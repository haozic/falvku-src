/* 探针：是谁在制造 position:fixed 的包含块？
   沿 .mark-tip 的祖先链把 transform / filter / will-change / contain / perspective / animation 全列出来。
   用法: node tools/probe_chain.js [docId] */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs'); const os = require('os'); const path = require('path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const docId = process.argv[2] || 'r0001';
const PORT = 9970 + Math.floor(Math.random() * 25);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--window-size=1440,1050', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, 'about:blank'],
  { stdio: 'ignore' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
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
  await cdp('Page.enable', {}, sid); await cdp('Runtime.enable', {}, sid);
  const evalJs = async (expression) => {
    const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sid);
    if (r && r.exceptionDetails) return 'EXC: ' + JSON.stringify(r.exceptionDetails).slice(0, 400);
    return r && r.result && r.result.value;
  };
  await cdp('Page.navigate', { url: 'http://127.0.0.1:8765/index.html#/doc/' + docId }, sid);
  await sleep(10000);
  const chain = await evalJs(`(function(){
    var out = [], el = document.getElementById('markTip');
    while (el && el.nodeType === 1) {
      var cs = getComputedStyle(el);
      out.push({tag: el.tagName + '.' + (el.className||''),
        position: cs.position, transform: cs.transform, filter: cs.filter,
        willChange: cs.willChange, contain: cs.contain, perspective: cs.perspective,
        anim: cs.animationName, fill: cs.animationFillMode, opacity: cs.opacity});
      el = el.parentElement;
    }
    return out;
  })()`);
  console.log('祖先链（自内向外）：');
  chain.forEach((c, i) => console.log('  ' + i + ' ' + JSON.stringify(c)));
  console.log('scrollY:', await evalJs('Math.round(window.scrollY)'));
  chrome.kill(); process.exit(0);
})().catch(e => { console.error('FAIL', e.stack); try { chrome.kill(); } catch (x) { } process.exit(2); });
