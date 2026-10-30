/**
 * Cloudflare Pages Function 自检。
 *
 * 在 Node 里模拟 Pages Functions 运行环境：
 *   - 造一个假的 env.ASSETS.fetch()，从本地磁盘读 Mini App 语料
 *     （miniapps/falv-mini-app/miniapp/node/corpus/*.gz）；
 *   - 用 zlib.gunzipSync 解压的版本另做一套假 binding，覆盖「语料未压缩」的兜底分支;
 *   - 直接调用 functions/api/[[path]].js 导出的 onRequest()，拿到 Response;
 *   - **与既有 Node 服务端逐条比对**：同一批 query 的 total 与 hits[].id 序列
 *     必须完全一致（用的是同一份语料，参考实现是
 *     miniapps/falv-mini-app/miniapp/node/corpus.mjs）。
 *
 * 运行：node tools/cloudflare_function_selftest.mjs
 * 退出码非 0 表示有 FAIL。
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS_DIR = join(root, 'miniapps', 'falv-mini-app', 'miniapp', 'node', 'corpus');
const FN_FILE = join(root, 'functions', 'api', '[[path]].js');

let checks = 0;
const failures = [];

function check(cond, label) {
  checks++;
  if (!cond) {
    failures.push(label);
    console.log('  FAIL  ' + label);
  } else {
    console.log('  ok    ' + label);
  }
}

function eq(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/* --------------------------------------------------------------------------
   载入被测代码
   --------------------------------------------------------------------------
   functions/api/[[path]].js 是 ESM（Pages Functions 要求），但仓库根没有
   package.json，Node 会把 .js 当 CommonJS —— 用 data: URL 以 ESM 方式载入。
   每次加不同后缀即可得到**互相独立的模块实例**（各自一份 STATE 缓存），
   降级测试需要「干净的」实例。 */
const FN_SRC = readFileSync(FN_FILE, 'utf8');
async function loadModule(tag) {
  const code = FN_SRC + '\n// instance:' + tag + '\n';
  const url = 'data:text/javascript;base64,' + Buffer.from(code, 'utf8').toString('base64');
  return import(url);
}

/* --------------------------------------------------------------------------
   假 env.ASSETS：把 /corpus/*.gz 映射到本地磁盘
   -------------------------------------------------------------------------- */
const FILE_MAP = {
  '/corpus/meta.json.gz': join(CORPUS_DIR, 'meta.json.gz'),
  '/corpus/bodies.json.gz': join(CORPUS_DIR, 'bodies.json.gz')
};
const fileCache = new Map();

function readLocal(path) {
  if (!fileCache.has(path)) fileCache.set(path, new Uint8Array(readFileSync(path)));
  return fileCache.get(path);
}

function makeEnv(opts) {
  opts = opts || {};
  if (opts.noAssets) return {};
  return {
    ASSETS: {
      async fetch(input) {
        const href = typeof input === 'string' ? input : (input && input.url ? input.url : String(input));
        const pathname = new URL(href, 'https://falv.pages.dev').pathname;
        const file = FILE_MAP[pathname];
        if (!file) return new Response('not found', { status: 404 });
        if (opts.plain) {
          /* 兜底分支：语料没压缩，直接给 JSON 字节 */
          return new Response(gunzipSync(readLocal(file)), { status: 200 });
        }
        return new Response(readLocal(file), { status: 200 });
      }
    }
  };
}

/* --------------------------------------------------------------------------
   调用被测函数
   -------------------------------------------------------------------------- */
function makeRequest(path, params, method) {
  const u = new URL('https://falv.pages.dev/api/' + path);
  if (params) {
    for (const key of Object.keys(params)) u.searchParams.set(key, String(params[key]));
  }
  return new Request(u.href, { method: method || 'GET' });
}

async function call(mod, env, path, params, method) {
  const res = await mod.onRequest({
    request: makeRequest(path, params, method),
    env,
    params: {},
    waitUntil: function () {}
  });
  return res;
}

/** 取 JSON 响应 */
async function callJson(mod, env, path, params) {
  const res = await call(mod, env, path, params);
  const text = await res.text();
  return { res, json: text ? JSON.parse(text) : null, text };
}

