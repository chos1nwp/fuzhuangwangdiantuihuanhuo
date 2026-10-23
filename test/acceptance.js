'use strict';

/**
 * 核心验收场景自动化测试
 * 运行：npm test
 * 说明：使用独立的临时数据库，不影响演示数据。
 */

const fs = require('node:fs');
const path = require('node:path');

const TEST_DB = path.join(__dirname, '.tmp-acceptance.db');
for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
  if (fs.existsSync(f)) fs.rmSync(f);
}
process.env.DB_FILE = TEST_DB;

const { createApp } = require('../server');

const BASE_PORT = 3411;
let passed = 0;
const failures = [];

function ok(name, condition, extra) {
  if (condition) {
    passed += 1;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    failures.push({ name, extra });
    console.log(`  \x1b[31m✗\x1b[0m ${name}${extra ? ` → ${JSON.stringify(extra)}` : ''}`);
  }
}

function section(title) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

async function main() {
  const app = createApp();
  const server = await new Promise((resolve) => {
    const s = app.listen(BASE_PORT, () => resolve(s));
  });
  const base = `http://127.0.0.1:${BASE_PORT}`;

  const clients = new Map();

  async function login(phone) {
    const res = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, password: '123456' }),
    });
    const cookie = (res.headers.getSetCookie ? res.headers.getSetCookie()[0] : '') || '';
    const user = await res.json();
    clients.set(phone, { cookie: cookie.split(';')[0], user });
    return clients.get(phone);
  }

  async function call(phone, method, url, body) {
    const c = phone ? clients.get(phone) : null;
    const res = await fetch(`${base}${url}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(c ? { Cookie: c.cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      data = null;
    }
    return { status: res.status, data };
  }

  const LIN = '13800000001';
  const CHEN = '13800000002';
  const ZHOU = '13800000003';
  const SERVICE = '13900000001';
  const WH = '13700000001';

  await login(LIN);
  await login(CHEN);
  await login(ZHOU);
  await login(SERVICE);
  await login(WH);

  /* ---------------------------------------------------------------- */
  section('场景 1 · 消费者对本人已完成的模拟订单商品发起退换');

  const orders = await call(LIN, 'GET', '/api/orders');
  const jeans = orders.data
    .flatMap((o) => o.items.map((i) => ({ ...i, order: o })))
    .find((i) => i.sku === 'SKU-JN-1180');
  ok('林小雨可读取本人模拟订单', orders.status === 200 && orders.data.length === 3, orders.status);

  const created = await call(LIN, 'POST', '/api/cases', {
    orderItemId: jeans.id,
    type: 'return',
    reason: 'size_not_fit',
    qty: 1,
    description: '裤子腰围偏大，申请退货退款。',
  });
  ok(
    '退货申请创建成功，初始状态为「待客服审核」',
    created.status === 201 && created.data.status === 'pending_review' && /^AS\d{11}$/.test(created.data.caseNo),
    created
  );
  ok('创建后自动写入一条时间线', created.data.timeline.length === 1 && created.data.timeline[0].role === 'consumer');

  const shirts = orders.data
    .flatMap((o) => o.items.map((i) => ({ ...i, order: o })))
    .find((i) => i.sku === 'SKU-SH-2201');
  const tees = orders.data
    .flatMap((o) => o.items.map((i) => ({ ...i, order: o })))
    .find((i) => i.sku === 'SKU-TS-3301');
  const hoodie = orders.data
    .flatMap((o) => o.items.map((i) => ({ ...i, order: o })))
    .find((i) => i.sku === 'SKU-HD-3320');
  const cardigan = orders.data
    .flatMap((o) => o.items.map((i) => ({ ...i, order: o })))
    .find((i) => i.sku === 'SKU-KN-4402');
  ok('衬衫可售后数量为 1（已有 1 件在售后中）', shirts.availableQty === 1, shirts.availableQty);

  /* ---------------------------------------------------------------- */
  section('场景 2 · 超过可售后数量、重复申请与未完成订单被拒绝');

  const overQty = await call(LIN, 'POST', '/api/cases', {
    orderItemId: tees.id,
    type: 'return',
    reason: 'size_not_fit',
    qty: 5,
  });
  ok('超过可售后数量被拒绝（409）', overQty.status === 409 && /可售后数量/.test(overQty.data.error), overQty);

  const duplicate = await call(LIN, 'POST', '/api/cases', {
    orderItemId: hoodie.id,
    type: 'return',
    reason: 'quality_issue',
    qty: 1,
  });
  ok('同一商品重复申请被拒绝（409）', duplicate.status === 409 && /进行中/.test(duplicate.data.error), duplicate);

  const unfinished = await call(LIN, 'POST', '/api/cases', {
    orderItemId: cardigan.id,
    type: 'return',
    reason: 'size_not_fit',
    qty: 1,
  });
  ok('未完成订单不能申请售后（409）', unfinished.status === 409 && /尚未完成/.test(unfinished.data.error), unfinished);

  const othersItem = await call(ZHOU, 'POST', '/api/cases', {
    orderItemId: jeans.id,
    type: 'return',
    reason: 'size_not_fit',
    qty: 1,
  });
  ok('不能对他人订单申请售后（403）', othersItem.status === 403, othersItem);

  /* ---------------------------------------------------------------- */
  section('场景 3 · 客服要求补充材料，买家补充后重新进入审核');

  const needInfoCase = await call(CHEN, 'GET', '/api/cases');
  const target = needInfoCase.data.find((c) => c.status === 'need_info');
  ok('存在待买家补充的售后单', !!target, needInfoCase.data.map((c) => c.status));

  const supplementEmpty = await call(CHEN, 'POST', `/api/cases/${target.id}/actions`, { action: 'supplement', note: '' });
  ok('补充材料必须填写说明或上传凭证（400）', supplementEmpty.status === 400, supplementEmpty);

  const supplement = await call(CHEN, 'POST', `/api/cases/${target.id}/actions`, {
    action: 'supplement',
    note: '吊牌与洗标已拍照上传，商品未下水洗涤。',
  });
  ok(
    '补充材料后状态回到「待客服审核」',
    supplement.status === 200 && supplement.data.status === 'pending_review',
    supplement.data && supplement.data.status
  );

  const approveAgain = await call(SERVICE, 'POST', `/api/cases/${target.id}/actions`, {
    action: 'approve',
    note: '材料齐全，同意退回。',
  });
  ok('客服可再次审核通过', approveAgain.status === 200 && approveAgain.data.status === 'awaiting_return');

  /* ---------------------------------------------------------------- */
  section('场景 4 · 未经客服同意，仓库不能登记退回商品');

  const early = await call(WH, 'POST', '/api/cases/3/actions', { action: 'receive', note: '提前收货测试' });
  ok('待审核的售后单仓库不能收货（409）', early.status === 409, early);

  const earlyView = await call(WH, 'GET', '/api/cases/3');
  ok('未进入仓库环节的售后单仓库不可见（403）', earlyView.status === 403, earlyView);

  /* ---------------------------------------------------------------- */
  section('场景 5 · 客服同意后退回，仓库收货与验货，异常后客服继续处理');

  const newId = created.data.id;
  const approve = await call(SERVICE, 'POST', `/api/cases/${newId}/actions`, {
    action: 'approve',
    note: '同意退回，请按指引寄回。',
  });
  ok(
    '客服同意后进入「待买家寄回」并写入退回地址',
    approve.status === 200 && approve.data.status === 'awaiting_return' && !!approve.data.returnAddress,
    approve.data && approve.data.status
  );

  const receiveEarly = await call(WH, 'POST', `/api/cases/${newId}/actions`, { action: 'receive' });
  ok('客服已同意，仓库可以登记收货', receiveEarly.status === 200 && receiveEarly.data.status === 'received');

  const inspectNoReason = await call(WH, 'POST', `/api/cases/${newId}/actions`, {
    action: 'inspect',
    result: 'issue',
    issueType: 'missing_parts',
    note: '',
  });
  ok('验货异常必须填写说明（400）', inspectNoReason.status === 400, inspectNoReason);

  const inspectIssue = await call(WH, 'POST', `/api/cases/${newId}/actions`, {
    action: 'inspect',
    result: 'issue',
    issueType: 'missing_parts',
    note: '缺少原装吊牌，且裤脚有轻微磨损。',
  });
  ok(
    '验货异常不直接退款：状态为「验货异常」，等待客服处理',
    inspectIssue.status === 200 && inspectIssue.data.status === 'inspect_issue',
    inspectIssue.data && inspectIssue.data.status
  );
  ok('验货结果与说明被记录', inspectIssue.data.inspection.issueTypeLabel === '缺少吊牌 / 配件');

  const resolve = await call(SERVICE, 'POST', `/api/cases/${newId}/actions`, {
    action: 'resolve_issue',
    outcome: 'refund',
    amount: 180,
    note: '与买家协商一致，按部分退款处理。',
  });
  ok(
    '客服处理验货异常并给出结论，售后单完成',
    resolve.status === 200 && resolve.data.status === 'completed' && resolve.data.refundNo,
    resolve.data && { status: resolve.data.status, refundNo: resolve.data.refundNo }
  );
  ok(
    '时间线保留处理岗位、时间与结论',
    resolve.data.timeline.length >= 5 && resolve.data.timeline.at(-1).note.includes('部分退款'),
    resolve.data.timeline.length
  );

  /* ---------------------------------------------------------------- */
  section('场景 5b · 换货：验货通过后记录模拟补发单号');

  const exchangeCase = (await call(CHEN, 'GET', '/api/cases')).data.find((c) => c.type === 'exchange');
  const pass = await call(WH, 'POST', `/api/cases/${exchangeCase.id}/actions`, {
    action: 'inspect',
    result: 'pass',
    note: '商品完好，吊牌齐全。',
  });
  ok('仓库验货通过，状态为「验货通过待处理」', pass.status === 200 && pass.data.status === 'inspected');

  const noTracking = await call(SERVICE, 'POST', `/api/cases/${exchangeCase.id}/actions`, {
    action: 'exchange',
    tracking: '',
  });
  ok('换货补发必须填写补发单号（400）', noTracking.status === 400, noTracking);

  const shipped = await call(SERVICE, 'POST', `/api/cases/${exchangeCase.id}/actions`, {
    action: 'exchange',
    tracking: 'SF9001234567',
    company: '顺丰速运',
    note: 'L 码已补发。',
  });
  ok(
    '完成换货并记录补发单号',
    shipped.status === 200 && shipped.data.status === 'completed' && shipped.data.reshipTracking === 'SF9001234567',
    shipped.data && shipped.data.status
  );

  /* ---------------------------------------------------------------- */
  section('场景 6 · 普通消费者不能查看他人订单与售后资料');

  const peek = await call(ZHOU, 'GET', '/api/cases/1');
  ok('他人售后单不可见（403）', peek.status === 403, peek);

  const peekOrders = await call(ZHOU, 'GET', '/api/orders');
  ok(
    '订单列表只返回本人订单',
    peekOrders.data.every((o) => o.receiver === '周可'),
    peekOrders.data.map((o) => o.receiver)
  );

  const anonCase = await fetch(`${base}/api/cases/1`);
  ok('未登录无法访问售后单（401）', anonCase.status === 401);

  const anonAttach = await fetch(`${base}/api/attachments/1`);
  ok('未登录无法访问他人凭证图片（401）', anonAttach.status === 401);

  const attach = await fetch(`${base}/api/attachments/1`, { headers: { Cookie: clients.get(LIN).cookie } });
  ok(
    '买家可查看本人凭证图片',
    attach.status === 200 && (attach.headers.get('content-type') || '').includes('svg'),
    attach.status
  );

  /* ---------------------------------------------------------------- */
  section('补充规则');

  const rejectNoReason = await call(SERVICE, 'POST', '/api/cases/3/actions', { action: 'reject', note: '' });
  ok('拒绝申请必须填写原因（400）', rejectNoReason.status === 400, rejectNoReason);

  const reject = await call(SERVICE, 'POST', '/api/cases/3/actions', {
    action: 'reject',
    note: '订单已完成 24 天，超出 15 天售后受理期限。',
  });
  ok('超期申请由客服判断拒绝，原因写入时间线', reject.status === 200 && reject.data.status === 'rejected');

  const roleGuard = await call(WH, 'POST', '/api/cases/3/actions', { action: 'approve' });
  ok('仓库无权执行客服操作（403 或状态拦截）', roleGuard.status === 403, roleGuard);

  const svcEarly = await call(SERVICE, 'POST', `/api/cases/${newId}/actions`, {
    action: 'refund',
    amount: 100,
  });
  ok('已完成的售后单不能重复退款', svcEarly.status === 409, svcEarly);

  const ledger = await call(SERVICE, 'GET', '/api/workbench');
  ok(
    '客服工作台返回各环节待办数量',
    ledger.status === 200 && typeof ledger.data.pendingReview === 'number' && typeof ledger.data.toResolve === 'number',
    ledger.data
  );

  const whBench = await call(WH, 'GET', '/api/workbench');
  ok('仓库工作台只统计仓库环节', whBench.status === 200 && typeof whBench.data.toReceive === 'number');

  /* ---------------------------------------------------------------- */

  console.log(`\n${'─'.repeat(52)}`);
  if (failures.length === 0) {
    console.log(`\x1b[32m全部通过：${passed} 项检查\x1b[0m\n`);
  } else {
    console.log(`\x1b[31m通过 ${passed} 项，失败 ${failures.length} 项\x1b[0m`);
    for (const f of failures) console.log(`  - ${f.name}`);
    console.log('');
  }

  await new Promise((resolve) => server.close(resolve));
  for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
    if (fs.existsSync(f)) {
      try {
        fs.rmSync(f);
      } catch (e) {
        /* ignore */
      }
    }
  }
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
