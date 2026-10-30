/* 阅读三件套（阅读背景与版式 / 划线批注 / 我的笔记）逐个状态截图。
   一个 Chrome 会话里跑完整串操作，避免每次重开页面导致状态丢失。
   用法: node tools/shot_read.js [docId]
   产物: tools/shots/read_*.png */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const docId = process.argv[2] || 'r0001';
const BASE = 'http://127.0.0.1:8765/index.html';
const W = 1440, H = 1050;
const PORT = 9700 + Math.floor(Math.random() * 200);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-'));
const OUT = path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--hide-scrollbars', '--window-size=' + W + ',' + H,
  /* 这里刻意不加 --force-prefers-reduced-motion：
     关掉动效会让入场动画的 transform 根本不生效，从而掩盖
     「position:fixed 被 transform 劫持包含块」这类真实布局 bug。
     本脚本用 CDP 真实等待（动画只有 0.2s），截到的都是稳定态。 */
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

  const evalJs = async (expression) => {
    const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: false }, sid);
    if (r && r.exceptionDetails) return 'EXC: ' + JSON.stringify(r.exceptionDetails).slice(0, 400);
    return r && r.result && r.result.value;
  };
  const shot = async (name) => {
    const s2 = await cdp('Page.captureScreenshot', { format: 'png' }, sid);
    const file = path.join(OUT, name + '.png');
    fs.writeFileSync(file, Buffer.from(s2.data, 'base64'));
    console.log('saved', name, fs.statSync(file).size, 'bytes');
  };

  await cdp('Page.navigate', { url: BASE + '#/doc/' + docId }, sid);
  await sleep(9000);
  console.log('boot:', await evalJs(`(function(){
    var l = document.getElementById('docLayout');
    return 'data-rd=' + (l ? l.getAttribute('data-rd') : 'NO_LAYOUT') +
           ' article=' + (document.querySelectorAll('.article p').length);
  })()`));

  /* ---- 1. 六种阅读背景 ---- */
  const themes = ['paper', 'cream', 'green', 'blue', 'gray', 'night'];
  for (const th of themes) {
    const r = await evalJs(`(function(){
      Store.settings.set('readTheme', '${th}');
      location.hash = '#/doc/${docId}'; FGApp.route();
      var l = document.getElementById('docLayout');
      var a = document.querySelector('.article-box');
      return 'data-rd=' + (l ? l.getAttribute('data-rd') : '?') +
             ' bg=' + (a ? getComputedStyle(a).backgroundColor : '?');
    })()`);
    console.log('theme ' + th, r);
    await sleep(900);
    await shot('read_bg_' + th);
  }

  /* ---- 2. 阅读设置面板（展开态）---- */
  await evalJs(`(function(){
    Store.settings.set('readTheme','paper');
    location.hash = '#/doc/${docId}'; FGApp.route();
    return 'ok';
  })()`);
  await sleep(1200);
  console.log('panel:', await evalJs(`(function(){
    var b = document.getElementById('readBtn'); if (!b) return 'NO_BTN';
    b.click();
    var p = document.getElementById('readPanel');
    return 'hidden=' + p.hidden + ' themes=' + p.querySelectorAll('.rp-theme').length;
  })()`));
  await sleep(700);
  await shot('read_panel');

  /* ---- 3. 选中正文 → 划线工具条浮出 ---- */
  console.log('tip:', await evalJs(`(function(){
    var art = document.getElementById('article');
    if (!art) return 'NO_ART';
    var p = art.querySelector('p.md-clause') || art.querySelector('p');
    if (!p) return 'NO_P';
    /* 先滚到视口中间：浮条是 fixed 定位，只有选区在视口内才看得见 */
    p.scrollIntoView({ block: 'center' });
    var w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT, null, false), n, tn = null;
    while ((n = w.nextNode())) { if (n.nodeValue.replace(/\\s/g,'').length > 16) { tn = n; break; } }
    if (!tn) return 'NO_TEXT';
    var r = document.createRange();
    r.setStart(tn, 0); r.setEnd(tn, Math.min(16, tn.nodeValue.length));
    var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    art.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    return 'selected=' + sel.toString().slice(0, 20);
  })()`));
  await sleep(900);
  console.log('tip visible:', await evalJs(`(function(){
    var t = document.getElementById('markTip');
    return t ? ('hidden=' + t.hidden + ' top=' + t.style.top + ' left=' + t.style.left) : 'NO_TIP';
  })()`));
  await shot('read_mark_tip');

  /* ---- 4. 点「写批注」→ 就地弹出批注框 ---- */
  console.log('note btn:', await evalJs(`(function(){
    var b = document.getElementById('markNoteBtn'); if (!b) return 'NO_BTN';
    b.click(); return 'CLICKED';
  })()`));
  await sleep(900);
  console.log('editor:', await evalJs(`(function(){
    var e = document.getElementById('markEdit');
    var ta = document.getElementById('markNoteText');
    if (!e) return 'NO_EDIT';
    if (ta) ta.value = '这是划线后写的批注：适用范围存疑，需要结合实施细则核对。';
    return 'hidden=' + e.hidden + ' marks=' + document.querySelectorAll('.article mark.fg-hl').length;
  })()`));
  await sleep(400);
  await shot('read_mark_edit');

  /* ---- 5. 保存批注 → 右侧抽屉 ---- */
  console.log('save:', await evalJs(`(function(){
    var b = document.getElementById('markSave'); if (!b) return 'NO_BTN';
    b.click(); return 'SAVED';
  })()`));
  await sleep(700);
  console.log('drawer:', await evalJs(`(function(){
    var d = document.getElementById('markDrawerBtn'); if (!d) return 'NO_BTN';
    d.click();
    var dr = document.getElementById('markDrawer');
    return 'open=' + dr.classList.contains('open') + ' items=' + dr.querySelectorAll('.md-item').length;
  })()`));
  await sleep(700);
  await shot('read_drawer');

  /* ---- 6. 我的笔记页 ---- */
  await evalJs(`(function(){ location.hash = '#/notes'; FGApp.route(); return 'ok'; })()`);
  await sleep(1400);
  console.log('notes page:', await evalJs(`(function(){
    return 'groups=' + document.querySelectorAll('#view .notes-group').length +
           ' items=' + document.querySelectorAll('#view .ni-t').length;
  })()`));
  await shot('read_notes_page');

  /* ---- 7. 站点深色模式 + 阅读夜间背景 ---- */
  await evalJs(`(function(){
    document.documentElement.setAttribute('data-theme','dark');
    Store.settings.set('readTheme','night');
    location.hash = '#/doc/${docId}'; FGApp.route();
    return 'ok';
  })()`);
  await sleep(1600);
  /* 抽屉在 .doc-layout 之外，夜间配色靠 html[data-rd] 给 —— 必须单独验 */
  console.log('night drawer:', await evalJs(`(function(){
    var d = document.getElementById('markDrawerBtn'); if (!d) return 'NO_BTN';
    d.click();
    var dr = document.getElementById('markDrawer');
    var cs = getComputedStyle(dr);
    return 'open=' + dr.classList.contains('open') +
           ' bg=' + cs.backgroundColor + ' color=' + cs.color +
           ' htmlRd=' + document.documentElement.getAttribute('data-rd');
  })()`));
  await sleep(700);
  await shot('read_dark_drawer');
  await evalJs(`(function(){
    var d = document.getElementById('markDrawerBtn');
    if (d) d.click();
    return 'ok';
  })()`);
  await sleep(400);
  await shot('read_dark_night');

  /* ---- 8. 楷体 + 宽松行距 + 宽版心 ---- */
  await evalJs(`(function(){
    document.documentElement.setAttribute('data-theme','light');
    Store.settings.set('readTheme','cream');
    Store.settings.set('readFf','kai');
    Store.settings.set('readLh', 2.4);
    Store.settings.set('readWidth','wide');
    Store.settings.set('fontSize', 19);
    location.hash = '#/doc/${docId}'; FGApp.route();
    return 'ok';
  })()`);
  await sleep(1400);
  console.log('kai:', await evalJs(`(function(){
    var a = document.querySelector('.article');
    var cs = getComputedStyle(a);
    var ab = document.querySelector('.article-box');
    return 'ff=' + cs.fontFamily.slice(0, 24) + ' fs=' + cs.fontSize + ' lh=' + cs.lineHeight +
           ' width=' + Math.round(ab.getBoundingClientRect().width);
  })()`));
  await shot('read_kai_wide');

  /* ---- 9. 窄屏（430px）：正文、阅读面板、抽屉都要能用 ---- */
  await cdp('Emulation.setDeviceMetricsOverride',
    { width: 430, height: 900, deviceScaleFactor: 1, mobile: true }, sid);
  await evalJs(`(function(){
    document.documentElement.setAttribute('data-theme','light');
    Store.settings.set('readTheme','paper');
    Store.settings.set('readFf','serif');
    Store.settings.set('readLh', 2.02);
    Store.settings.set('readWidth','normal');
    Store.settings.set('fontSize', 17);
    location.hash = '#/doc/${docId}'; FGApp.route();
    return 'ok';
  })()`);
  await sleep(1600);
  console.log('narrow:', await evalJs(`(function(){
    var ab = document.querySelector('.article-box');
    var tb = document.querySelector('.article-toolbar');
    return 'box=' + Math.round(ab.getBoundingClientRect().width) +
           ' toolbar=' + Math.round(tb.getBoundingClientRect().height) +
           ' vw=' + window.innerWidth;
  })()`));
  await shot('read_narrow_doc');

  console.log('narrow panel:', await evalJs(`(function(){
    var b = document.getElementById('readBtn'); if (!b) return 'NO_BTN';
    b.click();
    var p = document.getElementById('readPanel');
    var r = p.getBoundingClientRect();
    return 'hidden=' + p.hidden + ' w=' + Math.round(r.width) + ' right=' + Math.round(r.right) + ' vw=' + window.innerWidth;
  })()`));
  await sleep(700);
  await shot('read_narrow_panel');

  console.log('narrow drawer:', await evalJs(`(function(){
    var d = document.getElementById('markDrawerBtn'); if (!d) return 'NO_BTN';
    d.click();
    var dr = document.getElementById('markDrawer');
    var r = dr.getBoundingClientRect();
    return 'open=' + dr.classList.contains('open') + ' w=' + Math.round(r.width) + ' right=' + Math.round(r.right);
  })()`));
  await sleep(700);
  await shot('read_narrow_drawer');

  /* ---- 10. 打印排版：站点深色 + 阅读夜间背景，打印稿必须是白底 ---- */
  await cdp('Emulation.setDeviceMetricsOverride',
    { width: 1440, height: 1050, deviceScaleFactor: 1, mobile: false }, sid);
  await evalJs(`(function(){
    document.documentElement.setAttribute('data-theme','dark');
    Store.settings.set('readTheme','night');
    location.hash = '#/doc/${docId}'; FGApp.route();
    return 'ok';
  })()`);
  await sleep(1800);
  /* 深色站点下批注文字必须仍是浅色（不能被检索高亮的浅粉色规则污染） */
  console.log('dark mark:', await evalJs(`(function(){
    var m = document.querySelector('.article mark.fg-hl');
    if (!m) return 'NO_MARK';
    m.scrollIntoView({ block: 'center' });
    var cs = getComputedStyle(m);
    var pc = getComputedStyle(m.parentNode);
    return 'markColor=' + cs.color + ' paraColor=' + pc.color + ' bg=' + cs.backgroundColor +
           ' fw=' + cs.fontWeight;
  })()`));
  await sleep(600);
  await shot('read_dark_mark');
  const pdf = await cdp('Page.printToPDF', {
    printBackground: true, paperWidth: 8.27, paperHeight: 11.69,
    marginTop: 0.4, marginBottom: 0.4, marginLeft: 0.4, marginRight: 0.4
  }, sid);
  const pdfFile = path.join(OUT, 'read_print.pdf');
  fs.writeFileSync(pdfFile, Buffer.from(pdf.data, 'base64'));
  console.log('saved', pdfFile, fs.statSync(pdfFile).size, 'bytes');

  chrome.kill();
  process.exit(0);
})().catch((e) => { console.error('FAIL', e.stack); try { chrome.kill(); } catch (x) { } process.exit(2); });
