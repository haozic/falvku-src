/* 量时间轴几何：竖线位置、圆点位置、卡片位置是否对齐。
   用法：node tools/measure_tl.js */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9700 + Math.floor(Math.random() * 150);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--window-size=1440,1050',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, 'about:blank'
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async function () {
  let wsUrl;
  for (let i = 0; i < 80; i++) {
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

  await cdp('Page.navigate', { url: 'http://127.0.0.1:8765/index.html#/timeline' }, sid);
  await sleep(14000);

  const expr = `(function(){
    var out = [];
    var items = document.querySelector('.tl-items');
    if (!items) return 'NO .tl-items';
    var ir = items.getBoundingClientRect();
    var ics = getComputedStyle(items);
    out.push('tl-items left=' + ir.left.toFixed(1) + ' border-left=' + ics.borderLeftWidth + ' ' + ics.borderLeftColor +
             ' pad-left=' + ics.paddingLeft + ' margin-left=' + ics.marginLeft);
    var its = document.querySelectorAll('.tl-item');
    out.push('items=' + its.length);
    for (var i = 0; i < its.length && i < 3; i++) {
      var it = its[i];
      var r = it.getBoundingClientRect();
      var dot = getComputedStyle(it, ':before');
      var card = it.querySelector('.tl-card');
      var cr = card.getBoundingClientRect();
      var ccs = getComputedStyle(card);
      out.push('#' + i + ' item left=' + r.left.toFixed(1) +
               ' | dot left=' + dot.left + ' w=' + dot.width + ' border=' + dot.borderWidth +
               ' top=' + dot.top +
               ' | card left=' + cr.left.toFixed(1) + ' w=' + cr.width.toFixed(1) +
               ' shadow=' + ccs.boxShadow.slice(0, 40));
    }
    return out.join('\\n');
  })()`;
  const res = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true }, sid);
  if (res && res.exceptionDetails) console.log('EXC:', JSON.stringify(res.exceptionDetails).slice(0, 600));
  console.log(res && res.result && res.result.value);
  chrome.kill();
  process.exit(0);
})().catch((e) => { console.error('FAIL', e.stack); try { chrome.kill(); } catch (x) { } process.exit(2); });
