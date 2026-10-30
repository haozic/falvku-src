/* 求解创宇盾 WZWS 的 JS 挑战：把挑战脚本放进一个最小 DOM 垫片里跑，
   捕获它构造的表单（action / method / 字段），供 Python 发起 POST。
   用法：node tools/wzws_solve.js <challenge.html> */
'use strict';
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync(process.argv[2], 'utf8');
const m = html.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
if (!m) { console.error('NO_SCRIPT'); process.exit(3); }
const code = m[1];

const captured = {};
const created = [];

function makeEl(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    name: '', value: '', type: '', style: {},
    children: [],
    appendChild(c) { this.children.push(c); return c; },
    submit() {
      captured.action = this.action;
      captured.method = this.method;
      captured.fields = this.children.map(function (c) { return [c.name, c.value]; });
      captured.hasAction = this.action !== undefined;
    },
    setAttribute(k, v) { this[k] = v; },
    getAttribute(k) { return this[k]; }
  };
  created.push(el);
  return el;
}

const location = {
  href: 'https://flk.npc.gov.cn/',
  protocol: 'https:',
  host: 'flk.npc.gov.cn',
  hostname: 'flk.npc.gov.cn',
  port: '',
  origin: 'https://flk.npc.gov.cn',
  pathname: '/',
  search: '',
  hash: ''
};

const document = {
  createElement: makeEl,
  body: { appendChild() {}, children: [], innerHTML: '' },
  documentElement: { appendChild() {}, style: {} },
  getElementById() { return null; },
  getElementsByTagName() { return []; },
  referrer: 'https://flk.npc.gov.cn/index',
  title: '',
  domain: 'flk.npc.gov.cn',
  cookie: '',
  location: location
};

const navigator = {
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  appName: 'Netscape',
  appVersion: '5.0 (Windows)',
  platform: 'Win32',
  language: 'zh-CN',
  languages: ['zh-CN', 'zh'],
  cookieEnabled: true,
  webdriver: false
};

const sandbox = {
  __doc: document,
  __nav: navigator,
  __loc: location,
  console: console,
  parseInt: parseInt,
  parseFloat: parseFloat,
  isNaN: isNaN,
  String: String,
  Number: Number,
  Math: Math,
  Date: Date,
  RegExp: RegExp,
  Array: Array,
  Object: Object,
  JSON: JSON,
  encodeURIComponent: encodeURIComponent,
  decodeURIComponent: decodeURIComponent,
  atob: function (s) { return Buffer.from(s, 'base64').toString('binary'); },
  btoa: function (s) { return Buffer.from(s, 'binary').toString('base64'); },
  // 反调试定时器：直接忽略即可
  setInterval: function () { return 0; },
  clearInterval: function () { },
  setTimeout: function () { return 0; },
  clearTimeout: function () { }
};

/* 关键：浏览器里 window === globalThis === this。
   用 createContext 后再把 window 指向上下文自身的 globalThis，
   否则混淆脚本的环境检测会判定「不是浏览器」而直接退出。 */
const ctx = vm.createContext(sandbox);
vm.runInContext(
  'globalThis.window = globalThis; globalThis.self = globalThis; globalThis.top = globalThis;' +
  'globalThis.document = __doc; globalThis.navigator = __nav; globalThis.location = __loc;',
  ctx);

try {
  vm.runInContext(code, ctx, { timeout: 15000 });
} catch (e) {
  console.error('EVAL_ERROR ' + (e && e.message ? e.message : e));
  process.exit(2);
}

if (!captured.action) {
  // 兜底：从脚本里取 WZWSREL 路径
  const cm = code.match(/var\s+c\s*=\s*'([^']+)'/);
  const out = { debug: 'no-action', rel: cm ? cm[1] : null, created: created.length, captured: captured };
  for (const el of created) {
    out.createdEls = out.createdEls || [];
    out.createdEls.push({
      tag: el.tagName, name: el.name, value: el.value, action: el.action,
      method: el.method, kids: el.children.length
    });
  }
  console.error(JSON.stringify(out));
  process.exit(4);
}
console.log(JSON.stringify(captured));
