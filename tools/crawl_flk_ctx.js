/* 用真实 Chrome 批量下载 flk 正文附件（创宇盾 WZWS 挑战由浏览器原生解决）。

   关键点：
   * Browser.setDownloadBehavior 是浏览器级命令，多个 worker 共用一个 Chrome 时
     会互相覆盖 downloadPath，导致「下载到的文件存到了别的编号名下」。
     这里给每个 worker 建独立的浏览器上下文（Target.createBrowserContext），
     用 browserContextId 把下载目录按上下文隔离，于是可以并发且不会张冠李戴。
   * 每个 worker 顺序处理，下载目录里出现新文件即为本篇；
     同时用文件名（服务器给的「标题_日期.docx」）反查标题做二次校验。

   用法：node tools/crawl_flk_ctx.js <items.json> <outdir> [并发数]
        items.json: [{bbbs, title, url}]
*/
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const itemsFile = process.argv[2];
const OUT = path.resolve(process.argv[3] || path.join(__dirname, 'flk_cache'));
const CONC = parseInt(process.argv[4] || '2', 10);
/* 下载间隔（毫秒）：太密会触发创宇盾风控（先是 JS 挑战，再升级成图形验证码） */
const GAP = parseInt(process.argv[5] || '2500', 10);
const PORT = 9300 + Math.floor(Math.random() * 600);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wzwsctx-'));

fs.mkdirSync(OUT, { recursive: true });
const items = JSON.parse(fs.readFileSync(itemsFile, 'utf8'))
  .filter(function (it) { return !fs.existsSync(path.join(OUT, it.bbbs + '.docx')); });
console.log('待下载 ' + items.length + ' 篇，并发 ' + CONC);

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--disable-background-networking', '--disable-sync', '--disable-dev-shm-usage',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, 'about:blank'
], { stdio: 'ignore' });

const sleep = (ms) => new Promise(function (r) { setTimeout(r, ms); });

let wsUrl;
async function getWsUrl() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/version');
      const j = await r.json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch (e) { }
    await sleep(300);
  }
  throw new Error('Chrome 未就绪');
}

let cdp;
function attach(ws) {
  let id = 0; const waiters = {};
  ws.onmessage = function (ev) {
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.id && waiters[m.id]) {
      const w = waiters[m.id]; delete waiters[m.id];
      if (m.error) w.reject(new Error(m.error.message)); else w.resolve(m.result);
    }
  };
  return function (method, params, sessionId) {
    const mid = ++id;
    return new Promise(function (resolve, reject) {
      waiters[mid] = { resolve: resolve, reject: reject };
      const msg = { id: mid, method: method, params: params || {} };
      if (sessionId) msg.sessionId = sessionId;
      ws.send(JSON.stringify(msg));
    });
  };
}

function norm(s) {
  if (!s) return '';
  return String(s).replace(/[^一-龥A-Za-z0-9]/g, '');
}

/* 文件名形如「+全国污染源普查条例_20260808.docx」，取标题主体 */
function fileTitle(name) {
  return norm(path.basename(name, '.docx').replace(/[+＋]$/, '').replace(/_\d{6,8}$/, ''));
}

function titleMatch(expected, fileName) {
  const e = norm(expected).slice(0, 10);
  const f = fileTitle(fileName);
  if (!e || !f) return true;              // 标题过短则跳过校验
  return f.indexOf(e) === 0 || f.indexOf(e) > 0;
}

(async function main() {
  wsUrl = await getWsUrl();
  const ws = new WebSocket(wsUrl);
  await new Promise(function (res, rej) { ws.onopen = res; ws.onerror = rej; });
  cdp = attach(ws);

  let idx = 0, ok = 0, fail = 0, mismatch = 0;
  const failures = [];

  async function worker(w) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dl' + w + '-'));
    const ctx = await cdp('Target.createBrowserContext', {});
    await cdp('Browser.setDownloadBehavior', {
      behavior: 'allow', downloadPath: dir, eventsEnabled: true,
      browserContextId: ctx.browserContextId
    });
    const t = await cdp('Target.createTarget', { url: 'about:blank', browserContextId: ctx.browserContextId });
    const s = await cdp('Target.attachToTarget', { targetId: t.targetId, flatten: true });
    const sid = s.sessionId;
    await cdp('Page.enable', {}, sid);
    const seen = new Set(fs.readdirSync(dir));

    while (true) {
      const i = idx++;
      if (i >= items.length) break;
      const it = items[i];
      let saved = null, got = null;
      for (let attempt = 0; attempt < 3 && !saved; attempt++) {
        try { await cdp('Page.navigate', { url: it.url }, sid); } catch (e) { }
        for (let k = 0; k < 80; k++) {
          await sleep(300);
          let now = [];
          try { now = fs.readdirSync(dir).filter(function (n) { return !seen.has(n) && !n.endsWith('.crdownload'); }); } catch (e) { }
          for (const n of now) {
            const src = path.join(dir, n);
            let st; try { st = fs.statSync(src); } catch (e) { continue; }
            if (st.size < 1000) continue;
            const head = Buffer.alloc(2);
            const fd = fs.openSync(src, 'r');
            fs.readSync(fd, head, 0, 2, 0);
            fs.closeSync(fd);
            if (head[0] !== 0x50 || head[1] !== 0x4b) { seen.add(n); continue; }   // 非 docx（挑战页）
            got = { file: src, name: n };
            break;
          }
          if (got) break;
        }
        if (got) {
          if (!titleMatch(it.title, got.name)) {
            mismatch++;
            console.log('  !! 标题不符，丢弃：期望「' + String(it.title).slice(0, 22) + '」实得「' + got.name.slice(0, 30) + '」');
            try { fs.unlinkSync(got.file); } catch (e) { }
            seen.add(got.name);
            got = null;
            await sleep(1500 + attempt * 3000);
            continue;
          }
          const dst = path.join(OUT, it.bbbs + '.docx');
          fs.copyFileSync(got.file, dst);
          try { fs.unlinkSync(got.file); } catch (e) { }
          seen.add(got.name);
          saved = dst;
        } else {
          await sleep(1500 + attempt * 3000);
        }
      }
      if (saved) { ok++; } else {
        fail++;
        failures.push({ bbbs: it.bbbs, title: it.title });
        console.log('  !! 失败 ' + it.bbbs.slice(0, 12) + ' ' + String(it.title).slice(0, 30));
      }
      if ((ok + fail) % 10 === 0) console.log('  ' + (ok + fail) + '/' + items.length + '  成功 ' + ok + ' 失败 ' + fail);
      await sleep(GAP + Math.floor(Math.random() * GAP * 0.6));
    }
    try { await cdp('Target.closeTarget', { targetId: t.targetId }); } catch (e) { }
    try { await cdp('Target.disposeBrowserContext', { browserContextId: ctx.browserContextId }); } catch (e) { }
  }

  const workers = [];
  for (let i = 0; i < CONC; i++) workers.push(worker(i));
  await Promise.all(workers);

  fs.writeFileSync(path.join(__dirname, 'wzws_failures.json'), JSON.stringify(failures, null, 1));
  console.log('完成：成功 ' + ok + ' 失败 ' + fail + ' 标题不符 ' + mismatch);
  chrome.kill();
  process.exit(fail === 0 ? 0 : 1);
})().catch(function (e) {
  console.error('FAIL ' + (e && e.stack ? e.stack : e));
  try { chrome.kill(); } catch (x) { }
  process.exit(2);
});
