/* 提取 flk.npc.gov.cn 首页的 logo / 背景图素材（内联 SVG 与 data URI 图片）。
   用法：node tools/extract_flk_home.js <输出目录> */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = process.argv[2] || path.join(__dirname, '_flkhome');
const PORT = 9950 + Math.floor(Math.random() * 40);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'flkext-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--window-size=1440,1200',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, 'about:blank'
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async function () {
  fs.mkdirSync(OUT, { recursive: true });
  let wsUrl;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/version');
      const j = await r.json();
      if (j.webSocketDebuggerUrl) { wsUrl = j.webSocketDebuggerUrl; break; }
    } catch (e) { }
    await sleep(300);
  }
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const waiters = {};
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && waiters[m.id]) {
      const w = waiters[m.id]; delete waiters[m.id];
      m.error ? w.reject(new Error(m.error.message)) : w.resolve(m.result);
    }
  };
  const cdp = (method, params, sessionId) => new Promise((resolve, reject) => {
    const mid = ++id; waiters[mid] = { resolve, reject };
    const msg = { id: mid, method, params: params || {} };
    if (sessionId) msg.sessionId = sessionId;
    ws.send(JSON.stringify(msg));
  });

  const t = await cdp('Target.createTarget', { url: 'about:blank' });
  const s = await cdp('Target.attachToTarget', { targetId: t.targetId, flatten: true });
  const sid = s.sessionId;
  await cdp('Page.enable', {}, sid);
  await cdp('Runtime.enable', {}, sid);

  await cdp('Page.navigate', { url: 'https://flk.npc.gov.cn/index' }, sid);
  await sleep(15000);

  const expr = `(function(){
    var out = { svgs: [], bgs: [], imgs: [], pseudo: [], bodyBg: '' };
    var bcs = getComputedStyle(document.body);
    out.bodyBg = (bcs.backgroundImage || 'none').slice(0, 3000) + ' || color=' + bcs.backgroundColor;
    /* 伪元素的背景（getComputedStyle 查不到 ::before/::after，需带参数） */
    var all2 = document.querySelectorAll('body, body *');
    for (var q = 0; q < all2.length; q++) {
      var e2 = all2[q];
      for (var pp of ['::before', '::after']) {
        var ps = getComputedStyle(e2, pp);
        if (!ps || ps.content === 'none' || ps.content === 'normal') continue;
        if (!ps.backgroundImage || ps.backgroundImage === 'none') continue;
        var r2 = e2.getBoundingClientRect();
        out.pseudo.push({ tag: e2.tagName, cls: (e2.className || '').toString().slice(0, 60), pp: pp, bg: ps.backgroundImage.slice(0, 2000) });
      }
    }
    /* 所有内联 svg：取前若干个大的（logo / 背景装饰） */
    var svgs = document.querySelectorAll('svg');
    for (var i = 0; i < svgs.length; i++) {
      var el = svgs[i];
      var r = el.getBoundingClientRect();
      if (r.width < 20 || r.height < 20) continue;
      var parent = el.parentElement;
      out.svgs.push({
        i: i, x: Math.round(r.left), y: Math.round(r.top),
        w: Math.round(r.width), h: Math.round(r.height),
        cls: (el.getAttribute('class')||'') + '|' + (parent && parent.className || ''),
        html: el.outerHTML
      });
    }
    /* 背景图 / 背景色：只看有意义的元素 */
    var all = document.querySelectorAll('body *');
    for (var j = 0; j < all.length; j++) {
      var e = all[j];
      var cs = getComputedStyle(e);
      var bg = cs.backgroundImage;
      if (!bg || bg === 'none') continue;
      var rr = e.getBoundingClientRect();
      if (rr.width < 60 || rr.height < 60) continue;
      out.bgs.push({
        tag: e.tagName, cls: (e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className) || '',
        x: Math.round(rr.left), y: Math.round(rr.top),
        w: Math.round(rr.width), h: Math.round(rr.height),
        bg: bg.slice(0, 4000)
      });
    }
    for (var k = 0; k < document.images.length; k++) {
      var im = document.images[k];
      var ir = im.getBoundingClientRect();
      out.imgs.push({ src: im.currentSrc || im.src, w: Math.round(ir.width), h: Math.round(ir.height) });
    }
    return JSON.stringify(out);
  })()`;
  const res = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true }, sid);
  const val = res && res.result && res.result.value;
  if (!val) {
    console.log('NO VALUE', JSON.stringify(res).slice(0, 500));
  } else {
    fs.writeFileSync(path.join(OUT, 'dom.json'), val, 'utf8');
    const d = JSON.parse(val);
    console.log('svg 数量：', d.svgs.length);
    d.svgs.forEach((s, i) => console.log('  #' + i, s.w + 'x' + s.h, '@' + s.x + ',' + s.y, s.cls.slice(0, 60)));
    console.log('bg 数量：', d.bgs.length);
    d.bgs.forEach((b, i) => console.log('  #' + i, b.tag, b.w + 'x' + b.h, '@' + b.x + ',' + b.y, b.cls.slice(0, 50), '=>', b.bg.slice(0, 90)));
    console.log('img 数量：', d.imgs.length);
    d.imgs.forEach((im, i) => console.log('  #' + i, im.w + 'x' + im.h, im.src.slice(0, 160)));
    console.log('bodyBg：', d.bodyBg.slice(0, 300));
    console.log('pseudo 数量：', d.pseudo.length);
    d.pseudo.forEach((p, i) => console.log('  #' + i, p.tag, p.pp, p.cls, '=>', p.bg.slice(0, 140)));
  }
  chrome.kill();
  process.exit(0);
})().catch((e) => { console.error('FAIL', e.stack); try { chrome.kill(); } catch (x) { } process.exit(2); });
