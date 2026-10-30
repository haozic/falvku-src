/**
 * 静态站数据层自检。
 *
 * 在 Node 里造一个最小浏览器环境（window + document + 脚本加载器），
 * 把 assets/js/search.js 与 miniapp/client/static-api.js 加载进来，
 * 然后按客户端的用法逐条打 /api/*，核对返回结构与内容。
 *
 * 目的是保证「静态部署版」与「服务端版」对外契约一致：
 * 同一个查询在两边必须得到同样的条数、同样的目录结构、同样的导出内容。
 *
 * 运行：node tools/static_site_selftest.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(root, 'data');

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

/* ------------------------------------------------------------ 最小浏览器环境 */

const win = {};
globalThis.window = win;

/* 脚本加载器：把 <script src="data/xxx.js"> 直接读本地文件执行 */
globalThis.document = {
  querySelector: function () { return null; },
  createElement: function () {
    const node = {
      set src(v) {
        const file = v.split('?')[0].replace(/^data\//, '');
        const code = readFileSync(join(DATA_DIR, file), 'utf8');
        new Function('window', code)(win);
        setTimeout(function () { if (node.onload) node.onload(); }, 0);
      }
    };
    return node;
  },
  head: { appendChild: function () {} },
  getElementById: function () { return null; }
};

/* ------------------------------------------------------------ 加载被测代码 */

new Function('window', readFileSync(join(root, 'assets', 'js', 'search.js'), 'utf8'))(win);
new Function('window', readFileSync(join(root, 'miniapps', 'falv-mini-app', 'miniapp', 'client', 'static-api.js'), 'utf8'))(win);

const API = win.FGStaticAPI;
if (!API || !API.enabled) {
  console.error('static-api.js 没有暴露 FGStaticAPI');
  process.exit(1);
}

/* 等待正文分片全部载入（两段式检索的「第二段」）。
   静态站的全文检索必须先下载 24 个正文分片，索引建好后结果才完整。 */
async function waitBodiesReady(timeoutMs) {
  const limit = timeoutMs || 120000;
  const t0 = Date.now();
  while (!API.bodiesReady()) {
    await new Promise((r) => setTimeout(r, 50));
    if (Date.now() - t0 > limit) throw new Error('等待正文分片载入超时（' + limit + 'ms）');
  }
}

console.log('=== 1. GET /api/meta ===');
{
  const m = await API.request('/api/meta', {});
  console.log('  total=' + m.total + ' categories=' + m.categories.length + ' groups=' + m.groups.length);
  check(m.total === 2706, 'meta.total = 2706');
  check(m.categories.length === 17, 'meta.categories 是 17 个门类');
  check(m.groups.length === 5, 'meta.groups 是 5 个体系');
  check(Object.keys(m.stats).length === 16, 'meta.stats 覆盖 16 个有法规的门类');
  check(!('records' in m), 'meta 不含 records 明细');
  check(typeof m.totalChars === 'number' && m.totalChars > 13000000, 'meta.totalChars 约 1300 万字');
}

console.log('\n=== 2. GET /api/search ===');
{
  /* 两段式检索：第一次请求只按元信息（标题/摘要/标签/发文机关）出结果，
     24 个正文分片在后台并行下载；索引就绪后再查一次才是完整全文命中。 */
  const first = await API.request('/api/search', { q: '党内监督' });
  console.log('  首屏 total=' + first.total + ' took=' + first.took + 'ms partial=' + first.partial);
  check(first.partial === true, '首次检索标记 partial=true（先按元信息出结果）');
  check(first.loadingBodies === true, '首次检索标记 loadingBodies=true（正文分片后台下载中）');
  check(first.total <= 127, '元信息级命中数不超过全文命中数（实际 ' + first.total + '）');

  const t0 = Date.now();
  await waitBodiesReady();
  console.log('  正文索引就绪耗时 ' + (Date.now() - t0) + 'ms');

  const r = await API.request('/api/search', { q: '党内监督' });
  console.log('  全文 total=' + r.total + ' pages=' + r.pages + ' took=' + r.took + 'ms hits=' + r.hits.length);
  /* 与服务端同一条查询必须得到同样的条数 */
  check(r.partial === false, '正文索引就绪后 partial=false');
  check(r.loadingBodies === false, '正文索引就绪后 loadingBodies=false');
  check(r.total === 127, '「党内监督」命中 127 条（与服务端一致，实际 ' + r.total + '）');
  check(r.hits.length === 20, '默认返回 20 条');
  const h = r.hits[0];
  check(h.id === 'r0034', 'hit[0] 是 r0034');
  check(h.title === '中国共产党党内监督条例', 'hit[0] 标题正确');
  check(typeof h.catName === 'string' && h.catName === '条例', 'hit[0] 门类正确');
  check(h.group === '党内法规', 'hit[0] 体系由 categories[].group 回填');
  check(h.snippetHtml.includes('<mark>'), 'snippetHtml 含 <mark> 高亮');
  check(!/<script/i.test(h.snippetHtml), 'snippetHtml 无脚本注入');

  /* 查询语法 */
  const phrase = await API.request('/api/search', { q: '"党内监督"' });
  check(phrase.query.phrases.length === 1, '短语语法解析出 phrases');
  const excl = await API.request('/api/search', { q: '条例 -监督' });
  check(excl.query.exclude.length === 1, '排除词语法解析出 exclude');
  const field = await API.request('/api/search', { q: '标题:条例' });
  check(field.query.scope === 'title', '字段限定语法解析出 scope=title');

  /* 门类过滤 / 排序 / 分页 */
  const byCat = await API.request('/api/search', { cat: 'falv', sort: 'new', page: 1, size: 5 });
  check(byCat.hits.length === 5 && byCat.hits.every((x) => x.cat === 'falv'), 'cat 过滤生效');
  /* 体系过滤（服务端也支持，静态版原先漏了，这里补齐并锁死） */
  const byGroup = await API.request('/api/search', { group: '党内法规', size: 100 });
  check(byGroup.hits.length > 0 && byGroup.hits.every((x) => x.group === '党内法规'), 'group 过滤生效');
  const byGroupId = await API.request('/api/search', { group: 'dangnei', size: 100 });
  check(byGroupId.total === byGroup.total, 'group 用 id 或用 name 结果一致');
  const groupAll = await API.request('/api/search', { group: 'all', size: 5 });
  check(groupAll.hits.length === 5, 'group=all 不过滤');
  const p2 = await API.request('/api/search', { q: '条例', page: 2, size: 5 });
  check(p2.page === 2, 'page 参数生效');
  const byTitle = await API.request('/api/search', { sort: 'title', size: 10 });
  const titles = byTitle.hits.map((x) => x.title);
  check(JSON.stringify(titles) === JSON.stringify(titles.slice().sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))),
    '按标题排序生效');
  const capped = await API.request('/api/search', { size: 999 });
  check(capped.hits.length <= 100, 'size 被收敛到 100 以内');
}

