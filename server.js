'use strict';

/**
 * 服装网店退换货处理系统 —— 后端服务
 * 角色：消费者 / 售后客服 / 仓库人员
 * 说明：仅模拟业务闭环，不接真实支付、快递与电商平台接口。
 */

const express = require('express');
const path = require('node:path');
const crypto = require('node:crypto');

const {
  db,
  now,
  addDays,
  hashPassword,
  SERVICE_DAYS,
  STATUS,
  ACTIVE,
  REASONS,
  ISSUE_TYPES,
  ROLE_LABEL,
  ACTIONS,
  SHIPPING_COMPANIES,
  DEFAULT_RETURN_ADDRESS,
} = require('./db');

const PORT = Number(process.env.PORT) || 3000;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/* ------------------------------------------------------------------ */
/* 基础工具                                                             */
/* ------------------------------------------------------------------ */

const sessions = new Map();

const CASE_SELECT = `
  SELECT c.*, o.order_no, o.completed_at, o.total_amount, o.receiver, o.address, o.channel,
         o.status AS order_status,
         i.title AS item_title, i.sku_no, i.color, i.size, i.unit_price, i.qty AS item_qty, i.hue,
         u.name AS buyer_name, u.phone AS buyer_phone
  FROM cases c
  JOIN orders o ON o.id = c.order_id
  JOIN order_items i ON i.id = c.order_item_id
  JOIN users u ON u.id = c.user_id
`;

const WAREHOUSE_VISIBLE = ['awaiting_return', 'return_shipped', 'received', 'inspected', 'inspect_issue', 'completed'];

function pad(n) {
  return String(n).padStart(2, '0');
}

function stamp(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function trim(v) {
  return String(v == null ? '' : v).trim();
}

function getCookie(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return null;
}

function publicUser(u) {
  return {
    id: u.id,
    name: u.name,
    phone: u.phone,
    role: u.role,
    roleLabel: ROLE_LABEL[u.role] || u.role,
    title: u.title,
  };
}

function needText(value, message, max = 300) {
  const s = trim(value);
  if (!s) throw new HttpError(400, message);
  if (s.length > max) throw new HttpError(400, `说明不能超过 ${max} 字`);
  return s;
}

function optionalText(value, max = 300) {
  const s = trim(value);
  if (s.length > max) throw new HttpError(400, `说明不能超过 ${max} 字`);
  return s;
}

function availableQty(itemId) {
  const item = db.prepare('SELECT qty FROM order_items WHERE id = ?').get(itemId);
  if (!item) return 0;
  const used = db
    .prepare("SELECT COALESCE(SUM(qty), 0) AS s FROM cases WHERE order_item_id = ? AND status NOT IN ('rejected','cancelled')")
    .get(itemId).s;
  return Math.max(0, item.qty - used);
}

function deadlineInfo(completedAt) {
  if (!completedAt) return { deadlineAt: null, overdue: false, daysLeft: null };
  const deadline = addDays(completedAt, SERVICE_DAYS);
  const diff = deadline.getTime() - Date.now();
  return {
    deadlineAt: stamp(deadline),
    overdue: diff < 0,
    daysLeft: Math.ceil(diff / 86400000),
  };
}

function nextNo(prefix, table, column) {
  const d = new Date();
  const head = `${prefix}${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} LIKE ?`).get(`${head}%`);
  return `${head}${String(row.n + 1).padStart(3, '0')}`;
}

/* ------------------------------------------------------------------ */
/* 权限：某张售后单当前用户可以执行哪些操作                              */
/* ------------------------------------------------------------------ */

function actionsFor(row, user) {
  const s = row.status;

  if (user.role === 'consumer') {
    if (row.user_id !== user.id) return [];
    if (s === 'need_info') return ['supplement', 'cancel'];
    if (s === 'pending_review') return ['cancel'];
    if (s === 'awaiting_return') return ['ship_back', 'cancel'];
    return [];
  }

  if (user.role === 'service') {
    if (s === 'pending_review') return ['approve', 'request_info', 'reject'];
    if (s === 'need_info') return ['reject'];
    if (s === 'rejected') return ['reopen'];
    if (s === 'inspected') return row.type === 'exchange' ? ['exchange', 'refund'] : ['refund'];
    if (s === 'inspect_issue') return ['resolve_issue'];
    return [];
  }

  if (user.role === 'warehouse') {
    if (s === 'awaiting_return' || s === 'return_shipped') return ['receive'];
    if (s === 'received') return ['inspect'];
    return [];
  }

  return [];
}

