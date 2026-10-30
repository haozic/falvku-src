/**
 * 法规库 · 原生微信小程序本地开发后端
 *
 * 起一个**常驻**的纯 API 服务，供微信开发者工具里的 `app.js` → `API_BASE` 访问。
 * 路由与生产环境（miniapps/falv-mini-app/miniapp/node/server.mjs）**逐条对齐**，
 * 只是不托管 Mini App 的静态页、也不依赖 Mini App 运行时注入的 host/port。
 *
 * 只读地加载 miniapps/ 下的语料，不做任何修改。
 *
 * 运行：
 *   node tools\serve.mjs                # 监听 127.0.0.1:8765
 *   node tools\serve.mjs --port 9000    # 换端口
 *   node tools\serve.mjs --host 0.0.0.0 # 允许局域网真机预览
 *   $env:FG_PORT_OFFSET=1; node tools\serve.mjs
 *
 * 按 Ctrl+C 停止。
 */

import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORPUS_DIR = join(__dirname, '..', '..', 'miniapps', 'falv-mini-app', 'miniapp', 'node', 'corpus');
const CORPUS_MJS = join(__dirname, '..', '..', 'miniapps', 'falv-mini-app', 'miniapp', 'node', 'corpus.mjs');

const {
  loadCorpus,
  searchCorpus,
  suggestCorpus,
  docDetail,
  categoryStats,
  timeline,
  exportDocs,
  parseQuery
} = await import(pathToFileURL(CORPUS_MJS).href);

/* ------------------------------------------------------------ 参数 */

function argOf(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  const env = process.env['FG_' + name.toUpperCase()];
  return env || fallback;
}

const HOST = argOf('host', '127.0.0.1');
const PORT = Number(argOf('port', 8765 + (Number(process.env.FG_PORT_OFFSET) || 0)));

/* ------------------------------------------------------------ 启动 */

console.log('正在载入法规语料（约需数秒）…');
const t0 = Date.now();
const corpus = await loadCorpus(CORPUS_DIR);
console.log(
  `语料已载入：${corpus.docs.length} 条法规 / ${corpus.totalChars.toLocaleString('en-US')} 字` +
  `（耗时 ${Date.now() - t0}ms）`
);

const server = createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://x');
  const p = url.pathname;

  const sendJson = (code, obj) => {
    const body = JSON.stringify(obj);
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
    res.end(body);
  };
  const sendText = (code, text, mime) => {
    res.writeHead(code, { 'content-type': mime });
    res.end(text);
  };

  if (p === '/api/meta') {
    sendJson(200, {
      version: corpus.meta.version,
      source: corpus.meta.source,
      note: corpus.meta.note,
      categories: corpus.meta.categories,
      groups: corpus.meta.groups,
      stats: categoryStats(corpus),
      total: corpus.docs.length,
      totalChars: corpus.totalChars
    });
    return;
  }

  if (p === '/api/search') {
    const q = url.searchParams.get('q') || '';
    const cat = url.searchParams.get('cat') || '';
    const group = url.searchParams.get('group') || '';
    const sort = url.searchParams.get('sort') || 'relevance';
    const page = parseInt(url.searchParams.get('page') || '1', 10) || 1;
    const size = parseInt(url.searchParams.get('size') || '20', 10) || 20;
    const cats = cat && cat !== 'all' ? cat.split(',').filter(Boolean) : null;
    sendJson(200, searchCorpus(corpus, q, { cats, group, sort, page, pageSize: size }));
    return;
  }

  if (p === '/api/recs') {
    const ids = (url.searchParams.get('ids') || '').split(',').map((s) => s.trim()).filter(Boolean);
    const items = [];
    for (const id of ids) {
      const d = corpus.byId.get(id);
      if (!d) continue;
      items.push({
        id: d.id, title: d.title, cat: d.cat, catName: d.catName, group: d.group,
        issuer: d.issuer, published: d.rec.published || '', year: d.year,
        chars: d.rec.chars || 0, tags: d.rec.tags || [], summary: d.summary,
        url: d.rec.url || '', source: d.rec.source || '',
        effect: d.rec.effect || '', flxz: d.rec.flxz || ''
      });
    }
    sendJson(200, { items });
    return;
  }

  if (p === '/api/suggest') {
    sendJson(200, { items: suggestCorpus(corpus, url.searchParams.get('q') || '', 8) });
    return;
  }

  if (p === '/api/doc') {
    const id = url.searchParams.get('id') || '';
    const q = url.searchParams.get('q') || '';
    const parsed = parseQuery(q);
    const terms = q ? parsed.terms.concat(parsed.phrases) : [];
    const detail = docDetail(corpus, id, terms);
    if (!detail) { sendJson(404, { error: 'not_found' }); return; }
    sendJson(200, detail);
    return;
  }

  if (p === '/api/timeline') {
    sendJson(200, { years: timeline(corpus) });
    return;
  }

  if (p === '/api/export') {
    const ids = (url.searchParams.get('ids') || '').split(',').map((s) => s.trim()).filter(Boolean);
    const fmt = url.searchParams.get('fmt') || 'txt';
    const out = exportDocs(corpus, ids, fmt);
    sendText(200, out.content, out.mime);
    return;
  }

  sendJson(404, { error: 'not_found' });
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log(`  法规库 API 已启动：http://${HOST}:${PORT}`);
  console.log('');
  console.log('  接口：');
  console.log('    GET /api/meta');
  console.log('    GET /api/search?q=&cat=&group=&sort=&page=&size=');
  console.log('    GET /api/recs?ids=');
  console.log('    GET /api/suggest?q=');
  console.log('    GET /api/doc?id=&q=');
  console.log('    GET /api/timeline');
  console.log('    GET /api/export?ids=&fmt=txt|md|json|csv|html');
  console.log('');
  console.log(`  小程序请把 wechat/app.js 里的 API_BASE 改成：http://${HOST}:${PORT}`);
  console.log('  按 Ctrl+C 停止。');
  console.log('');
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log('\n正在停止…');
    server.close(() => process.exit(0));
    /* 兜底：连接迟迟不断开时强制退出 */
    setTimeout(() => process.exit(0), 1500).unref();
  });
}
