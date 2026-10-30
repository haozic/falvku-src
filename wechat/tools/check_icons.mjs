/**
 * 校验 images/ 下的 PNG 图标：
 *   1. 8 字节 PNG 签名；
 *   2. IHDR 里的宽高合理；
 *   3. 至少有一个非零 alpha 像素（不是空白图）。
 *
 * 运行： node tools/check_icons.mjs
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const IMG = join(ROOT, 'images');

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** 从 IDAT 里解出原始像素，统计非透明像素 */
function countInk(png) {
  let off = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.toString('ascii', off + 4, off + 8);
    const data = png.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4 + 1;
  let ink = 0;
  for (let y = 0; y < height; y++) {
    const rowStart = y * stride;
    const filter = raw[rowStart];
    if (filter !== 0) throw new Error('不支持的 PNG 行过滤器: ' + filter);
    for (let x = 0; x < width; x++) {
      if (raw[rowStart + 1 + x * 4 + 3] > 8) ink++;
    }
  }
  return { width, height, ink };
}

/* tabBar 需要的 10 个图标 + 页面内图标 */
const REQUIRED = [
  'tab-home.png', 'tab-home-active.png',
  'tab-search.png', 'tab-search-active.png',
  'tab-tree.png', 'tab-tree-active.png',
  'tab-timeline.png', 'tab-timeline-active.png',
  'tab-mine.png', 'tab-mine-active.png'
];

const files = readdirSync(IMG).filter((f) => f.endsWith('.png')).sort();
const errors = [];
let tabCount = 0;

for (const f of files) {
  const p = join(IMG, f);
  const buf = readFileSync(p);
  const rel = relative(ROOT, p).replace(/\\/g, '/');

  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIG)) {
    errors.push(`${rel}: PNG 签名不合法`);
    continue;
  }
  if (buf.toString('ascii', 12, 16) !== 'IHDR') {
    errors.push(`${rel}: 第一个块不是 IHDR`);
    continue;
  }
  let info;
  try {
    info = countInk(buf);
  } catch (e) {
    errors.push(`${rel}: 解码失败 ${e.message}`);
    continue;
  }
  if (info.width < 16 || info.height < 16) {
    errors.push(`${rel}: 尺寸过小 ${info.width}x${info.height}`);
  }
  if (info.ink === 0) {
    errors.push(`${rel}: 整张图是空白的`);
  }
  if (f.startsWith('tab-')) tabCount++;
  console.log(
    `OK    ${rel.padEnd(28)} ${String(info.width).padStart(3)}x${String(info.height).padStart(3)}  ` +
    `非透明像素 ${String(info.ink).padStart(5)}  ${statSync(p).size} bytes`
  );
}

/* app.json 里引用的图标必须都存在 */
const appJson = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8'));
for (const t of appJson.tabBar.list) {
  for (const key of ['iconPath', 'selectedIconPath']) {
    if (!t[key]) continue;
    /* app.json 里写的是相对小程序根目录的路径 */
    const rel = t[key].replace(/^\//, '');
    if (!files.some((f) => rel === f || rel === 'images/' + f)) {
      errors.push(`app.json 的 tabBar 引用了不存在的图标 ${rel}`);
    }
  }
}
if (appJson.tabBar.list.length !== 5) {
  errors.push(`app.json 的 tabBar 应该有 5 项，实际 ${appJson.tabBar.list.length}`);
}
const missing = REQUIRED.filter((f) => !files.includes(f));
for (const f of missing) errors.push(`缺少 tabBar 图标 ${f}`);

console.log('');
if (errors.length) for (const e of errors) console.log('FAIL  ' + e);
console.log(
  `共 ${files.length} 个 PNG（其中 tabBar 图标 ${tabCount} 个），错误 ${errors.length} 条`
);
process.exit(errors.length ? 1 : 0);
