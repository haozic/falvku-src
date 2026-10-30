/* 移动端截图：用 CDP 的设备模拟量出真实手机视口。
 *
 * 为什么不用 tools/shot.py：它靠 --window-size，Windows 上 Chrome 有最小窗口宽度
 * （实测 --window-size=390 会被撑到 504），于是「按 390 截」拿到的是一张
 * 被裁掉的 390px 图 —— 看起来像布局横向溢出，其实是截图窗口被钳制。
 * Emulation.setDeviceMetricsOverride 能把视口精确设成 390×844，媒体查询也照常生效。
 *
 * 用法：
 *   node tools/shot_mobile.js <输出名> <url> [宽=390] [高=844] [等待毫秒=2500] [dark] [full]
 *     dark  置 data-theme="dark"（深色模式）
 *     full  整页长截图
 *
 * 例：
 *   node tools/shot_mobile.js home "file:///E:/.../index.html#/home" 390 844
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = path.join(__dirname, '..');
const SHOTS = path.join(ROOT, 'tools', 'shots');

const name = process.argv[2];
const URL_ = process.argv[3];
const W = parseInt(process.argv[4] || '390', 10);
const H = parseInt(process.argv[5] || '844', 10);
const WAIT = parseInt(process.argv[6] || '2500', 10);
const DARK = process.argv[7] === 'dark';
const FULL = process.argv[8] === 'full';

if (!name || !URL_) {
  console.error('用法: node tools/shot_mobile.js <输出名> <url> [宽] [高] [等待ms] [dark] [full]');
  process.exit(2);
}

const PORT = 9300 + Math.floor(Math.random() * 300);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--hide-scrollbars', '--force-prefers-reduced-motion',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, 'about:blank'
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async function () {
  let wsUrl;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/version');
      const j = await r.json();
      if (j.webSocketDebuggerUrl) { wsUrl = j.webSocketDebuggerUrl; break; }
    } catch (e) { /* 还没起来 */ }
    await sleep(300);
  }
  if (!wsUrl) throw new Error('Chrome 调试端口没起来');

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

  /* 精确视口：媒体查询（@media max-width:980px）与截图尺寸都按它算 */
  await cdp('Emulation.setDeviceMetricsOverride', {
    width: W, height: H, deviceScaleFactor: 1, mobile: true,
    screenWidth: W, screenHeight: H
  }, sid);

  await cdp('Page.navigate', { url: URL_ }, sid);
  await sleep(WAIT);

  if (DARK) {
    await cdp('Runtime.evaluate', {
      expression: '(function(){document.documentElement.setAttribute("data-theme","dark");' +
        'var s=document.createElement("style");s.textContent="*,*::before,*::after{animation:none!important;transition:none!important}";' +
        'document.head.appendChild(s);return 1;})()'
    }, sid);
    await sleep(400);
  }

  const probe = await cdp('Runtime.evaluate', {
    expression: '(function(){var d=document.documentElement;return JSON.stringify({vw:d.clientWidth,sw:d.scrollWidth});})()',
    returnByValue: true
  }, sid);

  const shot = await cdp('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: FULL,
    clip: FULL ? undefined : { x: 0, y: 0, width: W, height: H, scale: 1 }
  }, sid);

  fs.mkdirSync(SHOTS, { recursive: true });
  const out = path.join(SHOTS, name.endsWith('.png') ? name : name + '.png');
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
  const size = probe && probe.result && probe.result.value ? probe.result.value : '(probe 未返回)';
  console.log('saved ' + out + '  ' + fs.statSync(out).size + ' bytes  viewport=' + size);
  chrome.kill();
  process.exit(0);
})().catch((e) => {
  console.error('FAIL ' + (e.stack || e));
  try { chrome.kill(); } catch (x) { /* ignore */ }
  process.exit(2);
});
