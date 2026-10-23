'use strict';

/* ==========================================================================
   衣返 · 服装网店退换货处理系统 —— 前端应用
   单页应用，无构建步骤：原生 JS + 服务端 REST 接口
   ========================================================================== */

/* ------------------------------ 图标 ------------------------------ */

const ICON_PATHS = {
  bag: '<path d="M6 7h12l1 14H5L6 7z"/><path d="M9 7V5.2A3 3 0 0 1 12 2a3 3 0 0 1 3 3.2V7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5l3 1.8"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.6 5h12.8L22 12v7a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-7L5.6 5z"/>',
  list: '<path d="M8.5 6h12M8.5 12h12M8.5 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  warehouse: '<path d="M3 21V9.4L12 3l9 6.4V21"/><path d="M9 21v-6h6v6"/>',
  box: '<path d="M21 8l-9-5-9 5v8l9 5 9-5V8z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  truck: '<path d="M3 7h11v9H3z"/><path d="M14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="1.8"/><circle cx="17.5" cy="18" r="1.8"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="M8.3 12.4l2.5 2.5 4.9-5.2"/>',
  alert: '<path d="M10.3 3.7L1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 21c0-4 3.4-6 7.5-6s7.5 2 7.5 6"/>',
  shield: '<path d="M12 22s8-4 8-10V5.4L12 2 4 5.4V12c0 6 8 10 8 10z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>',
  arrow: '<path d="M4 12h15M13 6l6 6-6 6"/>',
  chevron: '<path d="M9 5l7 7-7 7"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.6" cy="8.6" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  exchange: '<path d="M4 8h13l-3.2-3.2M20 16H7l3.2 3.2"/>',
  return: '<path d="M9 14L4.8 9.8 9 5.6"/><path d="M4.8 9.8h9.4a5 5 0 0 1 0 10h-3"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 11h18"/>',
  refresh: '<path d="M20.5 12a8.5 8.5 0 1 1-2.7-6.2"/><path d="M21 4v4.5h-4.5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  pin: '<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z"/><path d="M14 3v5h5"/>',
  tag: '<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0l-8-8V4h8.6l9.4 9.4z"/><circle cx="7.6" cy="7.6" r="1.2"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  scissors: '<circle cx="6" cy="6" r="2.4"/><circle cx="6" cy="18" r="2.4"/><path d="M8.2 7.8L20 19M8.2 16.2L20 5"/>',
};

function icon(name, size = 18) {
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ''}</svg>`;
}

/* ------------------------------ 工具 ------------------------------ */

const state = {
  user: null,
  meta: null,
  orders: [],
  panel: { action: null, inspect: 'pass', outcome: 'refund' },
  uploadFiles: [],
};

const qs = (sel, root = document) => root.querySelector(sel);
const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const money = (n) => `¥${Number(n || 0).toFixed(2)}`;
const fmtDT = (s) => (s ? String(s).slice(5, 16) : '—');
const fmtFull = (s) => (s ? String(s) : '—');
const roleClass = (role) => (role === 'service' ? 'violet' : role === 'warehouse' ? 'teal' : '');

function todayLabel() {
  const d = new Date();
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 · ${week}`;
}

function deadlineChip(c) {
  if (!c.deadlineAt) return '';
  if (c.overdue) return `<span class="chip overdue">${icon('alert', 12)} 已超期 ${Math.abs(c.daysLeft)} 天</span>`;
  if (c.daysLeft <= 2) return `<span class="chip overdue">售后期限剩 ${c.daysLeft} 天</span>`;
  return `<span class="chip">售后期限至 ${c.deadlineAt.slice(5, 10)}</span>`;
}

function statusPill(status, label, lg = false) {
  return `<span class="pill st-${status}${lg ? ' lg' : ''}"><i></i>${esc(label)}</span>`;
}

function thumb(item, cls = '') {
  const h = item.hue == null ? 210 : item.hue;
  return `<span class="thumb ${cls}" style="--h:${h}" aria-hidden="true">
    <svg width="${cls === 'lg' ? 40 : 28}" height="${cls === 'lg' ? 40 : 28}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round">
      <path d="M8 5.2L10.6 3.6a2.6 2.6 0 0 1 2.8 0L16 5.2l3.4 3.9-2.6 2.3-1.6-1.4v9a1.4 1.4 0 0 1-1.4 1.4H10.2a1.4 1.4 0 0 1-1.4-1.4v-9L7.2 11.4 4.6 9.1 8 5.2z"/>
      <path d="M10.6 3.6c.4 1.3 2.4 1.3 2.8 0"/>
    </svg>
  </span>`;
}

/* ------------------------------ 接口 ------------------------------ */

async function api(url, options = {}) {
  const res = await fetch(url, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }
  if (!res.ok) {
    if (res.status === 401 && state.user) {
      state.user = null;
      renderLogin('登录状态已失效，请重新登录');
    }
    const err = new Error((data && data.error) || `请求失败（${res.status}）`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/* ------------------------------ 提示与弹层 ------------------------------ */

function toast(message, type = '') {
  const root = qs('#toast-root');
  while (root.children.length >= 3) root.firstElementChild.remove();
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `${type === 'ok' ? icon('checkCircle', 15) : type === 'error' ? icon('alert', 15) : ''}<span>${esc(message)}</span>`;
  root.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 220);
  }, 3200);
}

function openModal(html) {
  const root = qs('#modal-root');
  root.innerHTML = `<div class="modal-backdrop" id="modal-backdrop">${html}</div>`;
  document.body.style.overflow = 'hidden';
  const backdrop = qs('#modal-backdrop');
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) closeModal();
  });
}

function closeModal() {
  qs('#modal-root').innerHTML = '';
  document.body.style.overflow = '';
}

/* ------------------------------ 导航配置 ------------------------------ */

const NAV = {
  consumer: [
    { key: 'orders', hash: '#/orders', label: '我的订单', icon: 'bag' },
    { key: 'my-cases', hash: '#/my-cases', label: '我的售后', icon: 'clock' },
  ],
  service: [
    { key: 'workbench', hash: '#/workbench', label: '客服工作台', icon: 'inbox' },
    { key: 'library', hash: '#/library', label: '售后单库', icon: 'list' },
  ],
  warehouse: [
    { key: 'warehouse', hash: '#/warehouse', label: '收货验货台', icon: 'warehouse' },
    { key: 'library', hash: '#/library', label: '退回记录', icon: 'list' },
  ],
};

const PAGE_META = {
  orders: { title: '我的订单', desc: '选择已完成的模拟订单商品，发起退货或换货申请' },
  'my-cases': { title: '我的售后', desc: '查看每张售后单的进度、处理说明与凭证' },
  workbench: { title: '客服工作台', desc: '审核申请、跟进退回、处理验货异常与争议' },
  warehouse: { title: '收货验货台', desc: '登记退回包裹，记录验货事实与异常' },
  library: { title: '售后单库', desc: '按单号、买家或商品检索全部售后单' },
  case: { title: '售后单详情', desc: '一张单据上的完整协作记录' },
};

function defaultHash() {
  return (NAV[state.user.role] || NAV.consumer)[0].hash;
}

function syncNav(key) {
  qsa('.nav-item').forEach((el) => el.classList.toggle('active', el.dataset.key === key));
}

function topbar(title, desc, extra = '') {
  return `<div class="topbar">
    <div>
      <h1>${esc(title)}</h1>
      <p class="desc">${esc(desc)}</p>
    </div>
    <div class="topbar-right">
      ${extra}
      <span class="date-chip">${icon('calendar', 14)}${todayLabel()}</span>
    </div>
  </div>`;
}

/* ==========================================================================
   登录
   ========================================================================== */

