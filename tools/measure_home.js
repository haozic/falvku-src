/* 量首页门类卡片的几何：卡片宽度、底部色条宽度、是否满宽。
   用法：node tools/measure_home.js */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9800 + Math.floor(Math.random() * 150);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'meas-'));
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

  await cdp('Page.navigate', { url: 'http://127.0.0.1:8765/index.html#/' }, sid);
  await sleep(14000);

  const expr = `(function(){
    var out = [];
    var wrap = document.querySelector('.flk-cats');
    if (!wrap) return 'NO .flk-cats';
    var wr = wrap.getBoundingClientRect();
    out.push('flk-cats left=' + wr.left.toFixed(1) + ' width=' + wr.width.toFixed(1));
    var cards = document.querySelectorAll('.flk-cat');
    out.push('cards=' + cards.length);
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      var cr = c.getBoundingClientRect();
      var bar = c.querySelector('i');
      var br = bar ? bar.getBoundingClientRect() : null;
      var cs = getComputedStyle(c);
      out.push('#' + i + ' ' + c.querySelector('.cn').textContent +
        ' card left=' + cr.left.toFixed(1) + ' w=' + cr.width.toFixed(1) +
        ' | bar ' + (br ? ('left=' + br.left.toFixed(1) + ' w=' + br.width.toFixed(1) +
            ' bg=' + getComputedStyle(bar).backgroundImage.slice(0, 70)) : 'NONE'));
    }
    var st = document.querySelectorAll('.stat');
    for (var i = 0; i < st.length; i++) {
      var r = st[i].getBoundingClientRect();
      out.push('stat#' + i + ' w=' + r.width.toFixed(1) + ' v=' + st[i].querySelector('.v').textContent.trim());
    }
    var hero = document.querySelector('.flk-hero') || document.querySelector('.hero');
    if (hero) { var hr = hero.getBoundingClientRect(); out.push('hero top=' + hr.top.toFixed(1) + ' h=' + hr.height.toFixed(1)); }
    var cols = document.querySelectorAll('.home-col');
    for (var i = 0; i < cols.length; i++) { var r2 = cols[i].getBoundingClientRect(); out.push('home-col#' + i + ' left=' + r2.left.toFixed(1) + ' w=' + r2.width.toFixed(1)); }
    return out.join('\\n');
  })()`;
  const res = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true }, sid);
  if (res && res.exceptionDetails) console.log('EXC:', JSON.stringify(res.exceptionDetails).slice(0, 600));
  console.log(res && res.result && res.result.value);
  chrome.kill();
  process.exit(0);
})().catch((e) => { console.error('FAIL', e.stack); try { chrome.kill(); } catch (x) { } process.exit(2); });
