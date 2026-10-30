/**
 * 后端接口冒烟测试：起一个真实的 HTTP 服务（复用 miniapps 的 corpus.mjs），
 * 然后用 http.get 真的把 6 个接口各打一遍，逐条核对返回结构是否与
 * 小程序约定的契约一致。
 *
 * 注意：这里只**读取** miniapps/ 下的语料与代码，不做任何修改。
 *
 * 运行： node tools/api_smoke.mjs
 */

import { createServer } from 'node:http';
import { get } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

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

const HOST = '127.0.0.1';
const PORT = 8765 + (Number(process.env.FG_PORT_OFFSET) || 0);
const BASE = `http://${HOST}:${PORT}`;

const failures = [];
let checks = 0;

function check(cond, label) {
  checks++;
  if (!cond) {
    failures.push(label);
    console.log(`  FAIL  ${label}`);
  } else {
    console.log(`  ok    ${label}`);
  }
}

/* ------------------------------------------------------------ HTTP 辅助 */

function httpGet(path) {
  return new Promise((resolve, reject) => {
    get(BASE + path, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8')
        });
      });
    }).on('error', reject);
  });
}

async function getJson(path) {
  const r = await httpGet(path);
  if (r.status !== 200) throw new Error(`${path} -> HTTP ${r.status}`);
  return JSON.parse(r.body);
}

/* ------------------------------------------------------------ 起服务 */

const corpus = await loadCorpus(CORPUS_DIR);
console.log(`语料已载入：${corpus.docs.length} 条，${corpus.totalChars} 字\n`);

const server = createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://x');
  const p = url.pathname;
  const send = (code, obj) => {
    const body = JSON.stringify(obj);
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
    res.end(body);
  };
  const sendText = (code, text, mime) => {
    res.writeHead(code, { 'content-type': mime });
    res.end(text);
  };

  if (p === '/api/meta') {
    send(200, {
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
    send(200, searchCorpus(corpus, q, { cats, group, sort, page, pageSize: size }));
    return;
  }
  if (p === '/api/suggest') {
    send(200, { items: suggestCorpus(corpus, url.searchParams.get('q') || '', 8) });
    return;
  }
  if (p === '/api/doc') {
    const id = url.searchParams.get('id') || '';
    const q = url.searchParams.get('q') || '';
    const terms = q ? parseQuery(q).terms.concat(parseQuery(q).phrases) : [];
    const detail = docDetail(corpus, id, terms);
    if (!detail) { send(404, { error: 'not_found' }); return; }
    send(200, detail);
    return;
  }
  if (p === '/api/timeline') {
    send(200, { years: timeline(corpus) });
    return;
  }
  if (p === '/api/export') {
    const ids = (url.searchParams.get('ids') || '').split(',').map((s) => s.trim()).filter(Boolean);
    const fmt = url.searchParams.get('fmt') || 'txt';
    const out = exportDocs(corpus, ids, fmt);
    sendText(200, out.content, out.mime);
    return;
  }
  send(404, { error: 'not_found' });
});

await new Promise((resolve) => server.listen(PORT, HOST, resolve));
console.log(`临时服务已启动：${BASE}\n`);

/* ------------------------------------------------------------ 逐个接口验证 */

/* ---- 1. /api/meta ---- */
console.log('== GET /api/meta ==');
{
  const m = await getJson('/api/meta');
  console.log(`  version=${m.version} total=${m.total} totalChars=${m.totalChars}`);
  console.log(`  categories=${m.categories.length} groups=${m.groups.length} stats=${Object.keys(m.stats).length}`);
  check(typeof m.version !== 'undefined', 'meta.version 存在');
  check(Array.isArray(m.categories) && m.categories.length === 17, `meta.categories 是 17 个门类（实际 ${m.categories.length}）`);
  check(Array.isArray(m.groups) && m.groups.length === 5, `meta.groups 是 5 个体系（实际 ${m.groups.length}）`);
  check(typeof m.stats === 'object' && Object.keys(m.stats).length === 16, `meta.stats 覆盖 16 个有法规的门类（实际 ${Object.keys(m.stats).length}）`);
  const withCount = Object.keys(m.stats).filter((k) => m.stats[k].count > 0);
  check(withCount.length === 16, `16 个门类 count>0（实际 ${withCount.length}）`);
  check(typeof m.total === 'number' && m.total === 2706, `meta.total = 2706（实际 ${m.total}）`);
  const c0 = m.categories[0];
  check(!!c0.id && !!c0.name && !!c0.group, 'category 含 id/name/group');
  check(!('records' in m), 'meta **不含** records 明细（小程序因此在本地存标题快照）');
}