/** 取文本响应（/api/export 返回的是文件内容本身，不是 JSON） */
async function callText(mod, env, path, params) {
  const res = await call(mod, env, path, params);
  const text = await res.text();
  return { res, text };
}

/**
 * 取原始字节（/api/export 的 CSV 带 UTF-8 BOM：
 * BOM 是**字节**层面的，Response.text() 解码时会把开头的 BOM 去掉，
 * 所以导出比对必须看字节，不能看解码后的字符串）。
 */
async function callRaw(mod, env, path, params) {
  const res = await call(mod, env, path, params);
  const buf = new Uint8Array(await res.arrayBuffer());
  return { res, buf, text: new TextDecoder('utf-8').decode(buf) };
}

/* --------------------------------------------------------------------------
   参考实现（既有 Node 服务端）
   -------------------------------------------------------------------------- */
const corpusMod = await import(pathToFileURL(
  join(root, 'miniapps', 'falv-mini-app', 'miniapp', 'node', 'corpus.mjs')
).href);
const ref = await corpusMod.loadCorpus(CORPUS_DIR);

const mod = await loadModule('main');
const env = makeEnv();

console.log('=== 1. GET /api/meta ===');
{
  const { res, json: m } = await callJson(mod, env, 'meta');
  check(res.status === 200, 'meta 返回 200');
  check(m.total === 2706, 'meta.total = 2706');
  check(m.categories.length === 17, 'meta.categories 是 17 个门类');
  check(m.groups.length === 5, 'meta.groups 是 5 个体系');
  check(Object.keys(m.stats).length === 16, 'meta.stats 覆盖 16 个有法规的门类');
  check(!('records' in m), 'meta 不含 records 明细（1.4MB 不外泄）');
  check(typeof m.totalChars === 'number' && m.totalChars > 13000000, 'meta.totalChars 约 1300 万字');
  check(typeof m.version === 'string' && typeof m.source === 'string' && typeof m.note === 'string',
    'meta 含 version / source / note');

  /* 与服务端同口径比对 */
  const refMeta = {
    version: ref.meta.version,
    source: ref.meta.source,
    note: ref.meta.note,
    categories: ref.meta.categories,
    groups: ref.meta.groups,
    stats: corpusMod.categoryStats(ref),
    total: ref.docs.length,
    totalChars: ref.totalChars
  };
  check(eq(m, refMeta), 'meta 与服务端逐字段一致');
}

