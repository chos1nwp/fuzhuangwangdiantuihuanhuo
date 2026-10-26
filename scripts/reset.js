'use strict';

/**
 * 重置演示数据库：删除 MySQL 库并重建，重新写入模拟数据。
 * 用法：npm run reset
 */

const mysql = require('mysql2/promise');
const store = require('../db');

(async () => {
  const { DB } = store;

  const conn = await mysql.createConnection({
    host: DB.host,
    port: DB.port,
    user: DB.user,
    password: DB.password,
    charset: 'utf8mb4',
  });
  await conn.query(`DROP DATABASE IF EXISTS \`${DB.database}\``);
  await conn.end();
  console.log(`已删除数据库 ${DB.database}`);

  await store.init();

  const counts = await Promise.all([
    store.get('SELECT COUNT(*) AS n FROM users'),
    store.get('SELECT COUNT(*) AS n FROM orders'),
    store.get('SELECT COUNT(*) AS n FROM cases'),
  ]);
  console.log(
    `已重建并写入演示数据：${counts[0].n} 个账号、${counts[1].n} 笔订单、${counts[2].n} 张售后单`
  );

  const pool = store.getPool();
  if (pool) await pool.end();
  console.log('重置完成，执行 npm start 启动服务。');
})().catch((err) => {
  console.error('重置失败：', err.message);
  process.exit(1);
});