/* ---- 2. /api/search ---- */
console.log('\n== GET /api/search?q=党内监督 ==');
{
  const r = await getJson('/api/search?q=' + encodeURIComponent('党内监督'));
  console.log(`  query=${JSON.stringify(r.query)}`);
  console.log(`  total=${r.total} pages=${r.pages} page=${r.page} took=${r.took}ms hits=${r.hits.length}`);
  const h = r.hits[0];
  console.log(`  hit[0]=${h.title} | ${h.catName} | ${h.published} | score=${h.score}`);
  console.log(`  hit[0].snippetHtml=${h.snippetHtml.slice(0, 90)}…`);
  check(Array.isArray(r.hits) && r.hits.length > 0, 'search 返回 hits');
  check(typeof r.total === 'number' && r.pages >= 1, 'search 返回 total/pages');
  check(!!r.query.raw && Array.isArray(r.query.terms), 'search 返回 query 解析结果');
  check(typeof h.id === 'string' && !!h.title, 'hit 含 id/title');
  check(typeof h.cat === 'string' && typeof h.catName === 'string', 'hit 含 cat/catName');
  check(typeof h.published === 'string' && typeof h.year === 'number', 'hit 含 published/year');
  check(typeof h.chars === 'number' && Array.isArray(h.tags), 'hit 含 chars/tags');
  check(typeof h.snippetHtml === 'string' && h.snippetHtml.includes('<mark>'), 'snippetHtml 含 <mark> 高亮');
  check(!/<script/i.test(h.snippetHtml), 'snippetHtml 无脚本注入');

  /* 短语 / 排除词 / 字段限定 */
  const phrase = await getJson('/api/search?q=' + encodeURIComponent('"党内监督"'));
  check(phrase.query.phrases.length === 1, `短语语法解析出 phrases（实际 ${JSON.stringify(phrase.query.phrases)}）`);
  const excl = await getJson('/api/search?q=' + encodeURIComponent('条例 -监督'));
  check(excl.query.exclude.length === 1, `排除词语法解析出 exclude（实际 ${JSON.stringify(excl.query.exclude)}）`);
  const field = await getJson('/api/search?q=' + encodeURIComponent('标题:条例'));
  check(field.query.scope === 'title', `字段限定语法解析出 scope=title（实际 ${field.query.scope}）`);

  /* 门类过滤 + 排序 + 分页 */
  const byCat = await getJson('/api/search?cat=falv&sort=new&page=1&size=5');
  check(byCat.hits.length === 5 && byCat.hits.every((x) => x.cat === 'falv'), 'cat 过滤生效且 size 生效');
  const p2 = await getJson('/api/search?q=' + encodeURIComponent('条例') + '&page=2&size=5');
  check(p2.page === 2, 'page 参数生效');
}

