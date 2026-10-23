'use strict';

/**
 * 数据层：SQLite 建表 + 模拟数据
 * 说明：本项目为教学演示，所有订单、商品、退款、补发信息均为模拟数据，
 *      不接入真实电商平台、支付与快递接口。
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'clothes.db');
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

/* ------------------------------------------------------------------ */
/* 业务常量                                                             */
/* ------------------------------------------------------------------ */

const SERVICE_DAYS = 15; // 售后受理期限：订单完成起 15 天

const STATUS = {
  pending_review: '待客服审核',
  need_info: '待买家补充',
  rejected: '已拒绝',
  awaiting_return: '待买家寄回',
  return_shipped: '退回途中',
  received: '已收货待验货',
  inspected: '验货通过待处理',
  inspect_issue: '验货异常',
  completed: '已完成',
  cancelled: '已撤销',
};

// 已经占用可售后数量的状态（拒绝 / 撤销不占用）
const CONSUMING = Object.keys(STATUS).filter((s) => s !== 'rejected' && s !== 'cancelled');

// 进行中的售后单（用于拦截重复申请）
const ACTIVE = [
  'pending_review',
  'need_info',
  'awaiting_return',
  'return_shipped',
  'received',
  'inspected',
  'inspect_issue',
];

const REASONS = {
  size_not_fit: { label: '尺码 / 版型不合适', needProof: false },
  no_reason: { label: '七天无理由退货', needProof: false },
  quality_issue: { label: '做工 / 质量瑕疵', needProof: true },
  damaged: { label: '收到时已破损 / 有污渍', needProof: true },
  wrong_item: { label: '错发 / 漏发', needProof: true },
  not_as_described: { label: '实物与描述不符', needProof: true },
  other: { label: '其他原因', needProof: false },
};

const ISSUE_TYPES = {
  item_mismatch: '退回商品与申请不符',
  damaged_extra: '商品存在额外损伤 / 污渍',
  missing_parts: '缺少吊牌 / 配件',
  qty_mismatch: '退回数量不符',
  other: '其他异常',
};

const ROLE_LABEL = { consumer: '消费者', service: '售后客服', warehouse: '仓库人员' };

const ACTIONS = {
  created: '提交售后申请',
  supplement: '补充材料',
  approve: '客服同意退回',
  request_info: '要求补充材料',
  reject: '拒绝申请',
  reopen: '重新审核',
  ship_back: '买家寄回商品',
  receive: '仓库登记收货',
  inspect_pass: '仓库验货通过',
  inspect_issue: '仓库验货异常',
  refund: '确认模拟退款',
  exchange: '确认换货补发',
  resolve_issue: '处理验货异常',
  cancel: '买家撤销申请',
};

const DEFAULT_RETURN_ADDRESS = '浙江省杭州市余杭区文一西路 969 号 服装仓储中心 A 库 · 售后组（收） 0571-8888 6666';

const SHIPPING_COMPANIES = ['顺丰速运', '中通快递', '圆通速递', '韵达快递', '京东物流'];

/* ------------------------------------------------------------------ */
/* 建表                                                                 */
/* ------------------------------------------------------------------ */

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  phone         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL,
  title         TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no     TEXT NOT NULL UNIQUE,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  status       TEXT NOT NULL,              -- completed 已完成 / shipping 运输中
  total_amount REAL NOT NULL,
  receiver     TEXT NOT NULL,
  phone        TEXT NOT NULL,
  address      TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  completed_at TEXT,
  channel      TEXT
);

CREATE TABLE IF NOT EXISTS order_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL REFERENCES orders(id),
  title      TEXT NOT NULL,
  sku_no     TEXT NOT NULL,
  color      TEXT NOT NULL,
  size       TEXT NOT NULL,
  unit_price REAL NOT NULL,
  qty        INTEGER NOT NULL,
  hue        INTEGER NOT NULL DEFAULT 210
);

