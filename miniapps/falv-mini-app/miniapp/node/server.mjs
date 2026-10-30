// 法规库 Mini App 服务端。
//
// 职责：
//  1. 常驻全量语料（约 162MB），提供检索 / 详情 / 门类 / 时间轴 / 导出 API；
//  2. 托管 Mini App 客户端静态页面（surface.path = /）。
//
// API 契约（原生微信小程序直接复用同一套）：
//   GET /api/meta              门类、体系、统计
//   GET /api/search?q=&cat=&group=&sort=&page=&size=
//   GET /api/suggest?q=
//   GET /api/doc?id=           单篇详情（章节 + 结构化块 + 目录 + 纯文本）
//   GET /api/timeline
//   GET /api/export?ids=&fmt=  txt / md / json / csv / html

import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, extname, normalize } from 'node:path';
import { loadCorpus, searchCorpus, suggestCorpus, docDetail, categoryStats, timeline, exportDocs, parseQuery } from './corpus.mjs';

/** @typedef {import('./miniapp-api.js').MiniAppContext} MiniAppContext */
/** @typedef {import('./miniapp-api.js').MiniAppLifecycle} MiniAppLifecycle */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  });
  res.end(body);
}

function sendText(res, code, text, mime) {
  const body = Buffer.from(text, 'utf8');
  res.writeHead(code, {
    'content-type': mime || 'text/plain; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store'
  });
  res.end(body);
}

/**
 * @param {MiniAppContext} context
 * @returns {Promise<MiniAppLifecycle>}
 */
export async function start(context) {
  const clientDir = join(context.pluginRoot, 'miniapp', 'client');
  const corpusDir = join(context.pluginRoot, 'miniapp', 'node', 'corpus');

  /* 语料加载放在 start 之外：Host 装好路由后即可接受连接，
     语料在后台就绪，首个请求等待 ready 即可。 */
  let corpus = null;
  let corpusError = null;
  const ready = loadCorpus(corpusDir).then((c) => {
    corpus = c;
    context.logger.info('miniapp.corpus.ready');
  }).catch((err) => {
    corpusError = err;
    context.logger.error('miniapp.corpus.failed');
  });

  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      context.logger.error('miniapp.request.failed');
      sendJson(res, 500, { error: 'internal_error', message: String(err && err.message ? err.message : err) });
    });
  });

  async function handle(req, res) {
    const url = new URL(req.url || '/', 'http://miniapp.local');
    const p = url.pathname;

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: 'method_not_allowed' });
      return;
    }

    /* ------------------------------- API ------------------------------- */
    if (p.startsWith('/api/')) {
      await ready;
      if (corpusError) {
        sendJson(res, 503, { error: 'corpus_unavailable', message: String(corpusError.message || corpusError) });
        return;
      }
      if (!corpus) {
        sendJson(res, 503, { error: 'corpus_loading' });
        return;
      }

      if (p === '/api/meta') {
        sendJson(res, 200, {
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
        const result = searchCorpus(corpus, q, {
          cats, group, sort, page, pageSize: size
        });
        sendJson(res, 200, result);
        return;
      }

      if (p === '/api/recs') {
        /* 按 id 批量取元信息：客户端的「收藏 / 笔记 / 最近浏览」只需要这几条，
           不必把 1.4MB 的全量 records 塞进 /api/meta。 */
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
        sendJson(res, 200, { items });
        return;
      }

      if (p === '/api/suggest') {
        const q = url.searchParams.get('q') || '';
        sendJson(res, 200, { items: suggestCorpus(corpus, q, 8) });
        return;
      }

      if (p === '/api/doc') {
        const id = url.searchParams.get('id') || '';
        const q = url.searchParams.get('q') || '';
        const terms = q ? parseQuery(q).terms.concat(parseQuery(q).phrases) : [];
        const detail = docDetail(corpus, id, terms);
        if (!detail) {
          sendJson(res, 404, { error: 'not_found' });
          return;
        }
        sendJson(res, 200, detail);
        return;
      }

      if (p === '/api/timeline') {
        sendJson(res, 200, { years: timeline(corpus) });
        return;
      }

      if (p === '/api/export') {
        const ids = (url.searchParams.get('ids') || '').split(',').map((s) => s.trim()).filter(Boolean);
        const fmt = url.searchParams.get('fmt') || 'txt';
        const out = exportDocs(corpus, ids, fmt);
        sendText(res, 200, out.content, out.mime);
        return;
      }

      sendJson(res, 404, { error: 'not_found' });
      return;
    }

    /* --------------------------- 静态客户端 --------------------------- */
    /* surface.path 是 "/"，其余路径回落到 index.html（SPA 路由由 hash 承担）。 */
    let rel = p === '/' ? 'index.html' : p.replace(/^\/+/, '');
    /* 目录穿越护栏：规范化后必须仍在 client 目录内 */
    const safe = normalize(rel).replace(/^(\.\.[/\\])+/, '');
    if (safe.includes('..')) {
      sendText(res, 400, 'bad path');
      return;
    }
    let file = join(clientDir, safe);
    try {
      const st = await stat(file);
      if (st.isDirectory()) file = join(file, 'index.html');
    } catch (e) {
      file = join(clientDir, 'index.html');
    }
    try {
      const buf = await readFile(file);
      const ext = extname(file).toLowerCase();
      res.writeHead(200, {
        'content-type': MIME[ext] || 'application/octet-stream',
        'content-length': buf.length,
        'cache-control': 'no-store'
      });
      res.end(req.method === 'HEAD' ? undefined : buf);
    } catch (e) {
      sendText(res, 404, 'not found');
    }
  }

  await listen(server, context.listen.host, context.listen.port);
  context.logger.info('miniapp.runtime.listening');

  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    context.signal.removeEventListener('abort', onAbort);
    await close(server);
  };
  const onAbort = () => {
    void dispose();
  };
  context.signal.addEventListener('abort', onAbort, { once: true });
  if (context.signal.aborted) await dispose();

  return { dispose };
}

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolve();
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
