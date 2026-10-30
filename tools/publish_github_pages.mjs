/**
 * 把静态站发布到 GitHub Pages。
 *
 * 为什么要单独一个脚本：`dist/falv-web` 是**构建输出**，构建脚本每次都会
 * 整个目录重建（会删掉 .git）。所以发布用的 git 仓库放在 `.publish/falv-ku/`，
 * 每次发布只把产物**同步**进去（保留 .git），再提交推送。
 *
 * 流程：
 *   1. node tools/build_static_site.mjs .          （构建产物）
 *   2. node tools/publish_github_pages.mjs .        （同步 + 提交 + 推送 + 开 Pages）
 *
 * 需要已登录 GitHub CLI（gh auth status 可查看）。
 *
 * 用法：
 *   node tools/publish_github_pages.mjs [仓库根目录] [--repo haozic/falv-ku] [--yes]
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(root, 'dist', 'falv-web');
const PUBLISH = join(root, '.publish');

function arg(name, fallback) {
  const i = argv.indexOf('--' + name);
  if (i !== -1 && argv[i + 1]) return argv[i + 1];
  return fallback;
}

const REPO = arg('repo', 'haozic/falv-ku');
const BRANCH = arg('branch', 'main');
const owner = REPO.split('/')[0];
const repoName = REPO.split('/')[1];

/* 禁止 git 弹交互式账号密码框：凭据助手（gh）拿不到就直接报错，
   免得像之前那样挂在一个永远等不到的输入框上。 */
process.env.GIT_TERMINAL_PROMPT = '0';
process.env.GCM_INTERACTIVE = 'never';

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/* ------------------------------------------------------------ 前置检查 */

if (!existsSync(SITE)) {
  console.error('找不到构建产物：' + SITE);
  console.error('先跑：node tools/build_static_site.mjs .');
  process.exit(1);
}
if (!existsSync(join(SITE, 'index.html'))) {
  console.error('构建产物缺少 index.html');
  process.exit(1);
}

console.log('仓库      ' + REPO + '（' + BRANCH + ' 分支）');
console.log('构建产物  ' + SITE);
console.log('');

/* ------------------------------------------------------------ 同步产物 */

/* 目标目录保留 .git，只替换站点内容 */
mkdirSync(PUBLISH, { recursive: true });
const dest = join(PUBLISH, repoName);
if (!existsSync(join(dest, '.git'))) {
  mkdirSync(dest, { recursive: true });
  git(['init', '-b', BRANCH], dest);
  git(['remote', 'add', 'origin', 'https://github.com/' + REPO + '.git'], dest);
  console.log('初始化本地 git 仓库');
} else {
  console.log('复用已有本地 git 仓库');
}

/* 先清掉旧的站点文件（保留 .git 与 .github） */
for (const name of ['index.html', 'app.css', 'app.js', 'static-api.js', 'search.js', 'data']) {
  const p = join(dest, name);
  if (existsSync(p)) rmSync(p, { recursive: true, force: true });
}
cpSync(SITE, dest, {
  recursive: true,
  filter: (src) => !src.includes(`${'\\'}.git${'\\'}`) && !src.endsWith(`${'\\'}.git`)
});

/* GitHub Pages 默认走 Jekyll，会忽略部分文件 —— 加 .nojekyll 直接原样发布 */
const nojekyll = join(dest, '.nojekyll');
if (!existsSync(nojekyll)) writeFileSync(nojekyll, '', 'utf8');

/* README：让仓库首页说明这个站是什么 */
const readme = join(dest, 'README.md');
if (!existsSync(readme)) {
  writeFileSync(readme, [
    '# 法规库 · 党务工作速查',
    '',
    '2,706 部党内法规与国家法律法规的**离线全文检索**站点（静态部署，无需服务端）。',
    '',
    '- 首页：16 个门类磁贴 + 法规体系 + 最近浏览',
    '- 检索：支持「短语」精确匹配、`-排除词`、`标题:字段限定`',
    '- 详情：两级目录、条号加粗、首行缩进、划线批注、收藏',
    '- 导出：纯文本 / Markdown / 网页 / JSON / 目录 CSV 五种格式',
    '',
    '**首次发起非空检索需下载全部正文分片（约 39MB，仅此一次，之后走浏览器缓存）；',
    '门类浏览与打开单篇只加载 1 片（约 1.8MB）。**',
    '',
    '## 数据来源',
    '',
    '国家法律法规数据库（flk.npc.gov.cn）· 人民网党建频道「党章党规」·',
    '共产党员网「党章党规」专页 · 湖北法规库。条文以官方发布文本为准。',
    '',
    '## 重新构建',
    '',
    '本仓库是**产物**。源码与构建脚本在法规库项目里：',
    '',
    '```powershell',
    'node tools\\build_static_site.mjs .      # 生成 dist/falv-web',
    'node tools\\publish_github_pages.mjs .  # 同步并推送',
    '```',
    ''
  ].join('\n'), 'utf8');
}

console.log('已同步产物到 ' + dest);

/* ------------------------------------------------------------ 提交推送 */

git(['add', '-A'], dest);
const status = git(['status', '--porcelain'], dest);
if (!status.trim()) {
  console.log('内容无变化，跳过提交');
} else {
  const msg = '发布：法规库静态站 ' + new Date().toISOString().slice(0, 19).replace('T', ' ');
  git(['commit', '-m', msg], dest);
  console.log('已提交：' + msg);
}
git(['push', '-u', 'origin', BRANCH], dest);
console.log('已推送到 origin/' + BRANCH);

/* ------------------------------------------------------------ 开启 Pages */

try {
  const cur = JSON.parse(gh(['api', 'repos/' + REPO + '/pages']));
  console.log('Pages 已启用：' + cur.html_url);
} catch (e) {
  console.log('开启 Pages…');
  try {
    gh(['api', '--method', 'POST', 'repos/' + REPO + '/pages',
      '-f', 'source[branch]=' + BRANCH, '-f', 'source[path]=/']);
    console.log('Pages 已开启');
  } catch (e2) {
    console.error('开启 Pages 失败：' + (e2.stderr || e2.message));
    process.exit(1);
  }
}

/* ------------------------------------------------------------ 回显地址 */

const url = 'https://' + owner + '.github.io/' + repoName + '/';
console.log('');
console.log('  公网地址：' + url);
console.log('  仓库地址：https://github.com/' + REPO);
console.log('');
console.log('  GitHub Pages 首次构建通常要 1~2 分钟，之后可用上面的地址访问。');