console.log('\n=== 2. GET /api/search —— 与服务端逐条比对 ===');
{
  const QUERIES = ['民主集中制', '党内监督', '行政处罚', '党组织', '大气污染防治', '公务员'];
  for (const q of QUERIES) {
    const { json: r } = await callJson(mod, env, 'search', { q });
    const rr = corpusMod.searchCorpus(ref, q, {});
    check(r.total === rr.total, '「' + q + '」total 与服务端一致（' + r.total + '）');
    check(eq(r.hits.map((h) => h.id), rr.hits.map((h) => h.id)),
      '「' + q + '」hits[].id 序列与服务端一致');
    check(eq(r.hits.map((h) => h.snippetHtml), rr.hits.map((h) => h.snippetHtml)),
      '「' + q + '」snippetHtml 与服务端一致');
    check(eq(r.query, rr.query), '「' + q + '」query 解析结果与服务端一致');
  }

  /* 预筛的压力用例：宽查询、含 ASCII 字母、含引号、字段限定正文、排除词。
     预筛会在「元信息与原文都不含检索词」时跳过 JSON.parse，
     这些用例专门验证预筛不会漏命中、也不会多命中。 */
  const EDGE = ['条例', '的', 'WTO', '正文:民主', '"党内监督"', '条例 -监督', '安全生产'];
  for (const q of EDGE) {
    const { json: r } = await callJson(mod, env, 'search', { q, size: 50 });
    const rr = corpusMod.searchCorpus(ref, q, { pageSize: 50 });
    check(r.total === rr.total, '【预筛】「' + q + '」total 与服务端一致（' + r.total + '）');
    check(eq(r.hits.map((h) => h.id), rr.hits.map((h) => h.id)),
      '【预筛】「' + q + '」hits[].id 序列与服务端一致');
    check(eq(r.hits.map((h) => h.score), rr.hits.map((h) => h.score)),
      '【预筛】「' + q + '」命中评分与服务端一致');
  }

  const { json: r } = await callJson(mod, env, 'search', { q: '党内监督' });
  console.log('  total=' + r.total + ' pages=' + r.pages + ' hits=' + r.hits.length + ' took=' + r.took + 'ms');
  check(r.hits.length === 20, '默认返回 20 条');
  check(r.hits[0].id === 'r0034', 'hit[0] 是 r0034（中国共产党党内监督条例）');
  check(r.hits[0].title === '中国共产党党内监督条例', 'hit[0] 标题正确');
  check(r.hits[0].catName === '条例' && r.hits[0].group === '党内法规', 'hit[0] 门类与体系正确');
  check(typeof r.hits[0].score === 'number' && r.hits[0].score > 0, 'hit[0] 带评分');
  check(r.hits[0].snippetHtml.includes('<mark>'), 'snippetHtml 含 <mark> 高亮');
  check(!/<script/i.test(r.hits[0].snippetHtml), 'snippetHtml 无脚本注入');
  check(Array.isArray(r.hits[0].tags) && typeof r.hits[0].chars === 'number', 'hit 含 tags / chars');
  check(r.pages === Math.ceil(r.total / 20), 'pages 与 total/size 自洽');

  /* 查询语法 */
  const phrase = await callJson(mod, env, 'search', { q: '"党内监督"' });
  check(phrase.json.query.phrases.length === 1, '短语语法解析出 phrases');
  const excl = await callJson(mod, env, 'search', { q: '条例 -监督' });
  check(excl.json.query.exclude.length === 1, '排除词语法解析出 exclude');
  const field = await callJson(mod, env, 'search', { q: '标题:条例' });
  check(field.json.query.scope === 'title', '字段限定语法解析出 scope=title');
  const fieldRef = corpusMod.searchCorpus(ref, '标题:条例', {});
  check(eq(field.json.query, fieldRef.query), '字段限定的 query 解析与服务端一致');
  check(field.json.total === fieldRef.total, '字段限定命中的 total 与服务端一致');

  /* 门类 / 体系过滤 */
  const byCat = await callJson(mod, env, 'search', { cat: 'falv', sort: 'new', page: 1, size: 5 });
  const catRef = corpusMod.searchCorpus(ref, '', { cats: ['falv'], sort: 'new', page: 1, pageSize: 5 });
  check(byCat.json.hits.length === 5 && byCat.json.hits.every((x) => x.cat === 'falv'), 'cat 过滤生效');
  check(eq(byCat.json.hits.map((x) => x.id), catRef.hits.map((x) => x.id)), 'cat + sort=new 与服务端一致');

  const byGroup = await callJson(mod, env, 'search', { group: '党内法规', q: '监督', size: 10 });
  const groupRef = corpusMod.searchCorpus(ref, '监督', { group: '党内法规', pageSize: 10 });
  check(byGroup.json.hits.every((x) => x.group === '党内法规'), 'group 过滤生效');
  check(eq(byGroup.json.hits.map((x) => x.id), groupRef.hits.map((x) => x.id)), 'group 过滤结果与服务端一致');

  /* 排序：new / old / title */
  for (const sort of ['new', 'old', 'title']) {
    const s = await callJson(mod, env, 'search', { q: '条例', sort, size: 10 });
    const sr = corpusMod.searchCorpus(ref, '条例', { sort, pageSize: 10 });
    check(eq(s.json.hits.map((x) => x.id), sr.hits.map((x) => x.id)), 'sort=' + sort + ' 与服务端一致');
  }
  const byTitle = await callJson(mod, env, 'search', { sort: 'title', size: 10 });
  const titles = byTitle.json.hits.map((x) => x.title);
  check(eq(titles, titles.slice().sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))), '按标题排序生效');

  /* 分页与 size 上限 */
  const p2 = await callJson(mod, env, 'search', { q: '条例', page: 2, size: 5 });
  check(p2.json.page === 2, 'page 参数生效');
  const capped = await callJson(mod, env, 'search', { size: 999 });
  check(capped.json.hits.length <= 100, 'size 被收敛到 100 以内');
  const cappedRef = corpusMod.searchCorpus(ref, '', { pageSize: 100 });
  check(capped.json.total === cappedRef.total, 'size=999 的 total 与服务端一致');

  /* 空查询：只按元信息出结果，不碰正文 */
  const empty = await callJson(mod, env, 'search', {});
  const emptyRef = corpusMod.searchCorpus(ref, '', {});
  check(empty.json.total === 2706, '空查询返回全部 2,706 条');
  check(eq(empty.json.hits.map((x) => x.id), emptyRef.hits.map((x) => x.id)), '空查询的命中顺序与服务端一致');
}