function renderLogin(errorMessage) {
  const demo = [
    { name: '林小雨', phone: '13800000001', role: '消费者', desc: '有 3 笔模拟订单' },
    { name: '陈嘉禾', phone: '13800000002', role: '消费者', desc: '有进行中的售后' },
    { name: '苏晴', phone: '13900000001', role: '售后客服', desc: '负责审核与处理' },
    { name: '王建国', phone: '13700000001', role: '仓库人员', desc: '负责收货与验货' },
  ];

  qs('#root').innerHTML = `
  <div class="login-page">
    <div class="login-card">
      <aside class="login-aside">
        <div class="brand">
          <span class="brand-mark">${icon('box', 21)}</span>
          <div>
            <div class="brand-name">衣返</div>
            <div class="brand-sub">AFTER-SALE DESK</div>
          </div>
        </div>

        <h1>让每一次退换货，<br/>都走成<em>一条清晰的流程</em>。</h1>
        <p class="lede">消费者、售后客服与仓库人员在同一张售后单上协作。每一次状态变化，都留下岗位、时间与说明。</p>

        <div class="flow-mini">
          <div class="flow-mini-item">
            <span class="flow-mini-dot">1</span>
            <div><div class="flow-mini-title">买家提交申请</div><div class="flow-mini-desc">选订单商品，说明原因并上传凭证</div></div>
          </div>
          <div class="flow-mini-item">
            <span class="flow-mini-dot">2</span>
            <div><div class="flow-mini-title">客服审核</div><div class="flow-mini-desc">同意退回、要求补充或拒绝并写明原因</div></div>
          </div>
          <div class="flow-mini-item">
            <span class="flow-mini-dot">3</span>
            <div><div class="flow-mini-title">仓库收货与验货</div><div class="flow-mini-desc">登记包裹，记录验货事实与异常</div></div>
          </div>
          <div class="flow-mini-item">
            <span class="flow-mini-dot">4</span>
            <div><div class="flow-mini-title">客服确认结果</div><div class="flow-mini-desc">模拟退款或换货补发，售后单关闭</div></div>
          </div>
        </div>

        <div class="login-foot">${icon('shield', 13)} 教学演示项目 · 不接入真实支付、物流与电商平台</div>
      </aside>

      <section class="login-form">
        <div>
          <h2>登录售后协作台</h2>
          <p class="sub">选择岗位后，使用演示账号进入对应工作台</p>
        </div>

        <div class="role-tabs">
          <button type="button" class="role-tab active" data-role="consumer">${icon('user', 17)}消费者</button>
          <button type="button" class="role-tab" data-role="service">${icon('inbox', 17)}售后客服</button>
          <button type="button" class="role-tab" data-role="warehouse">${icon('warehouse', 17)}仓库人员</button>
        </div>

        <div class="field">
          <label for="login-phone">手机号</label>
          <input id="login-phone" class="input" autocomplete="username" value="13800000001" />
        </div>
        <div class="field">
          <label for="login-password">密码</label>
          <input id="login-password" class="input" type="password" autocomplete="current-password" value="123456" />
        </div>

        ${errorMessage ? `<div class="banner danger">${icon('alert', 15)}<span>${esc(errorMessage)}</span></div>` : ''}

        <button type="button" class="btn primary block lg" id="login-submit">进入系统</button>

        <div class="login-hint">${icon('shield', 14)}<span>演示账号密码统一为 <b>123456</b>。所有订单、退款与补发信息均为模拟数据。</span></div>

        <div class="demo-box">
          <div class="demo-box-title">演示账号</div>
          <div class="demo-list">
            ${demo
              .map(
                (d) => `<button type="button" class="demo-item" data-phone="${d.phone}">
                  <span class="demo-avatar" style="background:${d.role === '售后客服' ? 'linear-gradient(140deg,#8b5cf6,#6d28d9)' : d.role === '仓库人员' ? 'linear-gradient(140deg,#2aa79b,#0f766e)' : 'linear-gradient(140deg,#4d70ea,#2f56d9)'}">${esc(d.name[0])}</span>
                  <span style="flex:1"><span class="demo-main">${esc(d.name)} · ${esc(d.role)}</span><br/><span class="demo-sub">${esc(d.phone)} · ${esc(d.desc)}</span></span>
                  ${icon('arrow', 14)}
                </button>`
              )
              .join('')}
          </div>
        </div>
      </section>
    </div>
  </div>`;

  const phoneInput = qs('#login-phone');
  const rolePhone = { consumer: '13800000001', service: '13900000001', warehouse: '13700000001' };

  qsa('.role-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      qsa('.role-tab').forEach((t) => t.classList.toggle('active', t === tab));
      phoneInput.value = rolePhone[tab.dataset.role];
    });
  });

  qsa('.demo-item').forEach((item) => {
    item.addEventListener('click', () => {
      phoneInput.value = item.dataset.phone;
      qs('#login-password').value = '123456';
    });
  });

  const submit = async () => {
    const btn = qs('#login-submit');
    btn.disabled = true;
    btn.textContent = '登录中…';
    try {
      state.user = await api('/api/login', {
        method: 'POST',
        body: JSON.stringify({ phone: phoneInput.value.trim(), password: qs('#login-password').value }),
      });
      if (!state.meta) state.meta = await api('/api/meta');
      renderShell();
      location.hash = defaultHash();
      renderRoute();
    } catch (e) {
      btn.disabled = false;
      btn.textContent = '进入系统';
      toast(e.message, 'error');
    }
  };

  qs('#login-submit').addEventListener('click', submit);
  qs('#login-password').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  });
}

/* ==========================================================================
   应用外壳
   ========================================================================== */

function renderShell() {
  const user = state.user;
  const nav = NAV[user.role] || [];

  qs('#root').innerHTML = `
  <div class="layout">
    <aside class="sidebar">
      <div class="brand">
        <span class="brand-mark">${icon('box', 21)}</span>
        <div class="brand-text">
          <div class="brand-name">衣返</div>
          <div class="brand-sub">AFTER-SALE DESK</div>
        </div>
      </div>

      <div class="side-role"><span class="dot"></span>当前岗位 · <b>${esc(user.roleLabel)}</b></div>

      <nav class="nav">
        <div class="nav-label">工作台</div>
        ${nav
          .map(
            (n) => `<a class="nav-item" data-key="${n.key}" href="${n.hash}">${icon(n.icon, 17)}<span>${n.label}</span><span class="nav-count hidden" data-count="${n.key}"></span></a>`
          )
          .join('')}
      </nav>

      <div class="side-tip">
        <b>协作提示</b>
        客服同意退回后，仓库才能登记收货；验货结果不等于退款或换货完成。
      </div>

      <div class="side-user">
        <span class="avatar ${roleClass(user.role)}">${esc(user.name[0])}</span>
        <div class="side-user-text" style="flex:1;min-width:0">
          <div class="side-user-name">${esc(user.name)}</div>
          <div class="side-user-title">${esc(user.title || user.roleLabel)}</div>
        </div>
        <button type="button" class="icon-btn" data-act="logout" title="退出登录">${icon('logout', 16)}</button>
      </div>
    </aside>

    <main class="main"><div class="main-inner" id="view"></div></main>
  </div>`;

  loadNavCounts();
}

async function loadNavCounts() {
  if (state.user.role === 'consumer') return;
  try {
    const s = await api('/api/workbench');
    const map =
      state.user.role === 'service'
        ? { workbench: s.pendingReview + s.needInfo + s.toResolve }
        : { warehouse: s.toReceive + s.toInspect };
    Object.entries(map).forEach(([key, n]) => {
      const el = qs(`[data-count="${key}"]`);
      if (el && n > 0) {
        el.textContent = n;
        el.classList.remove('hidden');
      }
    });
  } catch (e) {
    /* 忽略角标失败 */
  }
}

async function doLogout() {
  try {
    await api('/api/logout', { method: 'POST' });
  } catch (e) {
    /* 忽略 */
  }
  state.user = null;
  state.orders = [];
  location.hash = '';
  renderLogin();
}

/* ==========================================================================
   路由
   ========================================================================== */

const ROUTE_ROLES = {
  orders: ['consumer'],
  'my-cases': ['consumer'],
  workbench: ['service'],
  warehouse: ['warehouse'],
  library: ['service', 'warehouse'],
};