/* ------------------------------------------------------------------ */
/* 序列化                                                               */
/* ------------------------------------------------------------------ */

function baseCase(row, user) {
  const dl = deadlineInfo(row.completed_at);
  const insp = db
    .prepare('SELECT package_no, receive_note, received_at, received_by, result, issue_type, inspect_note, inspected_at, inspected_by FROM inspections WHERE case_id = ?')
    .get(row.id);
  return {
    id: row.id,
    caseNo: row.case_no,
    type: row.type,
    typeLabel: row.type === 'exchange' ? '换货' : '退货退款',
    reason: row.reason,
    reasonLabel: REASONS[row.reason] ? REASONS[row.reason].label : row.reason,
    qty: row.qty,
    description: row.description,
    exchangeSize: row.exchange_size,
    status: row.status,
    statusLabel: STATUS[row.status] || row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deadlineAt: dl.deadlineAt,
    overdue: dl.overdue,
    daysLeft: dl.daysLeft,
    order: {
      id: row.order_id,
      no: row.order_no,
      completedAt: row.completed_at,
      totalAmount: row.total_amount,
      channel: row.channel,
      address: row.address,
      receiver: row.receiver,
    },
    item: {
      id: row.order_item_id,
      title: row.item_title,
      sku: row.sku_no,
      color: row.color,
      size: row.size,
      unitPrice: row.unit_price,
      qty: row.item_qty,
      hue: row.hue,
    },
    buyer: { id: row.user_id, name: row.buyer_name, phone: row.buyer_phone },
    returnAddress: row.return_address,
    returnTracking: row.return_tracking,
    returnCompany: row.return_company,
    refundAmount: row.refund_amount,
    refundNo: row.refund_no,
    reshipTracking: row.reship_tracking,
    reshipCompany: row.reship_company,
    closeNote: row.close_note,
    availableQty: availableQty(row.order_item_id),
    suggestedRefund: Number((row.unit_price * row.qty).toFixed(2)),
    availableActions: actionsFor(row, user),
    inspection: insp
      ? {
          packageNo: insp.package_no,
          receiveNote: insp.receive_note,
          receivedAt: insp.received_at,
          receivedBy: insp.received_by,
          result: insp.result,
          issueType: insp.issue_type,
          issueTypeLabel: insp.issue_type ? ISSUE_TYPES[insp.issue_type] : null,
          note: insp.inspect_note,
          inspectedAt: insp.inspected_at,
          inspectedBy: insp.inspected_by,
        }
      : null,
  };
}

function caseDetail(row, user) {
  const data = baseCase(row, user);
  const insp = db.prepare('SELECT * FROM inspections WHERE case_id = ?').get(row.id);
  const attachments = db
    .prepare('SELECT id, scene, name, mime, created_at FROM attachments WHERE case_id = ? ORDER BY id')
    .all(row.id)
    .map((a) => ({ id: a.id, scene: a.scene, name: a.name, url: `/api/attachments/${a.id}`, createdAt: a.created_at }));

  const timeline = db
    .prepare('SELECT * FROM timeline WHERE case_id = ? ORDER BY created_at, id')
    .all(row.id)
    .map((t) => ({
      id: t.id,
      role: t.role,
      roleLabel: ROLE_LABEL[t.role] || '系统',
      actor: t.actor,
      action: t.action,
      actionLabel: ACTIONS[t.action] || t.action,
      note: t.note,
      statusFrom: t.status_from,
      statusTo: t.status_to,
      createdAt: t.created_at,
    }));

  data.attachments = attachments;
  data.timeline = timeline;
  data.inspection = insp
    ? {
        packageNo: insp.package_no,
        receiveNote: insp.receive_note,
        receivedAt: insp.received_at,
        receivedBy: insp.received_by,
        result: insp.result,
        issueType: insp.issue_type,
        issueTypeLabel: insp.issue_type ? ISSUE_TYPES[insp.issue_type] : null,
        note: insp.inspect_note,
        inspectedAt: insp.inspected_at,
        inspectedBy: insp.inspected_by,
      }
    : null;

  return data;
}