console.log('\n=== 3. GET /api/doc ===');
{
  const { res, json: d } = await callJson(mod, env, 'doc', { id: 'r0034' });
  check(res.status === 200, 'doc 返回 200');
  check(d.id === 'r0034' && d.title === '中国共产党党内监督条例', 'doc 基本信息正确');
  check(d.catName === '条例' && d.group === '党内法规', 'doc 门类与体系正确');
  check(d.chars === 6749, 'doc 正文字数 6749');
  check(d.published === '2016-10-27', 'doc 公布日期正确');
  check(Array.isArray(d.toc) && d.toc.length === 8, 'doc 有 8 个一级章节');
  check(d.toc[0].name === '第一章 总 则', 'toc[0] 名称正确');
  check(Array.isArray(d.blocks) && d.blocks.length === 86, 'doc 有 86 个正文块');

  const types = {};
  for (const b of d.blocks) types[b.type] = (types[b.type] || 0) + 1;
  console.log('  块类型分布: ' + JSON.stringify(types));
  check(Object.keys(types).every((t) => ['h2', 'h3', 'clause', 'item', 'note', 'p'].indexOf(t) !== -1),
    '块类型只出现约定的 6 种');
  check(d.blocks.some((b) => b.type === 'clause' && /^第[一二三四五六七八九十百零〇]+条$/.test(b.no)),
    'clause 块的 no 是纯条号');
  check(typeof d.plain === 'string' && d.plain.length > 5000, 'doc 含全文纯文本');

  /* 与服务端 docDetail 逐字段比对 */
  const refDoc = corpusMod.docDetail(ref, 'r0034', []);
  check(eq(d, refDoc), 'doc 详情与服务端逐字段一致');

  /* 带 q 的摘要高亮 */
  const withSummary = (await callJson(mod, env, 'search', { q: '条例', size: 60 })).json.hits
    .find((x) => x.summary && x.summary.indexOf('条例') !== -1);
  if (withSummary) {
    const d2 = await callJson(mod, env, 'doc', { id: withSummary.id, q: '条例' });
    check(d2.json.summaryHtml.includes('<mark>'), '带 q 时 summaryHtml 含 <mark>（' + withSummary.id + '）');
    const refD2 = corpusMod.docDetail(ref, withSummary.id, ['条例']);
    check(eq(d2.json, refD2), '带 q 的 doc 详情与服务端一致');
  } else {
    check(false, '找不到摘要含关键词的法规，无法验证高亮');
  }

  const nf = await callJson(mod, env, 'doc', { id: 'zzz999' });
  check(nf.res.status === 404 && nf.json.error === 'not_found', '不存在的 id 返回 404 JSON');
}

console.log('\n=== 4. GET /api/timeline ===');
{
  const { json: t } = await callJson(mod, env, 'timeline');
  const refTl = corpusMod.timeline(ref);
  check(t.years.length === 60, '时间轴 60 个年份（与服务端一致）');
  check(t.years[0].year >= t.years[t.years.length - 1].year, '年份倒序');
  check(Array.isArray(t.years[0].items) && t.years[0].items.length === t.years[0].count, '年份下条目数与 count 一致');
  check(typeof t.years[0].items[0].id === 'string', '时间轴条目含 id');
  const itemCount = t.years.reduce((a, g) => a + g.items.length, 0);
  check(itemCount === 2560, '时间轴条目 2,560 条（2,706 - 146 条无发文日期的条目）');
  check(itemCount === refTl.reduce((a, g) => a + g.items.length, 0), '时间轴条目数与服务端一致');
  check(eq(t.years, refTl), '时间轴整体与服务端一致');
}

