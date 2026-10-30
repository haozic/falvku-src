/* file:// 终检：双击打开 index.html 时，详情页、正文分片、阅读设置、划线是否都正常。
   用法: node tools/probe_file.js */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs'); const os = require('os'); const path = require('path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9900 + Math.floor(Math.random() * 90);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-'));
const FILE = process.argv[2] || 'E:\\cursor\\法规库\\index.html';
const url = new URL('file:///' + FILE.replace(/\\/g, '/')).href;

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
    if (r && r.exceptionDetails) return 'EXC: ' + JSON.stringify(r.exceptionDetails).slice(0, 300);
    return r && r.result && r.result.value;
  };

  console.log('URL:', url);
  await cdp('Page.navigate', { url: url + '#/doc/r0001' }, sid);
  await sleep(12000);
  console.log('doc page:', await evalJs(`(function(){
    var l = document.getElementById('docLayout');
    var a = document.querySelectorAll('.article p');
    var b = window.FGApp.bodyLoaded, n = 0;
    for (var k in b) if (b[k]) n++;
    return {rd: l ? l.getAttribute('data-rd') : null, paras: a.length,
            chunksLoaded: n, chunksTotal: (window.FG_DATA.bodyFiles||[]).length,
            localStorage: typeof window.localStorage !== 'undefined'};
  })()`));

  console.log('read panel:', await evalJs(`(function(){
    var rd = document.getElementById('readBtn'); if (!rd) return 'NO_BTN';
    rd.click();
    var pn = document.getElementById('readPanel');
    return {open: !pn.hidden, themes: pn.querySelectorAll('.rp-theme').length,
            groups: pn.querySelectorAll('[data-rd-lh],[data-rd-ff],[data-rd-width]').length};
  })()`));

  console.log('theme switch:', await evalJs(`(function(){
    var b = document.getElementById('readPanel').querySelector('[data-rd-theme="green"]');
    if (!b) return 'NO_BTN';
    b.click();
    var l = document.getElementById('docLayout');
    var box = document.querySelector('.article-box');
    return {rd: l.getAttribute('data-rd'), bg: getComputedStyle(box).backgroundColor};
  })()`));

  console.log('marking:', await evalJs(`(function(){
    var art = document.getElementById('article');
    var p = art.querySelector('p.md-clause');
    if (!p) return 'NO_P';
    p.scrollIntoView({block:'center'});
    var w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT, null, false), n, tn = null;
    while ((n = w.nextNode())) { if (n.nodeValue.replace(/\\s/g,'').length > 16) { tn = n; break; } }
    var r = document.createRange();
    r.setStart(tn, 0); r.setEnd(tn, Math.min(16, tn.nodeValue.length));
    var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    art.dispatchEvent(new MouseEvent('mouseup', {bubbles:true}));
    return 'selected';
  })()`));
  await sleep(600);
  console.log('mark tip:', await evalJs(`(function(){
    var tip = document.getElementById('markTip');
    return {visible: !tip.hidden, top: tip.style.top, left: tip.style.left};
  })()`));

  console.log('notes page:', await evalJs(`(function(){
    location.hash = '#/notes'; FGApp.route();
    return {groups: document.querySelectorAll('#view .notes-group').length,
            sideCount: document.getElementById('marksCountSide').textContent};
  })()`));

  chrome.kill(); process.exit(0);
})().catch(e => { console.error('FAIL', e.stack); try { chrome.kill(); } catch (x) { } process.exit(2); });