function loadCaseRow(id) {
  return db.prepare(`${CASE_SELECT} WHERE c.id = ?`).get(Number(id));
}

function assertVisible(row, user) {
  if (!row) throw new HttpError(404, '售后单不存在');
  if (user.role === 'consumer' && row.user_id !== user.id) {
    throw new HttpError(403, '无权查看他人的订单与售后资料');
  }
  if (user.role === 'warehouse' && !WAREHOUSE_VISIBLE.includes(row.status)) {
    throw new HttpError(403, '该售后单尚未进入仓库环节');
  }
}

/* ------------------------------------------------------------------ */
/* 操作定义（状态机）                                                   */
/* ------------------------------------------------------------------ */

const ACTION_DEFS = {
  approve: {
    roles: ['service'],
    states: ['pending_review'],
    run({ body }) {
      return {
        status: 'awaiting_return',
        action: 'approve',
        note: optionalText(body.note) || '客服审核通过，同意退回。请按退回指引在 48 小时内寄回商品。',
        fields: { return_address: optionalText(body.returnAddress, 200) || DEFAULT_RETURN_ADDRESS },
      };
    },
  },

  request_info: {
    roles: ['service'],
    states: ['pending_review'],
    run({ body }) {
      return {
        status: 'need_info',
        action: 'request_info',
        note: needText(body.note, '要求补充材料时，必须填写需要买家补充的内容'),
      };
    },
  },

  reject: {
    roles: ['service'],
    states: ['pending_review', 'need_info', 'inspect_issue'],
    run({ body }) {
      const note = needText(body.note, '拒绝申请时必须填写拒绝原因');
      return {
        status: 'rejected',
        action: 'reject',
        note,
        fields: { close_note: note },
      };
    },
  },

  reopen: {
    roles: ['service'],
    states: ['rejected'],
    run({ body }) {
      const note = needText(body.note, '重新审核需要填写说明');
      return { status: 'pending_review', action: 'reopen', note };
    },
  },

  receive: {
    roles: ['warehouse'],
    states: ['awaiting_return', 'return_shipped'],
    run({ body, user }) {
      const packageNo = optionalText(body.packageNo, 60);
      const note = optionalText(body.note) || `仓库已登记收货${packageNo ? `，包裹单号 ${packageNo}` : ''}，等待验货。`;
      return {
        status: 'received',
        action: 'receive',
        note,
        inspection: {
          package_no: packageNo || null,
          receive_note: optionalText(body.note) || null,
          received_at: now(),
          received_by: user.name,
        },
      };
    },
  },

  inspect: {
    roles: ['warehouse'],
    states: ['received'],
    run({ body, user }) {
      if (body.result === 'issue') {
        const issueType = ISSUE_TYPES[body.issueType] ? body.issueType : null;
        if (!issueType) throw new HttpError(400, '验货异常时必须选择异常类型');
        const note = needText(body.note, '验货异常必须填写具体说明');
        return {
          status: 'inspect_issue',
          action: 'inspect_issue',
          note: `【${ISSUE_TYPES[issueType]}】${note}`,
          inspection: {
            result: 'issue',
            issue_type: issueType,
            inspect_note: note,
            inspected_at: now(),
            inspected_by: user.name,
          },
        };
      }

      const note = optionalText(body.note) || '商品完好，吊牌与配件齐全，验货通过，等待客服处理。';
      return {
        status: 'inspected',
        action: 'inspect_pass',
        note,
        inspection: {
          result: 'pass',
          issue_type: null,
          inspect_note: note,
          inspected_at: now(),
          inspected_by: user.name,
        },
      };
    },
  },

  refund: {
    roles: ['service'],
    states: ['inspected'],
    run({ row, body }) {
      const amount = Number(body.amount);
      const cap = Number((row.unit_price * row.qty).toFixed(2));
      if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, '退款金额必须大于 0');
      if (amount > cap + 0.001) throw new HttpError(400, `退款金额不能超过本单商品金额 ¥${cap.toFixed(2)}`);
      const refundNo = nextNo('RF', 'cases', 'refund_no');
      const rounded = Number(amount.toFixed(2));
      const note =
        optionalText(body.note) ||
        `模拟退款 ¥${rounded.toFixed(2)} 已生成，退款单号 ${refundNo}（不接真实资金）。`;
      return {
        status: 'completed',
        action: 'refund',
        note,
        fields: {
          refund_amount: rounded,
          refund_no: refundNo,
          close_note: note,
        },
        extraNote: `模拟退款单号 ${refundNo}`,
      };
    },
  },

  exchange: {
    roles: ['service'],
    states: ['inspected'],
    run({ row, body }) {
      const tracking = needText(body.tracking, '换货补发必须填写补发快递单号', 60);
      const company = optionalText(body.company, 30) || '顺丰速运';
      const size = row.exchange_size ? ` ${row.exchange_size} 码` : '';
      const note = optionalText(body.note) || `换货补发已安排：${company} ${tracking}${size ? `（${size.trim()}）` : ''}，请买家注意查收。`;
      return {
        status: 'completed',
        action: 'exchange',
        note,
        fields: {
          reship_tracking: tracking,
          reship_company: company,
          close_note: note,
        },
        extraNote: `补发单号 ${tracking}`,
      };
    },
  },

  resolve_issue: {
    roles: ['service'],
    states: ['inspect_issue'],
    run({ row, body }) {
      const outcome = body.outcome;
      const note = needText(body.note, '处理验货异常必须填写结论说明');
      const cap = Number((row.unit_price * row.qty).toFixed(2));

      if (outcome === 'reject') {
        return {
          status: 'rejected',
          action: 'resolve_issue',
          note: `验货异常处理结论：拒绝申请。${note}`,
          fields: { close_note: `验货异常 · 拒绝申请：${note}` },
        };
      }

      if (outcome === 'refund') {
        const amount = Number(body.amount);
        if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, '退款金额必须大于 0');
        if (amount > cap + 0.001) throw new HttpError(400, `退款金额不能超过本单商品金额 ¥${cap.toFixed(2)}`);
        const refundNo = nextNo('RF', 'cases', 'refund_no');
        const rounded = Number(amount.toFixed(2));
        return {
          status: 'completed',
          action: 'resolve_issue',
          note: `验货异常处理结论：按 ¥${rounded.toFixed(2)} 部分退款。${note}（退款单号 ${refundNo}）`,
          fields: { refund_amount: rounded, refund_no: refundNo, close_note: `验货异常 · 部分退款 ¥${rounded.toFixed(2)}：${note}` },
          extraNote: `模拟退款单号 ${refundNo}`,
        };
      }

      if (outcome === 'exchange') {
        const tracking = needText(body.tracking, '补发必须填写补发快递单号', 60);
        const company = optionalText(body.company, 30) || '顺丰速运';
        return {
          status: 'completed',
          action: 'resolve_issue',
          note: `验货异常处理结论：仍按换货补发。${note}（${company} ${tracking}）`,
          fields: {
            reship_tracking: tracking,
            reship_company: company,
            close_note: `验货异常 · 仍补发 ${tracking}：${note}`,
          },
          extraNote: `补发单号 ${tracking}`,
        };
      }

      throw new HttpError(400, '请选择验货异常的处理结论');
    },
  },

  supplement: {
    roles: ['consumer'],
    states: ['need_info'],
    run({ body }) {
      const note = optionalText(body.note, 500);
      const files = parseUploads(body.attachments);
      if (!note && files.length === 0) throw new HttpError(400, '请填写补充说明或上传补充凭证');
      return {
        status: 'pending_review',
        action: 'supplement',
        note: note || '买家已补充凭证材料。',
        attachments: files,
        scene: 'supplement',
      };
    },
  },

  ship_back: {
    roles: ['consumer'],
    states: ['awaiting_return'],
    run({ body }) {
      const company = needText(body.company, '请选择快递公司', 30);
      const tracking = needText(body.tracking, '请填写寄回快递单号', 60);
      return {
        status: 'return_shipped',
        action: 'ship_back',
        note: `买家已寄回：${company} ${tracking}`,
        fields: { return_company: company, return_tracking: tracking },
      };
    },
  },

  cancel: {
    roles: ['consumer'],
    states: ['pending_review', 'need_info', 'awaiting_return'],
    run({ body }) {
      const note = optionalText(body.reason) || '买家主动撤销申请。';
      return {
        status: 'cancelled',
        action: 'cancel',
        note,
        fields: { close_note: note },
      };
    },
  },
};

