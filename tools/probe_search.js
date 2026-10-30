/* 探针：检索页「正文分片加载 → 重渲染」时序。
   观察 bodyLoaded 数量、索引里的命中数、页面上的结果数随时间的变化。
   用法: node tools/probe_search.js */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs'); const os = require('os'); const path = require('path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9800 + Math.floor(Math.random() * 150);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-'));
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
  await cdp('Log.enable', {}, sid);
  const evalJs = async (expression) => {
    const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sid);
    if (r && r.exceptionDetails) return 'EXC: ' + JSON.stringify(r.exceptionDetails).slice(0, 300);
    return r && r.result && r.result.value;
  };
  const url = 'http://127.0.0.1:8765/index.html#/search?q=' + encodeURIComponent('纪律处分');
  await cdp('Page.navigate', { url }, sid);
  for (let i = 0; i < 14; i++) {
    await sleep(2000);
    const st = await evalJs(`(function(){
      var b = window.FGApp.bodyLoaded, n = 0;
      for (var k in b) if (b[k]) n++;
      var c = document.querySelector('#view .result-count');
      var cards = document.querySelectorAll('#view .result-card').length;
      var tip = document.getElementById('bodyLoadTip');
      var hits = -1;
      try { hits = Search.search('纪律处分', {pageSize:1}).total; } catch(e) { hits = 'ERR'; }
      return {t: ${i * 2 + 2}, chunks: n, idxHits: hits, pageCount: c ? c.textContent.trim() : 'NO', cards: cards, loading: tip ? tip.textContent : '-'};
    })()`);
    console.log(JSON.stringify(st));
  }
  chrome.kill(); process.exit(0);
})().catch(e => { console.error('FAIL', e.stack); try { chrome.kill(); } catch (x) { } process.exit(2); });