function renderRoute() {
  if (!state.user) return;
  const view = qs('#view');
  if (!view) return;
  const hash = location.hash || defaultHash();

  const caseMatch = hash.match(/^#\/case\/(\d+)$/);
  if (caseMatch) {
    syncNav('case');
    renderCaseDetail(Number(caseMatch[1]));
    return;
  }

  const key = hash.replace(/^#\//, '').split('?')[0];
  const allowed = ROUTE_ROLES[key];
  if (!allowed || !allowed.includes(state.user.role)) {
    location.hash = defaultHash();
    return;
  }

  syncNav(key);
  if (key === 'orders') return renderOrders();
  if (key === 'my-cases') return renderMyCases();
  if (key === 'workbench') return renderWorkbench();
  if (key === 'warehouse') return renderWarehouse();
  if (key === 'library') return renderLibrary();
  location.hash = defaultHash();
}

window.addEventListener('hashchange', renderRoute);

function loadingHTML() {
  return `<div class="loading"><div class="spinner"></div><span>正在加载…</span></div>`;
}

function errorHTML(e) {
  return `${topbar('暂时无法打开', '请稍后重试')}
    <div class="card card-pad"><div class="banner danger">${icon('alert', 16)}<span>${esc(e.message || '请求失败')}</span></div></div>`;
}

/* ==========================================================================
   消费者 · 我的订单
   ========================================================================== */

async function renderOrders() {
  const view = qs('#view');
  view.innerHTML = loadingHTML();
  let orders;
  try {
    orders = await api('/api/orders');
    state.orders = orders;
  } catch (e) {
    view.innerHTML = errorHTML(e);
    return;
  }

  const filter = state.orderFilter || 'all';
  const countApplicable = orders.filter((o) => o.items.some((i) => i.applicable)).length;
  const countCase = orders.filter((o) => o.items.some((i) => i.activeCase || i.lastCase)).length;

  const visible = orders.filter((o) => {
    if (filter === 'applicable') return o.items.some((i) => i.applicable);
    if (filter === 'case') return o.items.some((i) => i.activeCase || i.lastCase);
    return true;
  });

  const renderItem = (o, it) => {
    let actionHTML = '';
    if (it.activeCase) {
      actionHTML = `${statusPill(it.activeCase.status, it.activeCase.statusLabel)}
        <button type="button" class="btn sm ghost" data-act="open-case" data-id="${it.activeCase.id}">查看进度</button>`;
    } else if (o.status === 'completed' && it.availableQty > 0) {
      actionHTML = `<span class="qty-hint">可售后 <b>${it.availableQty}</b> 件</span>
        <button type="button" class="btn sm soft" data-act="apply" data-item="${it.id}">${icon('return', 14)}申请退换</button>`;
    } else if (o.status !== 'completed') {
      actionHTML = `<span class="qty-hint muted">订单完成后可申请</span>`;
    } else {
      actionHTML = `<span class="qty-hint">可售后 <b>0</b> 件</span><span class="muted small">已全部申请</span>`;
    }

    return `<div class="order-item">
      ${thumb(it)}
      <div class="item-main">
        <div class="item-title">${esc(it.title)}</div>
        <div class="item-sku"><span>${esc(it.color)}</span><span class="dot"></span><span>${esc(it.size)} 码</span><span class="dot"></span><span>${esc(it.sku)}</span></div>
        <div class="item-price" style="margin-top:4px">${money(it.unitPrice)} <span class="muted">× ${it.qty}</span></div>
      </div>
      <div class="item-side">${actionHTML}</div>
    </div>`;
  };

  view.innerHTML = `
    ${topbar(
      '我的订单',
      '选择已完成的模拟订单商品，发起退货或换货申请',
      `<button type="button" class="btn primary" data-act="apply">${icon('plus', 16)}发起售后申请</button>`
    )}

    <div class="toolbar">
      <div class="seg">
        <button type="button" class="${filter === 'all' ? 'active' : ''}" data-filter="all">全部订单<span class="num">${orders.length}</span></button>
        <button type="button" class="${filter === 'applicable' ? 'active' : ''}" data-filter="applicable">可申请售后<span class="num">${countApplicable}</span></button>
        <button type="button" class="${filter === 'case' ? 'active' : ''}" data-filter="case">已有售后<span class="num">${countCase}</span></button>
      </div>
      <div class="spacer"></div>
      <span class="muted small">售后受理期限：订单完成后 ${state.meta ? state.meta.serviceDays : 15} 天</span>
    </div>

    ${visible.length ? '' : `<div class="card"><div class="empty">
      <div class="empty-icon">${icon('bag', 24)}</div>
      <h4>这里还没有符合条件的订单</h4>
      <p>试试切换筛选条件，或等待模拟订单完成收货。</p>
    </div></div>`}

    ${visible
      .map(
        (o) => `<article class="card order-card">
        <div class="order-head">
          <span class="order-no">${esc(o.orderNo)}</span>
          ${o.status === 'completed' ? statusPill('completed', '已完成') : `<span class="pill st-return_shipped"><i></i>运输中</span>`}
          ${deadlineChip(o)}
          <span class="order-meta"><span class="sep"></span>${esc(o.channel || '模拟商城')}</span>
          <span class="order-total">订单金额 <b class="mono">${money(o.totalAmount)}</b></span>
        </div>
        <div class="order-body">${o.items.map((it) => renderItem(o, it)).join('')}</div>
        <div class="order-note ${o.overdue ? 'warn' : ''}">
          ${icon(o.overdue ? 'alert' : 'file', 13)}
          ${
            o.status !== 'completed'
              ? '订单仍在运输中，完成收货后才能申请售后。'
              : o.overdue
                ? `订单已完成 ${Math.abs(o.daysLeft)} 天，超出 ${state.meta ? state.meta.serviceDays : 15} 天受理期限，提交后由客服判断是否受理。`
                : `下单时间 ${fmtFull(o.createdAt)} · 完成时间 ${fmtFull(o.completedAt)} · 收货地址 ${esc(o.address)}`
          }
        </div>
      </article>`
      )
      .join('')}
  `;

  qsa('[data-filter]', view).forEach((btn) => {
    btn.addEventListener('click', () => {
      state.orderFilter = btn.dataset.filter;
      renderOrders();
    });
  });
}

/* ==========================================================================
   消费者 · 发起售后
   ========================================================================== */

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 1280;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const png = file.type === 'image/png';
        resolve({ name: file.name, dataUrl: canvas.toDataURL(png ? 'image/png' : 'image/jpeg', 0.85) });
      };
      img.onerror = () => reject(new Error('图片读取失败'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
}

async function openApplyModal(preselectId) {
  let orders = state.orders;
  if (!orders || !orders.length) {
    try {
      orders = await api('/api/orders');
      state.orders = orders;
    } catch (e) {
      toast(e.message, 'error');
      return;
    }
  }

  const eligible = [];
  for (const o of orders) {
    if (o.status !== 'completed') continue;
    for (const it of o.items) if (it.applicable) eligible.push({ ...it, order: o });
  }

  if (!eligible.length) {
    toast('当前没有可申请售后的商品', 'error');
    return;
  }

  const reasons = (state.meta && state.meta.reasons) || [];
  const serviceDays = state.meta ? state.meta.serviceDays : 15;
  const selected = eligible.find((e) => e.id === preselectId) || eligible[0];

  const form = {
    itemId: selected.id,
    type: 'return',
    qty: 1,
    reason: reasons.length ? reasons[0].value : 'size_not_fit',
    files: [],
  };

  const findItem = () => eligible.find((e) => e.id === form.itemId) || eligible[0];

  openModal(`
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-head">
        <div style="flex:1">
          <h3>发起售后申请</h3>
          <p>仅可对本人已完成订单中的商品发起，申请数量不能超过可售后数量</p>
        </div>
        <button type="button" class="icon-btn" data-act="close-modal">${icon('close', 17)}</button>
      </div>

      <div class="modal-body">
        <div class="field">
          <span class="field-label">选择商品<span class="required">*</span></span>
          <div class="pick-list" id="apply-items">
            ${eligible
              .map(
                (it) => `<button type="button" class="pick ${it.id === form.itemId ? 'active' : ''}" data-item="${it.id}">
                  ${thumb(it, 'sm')}
                  <span class="pick-main">
                    <span class="pick-title">${esc(it.title)}</span>
                    <span class="pick-sub">${esc(it.color)} / ${esc(it.size)} 码 · 订单 ${esc(it.order.orderNo)}</span>
                  </span>
                  <span class="pick-right">可售后<br/><b>${it.availableQty}</b> 件</span>
                  <span class="radio"></span>
                </button>`
              )
              .join('')}
          </div>
        </div>

        <div class="grid-2">
          <div class="field">
            <span class="field-label">售后类型<span class="required">*</span></span>
            <div class="radio-row">
              <button type="button" class="radio-card ${form.type === 'return' ? 'active' : ''}" data-type="return">
                <span class="rc-title">退货退款</span>
                <span class="rc-desc">寄回商品，验货通过后模拟退款</span>
              </button>
              <button type="button" class="radio-card ${form.type === 'exchange' ? 'active' : ''}" data-type="exchange">
                <span class="rc-title">换货</span>
                <span class="rc-desc">寄回原件，验货后补发新商品</span>
              </button>
            </div>
          </div>

          <div class="field">
            <span class="field-label">申请数量<span class="required">*</span></span>
            <div class="qty-input">
              <button type="button" data-qty="dec">−</button>
              <span id="apply-qty">1</span>
              <button type="button" data-qty="inc">+</button>
            </div>
            <span class="hint" id="apply-qty-hint">该商品可售后 ${selected.availableQty} 件</span>
          </div>
        </div>

        <div class="grid-2">
          <div class="field">
            <span class="field-label">申请原因<span class="required">*</span></span>
            <select class="select" id="apply-reason">
              ${reasons.map((r) => `<option value="${r.value}" ${r.value === form.reason ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}
            </select>
            <span class="hint" id="apply-reason-hint"></span>
          </div>
          <div class="field" id="apply-return-field">
            <span class="field-label">预计退款金额</span>
            <div class="estimate">
              <b id="apply-estimate">¥0.00</b>
              <span class="hint">验货通过后由客服确认</span>
            </div>
          </div>
          <div class="field hidden" id="apply-size-field">
            <span class="field-label">期望更换<span class="required">*</span></span>
            <input class="input" id="apply-size" placeholder="例如 L 码 / 换个颜色" />
          </div>
        </div>

        <div class="field">
          <span class="field-label">问题说明</span>
          <textarea class="textarea" id="apply-desc" maxlength="500" placeholder="简单描述问题，例如：尺码偏小、袖口走线开裂、收到时有污渍……"></textarea>
        </div>

        <div class="field">
          <span class="field-label">图片凭证<span class="hint" style="margin-left:4px">选填，最多 4 张</span></span>
          <div class="previews" id="apply-previews"></div>
          <label class="uploader" for="apply-file" style="margin-top:8px">
            ${icon('image', 20)}
            <span>点击上传凭证图片 · <b>支持 jpg / png / webp</b></span>
            <span style="font-size:11px;color:var(--muted-2)">质量问题、破损或错发建议上传，便于客服判断</span>
          </label>
          <input type="file" id="apply-file" accept="image/png,image/jpeg,image/webp" multiple class="hidden" />
        </div>

        <div class="banner info">
          ${icon('shield', 16)}
          <span>提交后进入「待客服审核」。审核通过后需按退回指引寄回，仓库在客服同意后才能登记收货。受理期限为订单完成后 ${serviceDays} 天。</span>
        </div>
      </div>

      <div class="modal-foot">
        <span class="muted small" id="apply-summary"></span>
        <div class="spacer"></div>
        <button type="button" class="btn ghost" data-act="close-modal">取消</button>
        <button type="button" class="btn primary" id="apply-submit">提交申请</button>
      </div>
    </div>
  `);

  const updateSummary = () => {
    const it = findItem();
    const isExchange = form.type === 'exchange';
    qs('#apply-summary').textContent = `${it.title} · ${isExchange ? '换货' : '退货退款'} ${form.qty} 件 · ${money(it.unitPrice * form.qty)}`;
    qs('#apply-qty').textContent = form.qty;
    qs('#apply-qty-hint').textContent = `该商品可售后 ${it.availableQty} 件`;
    qs('#apply-estimate').textContent = money(it.unitPrice * form.qty);
    qs('#apply-return-field').classList.toggle('hidden', isExchange);
    qs('#apply-size-field').classList.toggle('hidden', !isExchange);
  };

  const renderPreviews = () => {
    qs('#apply-previews').innerHTML = form.files
      .map(
        (f, i) => `<div class="preview"><img src="${f.dataUrl}" alt="${esc(f.name)}"/><button type="button" data-remove="${i}" title="移除">×</button></div>`
      )
      .join('');
    qsa('[data-remove]').forEach((btn) => {
      btn.addEventListener('click', () => {
        form.files.splice(Number(btn.dataset.remove), 1);
        renderPreviews();
      });
    });
  };

  const syncReasonHint = () => {
    const r = reasons.find((x) => x.value === form.reason);
    qs('#apply-reason-hint').textContent = r && r.needProof ? '该原因建议上传 1–2 张凭证，客服审核会更快' : '可不上传凭证，客服可能要求补充材料';
  };

  qsa('#apply-items .pick').forEach((btn) => {
    btn.addEventListener('click', () => {
      form.itemId = Number(btn.dataset.item);
      form.qty = 1;
      qsa('#apply-items .pick').forEach((b) => b.classList.toggle('active', b === btn));
      updateSummary();
    });
  });

  qsa('[data-type]').forEach((btn) => {
    btn.addEventListener('click', () => {
      form.type = btn.dataset.type;
      qsa('[data-type]').forEach((b) => b.classList.toggle('active', b === btn));
      updateSummary();
    });
  });

  qsa('[data-qty]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const max = findItem().availableQty;
      form.qty = Math.max(1, Math.min(max, form.qty + (btn.dataset.qty === 'inc' ? 1 : -1)));
      updateSummary();
    });
  });

  qs('#apply-reason').addEventListener('change', (e) => {
    form.reason = e.target.value;
    syncReasonHint();
  });

  qs('#apply-file').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []).slice(0, 4 - form.files.length);
    for (const f of files) {
      try {
        form.files.push(await readImageFile(f));
      } catch (err) {
        toast(err.message, 'error');
      }
    }
    e.target.value = '';
    renderPreviews();
  });

  qs('#apply-submit').addEventListener('click', async () => {
    const it = findItem();
    if (form.type === 'exchange' && !qs('#apply-size').value.trim()) {
      toast('换货请填写期望更换的尺码或颜色', 'error');
      qs('#apply-size').focus();
      return;
    }
    if (form.qty > it.availableQty) {
      toast(`最多可申请 ${it.availableQty} 件`, 'error');
      return;
    }
    const btn = qs('#apply-submit');
    btn.disabled = true;
    btn.textContent = '提交中…';
    try {
      const created = await api('/api/cases', {
        method: 'POST',
        body: JSON.stringify({
          orderItemId: form.itemId,
          type: form.type,
          reason: form.reason,
          qty: form.qty,
          description: qs('#apply-desc').value.trim(),
          exchangeSize: form.type === 'exchange' ? qs('#apply-size').value.trim() : '',
          attachments: form.files,
        }),
      });
      closeModal();
      toast(`售后单 ${created.caseNo} 已提交，等待客服审核`, 'ok');
      location.hash = `#/case/${created.id}`;
    } catch (e) {
      toast(e.message, 'error');
      btn.disabled = false;
      btn.textContent = '提交申请';
    }
  });

  updateSummary();
  syncReasonHint();
  renderPreviews();
}

