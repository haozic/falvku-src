// Mini App 数据通路探针：验证 Node 侧能否加载法规库全量语料并做子串检索。
// 只读，不写任何业务数据。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.argv[2] || '.');
const DATA = path.join(ROOT, 'data');

function t0() { return Number(process.hrtime.bigint() / 1000000n); }

// ---- 1. 元信息 ----
let t = t0();
const meta = JSON.parse(fs.readFileSync(path.join(DATA, 'regulations.json'), 'utf8'));
const metaMs = t0() - t;
console.log(`[meta] ${meta.records.length} 条 / ${meta.categories.length} 门类 / ${meta.groups.length} 体系 / ${meta.bodyFiles.length} 分片  耗时 ${metaMs}ms`);

// ---- 2. 正文分片：抽出 push([...]) 里的 JSON 数组 ----
function readShard(file) {
  const raw = fs.readFileSync(path.join(DATA, file), 'utf8');
  const i = raw.indexOf('.push(');
  if (i < 0) throw new Error('未找到 .push( in ' + file);
  const start = raw.indexOf('[', i);
  const end = raw.lastIndexOf(']');
  return JSON.parse(raw.slice(start, end + 1));
}

const bfFiles = [];
for (const g of ['party', 'flk', 'hubei']) {
  const files = fs.readdirSync(DATA).filter((f) => f.startsWith(g + '_') && f.endsWith('.js')).sort();
  for (const f of files) bfFiles.push(f);
}

t = t0();
let bodyDocs = 0, bodyChars = 0;
const bodies = new Map();
for (const f of bfFiles) {
  const arr = readShard(f);
  for (const d of arr) {
    let chars = 0;
    let text = '';
    if (Array.isArray(d.sections)) {
      for (const s of d.sections) {
        if (s.text) { text += s.text + '\n'; chars += s.text.replace(/\s/g, '').length; }
      }
    } else if (d.text) {
      text = d.text; chars = text.replace(/\s/g, '').length;
    }
    bodies.set(d.id, { text, chars, name: d.name || '' });
    bodyDocs++;
    bodyChars += chars;
  }
}
const bodyMs = t0() - t;
console.log(`[body] ${bfFiles.length} 片 / ${bodyDocs} 篇 / ${bodyChars.toLocaleString()} 字  耗时 ${bodyMs}ms`);

// ---- 3. 对齐检查：元信息 ↔ 正文 ----
const metaIds = new Set(meta.records.map((r) => r.id));
let missing = 0, extra = 0;
for (const r of meta.records) if (!bodies.has(r.id)) missing++;
for (const id of bodies.keys()) if (!metaIds.has(id)) extra++;
console.log(`[align] 元信息缺正文 ${missing} / 正文多余 ${extra}`);

// ---- 4. 检索耗时实测（子串匹配，与 search.js 同语义）----
function countOf(hay, needle) {
  if (!hay || !needle) return 0;
  let n = 0, i = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}
const docs = meta.records.map((r) => {
  const b = bodies.get(r.id);
  return {
    id: r.id, title: r.title, cat: r.cat, year: r.year,
    issuer: r.issuer || '', summary: r.summary || '', tags: (r.tags || []).join(' '),
    text: b ? b.text : ''
  };
});

for (const q of ['党内监督', '民主集中制', '长江保护法', '第一', '中国共产党章程']) {
  t = t0();
  let hits = 0, scored = 0;
  for (const d of docs) {
    const s = countOf(d.title, q) * 12 + countOf(d.tags, q) * 6 + countOf(d.summary, q) * 4 + countOf(d.issuer, q) * 4 + Math.min(countOf(d.text, q), 30);
    if (s > 0) { hits++; scored += s; }
  }
  console.log(`[search] "${q}" → ${hits} 篇命中  耗时 ${t0() - t}ms  累计分 ${scored}`);
}

// ---- 5. 内存 ----
const mem = process.memoryUsage();
console.log(`[mem] rss ${(mem.rss / 1048576).toFixed(0)}MB / heapUsed ${(mem.heapUsed / 1048576).toFixed(0)}MB`);
console.log('OK');
