/* UI 级导出验证：真的去点详情页的「导出本篇」按钮，确认文件落盘。
   用法：node tools/verify_export_ui.js [docId] */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const docId = process.argv[2] || 'n0002';
const PORT = 9450 + Math.floor(Math.random() * 120);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'vui-'));
const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vuiout-'));
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
  await cdp('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir, eventsEnabled: true });

  const evalJs = async (expression) => {
    const r = await cdp('Runtime.evaluate', { expression: expression, returnByValue: true, awaitPromise: false }, sid);
    if (r && r.exceptionDetails) return 'EXC: ' + JSON.stringify(r.exceptionDetails).slice(0, 300);
    return r && r.result && r.result.value;
  };

  const waitFile = async (pred, label) => {
    for (let i = 0; i < 40; i++) {
      await sleep(400);
      const files = fs.readdirSync(dlDir).filter((f) => !f.endsWith('.crdownload'));
      const hit = files.find(pred);
      if (hit) return hit;
    }
    return null;
  };

  await cdp('Page.navigate', { url: 'http://127.0.0.1:8765/index.html#/doc/' + docId }, sid);
  await sleep(11000);

  /* 1. 布局检查：目录在正文右边、正文居中 */
  const layout = await evalJs(`(function(){
    var toc = document.querySelector('.toc');
    var art = document.querySelector('.article-box');
    var head = document.querySelector('.doc-head');
    if (!toc || !art) return 'NO_TOC_OR_ARTICLE';
    var tr = toc.getBoundingClientRect(), ar = art.getBoundingClientRect(), hr = head.getBoundingClientRect();
    return JSON.stringify({
      tocLeft: Math.round(tr.left), artLeft: Math.round(ar.left), artRight: Math.round(ar.right),
      headLeft: Math.round(hr.left), headRight: Math.round(hr.right),
      viewport: window.innerWidth,
      artCenter: Math.round((ar.left + ar.right) / 2),
      tocIsRight: tr.left > ar.left,
      headAligned: Math.abs(hr.left - ar.left) < 2
    });
  })()`);
  console.log('布局:', layout);

  /* 2. 点「导出本篇」→ 应直接落一个 .md */
  await evalJs(`(function(){ var b = document.getElementById('expDocBtn'); if(!b) return 'NO_BTN'; b.click(); return 'CLICKED'; })()`);
  const md = await waitFile((f) => f.toLowerCase().endsWith('.md'), 'md');
  console.log('点「导出本篇」落盘:', md || '（无）');

  /* 3. 展开菜单 → 选 html → 应落一个 .html */
  await evalJs(`(function(){ var b = document.getElementById('expDocToggle'); b.click();
    var m = document.getElementById('expDocMenu');
    var hidden = m.hasAttribute('hidden');
    var btn = m.querySelector('button[data-fmt="html"]');
    if (btn) btn.click();
    return hidden ? 'MENU_HIDDEN' : 'MENU_OPEN'; })()`);
  const html = await waitFile((f) => f.toLowerCase().endsWith('.html'), 'html');
  console.log('菜单选「网页」落盘:', html || '（无）');

  /* 4. 菜单点击后应自动收起 */
  const closed = await evalJs(`(function(){ var m = document.getElementById('expDocMenu');
    return m ? (m.hasAttribute('hidden') ? 'CLOSED' : 'STILL_OPEN') : 'NO_MENU'; })()`);
  console.log('菜单状态:', closed);

  /* 5. 落盘内容抽查 */
  const out = [];
  for (const f of [md, html]) {
    if (!f) continue;
    const buf = fs.readFileSync(path.join(dlDir, f));
    out.push('  ' + f + ' | ' + buf.length + ' bytes | 标题出现: ' +
      (buf.toString('utf8').indexOf('中华人民共和国网络安全法') >= 0 ? '是' : '否'));
  }
  console.log(out.join('\n'));

  const ok = !!(md && html);
  console.log(ok ? 'RESULT: PASS（点按钮直接导出，菜单换格式，均已落盘）' : 'RESULT: FAIL');
  chrome.kill();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('FAIL', e.stack); try { chrome.kill(); } catch (x) { } process.exit(2); });
