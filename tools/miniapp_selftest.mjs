// Mini App 服务端 API 自检：不经浏览器，直接验证语料加载与各 API 的行为。
import { loadCorpus, searchCorpus, suggestCorpus, docDetail, categoryStats, timeline, exportDocs } from '../miniapps/falv-mini-app/miniapp/node/corpus.mjs';
import { fileURLToPath } from 'node:url';

/* URL.pathname 是百分号编码的，路径含中文时必须走 fileURLToPath */
const corpusDir = fileURLToPath(new URL('../miniapps/falv-mini-app/miniapp/node/corpus/', import.meta.url));

let pass = 0;
let fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (extra ? '  -> ' + extra : '')); }
}

console.log('载入语料…');
const t0 = Date.now();
const corpus = await loadCorpus(corpusDir);
console.log('载入耗时 ' + (Date.now() - t0) + 'ms\n');

console.log('[语料]');
ok(corpus.docs.length === 2706, '元信息 2706 条', corpus.docs.length);
ok(corpus.byId.size === 2706, '正文 2706 篇');
ok(corpus.totalChars > 13000000, '总字数 > 1300 万', corpus.totalChars);
ok(corpus.docs.every((d) => d.group), '每条都有体系分组');
ok(corpus.docs.every((d) => d.sections.length > 0), '每条都有章节');

console.log('\n[检索]');
const r1 = searchCorpus(corpus, '党内监督', { pageSize: 10 });
ok(r1.total > 50, '「党内监督」命中 > 50 篇', r1.total);
ok(r1.hits.length === 10, '分页返回 10 条', r1.hits.length);
ok(r1.hits[0].snippetHtml.includes('<mark>'), '摘要含高亮');
ok(r1.hits.every((h) => h.title && h.catName), '每条结果有标题与门类');

const r2 = searchCorpus(corpus, '"民主集中制"', { pageSize: 5 });
ok(r2.total > 0, '短语检索命中', r2.total);

const r3 = searchCorpus(corpus, '民主集中制 -湖北', { pageSize: 5 });
ok(r3.total < r2.total, '排除词生效（-湖北 收窄结果）', r3.total + ' vs ' + r2.total);

const r4 = searchCorpus(corpus, '标题:中国共产党章程', { pageSize: 5 });
ok(r4.total > 0 && r4.hits[0].title.includes('中国共产党章程'), '字段限定 标题: 生效');

const r5 = searchCorpus(corpus, '中国共产党章程', { cats: ['dangzhang'], pageSize: 5 });
ok(r5.total === 1 && r5.hits[0].cat === 'dangzhang', '门类过滤生效', r5.total);

const r6 = searchCorpus(corpus, '长江', { group: '湖北地方法规', pageSize: 5 });
ok(r6.hits.every((h) => h.group === '湖北地方法规'), '体系过滤生效');

const r7 = searchCorpus(corpus, '宪法', { sort: 'new', pageSize: 20 });
const years = r7.hits.map((h) => h.year);
ok(years.every((y, i) => i === 0 || years[i - 1] >= y), '按最新排序单调不增');

const r8 = searchCorpus(corpus, '', { pageSize: 10, page: 2 });
ok(r8.page === 2 && r8.hits.length === 10, '空查询翻页正常');
ok(r8.total === 2706, '空查询返回全部 2706', r8.total);

console.log('\n[联想]');
const sg = suggestCorpus(corpus, '共产党', 8);
ok(sg.length > 0 && sg.length <= 8, '联想返回 1-8 条', sg.length);
ok(sg[0].title.includes('共产党'), '首条标题命中');

console.log('\n[详情]');
const d = docDetail(corpus, 'r0001', ['中国共产党章程']);
ok(!!d, '取到党章');
ok(d.title === '中国共产党章程', '标题正确');
ok(d.blocks.length > 100, '结构化块 > 100', d.blocks.length);
ok(d.toc.length > 0, '目录非空');
ok(d.plain.length > 10000, '纯文本完整', d.plain.length);
const kinds = new Set(d.blocks.map((b) => b.type));
ok(kinds.has('clause'), '含条款块');
ok(kinds.has('h2'), '含章节标题块');
ok(d.blocks.filter((b) => b.type === 'clause').every((b) => b.no.startsWith('第')), '条号格式正确');

const d2 = docDetail(corpus, 'n0001', []);
ok(d2 && d2.blocks.length > 10, 'flk 法规详情正常');
ok(d2.flxz === '法律' && d2.effect === '有效', '效力级别与时效性字段正确', d2.flxz + '/' + d2.effect);