/* ==========================================================================
   消费者 · 我的售后
   ========================================================================== */

async function renderMyCases() {
  const view = qs('#view');
  view.innerHTML = loadingHTML();
  let cases;
  try {
    cases = await api('/api/cases');
  } catch (e) {
    view.innerHTML = errorHTML(e);
    return;
  }

  const tab = state.caseTab || 'active';
  const isActive = (s) => !['completed', 'rejected', 'cancelled'].includes(s);
  const counts = {
    active: cases.filter((c) => isActive(c.status)).length,
    done: cases.filter((c) => !isActive(c.status)).length,
  };
  const visible = cases.filter((c) => (tab === 'active' ? isActive(c.status) : !isActive(c.status)));

  view.innerHTML = `
    ${topbar('我的售后', '查看每张售后单的进度、处理说明与凭证')}

    <div class="toolbar">
      <div class="seg">
        <button type="button" class="${tab === 'active' ? 'active' : ''}" data-tab="active">进行中<span class="num">${counts.active}</span></button>
        <button type="button" class="${tab === 'done' ? 'active' : ''}" data-tab="done">已结束<span class="num">${counts.done}</span></button>
      </div>
      <div class="spacer"></div>
      <button type="button" class="btn ghost" data-act="apply">${icon('plus', 15)}新建申请</button>
    </div>

    ${
      visible.length
        ? `<div class="case-list">${visible.map(caseRowHTML).join('')}</div>`
        : `<div class="card"><div class="empty">
            <div class="empty-icon">${icon('clock', 24)}</div>
            <h4>${tab === 'active' ? '当前没有进行中的售后' : '还没有已结束的售后单'}</h4>
            <p>${tab === 'active' ? '在「我的订单」中选择商品即可发起退换货。' : '完成的售后单会保留在这里，方便回看处理结论。'}</p>
          </div></div>`
    }
  `;

  qsa('[data-tab]', view).forEach((btn) => {
    btn.addEventListener('click', () => {
      state.caseTab = btn.dataset.tab;
      renderMyCases();
    });
  });
}

function caseRowHTML(c) {
  return `<article class="case-row" data-act="open-case" data-id="${c.id}">
    ${thumb(c.item)}
    <div class="case-row-main">
      <div class="case-row-top">
        <span class="case-no">${esc(c.caseNo)}</span>
        <span class="chip type-${c.type}">${esc(c.typeLabel)}</span>
        ${statusPill(c.status, c.statusLabel)}
        ${c.overdue && !['completed', 'rejected', 'cancelled'].includes(c.status) ? `<span class="chip overdue">已超期</span>` : ''}
      </div>
      <div class="item-title" style="font-size:13px">${esc(c.item.title)} <span class="muted small">· ${esc(c.item.color)} / ${esc(c.item.size)} 码</span></div>
      <div class="muted small">申请 ${c.qty} 件 · 更新于 ${fmtDT(c.updatedAt)}</div>
    </div>
    <div class="case-row-side">
      ${c.refundAmount ? `<span class="mono" style="color:var(--ok);font-weight:650">${money(c.refundAmount)}</span>` : ''}
      ${icon('chevron', 16)}
    </div>
  </article>`;
}

/* ==========================================================================
   客服工作台
   ========================================================================== */

const BUCKETS = {
  review: ['pending_review', 'need_info'],
  processing: ['awaiting_return', 'return_shipped', 'received', 'inspected', 'inspect_issue'],
  done: ['completed', 'rejected', 'cancelled'],
};

async function renderWorkbench() {
  const view = qs('#view');
  view.innerHTML = loadingHTML();
  let cases;
  let stats;
  try {
    [cases, stats] = await Promise.all([api('/api/cases'), api('/api/workbench')]);
  } catch (e) {
    view.innerHTML = errorHTML(e);
    return;
  }

  const tab = state.workTab || 'review';
  const countOf = (key) => cases.filter((c) => BUCKETS[key].includes(c.status)).length;
  const visible = cases.filter((c) => BUCKETS[tab].includes(c.status));

  const kpi = [
    { label: '待客服审核', value: stats.pendingReview, icon: 'inbox', accent: '#b45309', foot: '需要给出同意、补充或拒绝结论' },
    { label: '待买家补充', value: stats.needInfo, icon: 'file', accent: '#6d28d9', foot: '买家补充后自动回到审核队列' },
    { label: '待处理结果', value: stats.toResolve, icon: 'checkCircle', accent: '#0f766e', foot: `其中验货异常 ${stats.issueCount} 单` },
    { label: '今日完成', value: stats.completedToday, icon: 'check', accent: '#157f52', foot: '退款或补发完成的售后单' },
  ];

  view.innerHTML = `
    ${topbar('客服工作台', '审核申请、跟进退回、处理验货异常与争议')}

    <div class="kpi-grid">
      ${kpi
        .map(
          (k) => `<div class="kpi" style="--accent:${k.accent}">
            <div class="kpi-top">${icon(k.icon, 15)}${k.label}</div>
            <div class="kpi-value">${k.value}<small>单</small></div>
            <div class="kpi-foot">${k.foot}</div>
          </div>`
        )
        .join('')}
    </div>

    <div class="card">
      <div class="card-head">
        <div class="seg">
          <button type="button" class="${tab === 'review' ? 'active' : ''}" data-tab="review">待审核<span class="num">${countOf('review')}</span></button>
          <button type="button" class="${tab === 'processing' ? 'active' : ''}" data-tab="processing">处理中<span class="num">${countOf('processing')}</span></button>
          <button type="button" class="${tab === 'done' ? 'active' : ''}" data-tab="done">已结束<span class="num">${countOf('done')}</span></button>
        </div>
        <div class="spacer"></div>
        <a class="btn ghost sm" href="#/library">${icon('search', 14)}售后单库</a>
      </div>

      ${
        visible.length
          ? `<div class="table-wrap">
              <table class="tbl">
                <thead><tr>
                  <th>售后单号 / 提交</th><th>商品</th><th>类型</th><th>买家</th><th>状态</th><th>更新时间</th><th></th>
                </tr></thead>
                <tbody>${visible.map(caseTableRow).join('')}</tbody>
              </table>
            </div>`
          : `<div class="empty">
              <div class="empty-icon">${icon('checkCircle', 24)}</div>
              <h4>${tab === 'review' ? '审核队列已清空' : '这个分组暂时没有单据'}</h4>
              <p>切换其他分组查看处理中的售后单。</p>
            </div>`
      }
    </div>
  `;

  qsa('[data-tab]', view).forEach((btn) => {
    btn.addEventListener('click', () => {
      state.workTab = btn.dataset.tab;
      renderWorkbench();
    });
  });
}

