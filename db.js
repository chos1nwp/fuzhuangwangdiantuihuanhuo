'use strict';

/**
 * 数据层：MySQL 建表 + 模拟数据
 * 说明：本项目为教学演示，所有订单、商品、退款、补发信息均为模拟数据，
 *      不接入真实电商平台、支付与快递接口。
 *
 * 连接配置从 .env 读取，未配置时使用本地默认值。
 */

const path = require('node:path');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');

// 存在 .env 就加载，没有也不报错（便于直接 npm start）
try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch {
  /* 忽略：使用默认配置 */
}

const DB = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'clothes_after_sale',
};

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

/**
 * 仅内部可见的时间线动作。
 * 仓库的收货、验货属于作业记录，消费者只看到状态变化，看不到包裹号、
 * 验货细节与内部备注；客服与仓库可以看全量。
 */
const INTERNAL_ACTIONS = new Set(['receive', 'inspect_pass', 'inspect_issue']);

/** 终态：进入后单据关闭并记录 closed_at */
const TERMINAL_STATUS = ['completed', 'rejected', 'cancelled'];

const DEFAULT_RETURN_ADDRESS = '浙江省杭州市余杭区文一西路 969 号 服装仓储中心 A 库 · 售后组（收） 0571-8888 6666';

const SHIPPING_COMPANIES = ['顺丰速运', '中通快递', '圆通速递', '韵达快递', '京东物流'];

