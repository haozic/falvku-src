/**
 * 校验 wechat/ 下所有 .json 文件是否合法。
 *
 * 运行： node tools/check_json.mjs
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['node_modules', '.git']);

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (extname(p) === '.json') out.push(p);
  }
  return out;
}

const files = walk(ROOT, []);
let fail = 0;

for (const f of files.sort()) {
  const rel = relative(ROOT, f).replace(/\\/g, '/');
  const text = readFileSync(f, 'utf8');
  try {
    JSON.parse(text);
    console.log(`OK    ${rel}`);
  } catch (e) {
    fail++;
    console.log(`FAIL  ${rel}  ${e.message}`);
    /* 定位到行 */
    const m = /position (\d+)/.exec(e.message);
    if (m) {
      const line = parseInt(m[1], 10);
      const lines = text.split('\n');
      console.log(`      行 ${line}: ${lines[line - 1]}`);
    }
  }
}

console.log(`\n共 ${files.length} 个 JSON，失败 ${fail} 个`);
process.exit(fail ? 1 : 0);
