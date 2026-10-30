/* 量一下正文排版的几何：首行缩进、每行字数、章标题位置。
   用法：node tools/measure_article.js <docId> */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const docId = process.argv[2] || 'n0002';
const PORT = 9600 + Math.floor(Math.random() * 200);
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

  await cdp('Page.navigate', { url: 'http://127.0.0.1:8765/index.html#/doc/' + docId }, sid);
  await sleep(12000);

  const expr = `(function(){
    var art = document.getElementById('article');
    var out = [];
    var cs = getComputedStyle(art);
    out.push('article  font-size=' + cs.fontSize + ' line-height=' + cs.lineHeight +
             ' padding=' + cs.padding + ' width=' + art.clientWidth);
    var box = art.getBoundingClientRect();
    out.push('article box left=' + box.left.toFixed(1) + ' right=' + box.right.toFixed(1));
    var ps = art.querySelectorAll('p');
    for (var i = 0; i < ps.length && i < 4; i++) {
      var p = ps[i];
      var pcs = getComputedStyle(p);
      var r = p.getBoundingClientRect();
      out.push('p[' + i + '] class=' + p.className +
               ' text-indent=' + pcs.textIndent +
               ' margin-bottom=' + pcs.marginBottom +
               ' left=' + r.left.toFixed(1) + ' width=' + r.width.toFixed(1) +
               ' | ' + p.textContent.slice(0, 26));
      /* 用 Range 量首行第一个字符的实际 x */
      try {
        var tn = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
        var node = tn.nextNode();
        if (node && node.nodeValue.trim().length) {
          var off = node.nodeValue.length - node.nodeValue.replace(/^\\s+/, '').length;
          var rg = document.createRange();
          rg.setStart(node, off); rg.setEnd(node, off + 1);
          var cr = rg.getBoundingClientRect();
          out.push('      首字符 x=' + cr.left.toFixed(1) + '  (与段左边界差 ' + (cr.left - r.left).toFixed(1) + 'px)');
        }
      } catch (e) { out.push('      measure err ' + e.message); }
    }
    var h = art.querySelector('h3');
    if (h) {
      var hr = h.getBoundingClientRect();
      var hcs = getComputedStyle(h);
      out.push('h3 left=' + hr.left.toFixed(1) + ' font-size=' + hcs.fontSize +
               ' margin=' + hcs.marginTop + '/' + hcs.marginBottom + ' | ' + h.textContent);
    }
    var n = art.querySelector('p.md-note');
    if (n) {
      var nr = n.getBoundingClientRect();
      var ncs = getComputedStyle(n);
      out.push('note left=' + nr.left.toFixed(1) + ' width=' + nr.width.toFixed(1) +
               ' font-size=' + ncs.fontSize + ' padding=' + ncs.padding);
    }
    var toc = document.querySelector('.toc');
    if (toc) { var tr = toc.getBoundingClientRect(); out.push('toc left=' + tr.left.toFixed(1) + ' width=' + tr.width.toFixed(1)); }
    var ab = document.querySelector('.article-box');
    if (ab) { var ar = ab.getBoundingClientRect(); out.push('article-box left=' + ar.left.toFixed(1) + ' width=' + ar.width.toFixed(1)); }
    var dh = document.querySelector('.doc-head');
    if (dh) { var dr = dh.getBoundingClientRect(); out.push('doc-head left=' + dr.left.toFixed(1) + ' width=' + dr.width.toFixed(1)); }
    return out.join('\\n');
  })()`;
  const res = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true }, sid);
  if (res && res.exceptionDetails) console.log('EXC:', JSON.stringify(res.exceptionDetails).slice(0, 600));
  console.log(res && res.result && res.result.value);
  chrome.kill();
  process.exit(0);
})().catch((e) => { console.error('FAIL', e.stack); try { chrome.kill(); } catch (x) { } process.exit(2); });
