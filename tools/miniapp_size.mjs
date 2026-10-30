// 测量 Mini App 服务端载荷压缩体积
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const DATA = 'data';
const files = fs.readdirSync(DATA).filter((f) => /^(party|flk|hubei)_\d+\.js$/.test(f)).sort();
let docs = [];
for (const f of files) {
  const raw = fs.readFileSync(path.join(DATA, f), 'utf8');
  const i = raw.indexOf('.push(');
  const s = raw.indexOf('[', i);
  const e = raw.lastIndexOf(']');
  docs = docs.concat(JSON.parse(raw.slice(s, e + 1)));
}
const bodyJson = JSON.stringify(docs);
const bodyGz = zlib.gzipSync(Buffer.from(bodyJson, 'utf8'), { level: 9 });

const metaRaw = fs.readFileSync(path.join(DATA, 'regulations.json'), 'utf8');
const meta = JSON.parse(metaRaw);
const metaGz = zlib.gzipSync(Buffer.from(metaRaw, 'utf8'), { level: 9 });

console.log('bodies docs      =', docs.length);
console.log('bodies json      =', (bodyJson.length / 1048576).toFixed(2), 'MB');
console.log('bodies gzip      =', (bodyGz.length / 1048576).toFixed(2), 'MB');
console.log('meta   json      =', (metaRaw.length / 1048576).toFixed(2), 'MB');
console.log('meta   gzip      =', (metaGz.length / 1048576).toFixed(2), 'MB');
console.log('TOTAL gzip       =', ((bodyGz.length + metaGz.length) / 1048576).toFixed(2), 'MB');
console.log('gunzip+parse ms  =', (() => {
  const t = Date.now();
  const b = JSON.parse(zlib.gunzipSync(bodyGz).toString('utf8'));
  return `${Date.now() - t}ms (${b.length} docs)`;
})());