function caseTableRow(c) {
  return `<tr data-act="open-case" data-id="${c.id}">
    <td>
      <div class="case-no">${esc(c.caseNo)}</div>
      <div class="sub">${fmtDT(c.createdAt)}</div>
    </td>
    <td>
      <div class="cell-item">
        ${thumb(c.item, 'sm')}
        <div>
          <div class="pick-title">${esc(c.item.title)}</div>
          <div class="sub">${esc(c.item.color)} / ${esc(c.item.size)} 码 · ${c.qty} 件</div>
        </div>
      </div>
    </td>
    <td><span class="chip type-${c.type}">${esc(c.typeLabel)}</span></td>
    <td><div>${esc(c.buyer.name)}</div><div class="sub">${esc(c.buyer.phone)}</div></td>
    <td>${statusPill(c.status, c.statusLabel)}${c.overdue && !['completed', 'rejected', 'cancelled'].includes(c.status) ? `<div class="sub" style="color:var(--danger)">已超 ${Math.abs(c.daysLeft)} 天</div>` : ''}</td>
    <td class="nowrap muted small">${fmtDT(c.updatedAt)}</td>
    <td style="text-align:right;color:var(--muted)">${icon('chevron', 15)}</td>
  </tr>`;
}

/* ==========================================================================
   仓库 · 收货验货台
   ========================================================================== */

async function renderWarehouse() {
  const view = qs('#view');
  view.innerHTML = loadingHTML();
  let cases;
  let stats;
  try {
    [cases, stats] = await Promise.all([api('/api/cases'), api('/api/workbench')]);
  } catch (e) {
    view.innerHTML = errorHTML(e);
    return;
  }

  const toReceive = cases.filter((c) => ['awaiting_return', 'return_shipped'].includes(c.status));
  const toInspect = cases.filter((c) => c.status === 'received');
  const inspected = cases.filter((c) => ['inspected', 'inspect_issue'].includes(c.status));

  const workItem = (c, actionLabel, hint) => `<div class="work-item" data-act="open-case" data-id="${c.id}">
    ${thumb(c.item, 'sm')}
    <div class="work-item-main">
      <div class="case-row-top">
        <span class="case-no">${esc(c.caseNo)}</span>
        <span class="chip type-${c.type}">${esc(c.typeLabel)}</span>
        ${statusPill(c.status, c.statusLabel)}
      </div>
      <div class="pick-title">${esc(c.item.title)} <span class="muted small">× ${c.qty}</span></div>
      <div class="muted small">${esc(hint)}</div>
    </div>
    <span class="btn sm soft work-action">${esc(actionLabel)}${icon('arrow', 13)}</span>
  </div>`;

  view.innerHTML = `
    ${topbar('收货验货台', '登记退回包裹，记录验货事实与异常，结果由客服最终确认')}

    <div class="kpi-grid">
      <div class="kpi" style="--accent:#2f56d9">
        <div class="kpi-top">${icon('truck', 15)}待收货</div>
        <div class="kpi-value">${stats.toReceive}<small>单</small></div>
        <div class="kpi-foot">客服已同意退回，可登记包裹</div>
      </div>
      <div class="kpi" style="--accent:#b45309">
        <div class="kpi-top">${icon('box', 15)}待验货</div>
        <div class="kpi-value">${stats.toInspect}<small>单</small></div>
        <div class="kpi-foot">已入库，等待记录验货结果</div>
      </div>
      <div class="kpi" style="--accent:#0f766e">
        <div class="kpi-top">${icon('checkCircle', 15)}待客服确认</div>
        <div class="kpi-value">${inspected.length}<small>单</small></div>
        <div class="kpi-foot">验货已完成，不等于售后完成</div>
      </div>
      <div class="kpi" style="--accent:#157f52">
        <div class="kpi-top">${icon('check', 15)}今日已验</div>
        <div class="kpi-value">${stats.inspectedToday}<small>单</small></div>
        <div class="kpi-foot">含验货通过与验货异常</div>
      </div>
    </div>

    <div class="work-grid">
      <div class="card">
        <div class="card-head"><h3>待收货</h3><span class="card-sub">客服已同意退回</span><div class="spacer"></div><span class="chip">${toReceive.length} 单</span></div>
        ${
          toReceive.length
            ? toReceive.map((c) => workItem(c, '登记收货', c.returnTracking ? `寄回 ${c.returnCompany || ''} ${c.returnTracking}` : '买家尚未登记寄回单号')).join('')
            : `<div class="empty"><div class="empty-icon">${icon('truck', 22)}</div><h4>暂无待收包裹</h4><p>买家寄回后会自动出现在这里。</p></div>`
        }
      </div>

      <div class="card">
        <div class="card-head"><h3>待验货</h3><span class="card-sub">已入库待检查</span><div class="spacer"></div><span class="chip">${toInspect.length} 单</span></div>
        ${
          toInspect.length
            ? toInspect.map((c) => workItem(c, '记录验货', c.inspection && c.inspection.receivedAt ? `收货时间 ${fmtDT(c.inspection.receivedAt)}` : '等待登记收货')).join('')
            : `<div class="empty"><div class="empty-icon">${icon('box', 22)}</div><h4>暂无待验货商品</h4><p>登记收货后进入验货队列。</p></div>`
        }
      </div>
    </div>
  `;
}

/* ==========================================================================
   售后单库
   ========================================================================== */

