/**
 * 交叉核对：WXML 里引用的每个数据字段 / 事件处理函数，
 * 是否真的在对应页面的 index.js 里存在。
 *
 * 检查项：
 *   1. WXML 表达式里的顶层标识符  ->  必须在 JS 的 data 或 setData 里出现；
 *   2. WXML 的 bind / catch 事件名  ->  必须在 JS 里定义同名方法；
 *   3. 汇总每个文件里 wx:for 循环变量上用到的属性名（人工复核用）。
 *
 * 运行： node tools/check_fields.mjs
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGES = join(ROOT, 'pages');
const SKIP = new Set(['node_modules', '.git']);

/* ============================================================ 通用工具 */

/** 从 src 的 start（必须是 '{'）开始，找到配对的 '}' 的下标 */
function matchBrace(src, start) {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      i++;
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\\') i++;
        i++;
      }
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** 取对象字面量的顶层 key */
function objectKeys(src, braceStart) {
  const end = matchBrace(src, braceStart);
  if (end < 0) return [];
  const keys = [];
  let depth = 0;
  let i = braceStart + 1;
  while (i < end) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      i++;
      while (i < end && src[i] !== q) {
        if (src[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }
    if (c === '{' || c === '[' || c === '(') { depth++; i++; continue; }
    if (c === '}' || c === ']' || c === ')') { depth--; i++; continue; }
    if (depth === 0) {
      const m = /^([A-Za-z_$][\w$]*)\s*:/.exec(src.slice(i, i + 80));
      if (m) {
        keys.push(m[1]);
        i += m[0].length;
        continue;
      }
    }
    i++;
  }
  return keys;
}

/** 提取 WXML 中所有 {{ }} 表达式的字符串 */
function extractExprs(text) {
  const out = [];
  let i = 0;
  while (i < text.length - 1) {
    if (text[i] === '{' && text[i + 1] === '{') {
      let depth = 0;
      let j = i;
      let expr = '';
      while (j < text.length - 1) {
        if (text[j] === '{' && text[j + 1] === '{') { depth++; j += 2; expr += '{{'; continue; }
        if (text[j] === '}' && text[j + 1] === '}') {
          depth--;
          j += 2;
          if (depth === 0) break;
          expr += '}}';
          continue;
        }
        expr += text[j];
        j++;
      }
      out.push(expr);
      i = j;
      continue;
    }
    i++;
  }
  return out;
}

/** 表达式里的顶层标识符（去掉字符串字面量、关键字与循环变量） */
function identifiers(expr, loopVars) {
  let s = expr;
  /* 去字符串字面量 */
  s = s.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""').replace(/`[^`]*`/g, '``');
  /* 去对象字面量的键（键后面跟 : 且不在括号里才去，简化处理：键统一去掉） */
  s = s.replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1');
  const kw = new Set(['true', 'false', 'null', 'undefined', 'item', 'index']);
  for (const v of loopVars) kw.add(v);
  const found = new Set();
  const re = /(^|[^.\w$])([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const name = m[2];
    if (kw.has(name)) continue;
    /* 前面是 '.' 的说明是属性访问，交给上层单独看 */
    found.add(name);
  }
  return found;
}

/** 表达式里 <循环变量>.xxx 形式用到的属性 */
function itemProps(expr, loopVars) {
  const out = new Set();
  for (const v of loopVars) {
    const re = new RegExp('\\b' + v + '\\s*\\.\\s*([A-Za-z_$][\\w$]*)', 'g');
    let m;
    while ((m = re.exec(expr)) !== null) out.add(v + '.' + m[1]);
  }
  return out;
}

/* ============================================================ 主流程 */

const errors = [];
const notes = [];

function walkPages(dir, out) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkPages(p, out);
    else if (extname(p) === '.wxml') out.push(p);
  }
  return out;
}

const wxmlFiles = walkPages(PAGES, []);

for (const wxmlPath of wxmlFiles) {
  const rel = relative(ROOT, wxmlPath).replace(/\\/g, '/');
  const jsPath = wxmlPath.replace(/\.wxml$/, '.js');
  if (!readdirSync(dirname(jsPath)).includes(basename(jsPath))) {
    errors.push(`${rel}: 找不到同名 JS ${relative(ROOT, jsPath)}`);
    continue;
  }
  const wxml = readFileSync(wxmlPath, 'utf8');
  const js = readFileSync(jsPath, 'utf8');

  /* --- JS 侧：data 的 key --- */
  const dataKeys = new Set();
  const dataIdx = js.indexOf('data:');
  if (dataIdx >= 0) {
    const brace = js.indexOf('{', dataIdx);
    if (brace >= 0) {
      for (const k of objectKeys(js, brace)) dataKeys.add(k);
    }
  }

  /* --- JS 侧：setData 的 key --- */
  const re = /setData\s*\(/g;
  let m;
  while ((m = re.exec(js)) !== null) {
    const brace = js.indexOf('{', m.index);
    if (brace < 0) continue;
    /* 确认这个 { 属于 setData 的第一个参数 */
    const between = js.slice(m.index + 'setData('.length, brace);
    if (between.trim() !== '') continue;
    for (const k of objectKeys(js, brace)) dataKeys.add(k);
  }

  /* --- JS 侧：方法名 --- */
  const methods = new Set();
  const pageIdx = js.indexOf('Page(');
  if (pageIdx >= 0) {
    const brace = js.indexOf('{', pageIdx);
    if (brace >= 0) {
      for (const k of objectKeys(js, brace)) methods.add(k);
    }
  }

  /* --- WXML 侧：循环变量名（wx:for-item / wx:for-index） --- */
  const loopVars = new Set(['item']);
  const lvRe = /wx:for-(?:item|index)\s*=\s*"([^"]+)"/g;
  let lvm;
  while ((lvm = lvRe.exec(wxml)) !== null) loopVars.add(lvm[1]);

  /* --- WXML 侧：表达式里的字段 --- */
  const exprs = extractExprs(wxml);
  const usedProps = new Set();
  for (const e of exprs) {
    for (const p of itemProps(e, loopVars)) usedProps.add(p);
    for (const id of identifiers(e, loopVars)) {
      if (!dataKeys.has(id)) {
        errors.push(`${rel}: 数据字段 "${id}" 在 ${relative(ROOT, jsPath)} 里没有定义`);
      }
    }
  }

  /* --- WXML 侧：事件处理函数 --- */
  const evRe = /(?:bind|catch|capture-bind|capture-catch):?[a-zA-Z-]*\s*=\s*"([^"]+)"/g;
  while ((m = evRe.exec(wxml)) !== null) {
    const h = m[1];
    if (!methods.has(h)) {
      errors.push(`${rel}: 事件处理函数 "${h}" 在 ${relative(ROOT, jsPath)} 里没有定义`);
    }
  }

  notes.push(`${rel}: data 字段 ${dataKeys.size} 个，方法 ${methods.size} 个，item 属性 {${[...usedProps].sort().join(', ')}}`);
}

for (const n of notes) console.log('INFO  ' + n);
console.log('');
if (errors.length) {
  for (const e of errors) console.log('FAIL  ' + e);
}
console.log(`\n共 ${wxmlFiles.length} 个页面，错误 ${errors.length} 条`);
process.exit(errors.length ? 1 : 0);

function basename(p) {
  return p.split(/[\\/]/).pop();
}