/* ------------------------------------------------------------------ */
/* 凭证上传                                                             */
/* ------------------------------------------------------------------ */

function parseUploads(list, max = 5) {
  if (list == null) return [];
  if (!Array.isArray(list)) throw new HttpError(400, '凭证格式不正确');
  if (list.length > max) throw new HttpError(400, `最多上传 ${max} 张凭证`);
  return list.map((f) => {
    const m = /^data:(image\/(?:png|jpe?g|webp|gif|svg\+xml));base64,(.+)$/i.exec(String((f && f.dataUrl) || ''));
    if (!m) throw new HttpError(400, '仅支持 jpg / png / webp 格式的图片凭证');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 3 * 1024 * 1024) throw new HttpError(413, '单张图片不能超过 3MB，请压缩后重试');
    return { name: trim(f.name) || '凭证图片', mime: m[1], data: buf };
  });
}

/* ------------------------------------------------------------------ */
/* 应用                                                                 */
/* ------------------------------------------------------------------ */

function createApp() {
  const app = express();

  app.use(express.json({ limit: '12mb' }));

  app.use((req, res, next) => {
    const sid = getCookie(req, 'sid');
    const uid = sid ? sessions.get(sid) : null;
    if (uid) {
      const u = db.prepare('SELECT id, name, phone, role, title FROM users WHERE id = ?').get(uid);
      if (u) req.user = u;
    }
    next();
  });

  const requireAuth = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: '请先登录' });
    next();
  };

  const requireRole = (...roles) => (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: '请先登录' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: '当前岗位无权执行该操作' });
    next();
  };

  /* ---------------- 认证 ---------------- */

  app.post('/api/login', (req, res) => {
    const phone = trim(req.body && req.body.phone);
    const password = trim(req.body && req.body.password);
    const u = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
    if (!u || u.password_hash !== hashPassword(password)) {
      return res.status(401).json({ error: '手机号或密码不正确' });
    }
    const sid = crypto.randomUUID();
    sessions.set(sid, u.id);
    res.setHeader('Set-Cookie', `sid=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`);
    res.json(publicUser(u));
  });

  app.post('/api/logout', (req, res) => {
    const sid = getCookie(req, 'sid');
    if (sid) sessions.delete(sid);
    res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    res.json({ ok: true });
  });

  app.get('/api/me', (req, res) => {
    if (!req.user) return res.status(401).json({ error: '请先登录' });
    res.json(publicUser(req.user));
  });

  app.get('/api/meta', (req, res) => {
    res.json({
      serviceDays: SERVICE_DAYS,
      statuses: STATUS,
      reasons: Object.entries(REASONS).map(([value, v]) => ({ value, label: v.label, needProof: v.needProof })),
      issueTypes: Object.entries(ISSUE_TYPES).map(([value, label]) => ({ value, label })),
      companies: SHIPPING_COMPANIES,
      defaultReturnAddress: DEFAULT_RETURN_ADDRESS,
      roleLabels: ROLE_LABEL,
    });
  });

  /* ---------------- 消费者：订单 ---------------- */

  app.get('/api/orders', requireRole('consumer'), (req, res) => {
    const orders = db
      .prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY COALESCE(completed_at, created_at) DESC')
      .all(req.user.id);

    const result = orders.map((o) => {
      const items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(o.id);
      return {
        id: o.id,
        orderNo: o.order_no,
        status: o.status,
        statusLabel: o.status === 'completed' ? '已完成' : '运输中',
        totalAmount: o.total_amount,
        receiver: o.receiver,
        address: o.address,
        channel: o.channel,
        createdAt: o.created_at,
        completedAt: o.completed_at,
        ...deadlineInfo(o.completed_at),
        items: items.map((it) => {
          const active = db
            .prepare(
              `SELECT id, case_no, status, type FROM cases WHERE order_item_id = ? AND status IN (${ACTIVE.map(() => '?').join(',')}) ORDER BY id DESC LIMIT 1`
            )
            .get(it.id, ...ACTIVE);
          const avail = availableQty(it.id);
          const lastCase = db
            .prepare('SELECT id, case_no, status FROM cases WHERE order_item_id = ? ORDER BY id DESC LIMIT 1')
            .get(it.id);
          return {
            id: it.id,
            title: it.title,
            sku: it.sku_no,
            color: it.color,
            size: it.size,
            unitPrice: it.unit_price,
            qty: it.qty,
            hue: it.hue,
            availableQty: avail,
            activeCase: active
              ? { id: active.id, caseNo: active.case_no, status: active.status, statusLabel: STATUS[active.status] }
              : null,
            lastCase: lastCase
              ? { id: lastCase.id, caseNo: lastCase.case_no, statusLabel: STATUS[lastCase.status] }
              : null,
            applicable: o.status === 'completed' && avail > 0 && !active,
          };
        }),
      };
    });

    res.json(result);
  });

  /* ---------------- 售后单列表 ---------------- */

  app.get('/api/cases', requireAuth, (req, res) => {
    let rows = db.prepare(`${CASE_SELECT} ORDER BY c.updated_at DESC, c.id DESC`).all();

    if (req.user.role === 'consumer') {
      rows = rows.filter((r) => r.user_id === req.user.id);
    } else if (req.user.role === 'warehouse') {
      rows = rows.filter((r) => WAREHOUSE_VISIBLE.includes(r.status));
    }

    const bucket = trim(req.query.bucket);
    const bucketMap = {
      review: ['pending_review', 'need_info'],
      processing: ['awaiting_return', 'return_shipped', 'received', 'inspected', 'inspect_issue'],
      done: ['completed', 'rejected', 'cancelled'],
      receive: ['awaiting_return', 'return_shipped'],
      inspect: ['received'],
    };
    if (bucket && bucketMap[bucket]) {
      rows = rows.filter((r) => bucketMap[bucket].includes(r.status));
    }

    const status = trim(req.query.status);
    if (status && STATUS[status]) rows = rows.filter((r) => r.status === status);

    const q = trim(req.query.q).toLowerCase();
    if (q) {
      rows = rows.filter((r) =>
        [r.case_no, r.order_no, r.buyer_name, r.item_title, r.buyer_phone].join(' ').toLowerCase().includes(q)
      );
    }

    res.json(rows.map((r) => baseCase(r, req.user)));
  });

  /* ---------------- 工作台统计 ---------------- */

  app.get('/api/workbench', requireAuth, (req, res) => {
    let rows = db.prepare('SELECT status, type, updated_at FROM cases').all();
    if (req.user.role === 'consumer') return res.status(403).json({ error: '当前岗位无需工作台' });
    if (req.user.role === 'warehouse') rows = rows.filter((r) => WAREHOUSE_VISIBLE.includes(r.status));

    const count = (list) => rows.filter((r) => list.includes(r.status)).length;
    const today = now().slice(0, 10);

    res.json({
      pendingReview: count(['pending_review']),
      needInfo: count(['need_info']),
      awaitingReturn: count(['awaiting_return']),
      returnShipped: count(['return_shipped']),
      toResolve: count(['inspected', 'inspect_issue']),
      issueCount: count(['inspect_issue']),
      toReceive: count(['awaiting_return', 'return_shipped']),
      toInspect: count(['received']),
      inspectedToday: rows.filter((r) => (r.status === 'inspected' || r.status === 'inspect_issue') && (r.updated_at || '').slice(0, 10) === today).length,
      completedToday: rows.filter((r) => r.status === 'completed' && (r.updated_at || '').slice(0, 10) === today).length,
    });
  });

  /* ---------------- 售后单详情 ---------------- */

  app.get('/api/cases/:id', requireAuth, (req, res) => {
    const row = loadCaseRow(req.params.id);
    assertVisible(row, req.user);
    res.json(caseDetail(row, req.user));
  });

  /* ---------------- 创建售后单 ---------------- */

  app.post('/api/cases', requireRole('consumer'), (req, res) => {
    const body = req.body || {};
    const item = db
      .prepare(
        `SELECT i.*, o.user_id, o.status AS order_status, o.completed_at, o.order_no
         FROM order_items i JOIN orders o ON o.id = i.order_id WHERE i.id = ?`
      )
      .get(Number(body.orderItemId));

    if (!item) throw new HttpError(404, '订单商品不存在');
    if (item.user_id !== req.user.id) throw new HttpError(403, '只能对本人订单申请售后');
    if (item.order_status !== 'completed') throw new HttpError(409, '该订单尚未完成，暂不能申请售后');

    const type = body.type === 'exchange' ? 'exchange' : body.type === 'return' ? 'return' : null;
    if (!type) throw new HttpError(400, '请选择售后类型');
    if (!REASONS[body.reason]) throw new HttpError(400, '请选择申请原因');

    const qty = Number(body.qty);
    if (!Number.isInteger(qty) || qty < 1) throw new HttpError(400, '申请数量必须是大于 0 的整数');

    const avail = availableQty(item.id);
    const duplicate = db
      .prepare(`SELECT case_no FROM cases WHERE order_item_id = ? AND status IN (${ACTIVE.map(() => '?').join(',')})`)
      .get(item.id, ...ACTIVE);
    if (duplicate) {
      throw new HttpError(409, `该商品已有进行中的售后单 ${duplicate.case_no}，请先处理完成后再申请`);
    }
    if (avail <= 0) throw new HttpError(409, '该商品可售后数量已用完，无法再次申请');
    if (qty > avail) throw new HttpError(409, `该商品可售后数量为 ${avail} 件，无法申请 ${qty} 件`);

    const exchangeSize = optionalText(body.exchangeSize, 20);
    if (type === 'exchange' && !exchangeSize) throw new HttpError(400, '换货请填写期望更换的尺码或颜色');

    const files = parseUploads(body.attachments);

    const description = optionalText(body.description, 500);
    const caseNo = nextNo('AS', 'cases', 'case_no');
    const ts = now();
    const dl = deadlineInfo(item.completed_at);

    const info = db
      .prepare(
        `INSERT INTO cases (case_no, order_id, order_item_id, user_id, type, reason, qty, description,
          exchange_size, status, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        caseNo,
        item.order_id,
        item.id,
        req.user.id,
        type,
        body.reason,
        qty,
        description || null,
        exchangeSize || null,
        'pending_review',
        ts,
        ts
      );

    const caseId = Number(info.lastInsertRowid);

    const createdNote = `申请${type === 'exchange' ? '换货' : '退货退款'} ${qty} 件，原因：${REASONS[body.reason].label}${
      dl.overdue ? `（该订单已完成 ${SERVICE_DAYS + Math.abs(dl.daysLeft)} 天，超出 ${SERVICE_DAYS} 天受理期限）` : ''
    }`;

    db.prepare(
      `INSERT INTO timeline (case_id, role, actor, action, note, status_from, status_to, created_at)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(caseId, 'consumer', req.user.name, 'created', createdNote, null, 'pending_review', ts);

    const ins = db.prepare(
      'INSERT INTO attachments (case_id, scene, name, mime, data, uploaded_by, created_at) VALUES (?,?,?,?,?,?,?)'
    );
    for (const f of files) ins.run(caseId, 'apply', f.name, f.mime, f.data, req.user.id, ts);

    res.status(201).json(caseDetail(loadCaseRow(caseId), req.user));
  });

  /* ---------------- 执行操作 ---------------- */

  app.post('/api/cases/:id/actions', requireAuth, (req, res) => {
    const body = req.body || {};
    const action = trim(body.action);
    const def = ACTION_DEFS[action];
    if (!def) throw new HttpError(400, '未知操作');

    const row = loadCaseRow(req.params.id);
    if (!row) throw new HttpError(404, '售后单不存在');
    if (!def.roles.includes(req.user.role)) throw new HttpError(403, '当前岗位无权执行该操作');
    if (req.user.role === 'consumer' && row.user_id !== req.user.id) {
      throw new HttpError(403, '无权操作他人的售后单');
    }
    if (!def.states.includes(row.status)) {
      throw new HttpError(409, `当前状态为「${STATUS[row.status]}」，不能执行该操作`);
    }

    const result = def.run({ row, body, user: req.user });
    const ts = now();

    const fields = result.fields || {};
    const sets = ['status = ?', 'updated_at = ?'];
    const values = [result.status, ts];
    for (const [key, value] of Object.entries(fields)) {
      sets.push(`${key} = ?`);
      values.push(value);
    }

    db.prepare(`UPDATE cases SET ${sets.join(', ')} WHERE id = ?`).run(...values, row.id);

    db.prepare(
      `INSERT INTO timeline (case_id, role, actor, action, note, status_from, status_to, created_at)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(row.id, req.user.role, req.user.name, result.action, result.note, row.status, result.status, ts);

    if (result.inspection) {
      const insp = result.inspection;
      const exist = db.prepare('SELECT id FROM inspections WHERE case_id = ?').get(row.id);
      if (exist) {
        const keys = Object.keys(insp);
        db.prepare(`UPDATE inspections SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE case_id = ?`).run(
          ...keys.map((k) => insp[k]),
          row.id
        );
      } else {
        const keys = ['case_id', ...Object.keys(insp)];
        db.prepare(`INSERT INTO inspections (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(
          row.id,
          ...keys.slice(1).map((k) => insp[k])
        );
      }
    }

    if (result.attachments && result.attachments.length) {
      const ins = db.prepare(
        'INSERT INTO attachments (case_id, scene, name, mime, data, uploaded_by, created_at) VALUES (?,?,?,?,?,?,?)'
      );
      for (const f of result.attachments) {
        ins.run(row.id, result.scene || 'supplement', f.name, f.mime, f.data, req.user.id, ts);
      }
    }

    res.json(caseDetail(loadCaseRow(row.id), req.user));
  });

  /* ---------------- 凭证图片 ---------------- */

  app.get('/api/attachments/:id', requireAuth, (req, res) => {
    const row = db.prepare('SELECT * FROM attachments WHERE id = ?').get(Number(req.params.id));
    if (!row) return res.status(404).end();
    const c = loadCaseRow(row.case_id);
    try {
      assertVisible(c, req.user);
    } catch (e) {
      return res.status(e.status || 403).json({ error: e.message });
    }
    res.setHeader('Content-Type', row.mime);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.end(Buffer.from(row.data));
  });

  app.get('/api/health', (req, res) => res.json({ ok: true, time: now() }));

  /* ---------------- 静态资源 ---------------- */

  app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: '接口不存在' });
    next();
  });

  app.use((err, req, res, next) => {
    if (err && err.type === 'entity.too.large') {
      return res.status(413).json({ error: '上传内容过大，请压缩图片后重试' });
    }
    const status = err.status || 500;
    if (status >= 500) console.error('[server error]', err);
    res.status(status).json({ error: err.message || '服务器内部错误' });
  });

  return app;
}

if (require.main === module) {
  const app = createApp();
  app.listen(PORT, () => {
    console.log(`\n  衣返 · 服装网店退换货处理系统`);
    console.log(`  服务已启动：http://localhost:${PORT}\n`);
  });
}

module.exports = { createApp, sessions };