async function renderLibrary() {
  const view = qs('#view');
  view.innerHTML = loadingHTML();
  let cases;
  try {
    cases = await api('/api/cases');
  } catch (e) {
    view.innerHTML = errorHTML(e);
    return;
  }

  const q = (state.libQuery || '').trim().toLowerCase();
  const status = state.libStatus || '';
  const visible = cases.filter((c) => {
    if (status && c.status !== status) return false;
    if (!q) return true;
    return [c.caseNo, c.order.no, c.buyer.name, c.item.title].join(' ').toLowerCase().includes(q);
  });

  const statusOptions = state.meta ? Object.entries(state.meta.statuses) : [];

  view.innerHTML = `
    ${topbar('售后单库', '按单号、买家或商品检索全部售后单')}

    <div class="card">
      <div class="card-head" style="gap:12px;flex-wrap:wrap">
        <div class="search">
          ${icon('search', 15)}
          <input class="input" id="lib-q" placeholder="搜索售后单号 / 订单号 / 买家 / 商品" value="${esc(state.libQuery || '')}" />
        </div>
        <select class="select" id="lib-status" style="width:170px">
          <option value="">全部状态</option>
          ${statusOptions.map(([k, v]) => `<option value="${k}" ${k === status ? 'selected' : ''}>${esc(v)}</option>`).join('')}
        </select>
        <div class="spacer"></div>
        <span class="muted small">共 ${visible.length} 单</span>
      </div>

      ${
        visible.length
          ? `<div class="table-wrap">
              <table class="tbl">
                <thead><tr><th>售后单号 / 提交</th><th>商品</th><th>类型</th><th>买家</th><th>状态</th><th>更新时间</th><th></th></tr></thead>
                <tbody>${visible.map(caseTableRow).join('')}</tbody>
              </table>
            </div>`
          : `<div class="empty"><div class="empty-icon">${icon('search', 24)}</div><h4>没有匹配的售后单</h4><p>换个关键词或状态试试。</p></div>`
      }
    </div>
  `;

  const input = qs('#lib-q');
  input.addEventListener('input', () => {
    state.libQuery = input.value;
    clearTimeout(input._t);
    input._t = setTimeout(() => {
      renderLibrary().then(() => {
        const el = qs('#lib-q');
        if (el) {
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
      });
    }, 320);
  });

  qs('#lib-status').addEventListener('change', (e) => {
    state.libStatus = e.target.value;
    renderLibrary();
  });
}

/* ==========================================================================
   售后单详情
   ========================================================================== */

const STEP_LABELS = ['提交申请', '客服审核', '买家寄回', '仓库收货', '仓库验货', '处理完成'];

function stepIndex(status) {
  return (
    {
      pending_review: 1,
      need_info: 1,
      rejected: 1,
      cancelled: 1,
      awaiting_return: 2,
      return_shipped: 2,
      received: 3,
      inspected: 4,
      inspect_issue: 4,
      completed: 5,
    }[status] || 0
  );
}

const NEXT_HINT = {
  pending_review: '等待售后客服审核申请材料，审核后可进入退回或补充环节。',
  need_info: '等待买家补充材料，补充提交后会自动回到客服审核队列。',
  awaiting_return: '等待买家寄回商品。客服已同意，仓库可以登记收货。',
  return_shipped: '商品退回途中，等待仓库登记收货并验货。',
  received: '仓库已收货，等待验货结果。',
  inspected: '验货通过，等待客服确认退款或换货补发。',
  inspect_issue: '验货异常，等待客服给出最终处理结论。',
  completed: '售后已完成，单据已关闭。',
  rejected: '申请已被拒绝。如买家有异议，可由客服重新审核。',
  cancelled: '买家已撤销本次申请。',
};

async function renderCaseDetail(id) {
  const view = qs('#view');
  view.innerHTML = loadingHTML();
  let c;
  try {
    c = await api(`/api/cases/${id}`);
  } catch (e) {
    view.innerHTML = errorHTML(e);
    return;
  }

  state.panel.action = c.availableActions.length ? c.availableActions[0] : null;
  state.panel.inspect = 'pass';
  state.panel.outcome = 'refund';
  state.uploadFiles = [];

  const idx = stepIndex(c.status);
  const terminal = ['rejected', 'cancelled'].includes(c.status);
  const steps = STEP_LABELS.map((label, i) => {
    const done = i < idx || c.status === 'completed';
    const current = i === idx && c.status !== 'completed';
    return `<div class="step ${done ? 'done' : ''} ${current ? 'current' : ''}">
      <span class="sdot">${done ? icon('check', 12) : i + 1}</span>
      <span class="slabel">${label}</span>
    </div>`;
  }).join('');

  const statusDesc = NEXT_HINT[c.status] || '';
  const canAct = c.availableActions.length > 0;
  const noActionHint = (() => {
    if (c.status === 'completed') return '这张售后单已完成并关闭，无需继续操作。';
    if (c.status === 'cancelled') return '买家已撤销本次申请，单据已关闭。';
    if (c.status === 'rejected') {
      return state.user.role === 'service' ? '申请已拒绝；如买家有异议，可重新审核。' : '申请已被拒绝，售后单已关闭。';
    }
    if (state.user.role === 'consumer') return '当前状态下你暂无需要执行的操作，可以查看进度或等待平台处理。';
    if (state.user.role === 'warehouse') return '当前单据不在仓库环节，或已由客服处理完毕。';
    return '当前单据无需客服操作，等待其他岗位处理。';
  })();

  const resultBlocks = [];
  if (c.returnAddress) {
    resultBlocks.push(`
      <div class="result-box">
        <div class="result-line"><span class="label">退回指引</span><span class="value" style="font-weight:500;line-height:1.6">${esc(c.returnAddress)}</span></div>
        ${c.returnTracking ? `<div class="result-line"><span class="label">买家寄回</span><span class="value">${esc(c.returnCompany || '')} ${esc(c.returnTracking)}</span></div>` : ''}
      </div>`);
  }
  if (c.inspection && (c.inspection.receivedAt || c.inspection.inspectedAt)) {
    resultBlocks.push(`
      <div class="result-box">
        <div class="result-line"><span class="label">收货登记</span><span class="value">${esc(c.inspection.receivedBy || '仓库')} · ${fmtDT(c.inspection.receivedAt)}${c.inspection.packageNo ? ` · 包裹 ${esc(c.inspection.packageNo)}` : ''}</span></div>
        ${c.inspection.receiveNote ? `<div class="result-line"><span class="label">收货备注</span><span class="value" style="font-weight:400">${esc(c.inspection.receiveNote)}</span></div>` : ''}
        ${
          c.inspection.result
            ? `<div class="result-line"><span class="label">验货结果</span>${statusPill(c.status === 'inspect_issue' ? 'inspect_issue' : 'inspected', c.inspection.result === 'issue' ? '验货异常' : '验货通过')}</div>
               ${c.inspection.issueTypeLabel ? `<div class="result-line"><span class="label">异常类型</span><span class="value">${esc(c.inspection.issueTypeLabel)}</span></div>` : ''}
               <div class="result-line"><span class="label">验货说明</span><span class="value" style="font-weight:400">${esc(c.inspection.note || '—')}</span></div>
               <div class="result-line"><span class="label">验货人</span><span class="value" style="font-weight:400">${esc(c.inspection.inspectedBy || '')} · ${fmtDT(c.inspection.inspectedAt)}</span></div>`
            : `<div class="result-line"><span class="label">验货结果</span><span class="muted">待验货</span></div>`
        }
      </div>`);
  }
  if (c.refundNo) {
    resultBlocks.push(`
      <div class="result-box">
        <div class="result-line"><span class="label">模拟退款</span><span class="value big">${money(c.refundAmount)}</span></div>
        <div class="result-line"><span class="label">退款单号</span><span class="value mono">${esc(c.refundNo)}</span></div>
        <div class="banner info" style="margin-top:2px">${icon('shield', 14)}<span>模拟退款记录，不接入真实资金渠道。</span></div>
      </div>`);
  }
  if (c.reshipTracking) {
    resultBlocks.push(`
      <div class="result-box">
        <div class="result-line"><span class="label">换货补发</span><span class="value">${esc(c.reshipCompany || '')} ${esc(c.reshipTracking)}</span></div>
        ${c.exchangeSize ? `<div class="result-line"><span class="label">更换规格</span><span class="value">${esc(c.exchangeSize)}</span></div>` : ''}
        <div class="banner info" style="margin-top:2px">${icon('truck', 14)}<span>模拟补发单号，未对接真实物流轨迹。</span></div>
      </div>`);
  }

  view.innerHTML = `
    <a class="back-link" href="${backHash()}">${icon('arrow', 14)}返回上一页</a>

    <div class="detail-head">
      <div class="detail-head-top">
        <h2>${esc(c.caseNo)}</h2>
        <span class="chip type-${c.type}">${esc(c.typeLabel)}</span>
        ${statusPill(c.status, c.statusLabel, true)}
        ${c.overdue && !['completed', 'rejected', 'cancelled'].includes(c.status) ? `<span class="chip overdue">${icon('alert', 12)} 超出受理期限 ${Math.abs(c.daysLeft)} 天</span>` : ''}
        <div class="spacer"></div>
        <span class="muted small">最后更新 ${fmtFull(c.updatedAt)}</span>
      </div>
      <div class="meta">
        <span>模拟订单 <b>${esc(c.order.no)}</b></span>
        <span>买家 <b>${esc(c.buyer.name)}</b></span>
        <span>提交时间 <b>${fmtFull(c.createdAt)}</b></span>
        <span>受理期限 <b>${c.deadlineAt ? c.deadlineAt.slice(0, 10) : '—'}</b></span>
      </div>
      <div class="steps">${steps}</div>
      ${statusDesc ? `<div class="banner ${terminal ? 'danger' : c.status === 'inspect_issue' ? 'warn' : c.status === 'completed' ? 'ok' : 'info'}" style="margin-top:14px">${icon(c.status === 'completed' ? 'checkCircle' : terminal || c.status === 'inspect_issue' ? 'alert' : 'clock', 15)}<span>${esc(statusDesc)}</span></div>` : ''}
    </div>

    <div class="detail-grid ${state.user.role !== 'consumer' ? 'staff' : ''}">
      <div class="detail-col">
        <section class="card">
          <div class="card-head"><h3>商品信息</h3><span class="card-sub">来自模拟订单 ${esc(c.order.no)}</span></div>
          <div class="card-body">
            <div class="row" style="gap:16px;align-items:flex-start">
              ${thumb(c.item, 'lg')}
              <div style="flex:1;min-width:0">
                <div class="item-title" style="font-size:15px">${esc(c.item.title)}</div>
                <div class="item-sku" style="margin-top:4px"><span>${esc(c.item.color)}</span><span class="dot"></span><span>${esc(c.item.size)} 码</span><span class="dot"></span><span>${esc(c.item.sku)}</span></div>
                <div class="row" style="margin-top:10px;gap:18px;flex-wrap:wrap">
                  <span class="muted small">单价 <b class="mono" style="color:var(--ink)">${money(c.item.unitPrice)}</b></span>
                  <span class="muted small">购买 <b style="color:var(--ink)">${c.item.qty}</b> 件</span>
                  <span class="muted small">可售后 <b style="color:var(--ink)">${c.availableQty}</b> 件</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class="card">
          <div class="card-head"><h3>申请信息</h3><span class="card-sub">买家提交</span></div>
          <div class="card-body">
            <dl class="kv">
              <dt>售后类型</dt><dd><span class="chip type-${c.type}">${esc(c.typeLabel)}</span></dd>
              <dt>申请原因</dt><dd>${esc(c.reasonLabel)}</dd>
              <dt>申请数量</dt><dd>${c.qty} 件</dd>
              ${c.exchangeSize ? `<dt>期望更换</dt><dd>${esc(c.exchangeSize)}</dd>` : ''}
              <dt>买家说明</dt><dd>${c.description ? `<span style="white-space:pre-wrap">${esc(c.description)}</span>` : '<span class="muted">未填写</span>'}</dd>
            </dl>
            ${
              c.attachments.length
                ? `<div class="proof-grid">${c.attachments
                    .map(
                      (a) => `<a class="proof" href="${a.url}" target="_blank" rel="noopener">
                        <img src="${a.url}" alt="${esc(a.name)}" loading="lazy"/>
                        <span>${a.scene === 'supplement' ? '补充凭证' : '申请凭证'} · ${fmtDT(a.createdAt)}</span>
                      </a>`
                    )
                    .join('')}</div>`
                : `<div class="muted small" style="margin-top:12px">${icon('image', 14)} 未上传图片凭证</div>`
            }
          </div>
        </section>

        ${
          resultBlocks.length
            ? `<section class="card">
                <div class="card-head"><h3>处理结果</h3><span class="card-sub">退回、验货与资金记录</span></div>
                <div class="card-body"><div class="stack" style="gap:12px">${resultBlocks.join('')}</div></div>
              </section>`
            : ''
        }

        <section class="card">
          <div class="card-head"><h3>售后时间线</h3><span class="card-sub">岗位 · 时间 · 说明</span><div class="spacer"></div><span class="chip">${c.timeline.length} 条记录</span></div>
          <div class="card-body">
            <div class="timeline">
              ${c.timeline
                .map(
                  (t) => `<div class="tl-item role-${t.role}">
                    <span class="tl-dot"></span>
                    <div class="tl-head">
                      <span class="role-tag ${t.role}">${esc(t.roleLabel)}</span>
                      <span class="tl-actor">${esc(t.actor)}</span>
                      <span class="tl-action">${esc(t.actionLabel)}</span>
                      <span class="tl-time">${fmtFull(t.createdAt)}</span>
                    </div>
                    ${t.note ? `<div class="tl-note">${esc(t.note)}</div>` : ''}
                  </div>`
                )
                .join('')}
            </div>
          </div>
        </section>
      </div>

      <div class="detail-side">
        <section class="card">
          <div class="card-head"><h3>处理操作</h3><span class="card-sub">${esc(state.user.roleLabel)}视角</span></div>
          <div class="card-body" style="padding-top:16px">
            ${
              canAct
                ? `<div id="panel-body">${panelBodyHTML(c)}</div>`
                : `<div class="readonly-note">${icon('clock', 15)}<span>${esc(noActionHint)}</span></div>`
            }
          </div>
        </section>

        <section class="card">
          <div class="card-head"><h3>订单信息</h3></div>
          <div class="card-body">
            <dl class="kv">
              <dt>订单号</dt><dd class="strong">${esc(c.order.no)}</dd>
              <dt>完成时间</dt><dd>${fmtFull(c.order.completedAt)}</dd>
              <dt>订单金额</dt><dd class="mono">${money(c.order.totalAmount)}</dd>
              <dt>买家</dt><dd>${esc(c.buyer.name)} · ${esc(c.buyer.phone)}</dd>
              <dt>收货地址</dt><dd style="line-height:1.6">${esc(c.order.address)}</dd>
            </dl>
          </div>
        </section>

        <section class="card">
          <div class="card-head"><h3>协作规则</h3></div>
          <div class="card-body">
            <div class="rule-list">
              <div>${icon('check', 14)}<span>客服同意退回后，仓库才能登记收货与验货。</span></div>
              <div>${icon('check', 14)}<span>验货结果只记录事实，退款或补发由客服确认。</span></div>
              <div>${icon('check', 14)}<span>拒绝、要求补充、验货异常必须写明原因。</span></div>
              <div>${icon('check', 14)}<span>每次状态变化都保留岗位、时间和说明。</span></div>
            </div>
          </div>
        </section>
      </div>
    </div>
  `;

  if (canAct) bindPanel(c);
}

function backHash() {
  if (state.user.role === 'consumer') return '#/my-cases';
  if (state.user.role === 'warehouse') return '#/warehouse';
  return '#/workbench';
}

/* ------------------------------ 操作面板 ------------------------------ */

const ACTION_META = {
  approve: { label: '同意退回', tone: 'primary' },
  request_info: { label: '要求补充', tone: '' },
  reject: { label: '拒绝申请', tone: 'danger' },
  reopen: { label: '重新审核', tone: '' },
  receive: { label: '登记收货', tone: 'primary' },
  inspect: { label: '提交验货结果', tone: 'primary' },
  refund: { label: '确认退款', tone: 'primary' },
  exchange: { label: '确认补发', tone: 'primary' },
  resolve_issue: { label: '处理验货异常', tone: 'primary' },
  supplement: { label: '补充材料', tone: 'primary' },
  ship_back: { label: '提交寄回信息', tone: 'primary' },
  cancel: { label: '撤销申请', tone: 'danger' },
};

function fieldHTML(label, inner, hint, required) {
  return `<div class="field">
    <span class="field-label">${label}${required ? '<span class="required">*</span>' : ''}</span>
    ${inner}
    ${hint ? `<span class="hint">${hint}</span>` : ''}
  </div>`;
}

function submitBtnHTML(action) {
  const meta = ACTION_META[action] || {};
  const cls = meta.tone === 'danger' ? 'btn danger block' : 'btn primary block';
  return `<button type="button" class="${cls}" id="action-submit">${meta.label || '提交处理'}</button>`;
}

function panelBodyHTML(c) {
  const actions = c.availableActions;
  return `<div class="action-chips" id="action-chips">
      ${actions
        .map(
          (a) => `<button type="button" class="action-chip ${ACTION_META[a] && ACTION_META[a].tone === 'danger' ? 'danger' : ''} ${a === state.panel.action ? 'active' : ''}" data-action-chip="${a}">${ACTION_META[a] ? ACTION_META[a].label : a}</button>`
        )
        .join('')}
    </div>
    <div class="action-form" style="margin-top:14px" id="action-fields">
      ${fieldsHTML(state.panel.action, c)}
      ${submitBtnHTML(state.panel.action)}
    </div>`;
}

function companyOptions(selected) {
  const list = (state.meta && state.meta.companies) || ['顺丰速运'];
  return list.map((c) => `<option ${c === selected ? 'selected' : ''}>${esc(c)}</option>`).join('');
}

function fieldsHTML(action, c) {
  const issueOptions = ((state.meta && state.meta.issueTypes) || [])
    .map((t) => `<option value="${t.value}">${esc(t.label)}</option>`)
    .join('');

  switch (action) {
    case 'approve':
      return `
        ${fieldHTML('退回地址', `<textarea class="textarea" id="f-address" style="min-height:64px">${esc(c.returnAddress || (state.meta && state.meta.defaultReturnAddress) || '')}</textarea>`)}
        ${fieldHTML('处理说明', `<textarea class="textarea" id="f-note" placeholder="例如：凭证清晰，同意退回，请保持吊牌完整，48 小时内寄回。"></textarea>`, '买家会看到这段说明')}
        <div class="banner info">${icon('truck', 15)}<span>同意后买家可寄回商品，仓库才能登记收货。</span></div>`;

    case 'request_info':
      return `
        ${fieldHTML('需要补充的内容', `<textarea class="textarea" id="f-note" placeholder="例如：请补充吊牌与洗标照片，并说明商品是否已下水洗涤。"></textarea>`, '必填，买家补充后自动回到审核队列', true)}
        <div class="banner info">${icon('refresh', 15)}<span>买家补充材料后，售后单会重新进入「待客服审核」。</span></div>`;

    case 'reject':
      return `
        <div class="action-chips" style="margin-bottom:10px">
          ${['超出 15 天售后受理期限', '凭证不足，无法判断', '商品已使用影响二次销售', '不符合退换货条件']
            .map((t) => `<button type="button" class="action-chip" data-quick="${esc(t)}" style="font-size:11.5px;padding:5px 9px">${esc(t)}</button>`)
            .join('')}
        </div>
        ${fieldHTML('拒绝原因', `<textarea class="textarea" id="f-note" placeholder="请写清拒绝依据，例如：订单已完成 24 天，超出 15 天受理期限。"></textarea>`, '必填，会写入时间线并对买家可见', true)}
        <div class="banner danger">${icon('alert', 15)}<span>拒绝后售后单关闭；如买家有异议，可由客服重新审核。</span></div>`;

    case 'reopen':
      return `
        ${fieldHTML('重新审核说明', `<textarea class="textarea" id="f-note" placeholder="例如：买家补充了物流延误证明，重新受理。"></textarea>`, '必填', true)}
        <div class="banner info">${icon('refresh', 15)}<span>售后单将回到「待客服审核」，可重新给出处理结论。</span></div>`;

    case 'receive':
      return `
        ${fieldHTML('包裹单号', `<input class="input" id="f-package" placeholder="例如 SF1234567890（选填）" />`)}
        ${fieldHTML('收货备注', `<textarea class="textarea" id="f-note" placeholder="例如：外箱完好，共 1 件，已入库待验。"></textarea>`)}
        <div class="banner info">${icon('box', 15)}<span>登记收货只代表包裹到仓，不代表退款或换货完成。</span></div>`;

    case 'inspect':
      return `
        <div class="radio-row">
          <button type="button" class="radio-card ${state.panel.inspect === 'pass' ? 'active' : ''}" data-variant="pass" data-group="inspect">
            <span class="rc-title">验货通过</span><span class="rc-desc">商品完好，吊牌与配件齐全</span>
          </button>
          <button type="button" class="radio-card danger ${state.panel.inspect === 'issue' ? 'active' : ''}" data-variant="issue" data-group="inspect">
            <span class="rc-title">验货异常</span><span class="rc-desc">商品不符、破损、缺件或数量不符</span>
          </button>
        </div>
        <div id="issue-block" class="${state.panel.inspect === 'issue' ? '' : 'hidden'}">
          ${fieldHTML('异常类型', `<select class="select" id="f-issue">${issueOptions}</select>`, '', true)}
        </div>
        ${fieldHTML('验货说明', `<textarea class="textarea" id="f-note" placeholder="记录验货事实，例如：袖口开裂属实，吊牌完整。"></textarea>`, '验货异常时必须填写具体说明', true)}
        <div class="banner info">${icon('checkCircle', 15)}<span>验货结果只记录事实，退款或补发由客服确认，售后单不会自动完成。</span></div>`;

    case 'refund':
      return `
        ${fieldHTML('退款金额', `<input class="input mono" id="f-amount" type="number" min="0.01" step="0.01" value="${c.suggestedRefund}" />`, `本单商品金额上限 ${money(c.suggestedRefund)}`, true)}
        ${fieldHTML('退款说明', `<textarea class="textarea" id="f-note" placeholder="例如：验货通过，按原支付方式模拟退款。"></textarea>`)}
        <div class="banner info">${icon('shield', 15)}<span>模拟退款：提交后生成退款单号，不接入真实资金渠道。</span></div>`;

    case 'exchange':
      return `
        <div class="grid-2">
          ${fieldHTML('快递公司', `<select class="select" id="f-company">${companyOptions()}</select>`, '', true)}
          ${fieldHTML('补发单号', `<input class="input" id="f-tracking" placeholder="例如 SF9001234567" />`, '', true)}
        </div>
        ${fieldHTML('补发说明', `<textarea class="textarea" id="f-note" placeholder="例如：L 码已补发，预计 3 天送达。"></textarea>`)}
        <div class="banner info">${icon('truck', 15)}<span>补发单号会写入售后单，买家可在进度中查看。</span></div>`;

    case 'resolve_issue':
      return `
        <div class="radio-row" style="flex-direction:column">
          <button type="button" class="radio-card danger ${state.panel.outcome === 'reject' ? 'active' : ''}" data-variant="reject" data-group="outcome">
            <span class="rc-title">拒绝申请</span> <span class="rc-desc">异常成立，关闭售后</span>
          </button>
          <button type="button" class="radio-card ${state.panel.outcome === 'refund' ? 'active' : ''}" data-variant="refund" data-group="outcome">
            <span class="rc-title">模拟退款</span> <span class="rc-desc">按协商金额退款</span>
          </button>
          <button type="button" class="radio-card ${state.panel.outcome === 'exchange' ? 'active' : ''}" data-variant="exchange" data-group="outcome">
            <span class="rc-title">仍换货补发</span> <span class="rc-desc">接受异常并补发</span>
          </button>
        </div>
        <div id="out-refund" class="${state.panel.outcome === 'refund' ? '' : 'hidden'}">
          ${fieldHTML('退款金额', `<input class="input mono" id="f-amount" type="number" min="0.01" step="0.01" value="${c.suggestedRefund}" />`, `本单商品金额上限 ${money(c.suggestedRefund)}`, true)}
        </div>
        <div id="out-exchange" class="${state.panel.outcome === 'exchange' ? '' : 'hidden'}">
          <div class="grid-2">
            ${fieldHTML('快递公司', `<select class="select" id="f-company">${companyOptions()}</select>`, '', true)}
            ${fieldHTML('补发单号', `<input class="input" id="f-tracking" placeholder="例如 SF9001234567" />`, '', true)}
          </div>
        </div>
        ${fieldHTML('处理结论', `<textarea class="textarea" id="f-note" placeholder="请写明判断依据与最终结论，例如：缺件情况属实，与买家协商一致按 180 元部分退款。"></textarea>`, '必填，会作为结论写入时间线', true)}
        <div class="banner warn">${icon('alert', 15)}<span>验货异常不能自动等同于退款或换货完成，必须由客服给出结论。</span></div>`;

    case 'supplement':
      return `
        ${fieldHTML('补充说明', `<textarea class="textarea" id="f-note" placeholder="说明客服要求补充的信息，例如：吊牌与洗标已拍照，商品未下水洗涤。"></textarea>`, '至少填写说明或上传 1 张凭证')}
        <div class="field">
          <span class="field-label">补充凭证</span>
          <div class="previews" id="sup-previews"></div>
          <label class="uploader" for="f-file" style="margin-top:8px">${icon('image', 18)}<span>点击上传图片 · <b>最多 4 张</b></span></label>
          <input type="file" id="f-file" accept="image/png,image/jpeg,image/webp" multiple class="hidden" />
        </div>
        <div class="banner info">${icon('refresh', 15)}<span>提交后售后单重新进入「待客服审核」。</span></div>`;

    case 'ship_back':
      return `
        <div class="grid-2">
          ${fieldHTML('快递公司', `<select class="select" id="f-company">${companyOptions()}</select>`, '', true)}
          ${fieldHTML('寄回单号', `<input class="input" id="f-tracking" placeholder="例如 SF7382910456" />`, '', true)}
        </div>
        <div class="result-box" style="margin-top:2px">
          <div class="result-line"><span class="label">退回地址</span><span class="value" style="font-weight:500;line-height:1.6">${esc(c.returnAddress || '')}</span></div>
        </div>
        <div class="banner info">${icon('truck', 15)}<span>请保留寄件凭证；仓库收货后会记录验货结果。</span></div>`;

    case 'cancel':
      return `
        ${fieldHTML('撤销原因', `<textarea class="textarea" id="f-reason" placeholder="例如：商品找到了，不需要退货了。"></textarea>`, '选填，会记录在时间线中')}
        <div class="banner warn">${icon('alert', 15)}<span>撤销后本次申请关闭，如仍有问题可重新发起。</span></div>`;

    default:
      return `<div class="readonly-note">该状态暂无可执行操作。</div>`;
  }
}

function bindPanel(c) {
  const rerender = () => {
    qs('#action-fields').innerHTML = fieldsHTML(state.panel.action, c) + submitBtnHTML(state.panel.action);
    bindFields(c);
  };

  qsa('[data-action-chip]').forEach((chip) => {
    chip.addEventListener('click', () => {
      state.panel.action = chip.dataset.actionChip;
      qsa('[data-action-chip]').forEach((x) => x.classList.toggle('active', x === chip));
      rerender();
    });
  });

  bindFields(c);
}

function bindFields(c) {
  qsa('[data-variant]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const group = btn.dataset.group;
      if (group === 'inspect') {
        state.panel.inspect = btn.dataset.variant;
        qsa('[data-variant][data-group="inspect"]').forEach((x) => x.classList.toggle('active', x === btn));
        const block = qs('#issue-block');
        if (block) block.classList.toggle('hidden', state.panel.inspect !== 'issue');
      } else {
        state.panel.outcome = btn.dataset.variant;
        qsa('[data-variant][data-group="outcome"]').forEach((x) => x.classList.toggle('active', x === btn));
        const refundBlock = qs('#out-refund');
        const exchangeBlock = qs('#out-exchange');
        if (refundBlock) refundBlock.classList.toggle('hidden', state.panel.outcome !== 'refund');
        if (exchangeBlock) exchangeBlock.classList.toggle('hidden', state.panel.outcome !== 'exchange');
      }
    });
  });

  qsa('[data-quick]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const ta = qs('#f-note');
      if (ta) ta.value = btn.dataset.quick;
    });
  });

  const fileInput = qs('#f-file');
  if (fileInput) {
    state.uploadFiles = [];
    const renderPreviews = () => {
      qs('#sup-previews').innerHTML = state.uploadFiles
        .map(
          (f, i) => `<div class="preview"><img src="${f.dataUrl}" alt="${esc(f.name)}"/><button type="button" data-remove="${i}">×</button></div>`
        )
        .join('');
      qsa('#sup-previews [data-remove]').forEach((btn) => {
        btn.addEventListener('click', () => {
          state.uploadFiles.splice(Number(btn.dataset.remove), 1);
          renderPreviews();
        });
      });
    };
    fileInput.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []).slice(0, 4 - state.uploadFiles.length);
      for (const f of files) {
        try {
          state.uploadFiles.push(await readImageFile(f));
        } catch (err) {
          toast(err.message, 'error');
        }
      }
      e.target.value = '';
      renderPreviews();
    });
  }

  const submit = qs('#action-submit');
  if (submit) submit.addEventListener('click', () => submitAction(c));
}

