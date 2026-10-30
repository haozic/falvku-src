/**
 * WXML 结构自检：
 *   1. 标签配对（view/text/block/scroll-view/rich-text/input/textarea/switch/image...）；
 *   2. 属性写法（值必须带引号、不能重复、指令属性必须有值）；
 *   3. {{ }} 表达式花括号配对；
 *   4. wx:elif / wx:else 必须紧跟在 wx:if / wx:elif 之后。
 *
 * 运行： node tools/check_wxml.mjs
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['node_modules', '.git']);

/** 自闭合即视为已配对（image 这类空元素） */
const VOID_OK = new Set(['image', 'input', 'icon', 'progress', 'slider', 'switch', 'navigator', 'camera', 'canvas', 'video', 'audio', 'map', 'web-view', 'cover-view', 'cover-image']);

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (extname(p) === '.wxml') out.push(p);
  }
  return out;
}

/** 校验 {{ }} 花括号配对（跳过字符串字面量） */
function checkBraces(text, rel, errors) {
  let depth = 0;
  let inExpr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '{' && text[i + 1] === '{') {
      if (depth === 0) inExpr = true;
      depth++;
      i++;
      continue;
    }
    if (c === '}' && text[i + 1] === '}') {
      depth--;
      if (depth < 0) {
        errors.push(`${rel}: 表达式 }} 多余（位置 ${i}）`);
        depth = 0;
        i++;
        continue;
      }
      if (depth === 0) inExpr = false;
      i++;
      continue;
    }
    if (inExpr && (c === '"' || c === "'")) {
      /* 跳过字符串字面量内部 */
      const q = c;
      i++;
      while (i < text.length && text[i] !== q) {
        if (text[i] === '\\') i++;
        i++;
      }
    }
  }
  if (depth !== 0) errors.push(`${rel}: 表达式 {{ }} 未闭合（还剩 ${depth} 层）`);
}

const files = walk(ROOT, []);
const allErrors = [];

for (const f of files.sort()) {
  const rel = relative(ROOT, f).replace(/\\/g, '/');
  const text = readFileSync(f, 'utf8');
  const errors = [];

  checkBraces(text, rel, errors);

  /* 标签扫描（栈底放一个虚拟根节点，根级别的兄弟链也要检查） */
  const stack = [{ tag: '#root', line: 0, self: { has: false, isElse: false }, lastChild: null }];
  const tagRe = /<\/?([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  let m;

  /* 每层栈帧记录：自身是否带 wx:if/wx:elif/wx:else，以及已完成的最后一个子元素的链状态 */
  const chainOf = (attrs) => ({
    has: attrs.has('wx:if') || attrs.has('wx:elif') || attrs.has('wx:else'),
    isElse: attrs.has('wx:elif') || attrs.has('wx:else')
  });

  while ((m = tagRe.exec(text)) !== null) {
    const whole = m[0];
    const tag = m[1];
    const attrText = m[2] || '';
    const selfClose = m[3] === '/';
    const isClose = whole.startsWith('</');
    const line = text.slice(0, m.index).split('\n').length;

    if (isClose) {
      if (!stack.length) {
        errors.push(`${rel}:${line}: 多余的 </${tag}>`);
      } else {
        const top = stack.pop();
        if (top.tag !== tag) {
          errors.push(`${rel}:${line}: </${tag}> 与 <${top.tag}>（第 ${top.line} 行）不匹配`);
        } else if (stack.length) {
          /* 这个子元素结束了，父层的「最后一个子元素链状态」更新成它自己的 */
          stack[stack.length - 1].lastChild = top.self;
        }
      }
      continue;
    }

    /* 属性检查 */
    const attrRe = /([@:\w-]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    const seen = new Map();
    let a;
    while ((a = attrRe.exec(attrText)) !== null) {
      const name = a[1];
      const hasValue = a[0].includes('=');
      const value = a[3] !== undefined ? a[3] : (a[4] !== undefined ? a[4] : a[5]);
      if (seen.has(name)) {
        errors.push(`${rel}:${line}: <${tag}> 上属性 ${name} 重复`);
      }
      seen.set(name, value);
      if (hasValue && value === undefined) {
        errors.push(`${rel}:${line}: <${tag}> 属性 ${name} 的值缺少引号`);
      }
      if (/^wx:(for|if|elif|key)$/.test(name) && !hasValue) {
        errors.push(`${rel}:${line}: <${tag}> 指令属性 ${name} 缺少值`);
      }
      if (/^wx:(for|if|elif)$/.test(name) && hasValue && value !== undefined) {
        const v = String(value);
        if (!v.includes('{{')) {
          errors.push(`${rel}:${line}: <${tag}> 指令属性 ${name} 的值不是表达式：${v}`);
        }
      }
    }

    /* 指令属性的引号内不能出现裸的 " */
    if (attrText.includes('"') && !/="[^"]*"/.test(attrText) && attrText.trim()) {
      errors.push(`${rel}:${line}: <${tag}> 属性列表引号不闭合`);
    }

    /* wx:elif / wx:else 必须紧跟 wx:if / wx:elif（同一父级的相邻兄弟） */
    const parent = stack.length ? stack[stack.length - 1] : null;
    const prev = parent ? parent.lastChild : null;
    if (seen.has('wx:elif') || seen.has('wx:else')) {
      if (!prev || !prev.has) {
        errors.push(`${rel}:${line}: <${tag}> 的 wx:${seen.has('wx:elif') ? 'elif' : 'else'} 前面没有 wx:if / wx:elif`);
      }
    }

    const selfChain = chainOf(seen);
    if (!selfClose) {
      stack.push({ tag, line, self: selfChain, lastChild: null });
    } else if (parent) {
      parent.lastChild = selfChain;
    }
  }

  if (stack.length > 1) {
    for (const s of stack.slice(1)) {
      errors.push(`${rel}:${s.line}: <${s.tag}> 未闭合`);
    }
  }

  if (errors.length) {
    for (const e of errors) console.log('FAIL  ' + e);
    allErrors.push(...errors);
  } else {
    console.log(`OK    ${rel}`);
  }
}

console.log(`\n共 ${files.length} 个 WXML，错误 ${allErrors.length} 条`);
process.exit(allErrors.length ? 1 : 0);
