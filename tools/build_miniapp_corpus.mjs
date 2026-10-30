// 构建 Mini App 服务端语料载荷。
// 输入：法规库 data/ 目录（元信息 + 24 个正文分片）
// 输出：miniapps/falv-mini-app/miniapp/node/corpus/meta.json.gz 与 bodies.json.gz
//
// 为什么要压缩：分片原文合计约 41MB，gzip 后约 11.3MB，Node 端一次 gunzip+parse
// 约 174ms，运行时内存约 162MB。服务端持有全量语料，客户端只取元信息与单篇正文。
//
// 数据可复现：本脚本只做「重排 + 压缩」，不改内容；源数据仍由 tools/build_dataset.py 负责。

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
const DATA = path.join(ROOT, 'data');
const OUT = path.join(ROOT, 'miniapps', 'falv-mini-app', 'miniapp', 'node', 'corpus');

if (!fs.existsSync(DATA)) {
  console.error('[build-corpus] 找不到数据目录：' + DATA);
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });

/* ---- 元信息 ---- */
const metaRaw = fs.readFileSync(path.join(DATA, 'regulations.json'), 'utf8');
const meta = JSON.parse(metaRaw);
if (!meta.records || !meta.records.length) {
  console.error('[build-corpus] 元信息为空');
  process.exit(1);
}

/* ---- 正文分片：抽出 window.X.push([...]) 里的 JSON 数组并合并 ---- */
const shardFiles = fs
  .readdirSync(DATA)
  .filter((f) => /^(party|flk|hubei)_\d+\.js$/.test(f))
  .sort();

const bodies = [];
for (const f of shardFiles) {
  const raw = fs.readFileSync(path.join(DATA, f), 'utf8');
  const i = raw.indexOf('.push(');
  if (i < 0) throw new Error('分片格式异常（未找到 .push(）：' + f);
  const s = raw.indexOf('[', i);
  const e = raw.lastIndexOf(']');
  const arr = JSON.parse(raw.slice(s, e + 1));
  for (const d of arr) bodies.push(d);
}

/* ---- 一致性护栏：正文 ↔ 元信息必须一一对应 ---- */
const metaIds = new Set(meta.records.map((r) => r.id));
const bodyIds = new Set(bodies.map((d) => d.id));
let missing = 0;
let extra = 0;
for (const id of metaIds) if (!bodyIds.has(id)) missing++;
for (const id of bodyIds) if (!metaIds.has(id)) extra++;
if (missing || extra) {
  console.error(`[build-corpus] 正文 ↔ 元信息不一致：缺 ${missing} / 多 ${extra}`);
  process.exit(1);
}

/* ---- 正文里每条法规的章节数与总字数（客户端首屏统计用） ---- */
const bodyStat = {};
let totalChars = 0;
for (const d of bodies) {
  let chars = 0;
  let secs = 0;
  for (const s of d.sections || []) {
    secs++;
    if (s.text) chars += s.text.replace(/\s/g, '').length;
  }
  bodyStat[d.id] = { chars, secs };
  totalChars += chars;
}

/* ---- 写出 ---- */
const metaOut = {
  version: meta.version,
  source: meta.source,
  note: meta.note,
  categories: meta.categories,
  groups: meta.groups,
  records: meta.records,
  bodyStat,
  totalChars
};
const bodyOut = bodies;

function writeGz(file, obj) {
  const buf = zlib.gzipSync(Buffer.from(JSON.stringify(obj), 'utf8'), { level: 9 });
  fs.writeFileSync(file, buf);
  return buf.length;
}

const metaBytes = writeGz(path.join(OUT, 'meta.json.gz'), metaOut);
const bodyBytes = writeGz(path.join(OUT, 'bodies.json.gz'), bodyOut);

console.log('[build-corpus] 元信息 %d 条 / 正文 %d 篇 / 总字数 %s',
  meta.records.length, bodies.length, totalChars.toLocaleString('en-US'));
console.log('[build-corpus] meta.json.gz  ' + (metaBytes / 1048576).toFixed(2) + ' MB');
console.log('[build-corpus] bodies.json.gz ' + (bodyBytes / 1048576).toFixed(2) + ' MB');
console.log('[build-corpus] 输出目录 ' + OUT);