console.log('\n=== 5. GET /api/suggest ===');
{
  const { json: s } = await callJson(mod, env, 'suggest', { q: '条例' });
  const refS = corpusMod.suggestCorpus(ref, '条例', 8);
  check(s.items.length > 0 && s.items.length <= 8, '联想返回 1~8 条');
  check(typeof s.items[0].id === 'string' && typeof s.items[0].title === 'string', '联想条目含 id/title');
  check(eq(s.items, refS), '联想结果与服务端一致');
  const emptyS = await callJson(mod, env, 'suggest', { q: '' });
  check(emptyS.json.items.length === 0, '空查询没有联想结果');
}

console.log('\n=== 6. GET /api/recs ===');
{
  const { json: r } = await callJson(mod, env, 'recs', { ids: 'r0034,n0001,zzz999' });
  check(r.items.length === 2, 'recs 跳过不存在的 id');
  check(r.items[0].id === 'r0034' && r.items[0].title === '中国共产党党内监督条例', 'recs 标题正确');
  check(r.items[0].group === '党内法规', 'recs 含 group');
  check(typeof r.items[0].url === 'string' && typeof r.items[0].effect === 'string' && typeof r.items[0].flxz === 'string',
    'recs 含 url / effect / flxz');

  /* 与服务端同一套字段比对 */
  const refItems = [];
  for (const id of ['r0034', 'n0001', 'zzz999']) {
    const d = ref.byId.get(id);
    if (!d) continue;
    refItems.push({
      id: d.id, title: d.title, cat: d.cat, catName: d.catName, group: d.group,
      issuer: d.issuer, published: d.rec.published || '', year: d.year,
      chars: d.rec.chars || 0, tags: d.rec.tags || [], summary: d.summary,
      url: d.rec.url || '', source: d.rec.source || '',
      effect: d.rec.effect || '', flxz: d.rec.flxz || ''
    });
  }
  check(eq(r.items, refItems), 'recs 与服务端逐字段一致');
}

console.log('\n=== 7. GET /api/export（5 种格式） ===');
{
  const fmtList = ['txt', 'md', 'json', 'csv', 'html'];
  for (const fmt of fmtList) {
    const { res, buf } = await callRaw(mod, env, 'export', { ids: 'r0034', fmt });
    const refOut = corpusMod.exportDocs(ref, ['r0034'], fmt);
    const refBytes = Buffer.from(refOut.content, 'utf8');
    check(res.status === 200, fmt + ' 导出返回 200');
    check(buf.length === refBytes.length && Buffer.compare(Buffer.from(buf), refBytes) === 0,
      fmt + ' 导出内容与服务端逐字节一致');
  }

  const txt = (await callRaw(mod, env, 'export', { ids: 'r0034', fmt: 'txt' })).text;
  check(txt.indexOf('中国共产党党内监督条例') === 0, 'txt 首行是标题');
  check(txt.indexOf('制定机关：中共中央') !== -1, 'txt 含元信息行');

  const md = (await callRaw(mod, env, 'export', { ids: 'r0034', fmt: 'md' })).text;
  check(md.indexOf('# 中国共产党党内监督条例') === 0, 'md 以 H1 开头');
  check(md.indexOf('**第') !== -1, 'md 里条号加粗');
  check(md.indexOf('## 第一章 总 则') !== -1, 'md 里章节是 H2');

  const json = (await callRaw(mod, env, 'export', { ids: 'r0034', fmt: 'json' })).text;
  const parsed = JSON.parse(json);
  check(Array.isArray(parsed) && parsed.length === 1, 'json 是数组');
  check(Array.isArray(parsed[0].sections) && parsed[0].sections.length === 8, 'json 含章节层级');
  check(parsed[0].sections[0].name === '第一章 总 则', 'json 章节名正确');

  const csvRaw = await callRaw(mod, env, 'export', { ids: 'r0034', fmt: 'csv' });
  check(csvRaw.buf[0] === 0xef && csvRaw.buf[1] === 0xbb && csvRaw.buf[2] === 0xbf, 'csv 带 UTF-8 BOM（字节层面）');
  const csv = csvRaw.text;
  check(csv.split('\r\n')[0].split(',').length === 16, 'csv 表头 16 列');
  check(csv.indexOf('标题,版本,分类,门类细分,效力级别,时效性') === 0, 'csv 表头字段与网页版对齐');

  const html = (await callRaw(mod, env, 'export', { ids: 'r0034', fmt: 'html' })).text;
  check(html.toLowerCase().indexOf('<!doctype html') === 0, 'html 是完整网页');
  check(html.indexOf('<span class="no">第一条</span>') !== -1, 'html 里条号单独包裹');

  const empty = await callRaw(mod, env, 'export', { ids: '', fmt: 'txt' });
  check(empty.buf.length === 0, '空导出返回空内容');
}