function collectPayload(c) {
  const v = (id) => {
    const el = qs(`#${id}`);
    return el ? el.value.trim() : '';
  };
  const action = state.panel.action;

  if (action === 'approve') return { note: v('f-note'), returnAddress: v('f-address') };
  if (['request_info', 'reject', 'reopen'].includes(action)) return { note: v('f-note') };
  if (action === 'receive') return { packageNo: v('f-package'), note: v('f-note') };
  if (action === 'inspect') return { result: state.panel.inspect, issueType: v('f-issue'), note: v('f-note') };
  if (action === 'refund') return { amount: Number(v('f-amount')), note: v('f-note') };
  if (action === 'exchange') return { company: v('f-company'), tracking: v('f-tracking'), note: v('f-note') };
  if (action === 'resolve_issue')
    return {
      outcome: state.panel.outcome,
      amount: state.panel.outcome === 'refund' ? Number(v('f-amount')) : undefined,
      company: state.panel.outcome === 'exchange' ? v('f-company') : undefined,
      tracking: state.panel.outcome === 'exchange' ? v('f-tracking') : undefined,
      note: v('f-note'),
    };
  if (action === 'supplement') return { note: v('f-note'), attachments: state.uploadFiles };
  if (action === 'ship_back') return { company: v('f-company'), tracking: v('f-tracking') };
  if (action === 'cancel') return { reason: v('f-reason') };
  return { note: v('f-note') };
}

