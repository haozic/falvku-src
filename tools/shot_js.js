/* 打开页面、执行一段 JS、然后截图。用来截那些需要交互才出现的状态
   （如展开的导出菜单）。
   用法：node tools/shot_js.js <名称> <url> <js表达式> [宽] [高] */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const name = process.argv[2] || 'shot';
const url = process.argv[3] || 'http://127.0.0.1:8765/index.html';
const js = process.argv[4] || 'null';
const W = parseInt(process.argv[5] || '1440', 10);
const H = parseInt(process.argv[6] || '1050', 10);
const OUT = path.join(__dirname, 'shots');
const PORT = 9600 + Math.floor(Math.random() * 200);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sj-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--hide-scrollbars', '--window-size=' + W + ',' + H,
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
  await cdp('Emulation.setDeviceMetricsOverride',
    { width: W, height: H, deviceScaleFactor: 1, mobile: false }, sid);

  await cdp('Page.navigate', { url: url }, sid);
  await sleep(11000);
  if (js && js !== 'null') {
    const r = await cdp('Runtime.evaluate', { expression: js, returnByValue: true }, sid);
    if (r && r.exceptionDetails) console.log('EXC:', JSON.stringify(r.exceptionDetails).slice(0, 300));
    else console.log('JS ->', JSON.stringify(r && r.result && r.result.value));
    await sleep(700);
  }
  const shot = await cdp('Page.captureScreenshot', { format: 'png' }, sid);
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, name + '.png');
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  console.log('saved', file, fs.statSync(file).size, 'bytes');
  chrome.kill();
  process.exit(0);
})().catch((e) => { console.error('FAIL', e.stack); try { chrome.kill(); } catch (x) { } process.exit(2); });