CREATE TABLE IF NOT EXISTS cases (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  case_no        TEXT NOT NULL UNIQUE,
  order_id       INTEGER NOT NULL REFERENCES orders(id),
  order_item_id  INTEGER NOT NULL REFERENCES order_items(id),
  user_id        INTEGER NOT NULL REFERENCES users(id),
  type           TEXT NOT NULL,             -- return 退货 / exchange 换货
  reason         TEXT NOT NULL,
  qty            INTEGER NOT NULL,
  description    TEXT,
  exchange_size  TEXT,
  status         TEXT NOT NULL,
  return_address TEXT,
  return_tracking TEXT,
  return_company TEXT,
  refund_amount  REAL,
  refund_no      TEXT,
  reship_tracking TEXT,
  reship_company TEXT,
  close_note     TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attachments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id     INTEGER NOT NULL REFERENCES cases(id),
  scene       TEXT NOT NULL,                -- apply / supplement
  name        TEXT NOT NULL,
  mime        TEXT NOT NULL,
  data        BLOB NOT NULL,
  uploaded_by INTEGER NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inspections (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id       INTEGER NOT NULL UNIQUE REFERENCES cases(id),
  package_no    TEXT,
  receive_note  TEXT,
  received_at   TEXT,
  received_by   TEXT,
  result        TEXT,                       -- pass / issue
  issue_type    TEXT,
  inspect_note  TEXT,
  inspected_at  TEXT,
  inspected_by  TEXT
);

CREATE TABLE IF NOT EXISTS timeline (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id     INTEGER NOT NULL REFERENCES cases(id),
  role        TEXT NOT NULL,
  actor       TEXT NOT NULL,
  action      TEXT NOT NULL,
  note        TEXT,
  status_from TEXT,
  status_to   TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cases_user   ON cases(user_id);
CREATE INDEX IF NOT EXISTS idx_cases_item   ON cases(order_item_id);
CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status);
CREATE INDEX IF NOT EXISTS idx_items_order  ON order_items(order_id);
`);

/* ------------------------------------------------------------------ */
/* 工具                                                                 */
/* ------------------------------------------------------------------ */

function now() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function addDays(value, days) {
  const d = new Date(String(value).replace(' ', 'T'));
  d.setDate(d.getDate() + days);
  return d;
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(`${password}::cloth-after-sale-demo`).digest('hex');
}

/* ------------------------------------------------------------------ */
/* 种子数据                                                             */
/* ------------------------------------------------------------------ */

const PASSWORD = '123456';

function photo({ title, caption, hue = 210, kind = 'shirt' }) {
  const accent =
    kind === 'defect'
      ? `<circle cx="360" cy="300" r="46" fill="none" stroke="#d94a3d" stroke-width="3" stroke-dasharray="7 5"/>
         <circle cx="360" cy="300" r="9" fill="#d94a3d" opacity=".75"/>`
      : kind === 'tag'
        ? `<rect x="392" y="266" width="86" height="118" rx="8" fill="#fffdf7" stroke="#d8d2c2" stroke-width="2"/>
           <text x="435" y="304" font-family="'Microsoft YaHei',sans-serif" font-size="15" fill="#5b5647" text-anchor="middle">S / M / L</text>
           <text x="435" y="332" font-family="'Microsoft YaHei',sans-serif" font-size="13" fill="#8a8474" text-anchor="middle">100% COTTON</text>
           <circle cx="435" cy="360" r="8" fill="none" stroke="#c9c3b3" stroke-width="2"/>`
        : '';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${hue}, 30%, 94%)"/>
      <stop offset="1" stop-color="hsl(${hue + 20}, 24%, 86%)"/>
    </linearGradient>
    <linearGradient id="cloth" x1="0" y1="0" x2="0.3" y2="1">
      <stop offset="0" stop-color="hsl(${hue}, 16%, 97%)"/>
      <stop offset="1" stop-color="hsl(${hue}, 14%, 88%)"/>
    </linearGradient>
  </defs>
  <rect width="640" height="480" fill="url(#bg)"/>
  <circle cx="540" cy="80" r="130" fill="#ffffff" opacity=".35"/>
  <ellipse cx="320" cy="420" rx="180" ry="18" fill="#0f172a" opacity=".06"/>
  <path d="M247 130 L305 100 Q320 118 335 100 L393 130 L448 180 L410 226 L375 200 L375 392 Q320 412 265 392 L265 200 L230 226 L192 180 Z"
        fill="url(#cloth)" stroke="#c3cadb" stroke-width="2.5" stroke-linejoin="round"/>
  <path d="M305 100 Q320 148 335 100" fill="none" stroke="#b8c0d2" stroke-width="2.5"/>
  <line x1="320" y1="148" x2="320" y2="390" stroke="#d2d8e6" stroke-width="1.6" stroke-dasharray="5 6"/>
  <circle cx="320" cy="210" r="3.4" fill="#c3cadb"/>
  <circle cx="320" cy="256" r="3.4" fill="#c3cadb"/>
  <circle cx="320" cy="302" r="3.4" fill="#c3cadb"/>
  ${accent}
  <rect x="0" y="404" width="640" height="76" fill="#0f172a" opacity=".62"/>
  <text x="32" y="438" font-family="'Microsoft YaHei','PingFang SC',sans-serif" font-size="23" fill="#ffffff">${title}</text>
  <text x="32" y="464" font-family="'Microsoft YaHei','PingFang SC',sans-serif" font-size="15" fill="#d7dcea">${caption}</text>
</svg>`;
  return { mime: 'image/svg+xml', data: Buffer.from(svg, 'utf8') };
}