console.log('\n=== 3. GET /api/doc ===');
{
  const d = await API.request('/api/doc', { id: 'r0034' });
  console.log('  ' + d.title + ' | toc=' + d.toc.length + ' blocks=' + d.blocks.length + ' plain=' + d.plain.length);
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
  check(types.clause > 0, '有 clause 块（条号）');
  check(d.blocks.some((b) => b.type === 'clause' && /^第[一二三四五六七八九十百零〇]+条$/.test(b.no)),
    'clause 块的 no 是纯条号（数据层存纯文本）');

  /* 带 q 的摘要高亮：挑一篇摘要里确实含关键词的法规
     （r0034 的摘要只有「2016年10月27日通过」，不含「监督」，测不出高亮） */
  const withSummary = (await API.request('/api/search', { q: '条例', size: 60 })).hits
    .find((x) => x.summary && x.summary.indexOf('条例') !== -1);
  if (withSummary) {
    const d2 = await API.request('/api/doc', { id: withSummary.id, q: '条例' });
    check(d2.summaryHtml.includes('<mark>'), '带 q 时 summaryHtml 含 <mark>（' + withSummary.id + '）');
  } else {
    check(false, '找不到摘要含关键词的法规，无法验证高亮');
  }

  /* 不存在的 id */
  let threw = false;
  try { await API.request('/api/doc', { id: 'zzz999' }); } catch (e) { threw = true; }
  check(threw, '不存在的 id 会抛错');
}