const d3 = docDetail(corpus, 'h0001', []);
ok(d3 && d3.blocks.length > 5, '湖北法规详情正常');
ok(d3.blocks.some((b) => b.type === 'h2'), '湖北含一级小节');

/* 二级小节（level=2）全库共 886 处，找一部确实含二级小节的法规验证 */
const withL2 = corpus.docs.find((d) => d.sections.some((s) => s.level === 2));
ok(!!withL2, '存在含二级小节的法规');
if (withL2) {
  const dd = docDetail(corpus, withL2.id, []);
  ok(dd.blocks.some((b) => b.type === 'h3'), '二级小节渲染为 h3 块', withL2.id);
  ok(dd.toc.some((t) => t.children && t.children.length), '目录含二级嵌套');
}

ok(docDetail(corpus, 'nope', []) === null, '不存在的 id 返回 null');

console.log('\n[门类与时间轴]');
const stats = categoryStats(corpus);
ok(Object.keys(stats).length === 16, '门类统计覆盖 16 个有法规的门类', Object.keys(stats).length);
ok(stats.falv.count === 591, '法律 591 部', stats.falv.count);
ok(stats.tiaoli.count === 45, '党内条例 45 部', stats.tiaoli.count);
const tl = timeline(corpus);
ok(tl.length > 30, '时间轴覆盖 30+ 年份', tl.length);
ok(tl[0].year > tl[tl.length - 1].year, '时间轴按年倒序');
/* 时间轴只收有可定位年份的条目；党务知识问答等 146 条源数据本就无发文日期，正确行为是排除 */
const withYear = corpus.docs.filter((d) => {
  const s = d.rec.published || d.rec.revised || d.rec.adopted || '';
  return (parseInt(String(s).slice(0, 4), 10) || d.year || 0) > 0;
}).length;
ok(tl.reduce((s, y) => s + y.count, 0) === withYear,
  '时间轴条目数 = 有年份条目数', tl.reduce((s, y) => s + y.count, 0) + ' vs ' + withYear);
ok(tl.reduce((s, y) => s + y.count, 0) < 2706, '无日期条目被正确排除');

console.log('\n[导出]');
for (const fmt of ['txt', 'md', 'json', 'html']) {
  const out = exportDocs(corpus, ['r0001'], fmt);
  ok(out.content.length > 1000 && out.filename.endsWith('.' + fmt), fmt + ' 导出非空且命名正确', out.filename + ' ' + out.content.length);
}
/* CSV 是「目录」导出（元信息表，不含正文），因此只需几百字节 */
const csvOut = exportDocs(corpus, ['r0001'], 'csv');
ok(csvOut.content.length > 80 && csvOut.filename.endsWith('.csv'), 'CSV 导出为元信息目录', csvOut.filename + ' ' + csvOut.content.length);
ok(csvOut.content.split('\r\n').length === 2, 'CSV 一条记录 = 表头 + 一行');
ok(csvOut.content.includes('效力级别') && csvOut.content.includes('施行日期'), 'CSV 含完整字段表头');
const md = exportDocs(corpus, ['r0001'], 'md');
ok(md.content.includes('**第一条**'), 'Markdown 条号加粗');
ok(!/^\*\*第一条\*\*$/m.test(md.content), '条号与正文同行');
const csv = exportDocs(corpus, ['r0001'], 'csv');
ok(csv.content.charCodeAt(0) === 0xfeff, 'CSV 带 BOM');
const js = exportDocs(corpus, ['r0001'], 'json');
ok(JSON.parse(js.content)[0].sections.length > 0, 'JSON 导出含章节');
const html = exportDocs(corpus, ['r0001'], 'html');
ok(html.content.includes('<!doctype html>') && html.content.includes('中国共产党章程'), 'HTML 导出完整');
ok(exportDocs(corpus, [], 'txt').content === '', '空导出返回空内容');

console.log('\n[性能]');
const t1 = Date.now();
searchCorpus(corpus, '民主集中制', { pageSize: 20 });
console.log('  检索耗时 ' + (Date.now() - t1) + 'ms');
const t2 = Date.now();
searchCorpus(corpus, '长江流域', { pageSize: 20 });
console.log('  检索耗时 ' + (Date.now() - t2) + 'ms');

console.log('\n———— ' + pass + ' PASS / ' + fail + ' FAIL ————');
process.exit(fail ? 1 : 0);