/* ---- 3. /api/doc ---- */
console.log('\n== GET /api/doc ==');
{
  const list = await getJson('/api/search?q=' + encodeURIComponent('党内监督') + '&size=20');
  const id = list.hits[0].id;
  list.allHits = list.hits;
  const d = await getJson('/api/doc?id=' + encodeURIComponent(id));
  console.log(`  id=${d.id} title=${d.title}`);
  console.log(`  cat=${d.cat}/${d.catName} group=${d.group} level=${d.level} chars=${d.chars}`);
  console.log(`  toc=${d.toc.length} 项，blocks=${d.blocks.length} 块，plain=${d.plain.length} 字`);
  const types = {};
  for (const b of d.blocks) types[b.type] = (types[b.type] || 0) + 1;
  console.log(`  block 类型分布：${JSON.stringify(types)}`);
  console.log(`  blocks[0]=${JSON.stringify(d.blocks[0]).slice(0, 120)}`);
  check(typeof d.id === 'string' && !!d.title, 'doc 含 id/title');
  check(typeof d.toc === 'object' && Array.isArray(d.toc), 'doc.toc 是数组');
  check(d.toc.length === 0 || (d.toc[0].name && d.toc[0].level === 1), 'toc 顶层是 level=1');
  check(Array.isArray(d.blocks) && d.blocks.length > 0, 'doc.blocks 非空');
  const allowed = new Set(['h2', 'h3', 'clause', 'item', 'note', 'p']);
  check(d.blocks.every((b) => allowed.has(b.type)), 'blocks 的 type 只在约定集合内');
  check(d.blocks.filter((b) => b.type === 'clause').every((b) => typeof b.no === 'string'), 'clause 块都带 no');
  check(d.blocks.filter((b) => b.type === 'item').every((b) => typeof b.no === 'string'), 'item 块都带 no');
  check(d.blocks.every((b) => typeof b.text === 'string'), '所有块都带 text');
  check(typeof d.plain === 'string' && d.plain.length > 0, 'doc.plain 是全文纯文本');
  check(typeof d.summaryHtml === 'string', 'doc.summaryHtml 存在');
  console.log(`  summary 长度=${(d.summary || '').length}（为空时 summaryHtml 也是空串）`);

  /* 带 q 的正文高亮：挑一篇 summary 里确实含关键词的法规 */
  const withSummary = list.allHits.find((x) => x.summary && x.summary.indexOf('监督') !== -1);
  if (withSummary) {
    const d2 = await getJson('/api/doc?id=' + encodeURIComponent(withSummary.id) + '&q=' + encodeURIComponent('监督'));
    check(d2.summaryHtml.includes('<mark>'), '带 q 时 summaryHtml 含 <mark>');
  } else {
    check(true, '带 q 时 summaryHtml 含 <mark>（本批命中无 summary，跳过）');
  }

  /* 不存在的 id */
  const bad = await httpGet('/api/doc?id=__not_exist__');
  check(bad.status === 404, '不存在的 id 返回 404');
}

/* ---- 4. /api/timeline ---- */
console.log('\n== GET /api/timeline ==');
{
  const t = await getJson('/api/timeline');
  console.log(`  years=${t.years.length}，最新=${t.years[0].year}(${t.years[0].count})，最旧=${t.years[t.years.length - 1].year}`);
  console.log(`  years[0].items[0]=${JSON.stringify(t.years[0].items[0])}`);
  const desc = t.years.every((y, i) => i === 0 || y.year < t.years[i - 1].year);
  check(Array.isArray(t.years) && t.years.length > 0, 'timeline 返回 years');
  check(desc, '年份严格倒序');
  check(typeof t.years[0].count === 'number' && t.years[0].count === t.years[0].items.length, 'year.count 与 items 数量一致');
  const it = t.years[0].items[0];
  check(!!it.id && !!it.title && !!it.catName, 'timeline item 含 id/title/catName');
}

/* ---- 5. /api/suggest ---- */
console.log('\n== GET /api/suggest?q=条例 ==');
{
  const s = await getJson('/api/suggest?q=' + encodeURIComponent('条例'));
  console.log(`  items=${s.items.length}`);
  for (const it of s.items.slice(0, 3)) console.log(`    ${it.title} | ${it.catName}`);
  check(Array.isArray(s.items), 'suggest 返回 items 数组');
  check(s.items.length <= 8, `suggest 最多 8 条（实际 ${s.items.length}）`);
  check(s.items.every((x) => x.id && x.title && x.catName && x.cat), 'suggest item 含 id/title/catName/cat');
}