/* ------------------------------------------------------------------ */
/* 建表语句                                                             */
/* ------------------------------------------------------------------ */

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
     id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
     name          VARCHAR(60)  NOT NULL,
     phone         VARCHAR(20)  NOT NULL,
     password_hash CHAR(64)     NOT NULL,
     role          VARCHAR(16)  NOT NULL,
     title         VARCHAR(100) DEFAULT NULL,
     created_at    DATETIME     NOT NULL,
     PRIMARY KEY (id),
     UNIQUE KEY uk_users_phone (phone)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS orders (
     id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
     order_no     VARCHAR(32)   NOT NULL,
     user_id      INT UNSIGNED  NOT NULL,
     status       VARCHAR(16)   NOT NULL COMMENT 'completed 已完成 / shipping 运输中',
     total_amount DECIMAL(10,2) NOT NULL,
     receiver     VARCHAR(60)   NOT NULL,
     phone        VARCHAR(20)   NOT NULL,
     address      VARCHAR(255)  NOT NULL,
     created_at   DATETIME      NOT NULL,
     completed_at DATETIME      DEFAULT NULL,
     channel      VARCHAR(100)  DEFAULT NULL,
     PRIMARY KEY (id),
     UNIQUE KEY uk_orders_no (order_no),
     KEY idx_orders_user (user_id),
     CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users (id)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS order_items (
     id         INT UNSIGNED  NOT NULL AUTO_INCREMENT,
     order_id   INT UNSIGNED  NOT NULL,
     title      VARCHAR(120)  NOT NULL,
     sku_no     VARCHAR(40)   NOT NULL,
     color      VARCHAR(30)   NOT NULL,
     size       VARCHAR(20)   NOT NULL,
     unit_price DECIMAL(10,2) NOT NULL,
     qty        INT           NOT NULL,
     hue        INT           NOT NULL DEFAULT 210,
     PRIMARY KEY (id),
     KEY idx_items_order (order_id),
     CONSTRAINT fk_items_order FOREIGN KEY (order_id) REFERENCES orders (id)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS cases (
     id              INT UNSIGNED  NOT NULL AUTO_INCREMENT,
     case_no         VARCHAR(32)   NOT NULL,
     order_id        INT UNSIGNED  NOT NULL,
     order_item_id   INT UNSIGNED  NOT NULL,
     user_id         INT UNSIGNED  NOT NULL,
     type            VARCHAR(16)   NOT NULL COMMENT 'return 退货 / exchange 换货',
     reason          VARCHAR(32)   NOT NULL,
     qty             INT           NOT NULL,
     description     TEXT,
     exchange_size   VARCHAR(30)   DEFAULT NULL,
     status          VARCHAR(24)   NOT NULL,
     return_address  VARCHAR(255)  DEFAULT NULL,
     return_tracking VARCHAR(60)   DEFAULT NULL,
     return_company  VARCHAR(40)   DEFAULT NULL,
     refund_amount   DECIMAL(10,2) DEFAULT NULL,
     refund_no       VARCHAR(32)   DEFAULT NULL,
     reship_tracking VARCHAR(60)   DEFAULT NULL,
     reship_company  VARCHAR(40)   DEFAULT NULL,
     close_note      TEXT,
     created_at      DATETIME      NOT NULL,
     updated_at      DATETIME      NOT NULL,
     closed_at       DATETIME      DEFAULT NULL COMMENT '进入终态的时间，用于统计与 SLA',
     PRIMARY KEY (id),
     UNIQUE KEY uk_cases_no (case_no),
     KEY idx_cases_user (user_id),
     KEY idx_cases_item (order_item_id),
     KEY idx_cases_status (status),
     CONSTRAINT fk_cases_order FOREIGN KEY (order_id) REFERENCES orders (id),
     CONSTRAINT fk_cases_item FOREIGN KEY (order_item_id) REFERENCES order_items (id),
     CONSTRAINT fk_cases_user FOREIGN KEY (user_id) REFERENCES users (id)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS attachments (
     id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
     case_id     INT UNSIGNED NOT NULL,
     scene       VARCHAR(16)  NOT NULL COMMENT 'apply / supplement',
     name        VARCHAR(120) NOT NULL,
     mime        VARCHAR(60)  NOT NULL,
     data        MEDIUMBLOB   NOT NULL,
     uploaded_by INT UNSIGNED NOT NULL,
     created_at  DATETIME     NOT NULL,
     PRIMARY KEY (id),
     KEY idx_attachments_case (case_id),
     CONSTRAINT fk_attachments_case FOREIGN KEY (case_id) REFERENCES cases (id)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS inspections (
     id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
     case_id      INT UNSIGNED NOT NULL,
     package_no   VARCHAR(60)  DEFAULT NULL,
     receive_note TEXT,
     received_at  DATETIME     DEFAULT NULL,
     received_by  VARCHAR(60)  DEFAULT NULL,
     result       VARCHAR(16)  DEFAULT NULL COMMENT 'pass / issue',
     issue_type   VARCHAR(32)  DEFAULT NULL,
     inspect_note TEXT,
     inspected_at DATETIME     DEFAULT NULL,
     inspected_by VARCHAR(60)  DEFAULT NULL,
     PRIMARY KEY (id),
     UNIQUE KEY uk_inspections_case (case_id),
     CONSTRAINT fk_inspections_case FOREIGN KEY (case_id) REFERENCES cases (id)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS timeline (
     id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
     case_id     INT UNSIGNED NOT NULL,
     role        VARCHAR(16)  NOT NULL,
     actor       VARCHAR(60)  NOT NULL,
     action      VARCHAR(32)  NOT NULL,
     note        TEXT,
     status_from VARCHAR(24)  DEFAULT NULL,
     status_to   VARCHAR(24)  DEFAULT NULL,
     visible_to_consumer TINYINT(1) NOT NULL DEFAULT 1 COMMENT '0=仅内部可见的仓库作业记录',
     created_at  DATETIME     NOT NULL,
     PRIMARY KEY (id),
     KEY idx_timeline_case (case_id),
     CONSTRAINT fk_timeline_case FOREIGN KEY (case_id) REFERENCES cases (id)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS chat_messages (
     id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
     consumer_id  INT UNSIGNED NOT NULL,
     service_id   INT UNSIGNED NOT NULL,
     sender_id    INT UNSIGNED NOT NULL,
     content      TEXT         NOT NULL,
     is_read      TINYINT(1)   NOT NULL DEFAULT 0,
     created_at   DATETIME     NOT NULL,
     PRIMARY KEY (id),
     KEY idx_chat_consumer (consumer_id),
     KEY idx_chat_service (service_id),
     KEY idx_chat_created (created_at),
     CONSTRAINT fk_chat_consumer FOREIGN KEY (consumer_id) REFERENCES users (id),
     CONSTRAINT fk_chat_service FOREIGN KEY (service_id) REFERENCES users (id),
     CONSTRAINT fk_chat_sender FOREIGN KEY (sender_id) REFERENCES users (id)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS inventory (
     id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
     sku_no        VARCHAR(40)  NOT NULL,
     title         VARCHAR(120) NOT NULL,
     color         VARCHAR(30)  NOT NULL,
     size          VARCHAR(20)  NOT NULL,
     stock_qty     INT          NOT NULL DEFAULT 0 COMMENT '当前库存数量',
     standard_qty  INT          NOT NULL DEFAULT 0 COMMENT '标准库存量，低于此值触发补货提醒',
     location      VARCHAR(60)  DEFAULT NULL COMMENT '库位',
     updated_at    DATETIME     NOT NULL,
     PRIMARY KEY (id),
     UNIQUE KEY uk_inventory_sku (sku_no, color, size),
     KEY idx_inventory_stock (stock_qty)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS replenishments (
     id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
     inventory_id   INT UNSIGNED NOT NULL,
     sku_no         VARCHAR(40)  NOT NULL,
     title          VARCHAR(120) NOT NULL,
     color          VARCHAR(30)  NOT NULL,
     size           VARCHAR(20)  NOT NULL,
     qty            INT          NOT NULL COMMENT '补货数量',
     supplier       VARCHAR(80)  DEFAULT NULL COMMENT '供应商/厂家',
     status         VARCHAR(20)  NOT NULL DEFAULT 'pending' COMMENT 'pending/shipped/received/cancelled',
     note           TEXT,
     created_by     INT UNSIGNED NOT NULL,
     created_at     DATETIME     NOT NULL,
     shipped_at     DATETIME     DEFAULT NULL,
     received_at    DATETIME     DEFAULT NULL,
     PRIMARY KEY (id),
     KEY idx_repl_inventory (inventory_id),
     KEY idx_repl_status (status),
     KEY idx_repl_created (created_at),
     CONSTRAINT fk_repl_inventory FOREIGN KEY (inventory_id) REFERENCES inventory (id),
     CONSTRAINT fk_repl_creator FOREIGN KEY (created_by) REFERENCES users (id)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

/* ------------------------------------------------------------------ */
/* 连接池与查询封装                                                     */
/* ------------------------------------------------------------------ */

let pool = null;
let q = null;

/** 把 mysql2 的返回结构统一成 get / all / run 三个方法 */
function bind(executor) {
  const call = async (sql, params) => {
    const [result] = params.length ? await executor.query(sql, params) : await executor.query(sql);
    return result;
  };

  return {
    get: async (sql, ...params) => (await call(sql, params))[0],
    all: async (sql, ...params) => call(sql, params),
    run: async (sql, ...params) => {
      const r = await call(sql, params);
      return { insertId: Number(r.insertId || 0), affectedRows: Number(r.affectedRows || 0) };
    },
  };
}

/**
 * 确保目标数据库存在。
 *
 * 先带 database 直连：库已存在就直接返回，不需要任何建库权限
 * （容器里通常只用被授权的业务账号，没有 CREATE DATABASE 权限）。
 * 只有库确实不存在（ER_BAD_DB_ERROR）时，才用同一账号尝试建库。
 */
async function ensureDatabase() {
  try {
    const conn = await mysql.createConnection({ ...DB, charset: 'utf8mb4' });
    await conn.end();
    return;
  } catch (err) {
    if (err.code !== 'ER_BAD_DB_ERROR') throw err;
  }

  const admin = await mysql.createConnection({
    host: DB.host,
    port: DB.port,
    user: DB.user,
    password: DB.password,
    charset: 'utf8mb4',
  });
  try {
    await admin.query(
      `CREATE DATABASE IF NOT EXISTS \`${DB.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
  } finally {
    await admin.end();
  }
}

/**
 * 轻量迁移：早期版本建的库缺少后加的字段。
 * 只在字段不存在时 ALTER，可重复执行；新库建表时已包含这些字段，这里会直接跳过。
 */
const MIGRATIONS = [
  {
    table: 'cases',
    column: 'closed_at',
    ddl: "ALTER TABLE cases ADD COLUMN closed_at DATETIME DEFAULT NULL COMMENT '进入终态的时间，用于统计与 SLA' AFTER updated_at",
  },
  {
    table: 'timeline',
    column: 'visible_to_consumer',
    ddl: 'ALTER TABLE timeline ADD COLUMN visible_to_consumer TINYINT(1) NOT NULL DEFAULT 1 AFTER status_to',
  },
];

async function migrate() {
  for (const m of MIGRATIONS) {
    const [rows] = await pool.query(
      `SELECT COUNT(*) AS n FROM information_schema.columns
        WHERE table_schema = ? AND table_name = ? AND column_name = ?`,
      [DB.database, m.table, m.column]
    );
    if (Number(rows[0].n) === 0) await pool.query(m.ddl);
  }

  // 回填：历史数据里仓库作业记录标记为内部，已结束的单据补上关闭时间
  await pool.query(
    "UPDATE timeline SET visible_to_consumer = 0 WHERE action IN ('receive','inspect_pass','inspect_issue') AND visible_to_consumer = 1"
  );
  await pool.query(
    "UPDATE cases SET closed_at = updated_at WHERE status IN ('completed','rejected','cancelled') AND closed_at IS NULL"
  );
}

/**
 * 初始化：建库 → 连接池 → 建表 → 首次写入模拟数据
 * 服务启动时调用一次。
 */
async function init() {
  if (pool) return pool;

  // 1. 确保目标库存在（已存在时无需管理员权限）
  await ensureDatabase();

  // 2. 连接池。dateStrings 让 DATETIME 以 'YYYY-MM-DD HH:MM:SS' 返回，
  //    decimalNumbers 让 DECIMAL 以数字返回，业务层无需再做转换。
  pool = mysql.createPool({
    ...DB,
    waitForConnections: true,
    connectionLimit: 10,
    charset: 'utf8mb4',
    dateStrings: true,
    decimalNumbers: true,
    timezone: 'local',
  });

  q = bind(pool);

  // 3. 建表 + 旧库补列 + 种子数据
  for (const sql of SCHEMA) {
    await pool.query(sql);
  }
  await migrate();
  await seed();

  return pool;
}

/** 普通查询：自动走连接池 */
async function get(sql, ...params) {
  return q.get(sql, ...params);
}
async function all(sql, ...params) {
  return q.all(sql, ...params);
}
async function run(sql, ...params) {
  return q.run(sql, ...params);
}

/**
 * 事务：把一组操作放进同一个连接，出错自动回滚。
 * 用法：await tx(async (t) => { await t.run(...); await t.get(...); });
 */
async function tx(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(bind(conn));
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

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

const PASSWORD = process.env.SEED_PASSWORD || '123456';

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

/** 首次启动时写入演示数据；已有用户则跳过 */
async function seed() {
  const row = await q.get('SELECT COUNT(*) AS n FROM users');
  if (Number(row.n) > 0) return false;

  const base = now();
  const pwd = hashPassword(PASSWORD);

  return tx(async (t) => {
    const uid = {};
    const users = [
      ['林小雨', '13800000001', 'consumer', '普通会员 · 上海'],
      ['陈嘉禾', '13800000002', 'consumer', '普通会员 · 杭州'],
      ['周可', '13800000003', 'consumer', '普通会员 · 成都'],
      ['苏晴', '13900000001', 'service', '售后客服 · 一组'],
      ['何楠', '13900000002', 'service', '售后客服 · 二组'],
      ['王建国', '13700000001', 'warehouse', '仓储售后组 · 验收员'],
    ];
    for (const [name, phone, role, title] of users) {
      const info = await t.run(
        'INSERT INTO users (name, phone, password_hash, role, title, created_at) VALUES (?,?,?,?,?,?)',
        name,
        phone,
        pwd,
        role,
        title,
        base
      );
      uid[phone] = info.insertId;
    }

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
      const info = await t.run(
        `INSERT INTO orders (order_no, user_id, status, total_amount, receiver, phone, address, created_at, completed_at, channel)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        o.no,
        uid[o.user],
        o.status,
        Number(o.items.reduce((s, i) => s + i[4] * i[5], 0).toFixed(2)),
        o.receiver,
        o.phone,
        o.address,
        o.created,
        o.completed,
        o.channel
      );
      const oid = info.insertId;
      for (const it of o.items) {
        const r = await t.run(
          'INSERT INTO order_items (order_id, title, sku_no, color, size, unit_price, qty, hue) VALUES (?,?,?,?,?,?,?,?)',
          oid,
          it[0],
          it[1],
          it[2],
          it[3],
          it[4],
          it[5],
          it[6]
        );
        itemId[it[1]] = { id: r.insertId, orderId: oid, price: it[4], qty: it[5] };
      }
    }

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

    const needAddress = ['awaiting_return', 'return_shipped', 'received', 'inspected', 'inspect_issue', 'completed'];

    for (const c of cases) {
      const it = itemId[c.item];
      const shipBack = c.timeline.find((t) => t[2] === 'ship_back');
      const info = await t.run(
        `INSERT INTO cases (case_no, order_id, order_item_id, user_id, type, reason, qty, description,
          exchange_size, status, return_address, return_tracking, return_company, refund_amount, refund_no,
          reship_tracking, reship_company, close_note, created_at, updated_at, closed_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
        c.return_address || (needAddress.includes(c.status) ? DEFAULT_RETURN_ADDRESS : null),
        shipBack ? shipBack[3].replace(/^已寄回：\S+\s*/, '') : null,
        shipBack ? shipBack[3].replace(/^已寄回：(\S+)\s*.*$/, '$1') : null,
        c.refund || null,
        c.refundNo || null,
        null,
        null,
        c.closeNote || null,
        c.created,
        c.updated,
        TERMINAL_STATUS.includes(c.status) ? c.updated : null
      );
      const cid = info.insertId;

      for (const t2 of c.timeline) {
        await t.run(
          `INSERT INTO timeline (case_id, role, actor, action, note, status_from, status_to, visible_to_consumer, created_at)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          cid,
          t2[0],
          t2[1],
          t2[2],
          t2[3],
          t2[4],
          t2[5],
          INTERNAL_ACTIONS.has(t2[2]) ? 0 : 1,
          t2[6]
        );
      }

      for (const p of c.photos || []) {
        const img = photo(p);
        await t.run(
          'INSERT INTO attachments (case_id, scene, name, mime, data, uploaded_by, created_at) VALUES (?,?,?,?,?,?,?)',
          cid,
          'apply',
          `${p.title}.svg`,
          img.mime,
          img.data,
          uid[c.owner],
          c.created
        );
      }

      if (c.inspection) {
        await t.run(
          `INSERT INTO inspections (case_id, package_no, receive_note, received_at, received_by, result, issue_type, inspect_note, inspected_at, inspected_by)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          cid,
          ...c.inspection
        );
      }
    }

    // 库存数据
    const inventoryItems = [
      ['SKU-SH-2201', '经典牛津纺宽松衬衫', '燕麦白', 'S', 45, 50, 'A-01-01'],
      ['SKU-SH-2201', '经典牛津纺宽松衬衫', '燕麦白', 'M', 32, 50, 'A-01-02'],
      ['SKU-SH-2201', '经典牛津纺宽松衬衫', '燕麦白', 'L', 8, 50, 'A-01-03'],
      ['SKU-SH-2201', '经典牛津纺宽松衬衫', '燕麦白', 'XL', 56, 40, 'A-01-04'],
      ['SKU-JN-1180', '高腰直筒牛仔裤', '深蓝', 'S', 28, 30, 'B-02-01'],
      ['SKU-JN-1180', '高腰直筒牛仔裤', '深蓝', 'M', 35, 30, 'B-02-02'],
      ['SKU-JN-1180', '高腰直筒牛仔裤', '深蓝', 'L', 12, 30, 'B-02-03'],
      ['SKU-TS-3301', '重磅纯棉短袖 T 恤', '白色', 'M', 120, 100, 'C-03-01'],
      ['SKU-TS-3301', '重磅纯棉短袖 T 恤', '白色', 'L', 98, 100, 'C-03-02'],
      ['SKU-TS-1002', '基础款纯棉 T 恤', '白色', 'M', 3, 50, 'C-04-01'],
      ['SKU-TS-1002', '基础款纯棉 T 恤', '白色', 'L', 60, 50, 'C-04-02'],
      ['SKU-HD-3320', '落肩廓形卫衣', '雾灰', 'M', 22, 25, 'D-05-01'],
      ['SKU-HD-3320', '落肩廓形卫衣', '雾灰', 'L', 18, 25, 'D-05-02'],
      ['SKU-HD-3320', '落肩廓形卫衣', '雾灰', 'XL', 5, 20, 'D-05-03'],
      ['SKU-BZ-9010', '羊毛混纺西装外套', '炭灰', 'M', 15, 20, 'E-06-01'],
      ['SKU-BZ-9010', '羊毛混纺西装外套', '炭灰', 'L', 25, 20, 'E-06-02'],
      ['SKU-PT-5501', '垂感阔腿休闲西裤', '黑色', 'S', 30, 25, 'F-07-01'],
      ['SKU-PT-5501', '垂感阔腿休闲西裤', '黑色', 'M', 28, 25, 'F-07-02'],
      ['SKU-KN-4402', '细针针织开衫', '奶油白', 'S', 40, 30, 'G-08-01'],
      ['SKU-DR-6608', '法式碎花连衣裙', '杏色', 'M', 10, 20, 'H-09-01'],
      ['SKU-CT-7702', '轻薄防晒外套', '浅灰', 'L', 8, 15, 'I-10-01'],
    ];
    for (const inv of inventoryItems) {
      await t.run(
        'INSERT INTO inventory (sku_no, title, color, size, stock_qty, standard_qty, location, updated_at) VALUES (?,?,?,?,?,?,?,?)',
        inv[0], inv[1], inv[2], inv[3], inv[4], inv[5], inv[6], base
      );
    }

    // 补货申请种子数据
    const whUserId = uid['13700000001']; // 王建国
    const pad = (n) => String(n).padStart(2, '0');
    const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    const baseDate = new Date(base.replace(' ', 'T'));

    const replenishments = [
      { skuIdx: 2, qty: 50, supplier: '上海锦泓制衣有限公司', status: 'pending', note: '尺码L库存不足，紧急补货', daysAgo: 1 },
      { skuIdx: 9, qty: 80, supplier: '宁波恒远针织厂', status: 'shipped', note: '基础款T恤 M码长期缺货', daysAgo: 3 },
      { skuIdx: 12, qty: 30, supplier: '杭州优品服饰', status: 'received', note: '卫衣XL码补货', daysAgo: 7 },
      { skuIdx: 19, qty: 25, supplier: '苏州韵致女装', status: 'pending', note: '碎花连衣裙M码', daysAgo: 0 },
    ];

    for (const repl of replenishments) {
      const invItem = inventoryItems[repl.skuIdx];
      const invRow = await t.get(
        'SELECT id FROM inventory WHERE sku_no = ? AND color = ? AND size = ?',
        invItem[0], invItem[2], invItem[3]
      );
      const createTime = fmt(new Date(baseDate.getTime() - repl.daysAgo * 86400000));
      const shippedAt = (repl.status === 'shipped' || repl.status === 'received')
        ? fmt(new Date(baseDate.getTime() - (repl.daysAgo - 1) * 86400000))
        : null;
      const receivedAt = repl.status === 'received'
        ? fmt(new Date(baseDate.getTime() - (repl.daysAgo - 3) * 86400000))
        : null;

      await t.run(
        `INSERT INTO replenishments
         (inventory_id, sku_no, title, color, size, qty, supplier, status, note, created_by, created_at, shipped_at, received_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        invRow.id, invItem[0], invItem[1], invItem[2], invItem[3],
        repl.qty, repl.supplier, repl.status, repl.note,
        whUserId, createTime, shippedAt, receivedAt
      );

      // 如果已收货，增加库存
      if (repl.status === 'received') {
        await t.run(
          'UPDATE inventory SET stock_qty = stock_qty + ?, updated_at = ? WHERE id = ?',
          repl.qty, receivedAt, invRow.id
        );
      }
    }

    // 聊天消息种子数据
    const chatSeeds = [
      {
        consumer: '13800000001',
        service: '13900000001',
        messages: [
          { from: 'consumer', content: '你好，我想咨询一下退换货流程', time: '2026-10-15 10:20:00', read: 1 },
          { from: 'service', content: '您好！请问有什么可以帮您的？', time: '2026-10-15 10:21:30', read: 1 },
          { from: 'consumer', content: '我那件衬衫袖口有点问题，想申请退货', time: '2026-10-15 10:22:00', read: 1 },
          { from: 'service', content: '好的，您可以在订单详情页点击"申请售后"，选择退货退款并上传凭证图片，客服会在24小时内审核。', time: '2026-10-15 10:23:00', read: 1 },
          { from: 'consumer', content: '好的，谢谢！', time: '2026-10-15 10:24:00', read: 1 },
        ],
      },
      {
        consumer: '13800000002',
        service: '13900000002',
        messages: [
          { from: 'consumer', content: '在吗？我的换货申请什么时候能处理？', time: '2026-10-18 14:30:00', read: 1 },
          { from: 'service', content: '您好，您的换货申请已经审核通过了，商品寄回后我们会尽快安排补发。', time: '2026-10-18 14:32:00', read: 1 },
          { from: 'consumer', content: '我已经寄出去了，中通快递 753128904561', time: '2026-10-18 14:35:00', read: 0 },
        ],
      },
    ];
    for (const chat of chatSeeds) {
      const cid = uid[chat.consumer];
      const sid = uid[chat.service];
      for (const msg of chat.messages) {
        await t.run(
          'INSERT INTO chat_messages (consumer_id, service_id, sender_id, content, is_read, created_at) VALUES (?,?,?,?,?,?)',
          cid, sid, msg.from === 'consumer' ? cid : sid, msg.content, msg.read, msg.time
        );
      }
    }

    return true;
  });
}

module.exports = {
  DB,
  init,
  getPool: () => pool,
  get,
  all,
  run,
  tx,
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
  INTERNAL_ACTIONS,
  TERMINAL_STATUS,
  SHIPPING_COMPANIES,
  DEFAULT_RETURN_ADDRESS,
  PASSWORD,
};
