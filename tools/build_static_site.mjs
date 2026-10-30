/**
 * 构建静态站点：把 Mini App 客户端 + 网页版检索引擎 + 语料分片打成一个
 * 纯静态目录，交给静态托管（website_deploy）发布成公网可分享的链接。
 *
 * 为什么要这一层：
 *   Mini App 运行时里，正文与检索由 Node 服务端持有（/api/*）；
 *   静态托管没有服务端，所以用 client/static-api.js 在浏览器里实现同一套
 *   /api/* 契约 —— 客户端 app.js 一行都不用改。
 *
 * 产物目录：dist/falv-web/
 *   index.html            客户端外壳 + search.js + static-api.js + app.js
 *   app.css / app.js      Mini App 客户端（与 Mini App 包内同源）
 *   static-api.js         纯前端数据层
 *   search.js             网页版检索引擎（assets/js/search.js，window.Search）
 *   data/regulations.js   元信息（2,706 条 + 门类 + 体系 + 分片清单）
 *   data/<分片>.js        正文分片（24 片，约 39MB）
 *
 * 运行：node tools/build_static_site.mjs [仓库根目录]
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.argv[2] ? process.argv[process.argv.length - 1] : join(dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT = join(root, 'miniapps', 'falv-mini-app', 'miniapp', 'client');
const OUT = join(root, 'dist', 'falv-web');
const DATA_SRC = join(root, 'data');

function say(msg) { console.log(msg); }

if (!existsSync(CLIENT)) {
  console.error('找不到客户端目录：' + CLIENT);
  process.exit(1);
}

/* ------------------------------------------------------------ 资源版本号 */

/* 版本号 = 数据 + 前端代码的指纹，任何一处变动版本号就变，浏览器不会命中旧缓存 */
function fingerprint(files) {
  const h = createHash('md5');
  for (const f of files) {
    h.update(basename(f));
    h.update(readFileSync(f));
  }
  return h.digest('hex').slice(0, 8);
}

/* ------------------------------------------------------------ 清理产物 */

if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'data'), { recursive: true });

/* ------------------------------------------------------------ 拷贝文件 */

const clientFiles = ['index.html', 'app.css', 'app.js', 'static-api.js'];
for (const name of clientFiles) {
  const src = join(CLIENT, name);
  if (!existsSync(src)) {
    console.error('客户端缺文件：' + src);
    process.exit(1);
  }
  copyFileSync(src, join(OUT, name));
}

/* 检索引擎直接复用网页版那一份，保证静态站与网页版的检索语义完全一致 */
copyFileSync(join(root, 'assets', 'js', 'search.js'), join(OUT, 'search.js'));

/* 元信息 + 正文分片 */
const dataFiles = readdirSync(DATA_SRC).filter((f) => /^(regulations|party|flk|hubei)_\d+\.js$/.test(f) || f === 'regulations.js');
for (const f of dataFiles) copyFileSync(join(DATA_SRC, f), join(OUT, 'data', f));

say('拷贝资源：客户端 ' + clientFiles.length + ' 个 + search.js + 数据分片 ' + dataFiles.length + ' 个');

/* ------------------------------------------------------------ 边缘检索语料 */

/* 压缩语料（meta + bodies，合计约 11.3MB gzip）随站点一起发布，
   供 Cloudflare Pages Functions 的边缘检索函数读取：
   函数里用 env.ASSETS.fetch('/corpus/meta.json.gz') 取字节，
   再用 DecompressionStream('gzip') 解压。
   没有这一层，边缘函数就只能靠纯静态托管（只能下全部正文）。 */
const CORPUS_SRC = join(root, 'miniapps', 'falv-mini-app', 'miniapp', 'node', 'corpus');
let corpusFiles = [];
if (existsSync(CORPUS_SRC)) {
  corpusFiles = readdirSync(CORPUS_SRC).filter((f) => /\.json\.gz$/.test(f));
  if (corpusFiles.length) {
    mkdirSync(join(OUT, 'corpus'), { recursive: true });
    for (const f of corpusFiles) copyFileSync(join(CORPUS_SRC, f), join(OUT, 'corpus', f));
  }
}
say('拷贝边缘检索语料：' + corpusFiles.length + ' 个（' +
  (corpusFiles.reduce((n, f) => n + readFileSync(join(CORPUS_SRC, f)).length, 0) / 1024 / 1024).toFixed(1) + ' MB）');

/* ------------------------------------------------------------ 生成 index.html */

/* 在客户端外壳里插入 search.js 与 static-api.js，并给所有静态资源加版本号 */
let html = readFileSync(join(CLIENT, 'index.html'), 'utf8');

const verFiles = [
  join(CLIENT, 'app.css'),
  join(CLIENT, 'app.js'),
  join(CLIENT, 'static-api.js'),
  join(root, 'assets', 'js', 'search.js')
].concat(dataFiles.map((f) => join(DATA_SRC, f)));
const VER = fingerprint(verFiles);

html = html.replace('<link rel="stylesheet" href="app.css">',
  '<link rel="stylesheet" href="app.css?v=' + VER + '">');
html = html.replace('<script src="app.js"></script>',
  '<script src="search.js?v=' + VER + '"></script>\n' +
  '<script src="static-api.js?v=' + VER + '"></script>\n' +
  '<script src="app.js?v=' + VER + '"></script>');

if (html.indexOf('static-api.js') === -1) {
  console.error('生成 index.html 失败：没能插入脚本标签');
  process.exit(1);
}
writeFileSync(join(OUT, 'index.html'), html, 'utf8');

/* ------------------------------------------------------------ 体积统计 */

function dirSize(dir) {
  let n = 0;
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, f.name);
    if (f.isDirectory()) n += dirSize(p);
    else n += readFileSync(p).length;
  }
  return n;
}

const total = dirSize(OUT);
const dataSize = dirSize(join(OUT, 'data'));

say('');
say('静态站点已构建：' + OUT);
say('  资源版本号   ' + VER);
say('  总体积       ' + (total / 1024 / 1024).toFixed(1) + ' MB');
say('  其中 data/   ' + (dataSize / 1024 / 1024).toFixed(1) + ' MB（' + dataFiles.length + ' 个分片，检索时才按需下载）');
say('  index.html   ' + (readFileSync(join(OUT, 'index.html')).length / 1024).toFixed(1) + ' KB');
say('');
say('  说明：首次发起非空检索需要下载全部正文分片（约 39MB，仅此一次，之后走浏览器缓存）；');
say('        门类浏览、目录跳转只加载单篇所在的 1 片（约 1.8MB）。');
say('        两段式检索：先按元信息（标题/摘要/标签）毫秒级出结果，正文分片后台补齐后自动刷新。');
if (corpusFiles.length) {
  say('        部署到 Cloudflare Pages 时启用 functions/ 边缘检索，手机不再需要下载正文分片。');
}
