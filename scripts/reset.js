'use strict';

/**
 * 重置演示数据库：删除现有 SQLite 文件，下次启动将重新写入模拟数据。
 * 用法：npm run reset
 */

const fs = require('node:fs');
const path = require('node:path');

const dataDir = path.join(__dirname, '..', 'data');
const files = ['clothes.db', 'clothes.db-wal', 'clothes.db-shm'];

let removed = 0;
for (const name of files) {
  const target = path.join(dataDir, name);
  if (fs.existsSync(target)) {
    fs.rmSync(target);
    removed += 1;
    console.log(`已删除 ${path.relative(process.cwd(), target)}`);
  }
}

console.log(removed ? '数据库已重置，下次启动会重新写入模拟数据。' : '没有需要重置的数据库文件。');
