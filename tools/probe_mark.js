/* 探针：划线的「框」到底跟不跟文本。
   依次量：选中 → 建划线 → 打开批注框 → 滚动页面 → 再量。
   输出每一项的视口坐标与文档坐标，看框是否随文本一起移动。
   用法: node tools/probe_mark.js [docId] */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs'); const os = require('os'); const path = require('path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const docId = process.argv[2] || 'r0001';
const PORT = 9950 + Math.floor(Math.random() * 40);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--window-size=1440,1050', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, 'about:blank'],
  { stdio: 'ignore' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const SNAP = `(function(){
  function box(el){ if(!el) return null; var r = el.getBoundingClientRect();
    return {top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left),
            right: Math.round(r.right), h: Math.round(r.height),
            docTop: Math.round(r.top + window.scrollY)}; }
  var mk = document.querySelector('.article mark.fg-hl');
  var ed = document.getElementById('markEdit');
  var tip = document.getElementById('markTip');
  var art = document.getElementById('article');
  var marks = art ? art.querySelectorAll('mark.fg-hl') : [];
  var ids = [];
  for (var i = 0; i < marks.length; i++) ids.push(marks[i].getAttribute('data-mark'));
  return {
    scrollY: Math.round(window.scrollY),
    mark: box(mk),
    markText: mk ? mk.textContent.slice(0, 18) : null,
    markCount: marks.length,
    markIds: ids,
    editor: box(ed),
    editorHidden: ed ? ed.hidden : null,
    editorStyleTop: ed ? ed.style.top : null,
    editorStyleLeft: ed ? ed.style.left : null,
    editorPos: ed ? getComputedStyle(ed).position : null,
    editorParent: ed ? ed.parentNode.className : null,
    tip: box(tip),
    tipHidden: tip ? tip.hidden : null,
    tipStyleTop: tip ? tip.style.top : null,
    tipStyleLeft: tip ? tip.style.left : null
  };
})()`;

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

  /* 选一整段（会跨行），触发划线浮条 */
  console.log('select:', await evalJs(`(function(){
    var art = document.getElementById('article');
    var p = art.querySelector('p.md-clause');
    if (!p) return 'NO_P';
    p.scrollIntoView({block:'center'});
    var w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT, null, false), n, tn = null;
    while ((n = w.nextNode())) { if (n.nodeValue.length > 40) { tn = n; break; } }
    var r = document.createRange();
    r.setStart(tn, 0); r.setEnd(tn, Math.min(40, tn.nodeValue.length));
    var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    art.dispatchEvent(new MouseEvent('mouseup', {bubbles:true}));
    return 'len=' + sel.toString().length;
  })()`));
  await sleep(700);
  console.log('after select:', JSON.stringify(await evalJs(SNAP)));

  /* 点「写批注」→ 建划线并打开批注框 */
  await evalJs(`(function(){ document.getElementById('markNoteBtn').click(); return 1; })()`);
  await sleep(800);
  console.log('after mark+editor:', JSON.stringify(await evalJs(SNAP)));

  /* 滚动 400px，看框跟不跟 */
  await evalJs(`(function(){ window.scrollBy(0, 400); return window.scrollY; })()`);
  await sleep(600);
  console.log('after scroll 400:', JSON.stringify(await evalJs(SNAP)));

  await evalJs(`(function(){ window.scrollBy(0, 600); return window.scrollY; })()`);
  await sleep(600);
  console.log('after scroll 1000:', JSON.stringify(await evalJs(SNAP)));

  chrome.kill(); process.exit(0);
})().catch(e => { console.error('FAIL', e.stack); try { chrome.kill(); } catch (x) { } process.exit(2); });
