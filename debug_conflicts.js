const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// 直接模拟服务器内部逻辑
const serverCode = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

// 简化：直接读取 db 并调用函数
// 由于 server.js 有顶层 side effect，我们提取需要的函数
const db = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/db.json'), 'utf8'));

// 我们通过 eval 必要的函数
const fnCode = serverCode
  .replace(/^[\s\S]*?function validateLaneRange/, 'function validateLaneRange')
  .replace(/function detectConflictsForNewIssue[\s\S]*$/, '');

eval(fnCode.replace(/const app[\s\S]*$/, '').replace(/^const [a-zA-Z_]+ = require[\s\S]*$/gm, '').replace(/createServer[\s\S]*$/, ''));

// 手动定义
global.makeId = (p) => p + '_test_' + Math.random().toString(36).slice(2, 8);
global.findTune = (db, id) => db.tunes.find(t => t.id === id);

const items = [
  { startBeat: 200, endBeat: 210, laneRange: "1-30" },
  { startBeat: 110, endBeat: 120, laneRange: "1-10" },
  { startBeat: 115, endBeat: 125, laneRange: "1-10" },
  { startBeat: 140, endBeat: 150, laneRange: "1-10" },
];

const result = validateBatchSections(db, 'tune_demo', items);
console.log('=== batchConflicts.errors ===');
for (const e of result.batchConflicts.errors) {
  console.log(`  [${e.type}]`, e.message, JSON.stringify(e.details || { s1: e.section1, s2: e.section2 }).slice(0, 200));
}
console.log();
console.log('=== rowResults conflicts ===');
for (const r of result.rowResults) {
  console.log(`row ${r.index} status=${r.status} errors=${r.conflicts.length} warnings=${r.warnings.length}`);
  for (const e of r.conflicts) console.log(`  ERROR [${e.type}]: ${e.message}`);
}
