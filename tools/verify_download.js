/* 真实浏览器导出验证：调用站内导出功能，确认文件真的落盘。
   用法：node tools/verify_download.js <docId> <格式> */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const docId = process.argv[2] || 'n0003';
const fmt = process.argv[3] || 'md';
const PORT = 9300 + Math.floor(Math.random() * 150);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'vdl-'));
const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vdlout-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
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

  await cdp('Page.navigate', { url: 'http://127.0.0.1:8765/index.html' }, sid);
  await sleep(9000);

  const expr = "(function(){ var d = Search.get('" + docId + "'); if(!d) return 'NO_DOC'; " +
    "var r = Exporter.exportDocs([d], '" + fmt + "', '导出验证'); return JSON.stringify(r) + ' || ' + d.title; })()";
  const res = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true }, sid);
  console.log('导出调用返回:', res && res.result && res.result.value);

  let files = [];
  for (let i = 0; i < 40; i++) {
    await sleep(400);
    files = fs.readdirSync(dlDir).filter((f) => !f.endsWith('.crdownload'));
    if (files.length) break;
  }
  if (!files.length) {
    console.log('FAIL: 没有文件落盘');
    chrome.kill(); process.exit(1);
  }
  const f = files[0];
  const p = path.join(dlDir, f);
  const st = fs.statSync(p);
  const buf = fs.readFileSync(p);
  console.log('落盘文件:', f, '|', st.size, 'bytes');
  console.log('---- 前 400 字节 ----');
  console.log(buf.subarray(0, 400).toString('utf8'));
  console.log('---- 结尾 120 字节 ----');
  console.log(buf.subarray(Math.max(0, buf.length - 120)).toString('utf8'));
  chrome.kill();
  process.exit(st.size > 500 ? 0 : 1);
})().catch((e) => { console.error('FAIL', e.stack); try { chrome.kill(); } catch (x) { } process.exit(2); });