console.log('\n=== 4. GET /api/timeline ===');
{
  const t = await API.request('/api/timeline', {});
  console.log('  years=' + t.years.length + ' first=' + t.years[0].year);
  check(t.years.length === 60, '时间轴 60 个年份（与服务端一致）');
  check(t.years[0].year >= t.years[t.years.length - 1].year, '年份倒序');
  check(Array.isArray(t.years[0].items) && t.years[0].items.length === t.years[0].count, '年份下条目数与 count 一致');
  check(typeof t.years[0].items[0].id === 'string', '时间轴条目含 id');
}

console.log('\n=== 5. GET /api/suggest ===');
{
  const s = await API.request('/api/suggest', { q: '条例' });
  check(s.items.length > 0 && s.items.length <= 8, '联想返回 1~8 条');
  check(typeof s.items[0].id === 'string' && typeof s.items[0].title === 'string', '联想条目含 id/title');
}

console.log('\n=== 6. GET /api/recs ===');
{
  const r = await API.request('/api/recs', { ids: 'r0034,n0001,zzz999' });
  check(r.items.length === 2, 'recs 跳过不存在的 id');
  check(r.items[0].id === 'r0034' && r.items[0].title === '中国共产党党内监督条例', 'recs 标题正确');
  check(r.items[0].group === '党内法规', 'recs 含 group');
}

console.log('\n=== 7. GET /api/export（5 种格式） ===');
{
  const txt = await API.request('/api/export', { ids: 'r0034', fmt: 'txt' });
  check(txt.indexOf('中国共产党党内监督条例') === 0, 'txt 首行是标题');
  check(txt.indexOf('制定机关：中共中央') !== -1, 'txt 含元信息行');
  check(txt.length > 5000, 'txt 有正文（' + txt.length + ' 字符）');

  const md = await API.request('/api/export', { ids: 'r0034', fmt: 'md' });
  check(md.indexOf('# 中国共产党党内监督条例') === 0, 'md 以 H1 开头');
  check(md.indexOf('**第') !== -1, 'md 里条号加粗');
  check(md.indexOf('## 第一章 总 则') !== -1, 'md 里章节是 H2');

  const json = await API.request('/api/export', { ids: 'r0034', fmt: 'json' });
  const parsed = JSON.parse(json);
  check(Array.isArray(parsed) && parsed.length === 1, 'json 是数组');
  check(Array.isArray(parsed[0].sections) && parsed[0].sections.length === 8, 'json 含章节层级');
  check(parsed[0].sections[0].name === '第一章 总 则', 'json 章节名正确');

  const csv = await API.request('/api/export', { ids: 'r0034', fmt: 'csv' });
  check(csv.charCodeAt(0) === 0xfeff, 'csv 带 UTF-8 BOM');
  check(csv.split('\r\n')[0].split(',').length === 16, 'csv 表头 16 列');
  check(csv.indexOf('标题,版本,分类,门类细分,效力级别,时效性') === 1, 'csv 表头字段与网页版对齐');

  const html = await API.request('/api/export', { ids: 'r0034', fmt: 'html' });
  check(html.toLowerCase().indexOf('<!doctype html') === 0, 'html 是完整网页');
  check(html.indexOf('<span class="no">第一条</span>') !== -1, 'html 里条号单独包裹');

  const empty = await API.request('/api/export', { ids: '', fmt: 'txt' });
  check(empty === '', '空导出返回空内容');
}

console.log('\n============================================================');
console.log('共 ' + checks + ' 项断言，失败 ' + failures.length + ' 项');
if (failures.length) {
  console.log('\n失败项：');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
console.log('全部通过');