console.log('\n=== 8. 降级行为与路由 ===');
{
  /* 没有 ASSETS binding → 503 + 清晰 JSON */
  const mod2 = await loadModule('no-assets');
  const { res, json } = await callJson(mod2, makeEnv({ noAssets: true }), 'meta');
  check(res.status === 503, '缺 ASSETS binding 返回 503');
  check(json && json.error === 'corpus_unavailable', '缺 ASSETS binding 返回 error=corpus_unavailable');
  check(typeof json.message === 'string' && json.message.length > 0, '503 带可读 message');

  /* 语料文件缺失 → 503 */
  const mod3 = await loadModule('missing-file');
  const brokenEnv = {
    ASSETS: {
      async fetch() { return new Response('not found', { status: 404 }); }
    }
  };
  const miss = await callJson(mod3, brokenEnv, 'meta');
  check(miss.res.status === 503 && miss.json.error === 'corpus_unavailable', '语料文件缺失返回 503 JSON');

  /* 未知路径 → 404 */
  const nf = await callJson(mod, env, 'nope');
  check(nf.res.status === 404 && nf.json.error === 'not_found', '未知路径返回 404 JSON');

  /* 非 GET → 405 */
  const mm = await call(mod, env, 'meta', null, 'POST');
  check(mm.status === 405, 'POST 返回 405');
  check((await mm.text()).indexOf('method_not_allowed') !== -1, '405 返回 JSON 错误体');

  /* 语料未压缩（未走 gzip 分支）时也能工作 */
  const mod4 = await loadModule('plain-corpus');
  const plain = await callJson(mod4, makeEnv({ plain: true }), 'search', { q: '党内监督' });
  check(plain.res.status === 200 && plain.json.total === 127, '未压缩语料也能检索（total=127）');

  /* 只依赖元信息的接口在正文不可用时仍可用 */
  const mod5 = await loadModule('meta-only');
  const halfEnv = {
    ASSETS: {
      async fetch(input) {
        const href = typeof input === 'string' ? input : input.url;
        const pathname = new URL(href, 'https://falv.pages.dev').pathname;
        if (pathname === '/corpus/meta.json.gz') {
          return new Response(readLocal(FILE_MAP[pathname]), { status: 200 });
        }
        return new Response('not found', { status: 404 });
      }
    }
  };
  const metaOnly = await callJson(mod5, halfEnv, 'meta');
  check(metaOnly.res.status === 200 && metaOnly.json.total === 2706, '正文缺失时 /api/meta 仍可用');
  const searchOnly = await callJson(mod5, halfEnv, 'search', { q: '党内监督' });
  check(searchOnly.res.status === 503, '正文缺失时 /api/search 返回 503');
}

console.log('\n============================================================');
console.log('共 ' + checks + ' 项断言，失败 ' + failures.length + ' 项');
if (failures.length) {
  console.log('\n失败项：');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
console.log('全部通过');
