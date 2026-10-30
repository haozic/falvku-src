/**
 * 兼容性静态扫描：目标基础库 2.9+ / Chrome 69 级别。
 *
 * 禁用的 JS 特性：可选链 ?.、空值合并 ??、Object.fromEntries、
 *                 Array.prototype.at、String.replaceAll、
 *                 structuredClone、globalThis、Promise.allSettled、matchAll
 * 禁用的 CSS 特性：flex gap、clamp()、:is()/:where()、aspect-ratio、
 *                 backdrop-filter、inset
 * 另外：禁止在 WXML / WXSS 里引用外链资源（https://），图标必须本地。
 *
 * 运行： node tools/check_compat.mjs
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/* tools/ 下是跑在 Node 上的开发脚本，不进小程序包，不受基础库 2.9 约束 */
const SKIP = new Set(['node_modules', '.git', 'images', 'tools']);

/* [正则, 说明, 适用的扩展名] */
const JS_RULES = [
  [/\?\.[A-Za-z_$[(]/, '可选链 ?.', ['js', 'mjs']],
  [/\?\?/, '空值合并 ??', ['js', 'mjs']],
  [/Object\s*\.\s*fromEntries/, 'Object.fromEntries', ['js', 'mjs']],
  [/\.\s*at\s*\(/, 'Array.prototype.at', ['js', 'mjs']],
  [/\.\s*replaceAll\s*\(/, 'String.replaceAll', ['js', 'mjs']],
  [/structuredClone/, 'structuredClone', ['js', 'mjs']],
  [/\bglobalThis\b/, 'globalThis', ['js', 'mjs']],
  [/Promise\s*\.\s*allSettled/, 'Promise.allSettled', ['js', 'mjs']],
  [/\.\s*matchAll\s*\(/, 'String.matchAll', ['js', 'mjs']]
];

const CSS_RULES = [
  [/(^|[;{\s])gap\s*:/m, 'CSS gap（WXSS 的 flex 不支持 gap）', ['wxss']],
  [/\bclamp\s*\(/, 'clamp()', ['wxss']],
  [/:\s*(is|where)\s*\(/, ':is() / :where()', ['wxss']],
  [/\baspect-ratio\s*:/, 'aspect-ratio', ['wxss']],
  [/backdrop-filter\s*:/, 'backdrop-filter', ['wxss']],
  [/(^|[;{\s])inset\s*:/m, 'inset 简写', ['wxss']]
];

/** 注释与字符串里的内容不算 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (['js', 'mjs', 'wxml', 'wxss', 'json'].includes(extname(p).slice(1))) out.push(p);
  }
  return out;
}

const files = walk(ROOT, []);
const errors = [];

for (const f of files.sort()) {
  const rel = relative(ROOT, f).replace(/\\/g, '/');
  const ext = extname(f).slice(1);
  const raw = readFileSync(f, 'utf8');
  const src = stripComments(raw);

  for (const [re, label, exts] of JS_RULES) {
    if (!exts.includes(ext)) continue;
    const m = re.exec(src);
    if (m) {
      const line = src.slice(0, m.index).split('\n').length;
      errors.push(`${rel}:${line}: 用了 ${label}（基础库 2.9 / Chrome 69 不支持）`);
    }
  }

  for (const [re, label, exts] of CSS_RULES) {
    if (!exts.includes(ext)) continue;
    const m = re.exec(src);
    if (m) {
      const line = src.slice(0, m.index).split('\n').length;
      errors.push(`${rel}:${line}: 用了 ${label}`);
    }
  }

  /* 外链资源 */
  if (ext === 'wxml' || ext === 'wxss') {
    const m = /https?:\/\//.exec(src);
    if (m) {
      const line = src.slice(0, m.index).split('\n').length;
      errors.push(`${rel}:${line}: 出现外链 https:// （离线环境会加载失败）`);
    }
  }

  /* app.json / page json 里的 tabBar 图标必须是本地文件 */
  if (ext === 'json' && /iconPath/.test(raw)) {
    if (/https?:\/\//.test(raw)) {
      errors.push(`${rel}: tabBar 图标用了外链地址`);
    }
  }
}

console.log(`扫描了 ${files.length} 个源文件`);
if (errors.length) {
  for (const e of errors) console.log('FAIL  ' + e);
}
console.log(`\n兼容性问题 ${errors.length} 条`);
process.exit(errors.length ? 1 : 0);
