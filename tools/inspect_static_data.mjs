/**
 * 静态站构建前的数据形状勘察。
 *
 * 用 Node 造一个假的 `window`，加载 data/regulations.js，看清：
 *   - FG_DATA 的顶层键
 *   - records[0] 的字段（有没有 bf / sections / bodyFiles 之类）
 *   - bodyFiles 的形状（怎么定位一个分片属于 party/flk/hubei）
 *   - 一个正文分片里的记录形状
 *
 * 运行：node tools/inspect_static_data.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ---- 造一个最小 window ---- */
const win = {};
globalThis.window = win;

function loadJs(rel) {
  const code = readFileSync(join(root, rel), 'utf8');
  // eslint-disable-next-line no-new-func
  new Function('window', code)(win);
}

loadJs('data/regulations.js');
const D = win.FG_DATA;

console.log('=== FG_DATA 顶层键 ===');
console.log(Object.keys(D).join(', '));

console.log('\n=== records 数量 ===');
console.log(D.records.length);

console.log('\n=== records[0] 的键 ===');
console.log(Object.keys(D.records[0]).join(', '));

console.log('\n=== records[0] 摘要（截断） ===');
const r0 = D.records[0];
const brief = {};
for (const k of Object.keys(r0)) {
  const v = r0[k];
  brief[k] = typeof v === 'string' && v.length > 90 ? v.slice(0, 90) + '…' : v;
}
console.log(JSON.stringify(brief, null, 2));

console.log('\n=== bodyFiles 形状 ===');
const bf = D.bodyFiles || [];
console.log('type:', Array.isArray(bf) ? 'array' : typeof bf, ' length:', bf.length);
console.log(JSON.stringify(bf.slice(0, 3), null, 2));

console.log('\n=== bf 字段在各记录里的取值分布 ===');
const dist = {};
for (const rec of D.records) {
  const key = rec.bf || '(none)';
  dist[key] = (dist[key] || 0) + 1;
}
console.log(JSON.stringify(dist, null, 2));

console.log('\n=== categories[0] / groups[0] ===');
console.log(JSON.stringify(D.categories[0], null, 2));
console.log(JSON.stringify(D.groups[0], null, 2));

/* ---- 正文分片 ---- */
console.log('\n=== 正文分片：party_01 ===');
loadJs('data/party_01.js');
const party = win.FG_PARTY;
console.log('FG_PARTY 是数组的数组:', Array.isArray(party) && Array.isArray(party[0]));
console.log('push 次数:', party.length, ' 每片记录数:', party[0].length);
console.log('party[0][0] 的键:', Object.keys(party[0][0]).join(', '));
console.log('sections[0] 的键:', Object.keys(party[0][0].sections[0]).join(', '));
console.log('sections[0]:', JSON.stringify({
  name: party[0][0].sections[0].name,
  level: party[0][0].sections[0].level,
  text: String(party[0][0].sections[0].text).slice(0, 60) + '…'
}, null, 2));

/* ---- 统计：每条记录是否有 body 分片 ---- */
console.log('\n=== 覆盖统计 ===');
const seen = new Set();
for (const chunk of party) for (const rec of chunk) seen.add(rec.id);
console.log('party_01 覆盖记录数:', seen.size);