async function submitAction(c) {
  const action = state.panel.action;
  const btn = qs('#action-submit');
  const payload = collectPayload(c);

  if (action === 'reject' && !payload.note) return toast('请填写拒绝原因', 'error');
  if (action === 'request_info' && !payload.note) return toast('请填写需要买家补充的内容', 'error');
  if (action === 'resolve_issue' && !payload.note) return toast('请填写处理结论', 'error');
  if (action === 'inspect' && state.panel.inspect === 'issue' && !payload.note) return toast('验货异常必须填写说明', 'error');
  if (action === 'supplement' && !payload.note && !(payload.attachments || []).length)
    return toast('请填写补充说明或上传凭证', 'error');
  if (action === 'ship_back' && !payload.tracking) return toast('请填写寄回快递单号', 'error');
  if (action === 'exchange' && !payload.tracking) return toast('请填写补发快递单号', 'error');
  if (action === 'resolve_issue' && state.panel.outcome === 'exchange' && !payload.tracking)
    return toast('请填写补发快递单号', 'error');

  btn.disabled = true;
  btn.textContent = '提交中…';
  try {
    await api(`/api/cases/${c.id}/actions`, {
      method: 'POST',
      body: JSON.stringify({ action, ...payload }),
    });
    toast('处理已提交，时间线已记录', 'ok');
    await renderCaseDetail(c.id);
    loadNavCounts();
  } catch (e) {
    toast(e.message, 'error');
    btn.disabled = false;
    btn.textContent = ACTION_META[action] ? ACTION_META[action].label : '提交处理';
  }
}

/* ==========================================================================
   全局事件
   ========================================================================== */

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  if (act === 'logout') doLogout();
  if (act === 'close-modal') closeModal();
  if (act === 'open-case') {
    e.preventDefault();
    location.hash = `#/case/${el.dataset.id}`;
  }
  if (act === 'apply') {
    e.preventDefault();
    openApplyModal(el.dataset.item ? Number(el.dataset.item) : null);
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && qs('#modal-root').innerHTML) closeModal();
});

/* ==========================================================================
   启动
   ========================================================================== */

async function boot() {
  try {
    state.meta = await api('/api/meta');
  } catch (e) {
    state.meta = null;
  }
  try {
    state.user = await api('/api/me');
  } catch (e) {
    state.user = null;
  }

  if (!state.user) {
    renderLogin();
    return;
  }
  renderShell();
  if (!location.hash || location.hash === '#/') {
    location.hash = defaultHash();
  }
  renderRoute();
}

boot();