/* ---- 6. /api/export ---- */
console.log('\n== GET /api/export ==');
{
  const list = await getJson('/api/search?size=1');
  const id = list.hits[0].id;
  for (const fmt of ['txt', 'md', 'json', 'csv', 'html']) {
    const r = await httpGet('/api/export?ids=' + encodeURIComponent(id) + '&fmt=' + fmt);
    const head = r.body.slice(0, 60).replace(/\r?\n/g, ' ⏎ ');
    console.log(`  ${fmt.padEnd(5)} status=${r.status} type=${r.headers['content-type']} bytes=${Buffer.byteLength(r.body)}`);
    console.log(`        ${head}…`);
    check(r.status === 200, `export ${fmt} 返回 200`);
    check(r.body.length > 0, `export ${fmt} 内容非空`);
  }
  const csv = await httpGet('/api/export?ids=' + encodeURIComponent(id) + '&fmt=csv');
  check(csv.body.startsWith('﻿'), 'csv 带 UTF-8 BOM（Excel 友好）');
  check(csv.body.split('\r\n')[0].split(',').length === 16, 'csv 表头 16 列');
  const md = await httpGet('/api/export?ids=' + encodeURIComponent(id) + '&fmt=md');
  check(md.body.includes('# '), 'md 是 Markdown');
  check(md.body.includes('**第'), 'md 里条号加粗');
  const html = await httpGet('/api/export?ids=' + encodeURIComponent(id) + '&fmt=html');
  check(html.body.toLowerCase().startsWith('<!doctype html'), 'html 是完整网页');
}

/* ------------------------------------------------------------ 收尾 */

/* ---- 7. 用小程序自己的 utils/api.js 走一遍（mock wx.request） ---- */
console.log('\n== 用 utils/api.js 真调一遍（mock wx.request） ==');
{
  /* mock 微信运行环境：wx.request 用 http.get 实现，getApp 给出 apiBase */
  globalThis.wx = {
    request: function (opt) {
      get(opt.url, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          const data = opt.dataType === 'text' ? body : JSON.parse(body);
          opt.success({ statusCode: res.statusCode, headers: res.headers, data: data });
        });
      }).on('error', (e) => opt.fail({ errMsg: e.message }));
    }
  };
  globalThis.getApp = () => ({ globalData: { apiBase: BASE } });

  const require = createRequire(import.meta.url);
  const clientApi = require(join(__dirname, '..', 'utils', 'api.js'));

  const m = await clientApi.getMeta();
  console.log(`  api.getMeta()  -> total=${m.total} categories=${m.categories.length}`);
  check(m.total === 2706 && m.categories.length === 17, '客户端 api.getMeta() 正常');

  const s = await clientApi.search({ q: '党内监督', cat: 'all', sort: 'relevance', page: 1, size: 20 });
  console.log(`  api.search()   -> total=${s.total} hits=${s.hits.length} hit[0]=${s.hits[0].title}`);
  check(s.hits.length > 0 && !!s.hits[0].snippetHtml, '客户端 api.search() 正常');

  const sg = await clientApi.suggest('条例');
  console.log(`  api.suggest()  -> items=${sg.items.length}`);
  check(sg.items.length > 0, '客户端 api.suggest() 正常');

  const d = await clientApi.doc(s.hits[0].id, '党内监督');
  console.log(`  api.doc()      -> ${d.title} blocks=${d.blocks.length} toc=${d.toc.length}`);
  check(d.blocks.length > 0 && d.toc.length > 0, '客户端 api.doc() 正常');

  const tl = await clientApi.timeline();
  console.log(`  api.timeline() -> years=${tl.years.length}`);
  check(tl.years.length > 0, '客户端 api.timeline() 正常');

  const ex = await clientApi.exportDoc([s.hits[0].id], 'md');
  console.log(`  api.exportDoc()-> ${ex.length} 字符，前 40 字：${ex.slice(0, 40).replace(/\n/g, ' ⏎ ')}`);
  check(typeof ex === 'string' && ex.startsWith('# '), '客户端 api.exportDoc() 返回 Markdown 原文');

  /* 错误路径 */
  let errCaught = null;
  try {
    await clientApi.search({ q: '党内监督', page: 999999, size: 20 });
  } catch (e) {
    errCaught = e;
  }
  check(!errCaught, '超大 page 参数被服务端收敛，不抛异常');
}

server.close();
console.log('\n' + '='.repeat(60));
console.log(`共 ${checks} 项断言，失败 ${failures.length} 项`);
if (failures.length) {
  for (const f of failures) console.log('  FAIL  ' + f);
}
process.exit(failures.length ? 1 : 0);
