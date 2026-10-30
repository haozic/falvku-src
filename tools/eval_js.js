/* 通用页面探针：打开一个 URL，等页面稳定后执行一段 JS 表达式并打印结果。
   调试站点时比反复改代码插日志快得多。

   用法：node tools/eval_js.js <url> <js表达式> [等待毫秒，默认 9000]
   例：  node tools/eval_js.js http://127.0.0.1:8765/index.html#/doc/n0002 \
             "(function(){return {n:Search.count(), t:document.title};})()"
*/
'use strict';
const { spawn } = require('child_process');
const fs = require('fs'); const os = require('os'); const path = require('path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL_ = process.argv[2];
const EXPR = process.argv[3] || '1';
const WAIT = parseInt(process.argv[4] || '9000', 10);
const PORT = 9200 + Math.floor(Math.random() * 300);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-'));
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
  await cdp('Page.navigate', { url: URL_ }, sid);
  await sleep(WAIT);
  const res = await cdp('Runtime.evaluate', { expression: EXPR, returnByValue: true, awaitPromise: true }, sid);
  if (res && res.exceptionDetails) console.log('EXC:', JSON.stringify(res.exceptionDetails).slice(0, 900));
  else console.log(JSON.stringify(res && res.result && res.result.value, null, 1));
  chrome.kill(); process.exit(0);
})().catch(e => { console.error('FAIL', e.stack); try { chrome.kill(); } catch (x) { } process.exit(2); });