function seed() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count > 0) return false;

  const base = now();
  const pwd = hashPassword(PASSWORD);

  db.exec('BEGIN');

  const insertUser = db.prepare(
    'INSERT INTO users (name, phone, password_hash, role, title, created_at) VALUES (?,?,?,?,?,?)'
  );
  const uid = {};
  const users = [
    ['林小雨', '13800000001', 'consumer', '普通会员 · 上海', 'lin'],
    ['陈嘉禾', '13800000002', 'consumer', '普通会员 · 杭州', 'chen'],
    ['周可', '13800000003', 'consumer', '普通会员 · 成都', 'zhou'],
    ['苏晴', '13900000001', 'service', '售后客服 · 一组', 'su'],
    ['何楠', '13900000002', 'service', '售后客服 · 二组', 'he'],
    ['王建国', '13700000001', 'warehouse', '仓储售后组 · 验收员', 'wang'],
  ];
  for (const [name, phone, role, title] of users) {
    const info = insertUser.run(name, phone, pwd, role, title, base);
    uid[phone] = Number(info.lastInsertRowid);
  }

  const insertOrder = db.prepare(
    `INSERT INTO orders (order_no, user_id, status, total_amount, receiver, phone, address, created_at, completed_at, channel)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  );
  const insertItem = db.prepare(
    'INSERT INTO order_items (order_id, title, sku_no, color, size, unit_price, qty, hue) VALUES (?,?,?,?,?,?,?,?)'
  );

  const orderSeed = [
    {
      no: 'SO202610080001',
      user: '13800000001',
      status: 'completed',
      receiver: '林小雨',
      phone: '138****0001',
      address: '上海市徐汇区漕溪北路 88 号 3 号楼 1202',
      created: '2026-10-08 09:52:11',
      completed: '2026-10-12 10:24:00',
      channel: '模拟商城 · 天猫旗舰店',
      items: [
        ['经典牛津纺宽松衬衫', 'SKU-SH-2201', '燕麦白', 'L', 189, 2, 34],
        ['高腰直筒牛仔裤', 'SKU-JN-1180', '深蓝', 'M', 259, 1, 214],
        ['重磅纯棉短袖 T 恤', 'SKU-TS-3301', '白色', 'M', 129, 3, 200],
      ],
    },
    {
      no: 'SO202609280002',
      user: '13800000001',
      status: 'completed',
      receiver: '林小雨',
      phone: '138****0001',
      address: '上海市徐汇区漕溪北路 88 号 3 号楼 1202',
      created: '2026-09-28 18:20:06',
      completed: '2026-09-28 19:03:00',
      channel: '模拟商城 · 天猫旗舰店',
      items: [['落肩廓形卫衣', 'SKU-HD-3320', '雾灰', 'XL', 229, 1, 268]],
    },
    {
      no: 'SO202610210003',
      user: '13800000001',
      status: 'shipping',
      receiver: '林小雨',
      phone: '138****0001',
      address: '上海市徐汇区漕溪北路 88 号 3 号楼 1202',
      created: '2026-10-21 11:08:42',
      completed: null,
      channel: '模拟商城 · 天猫旗舰店',
      items: [['细针针织开衫', 'SKU-KN-4402', '奶油白', 'S', 299, 1, 42]],
    },
    {
      no: 'SO202610120004',
      user: '13800000002',
      status: 'completed',
      receiver: '陈嘉禾',
      phone: '138****0002',
      address: '浙江省杭州市西湖区文三路 478 号 2 幢 601',
      created: '2026-10-12 13:02:18',
      completed: '2026-10-15 14:11:00',
      channel: '模拟商城 · 微信小店',
      items: [
        ['羊毛混纺西装外套', 'SKU-BZ-9010', '炭灰', 'M', 499, 1, 218],
        ['基础款纯棉 T 恤', 'SKU-TS-1002', '白色', 'M', 99, 2, 200],
      ],
    },
    {
      no: 'SO202610150005',
      user: '13800000002',
      status: 'completed',
      receiver: '陈嘉禾',
      phone: '138****0002',
      address: '浙江省杭州市西湖区文三路 478 号 2 幢 601',
      created: '2026-10-15 09:12:30',
      completed: '2026-10-18 09:40:00',
      channel: '模拟商城 · 微信小店',
      items: [['垂感阔腿休闲西裤', 'SKU-PT-5501', '黑色', 'S', 329, 1, 250]],
    },
    {
      no: 'SO202610050006',
      user: '13800000003',
      status: 'completed',
      receiver: '周可',
      phone: '138****0003',
      address: '四川省成都市武侯区科华北路 62 号 1 单元 1804',
      created: '2026-10-05 15:40:09',
      completed: '2026-10-09 16:30:00',
      channel: '模拟商城 · 抖音店铺',
      items: [
        ['法式碎花连衣裙', 'SKU-DR-6608', '杏色', 'M', 359, 1, 24],
        ['轻薄防晒外套', 'SKU-CT-7702', '浅灰', 'L', 199, 1, 190],
      ],
    },
  ];

  const itemId = {};
  for (const o of orderSeed) {
    const info = insertOrder.run(
      o.no,
      uid[o.user],
      o.status,
      o.items.reduce((s, i) => s + i[4] * i[5], 0),
      o.receiver,
      o.phone,
      o.address,
      o.created,
      o.completed,
      o.channel
    );
    const oid = Number(info.lastInsertRowid);
    for (const it of o.items) {
      const r = insertItem.run(oid, it[0], it[1], it[2], it[3], it[4], it[5], it[6]);
      itemId[it[1]] = { id: Number(r.lastInsertRowid), orderId: oid, price: it[4], qty: it[5] };
    }
  }

  const insertCase = db.prepare(
    `INSERT INTO cases (case_no, order_id, order_item_id, user_id, type, reason, qty, description,
      exchange_size, status, return_address, return_tracking, return_company, refund_amount, refund_no,
      reship_tracking, reship_company, close_note, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );
  const insertTimeline = db.prepare(
    `INSERT INTO timeline (case_id, role, actor, action, note, status_from, status_to, created_at)
     VALUES (?,?,?,?,?,?,?,?)`
  );
  const insertAttachment = db.prepare(
    'INSERT INTO attachments (case_id, scene, name, mime, data, uploaded_by, created_at) VALUES (?,?,?,?,?,?,?)'
  );
  const insertInspection = db.prepare(
    `INSERT INTO inspections (case_id, package_no, receive_note, received_at, received_by, result, issue_type, inspect_note, inspected_at, inspected_by)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  );

  const cases = [
    {
      no: 'AS20261014001',
      item: 'SKU-SH-2201',
      owner: '13800000001',
      type: 'return',
      reason: 'quality_issue',
      qty: 1,
      desc: '衬衫左袖口走线开裂约 3 厘米，收到时就是这样，希望退货退款。',
      status: 'inspected',
      created: '2026-10-14 09:12:00',
      updated: '2026-10-17 14:02:00',
      timeline: [
        ['consumer', '林小雨', 'created', '申请退货 1 件，原因：做工 / 质量瑕疵', null, 'pending_review', '2026-10-14 09:12:00'],
        ['service', '苏晴', 'approve', '凭证清晰，同意退回。请保持吊牌完整，48 小时内寄回。', 'pending_review', 'awaiting_return', '2026-10-14 10:05:00'],
        ['consumer', '林小雨', 'ship_back', '已寄回：顺丰速运 SF7382910456', 'awaiting_return', 'return_shipped', '2026-10-15 08:30:00'],
        ['warehouse', '王建国', 'receive', '包裹完好，外箱无破损，已入库待验。', 'return_shipped', 'received', '2026-10-17 11:20:00'],
        ['warehouse', '王建国', 'inspect_pass', '袖口开裂属实，吊牌完整，符合退回标准。', 'received', 'inspected', '2026-10-17 14:02:00'],
      ],
      inspection: ['SF7382910456', '包裹完好，外箱无破损', '2026-10-17 11:20:00', '王建国', 'pass', null, '袖口开裂属实，吊牌完整，符合退回标准', '2026-10-17 14:02:00', '王建国'],
      photos: [
        { title: '袖口走线开裂', caption: '买家上传凭证 · 2026-10-14 09:08', hue: 30, kind: 'defect' },
        { title: '商品整体与吊牌', caption: '买家上传凭证 · 2026-10-14 09:09', hue: 34, kind: 'tag' },
      ],
    },
    {
      no: 'AS20261016002',
      item: 'SKU-BZ-9010',
      owner: '13800000002',
      type: 'exchange',
      reason: 'size_not_fit',
      qty: 1,
      desc: 'M 码肩宽偏窄，想换成 L 码，商品未穿着、吊牌完整。',
      exchangeSize: 'L',
      status: 'received',
      created: '2026-10-16 20:11:00',
      updated: '2026-10-20 15:40:00',
      return_address: DEFAULT_RETURN_ADDRESS,
      timeline: [
        ['consumer', '陈嘉禾', 'created', '申请换货 1 件，原因：尺码 / 版型不合适，期望换 L 码', null, 'pending_review', '2026-10-16 20:11:00'],
        ['service', '苏晴', 'approve', '同意换货，请于 48 小时内寄回原件，收到后安排补发 L 码。', 'pending_review', 'awaiting_return', '2026-10-17 09:30:00'],
        ['consumer', '陈嘉禾', 'ship_back', '已寄回：中通快递 753128904561', 'awaiting_return', 'return_shipped', '2026-10-18 10:00:00'],
        ['warehouse', '王建国', 'receive', '包裹已到仓，共 1 件，待验货。', 'return_shipped', 'received', '2026-10-20 15:40:00'],
      ],
      inspection: ['753128904561', '包裹已到仓，共 1 件', '2026-10-20 15:40:00', '王建国', null, null, null, null, null],
      photos: [{ title: '吊牌尺码标识', caption: '买家上传凭证 · 2026-10-16 20:05', hue: 205, kind: 'tag' }],
    },
    {
      no: 'AS20261022003',
      item: 'SKU-HD-3320',
      owner: '13800000001',
      type: 'return',
      reason: 'quality_issue',
      qty: 1,
      desc: '卫衣下摆有明显起球，洗过一次后更严重，申请退货。',
      status: 'pending_review',
      created: '2026-10-22 21:05:00',
      updated: '2026-10-22 21:05:00',
      timeline: [
        ['consumer', '林小雨', 'created', '申请退货 1 件，原因：做工 / 质量瑕疵（该订单已完成 24 天，超出 15 天受理期限）', null, 'pending_review', '2026-10-22 21:05:00'],
      ],
      photos: [{ title: '下摆起球细节', caption: '买家上传凭证 · 2026-10-22 21:01', hue: 262, kind: 'defect' }],
    },
    {
      no: 'AS20261017004',
      item: 'SKU-TS-1002',
      owner: '13800000002',
      type: 'return',
      reason: 'size_not_fit',
      qty: 1,
      desc: '白色 T 恤两件都偏大，想退一件。',
      status: 'need_info',
      created: '2026-10-17 12:40:00',
      updated: '2026-10-17 15:20:00',
      timeline: [
        ['consumer', '陈嘉禾', 'created', '申请退货 1 件，原因：尺码 / 版型不合适', null, 'pending_review', '2026-10-17 12:40:00'],
        ['service', '何楠', 'request_info', '请补充吊牌与洗标照片，并说明商品是否已下水洗涤。', 'pending_review', 'need_info', '2026-10-17 15:20:00'],
      ],
      photos: [],
    },
    {
      no: 'AS20261010005',
      item: 'SKU-DR-6608',
      owner: '13800000003',
      type: 'return',
      reason: 'not_as_described',
      qty: 1,
      desc: '裙长比页面标注短了约 8 厘米，与描述不符。',
      status: 'completed',
      created: '2026-10-10 10:02:00',
      updated: '2026-10-12 17:20:00',
      refund: 359,
      refundNo: 'RF20261012001',
      closeNote: '退款已完成（模拟），款项原路退回。',
      timeline: [
        ['consumer', '周可', 'created', '申请退货 1 件，原因：实物与描述不符', null, 'pending_review', '2026-10-10 10:02:00'],
        ['service', '苏晴', 'approve', '同意退回，请按指引寄回。', 'pending_review', 'awaiting_return', '2026-10-10 11:15:00'],
        ['consumer', '周可', 'ship_back', '已寄回：圆通速递 YT9930211456', 'awaiting_return', 'return_shipped', '2026-10-11 09:20:00'],
        ['warehouse', '王建国', 'receive', '已收到退回包裹，1 件。', 'return_shipped', 'received', '2026-10-12 09:05:00'],
        ['warehouse', '王建国', 'inspect_pass', '实物与描述一致，裙长 108cm，符合退回标准。', 'received', 'inspected', '2026-10-12 10:30:00'],
        ['service', '苏晴', 'refund', '模拟退款 ¥359.00 已生成，退款单号 RF20261012001。', 'inspected', 'completed', '2026-10-12 17:20:00'],
      ],
      photos: [{ title: '裙长实测', caption: '买家上传凭证 · 2026-10-10 09:58', hue: 20, kind: 'defect' }],
    },
    {
      no: 'AS20261019006',
      item: 'SKU-CT-7702',
      owner: '13800000003',
      type: 'return',
      reason: 'damaged',
      qty: 1,
      desc: '外套左袖有一块油渍，拆包后即发现。',
      status: 'return_shipped',
      created: '2026-10-19 14:22:00',
      updated: '2026-10-21 08:15:00',
      timeline: [
        ['consumer', '周可', 'created', '申请退货 1 件，原因：收到时已破损 / 有污渍', null, 'pending_review', '2026-10-19 14:22:00'],
        ['service', '何楠', 'approve', '凭证有效，同意退回，请保持原包装。', 'pending_review', 'awaiting_return', '2026-10-19 16:40:00'],
        ['consumer', '周可', 'ship_back', '已寄回：韵达快递 431209887765', 'awaiting_return', 'return_shipped', '2026-10-21 08:15:00'],
      ],
      photos: [{ title: '袖口油渍', caption: '买家上传凭证 · 2026-10-19 14:18', hue: 195, kind: 'defect' }],
    },
  ];

  for (const c of cases) {
    const it = itemId[c.item];
    const info = insertCase.run(
      c.no,
      it.orderId,
      it.id,
      uid[c.owner],
      c.type,
      c.reason,
      c.qty,
      c.desc,
      c.exchangeSize || null,
      c.status,
      c.return_address || (['awaiting_return', 'return_shipped', 'received', 'inspected', 'inspect_issue', 'completed'].includes(c.status) ? DEFAULT_RETURN_ADDRESS : null),
      c.timeline.find((t) => t[2] === 'ship_back') ? c.timeline.find((t) => t[2] === 'ship_back')[3].replace(/^已寄回：\S+\s*/, '') : null,
      c.timeline.find((t) => t[2] === 'ship_back') ? c.timeline.find((t) => t[2] === 'ship_back')[3].replace(/^已寄回：(\S+)\s*.*$/, '$1') : null,
      c.refund || null,
      c.refundNo || null,
      null,
      null,
      c.closeNote || null,
      c.created,
      c.updated
    );
    const cid = Number(info.lastInsertRowid);

    for (const t of c.timeline) {
      insertTimeline.run(cid, t[0], t[1], t[2], t[3], t[4], t[5], t[6]);
    }

    for (const p of c.photos || []) {
      const img = photo(p);
      insertAttachment.run(cid, 'apply', `${p.title}.svg`, img.mime, img.data, uid[c.owner], c.created);
    }

    if (c.inspection) {
      insertInspection.run(cid, ...c.inspection);
    }
  }

  db.exec('COMMIT');
  return true;
}

seed();

module.exports = {
  db,
  DB_FILE,
  now,
  addDays,
  hashPassword,
  SERVICE_DAYS,
  STATUS,
  CONSUMING,
  ACTIVE,
  REASONS,
  ISSUE_TYPES,
  ROLE_LABEL,
  ACTIONS,
  SHIPPING_COMPANIES,
  DEFAULT_RETURN_ADDRESS,
  PASSWORD,
};
