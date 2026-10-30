# AGENTS.md · 法律法规库

面向未来在本仓库工作的 agent 的硬性约束与工作流。

## 项目一句话

单机离线的中文法规检索库（静态站点，无构建步骤、无第三方依赖），目标浏览器 **Chrome 69**。
四个数据源：**党内法规**（人民网党建频道 + 共产党员网「党章党规」专页）+ **国家法律法规**
（flk.npc.gov.cn，排除地方法规与司法解释）+ **湖北地方法规**（湖北法规库 119.36.213.154:8088，
地方性法规 + 自治条例单行条例）。
数据内置在 `data/regulations.js`（元信息）与 `data/party_NN.js`、`data/flk_NN.js`、`data/hubei_NN.js`（正文分片）。

## 不可破坏的约束

1. **必须能在 `file://` 下直接双击 `index.html` 运行。**
   - 因此**禁止** ES Modules（`<script type="module">`）、禁止 `fetch()` 本地 JSON、禁止任何构建/打包步骤。
   - **启动只加载元信息**：`<script src="data/regulations.js">` 挂到 `window.FG_DATA`
     （全库 2,706 条的标题/日期/门类/字数等，约 2.2MB，**不含正文**）。
   - **正文按需加载**：正文在 `data/party_NN.js`（`window.FG_PARTY`）、`data/flk_NN.js`（`window.FG_FLK`，
     数组的数组）、`data/hubei_NN.js`（`window.FG_HUBEI`）里，共约 39MB。
     `index.html` **不静态引入**这些分片，由 `assets/js/app.js` 的 `ensureBodies()` 动态插 `<script>` 加载
     （`file://` 下动态加载本地脚本可用，已实测）；加载完由 `mergeData()` 把正文并回记录并重建索引。
     每条记录带 `bf` 字段标明自己的正文在哪个分片 —— 打开详情页只加载那一片。
   - **分片按字数切**（`CHUNK_CHARS = 600000`，约 60 万字 ≈ 1.8MB），当前 **24 片**
     （party 7 + flk 12 + hubei 5），单片最大 1.9MB；分片统一用 `window.X.push([...])` 形式追加。
   - **不要在 `index.html` 里手写分片标签**：`tools/build_dataset.py` 会清理旧的静态标签。
2. **目标浏览器是 Chrome 69（2018-09）。** 禁止使用该版本不存在的特性：
   - JS：可选链 `?.`、空值合并 `??`、`String.replaceAll`、`Object.fromEntries`、`matchAll`、
     `Array.prototype.at`、`structuredClone`、`globalThis`、`Promise.allSettled`。
   - CSS：flex `gap`、`clamp()`、`:is()`/`:where()`、`aspect-ratio`、`backdrop-filter`、`inset`。
   - 允许：CSS 变量、Grid、sticky、`aspect` 无关属性、`Object.entries`、`includes`、`padStart`、正则 lookbehind。
3. **单文件、无外部请求**：不引入 CDN 字体/图标/JS 库；图标一律用内联 SVG 或字符。
   **位图素材只放 `assets/img/`（本地文件），绝不能写 `https://` 外链**——
   否则 `file://` 双击打开时图片加载不出来，等于破坏「单机离线」这条底线。
   当前 `assets/img/` 里的四张图（横幅底图 / 国徽 / 大会堂剪影 / 华表）取自
   **国家法律法规数据库 flk.npc.gov.cn 首页**，由 `tools/prep_images.py` 处理后随站点打包。
4. **数据可复现**：
   - 党内法规正文来自人民网党建频道「党章党规」书架的 `contentItem` 变量；
   - 国家法律法规正文来自 flk.npc.gov.cn 的 docx 附件（`tools/flk_cache/<bbbs>.docx` → `.json`）；
   - 任何数据改动必须同步更新 `tools/build_dataset.py` / `tools/finish_flk.py` 并重建 `data/`。
5. **章节只有两级**：一级 =「第X章 / 第X编 / 第X篇 / 总则 / 分则 / 附则 / 序言」，
   以及党内法规的**中文数字分段**（「一、总体要求」这类，顶层分段，算一级）；二级 =「第X节」。
   flk 与湖北的层级由 `tools/section_parser.py` 判定并写进每条 section 的 `level` 字段（1 或 2）；
   共产党员网的条目由 `tools/crawl_12371_docs.py` 按**源页面的加粗标记**切分（段落整段加粗即分段标题）。
6. **正文只有 Markdown 一种形式**（`assets/js/markdown.js` 渲染）。
   原先的「Word 原文预览」已下线：`data/word_NN.js`（约 29.6 MB）与 `tools/word_manifest.json`
   已删除，`tools/word_html.py` 保留但**不参与构建**；原始 `.docx` 原件仍在
   `tools/flk_cache/` 与 `tools/hubei_cache/`，随时可恢复。
7. **不得出现重复条目**：构建期必须去重（规则写在 `tools/build_dataset.py`，可复现）：
   - 同一部法规的多个历史版本（flk `lsyg` 沿革链）只保留现行版，删 199 条；
   - 标题相同但没建沿革关系的旧版（已废止/已修改 + 正文相似度 ≥ 0.5）也删，共再删 90 条；
   - 党内法规内部重复（人民网两个栏目收录同一篇）保留党内法规门类那份，删 40 条；
   - **人民网 × 共产党员网重复**：标题归一后相同（**先剥掉「（2025年11月28日发布）」这类日期后缀**，
     否则同一部法规会被当成两条）→ 只留一条：公布日期**准确**的那份优先（正文里有发文日期行的胜出），
     再比日期新旧、门类层级、正文长度；
   - 跨源重复**以国家法律法规库为准**（正文比对后删党内那份），删 3 条；
   - 同名但内容不同的文件（历年《国务院关于修改和废止部分行政法规的决定》等）**必须保留**，
     并在标题后补版本后缀以便区分。
   改完必须跑 `tools/make_selftest.py`，自检里有 5 条去重断言（含「全库无同标题重复条目」）。

## 常用命令

```powershell
# 重建党内法规数据集（改动了抓取/清洗逻辑后必须执行）
python tools\parse_bookdata.py     # 解析书架目录 -> tools/bookdata.json
python tools\crawl.py              # 抓取全文（带缓存）-> tools/raw_corpus.json
python tools\supplement4.py        # 补抓 5 部公务员管理办法

# 共产党员网「党章党规」专页（12371.cn）
python tools\crawl_12371.py --list        # 抓 12 个分类页 -> tools/12371_meta.json
python tools\crawl_12371_docs.py --docs  # 抓正文 -> tools/12371_cache/*.json（带缓存）
python tools\crawl_12371_docs.py --reparse  # 改了解析逻辑：只按缓存里的原文重算章节
python tools\dedup_12371.py               # 与现有党内法规去重比对，出报告

# 国家法律法规（flk）
python tools\crawl_flk.py --stage list       # 抓门类目录 -> tools/flk_meta.json（1596 条）
python tools\make_flk_items.py --docx-only    # 待下载清单（只按 docx 是否存在判断）
node    tools\crawl_flk_ctx.js tools\flk_items.json tools\flk_cache 3   # 真实 Chrome 下载 docx（推荐）
python tools\finish_flk.py --docs            # docx -> 章节结构（带标题校验护栏）
python tools\fetch_flk_doc.py                # 少数旧版 .doc 附件（借本机 Word COM 转 docx）
python tools\finish_flk.py --details         # 补效力级别/时效性/历史沿革
python tools\finish_flk.py --merge           # -> tools/flk_corpus.json

# 数据体检：核对「正文 ↔ 编号」是否张冠李戴
python tools\verify_flk_mapping.py            # 校验 docx 与 json 的标题一致性
python tools\wrong_owner.py                   # 找「不同标题却同一篇正文」的串档组（判定主人用完整标题包含）

# 章节重算：剥离源文档「目 录」块 + 标注两级层级（改了解析逻辑必须执行）
python tools\repair_flk_sections.py           # -> 覆盖 tools/flk_cache/<bbbs>.json 的 sections

# 湖北地方法规（湖北法规库）
python tools\crawl_hubei.py                   # 列表 + 详情正文 -> tools/hubei_cache/<Rileid>.json（509 条）
python tools\crawl_hubei.py --reparse         # 只按缓存里的原始正文重算章节结构（改了解析逻辑用）
python tools\fetch_hubei_doc.py               # 下载 .doc 原件 -> 借 Word COM 转成 .docx（供章节重建与校验）

# 统一重建站点数据（元信息 + 正文分片，并刷新 index.html 资源版本号）
python tools\build_dataset.py      # -> data/regulations.js(元信息) + data/party_NN.js + data/flk_NN.js + data/hubei_NN.js(正文分片)

# 自检（浏览器打开 tools/selftest.html，169 项断言；必须走 HTTP）
python tools\make_selftest.py
```

**重建顺序不能乱**：`repair_flk_sections.py` 改的是 `tools/flk_cache/<bbbs>.json`，
`build_dataset.py` 从 loader（`build_dataset.load_flk_corpus()`）
按 `flk_cache` 文件名字典序取语料并分配 id。改了章节结构就按
`repair → build_dataset` 走一遍，否则站点正文会和缓存对不上。
湖北侧对应 `crawl_hubei.py --reparse → build_dataset`
（`load_hubei_corpus()` 按 `tools/hubei_cache` 文件名字典序分配 `h%04d`）。
共产党员网侧对应 `crawl_12371_docs.py --reparse → build_dataset`
（`load_12371_corpus()` 按 `tools/12371_cache` 文件名排序读；党内法规的 id 在去重后按
`r%04d` 连续重排，所以**任何按 id 生成的东西都要在重建之后再算**）。

## 验证要求（不可跳过）

- 改前端后必须跑 `tools/selftest.html`：覆盖数据完整性、四个数据源的检索、解析语法、高亮、
  5 种导出、收藏、自建条目、16 条路由渲染（带查询词的检索路由必须真的出结果）、
  两级目录、Markdown 正文排版、Chrome 69 兼容性静态扫描。
  **自检页带 `<base href="/">`，必须走 `http://127.0.0.1:8765/tools/selftest.html`，不能 file://。**
  **dump-dom 必须带 `--window-size=1440,1050`**：默认窗口宽 800px 会命中
  `@media (max-width: 980px)` 移动端分支，「目录排在正文右侧」这类几何断言会假 FAIL
  （测到 `toc.left=16 article.left=16`，其实是单列布局）。
- 必须用 headless Chrome 截图目检：`--headless=new --screenshot=... --window-size=1440,1050`，
  逐页看排版是否塌陷（`tools/shots/`）。**首页、检索页、详情页、深色模式都要看。**
- **深色模式要单独目检**：`tools/make_dark_page.py` 生成带 `<base href="/">` + 预置深色主题的
  临时页再截图（注意 `<base>` 必须放在 `<head>` 第一行，否则对已出现的 `<link>` 不生效）。
  **临时页每次都要重新生成**（它是 index.html 的副本，index.html 改了不重建就会截到旧版页面）。
  **深色页不能靠 localStorage 传主题**：临时页与 index.html 同源，写 localStorage 会把
  index.html、自检页一起变成深色（实测 `<html data-theme>` 被写成 "dark"）——
  脚本只硬置 DOM 属性，并在 DOMContentLoaded / load 之后再强制一次
  （app.js 的 `boot()` 会用 localStorage 的设置覆盖 `data-theme`）。
  `tools/shot.py` 每次还会清掉 profile 的 localStorage，保证截图在深浅之间不跳变。
- **打印排版要目检**：`--print-to-pdf` 出 PDF（必须绝对路径），再用 `tools/pdf_to_png.py` 逐页渲染成图片看。
  深色主题会把黑底带进打印结果，`@media print` 里必须把变量强制切回浅色。
- **量几何必须带 `--window-size=1440,1050`**：少了会命中 `@media (max-width: 980px)` 移动端分支，
  量到的 padding / font-size 全是移动端值（`tools/measure_article.js`、`tools/measure_home.js`）。
- 必须同时验证 `file://` 与 `http://` 两种协议都能启动（`file://` 下 localStorage 可用）。
- 下载导出要确认文件真的落盘（文件名、大小、内容），而不是只看函数返回值。
- PowerShell 里直接 `chrome.exe --dump-dom` 可能被已有 Chrome 会话吞掉，
  用 `Start-Process -NoNewWindow -Wait -RedirectStandardOutput` 才稳定。
- 改了抓取/解析逻辑后必须跑 `python tools\verify_flk_mapping.py`，
  确认「正文 ↔ 编号」零错配再入库。

## 代码结构

| 文件 | 职责 |
| --- | --- |
| `assets/css/style.css` | 设计系统：配色、组件、响应式、打印样式 |
| `assets/img/` | 本地图片素材：横幅底图、国徽、大会堂剪影、华表（取自 flk 官网首页，**不要改成外链**） |
| `assets/js/store.js` | localStorage 封装：收藏 / 自建条目 / 设置 / 最近浏览 / **划线批注（`fg.marks.v1`）**；不可用时降级为内存 |
| `assets/js/search.js` | 检索引擎：查询解析（短语/排除/字段限定）、字段加权评分、片段摘要、高亮、`refreshDoc` 增量重建单条索引 |
| `assets/js/exporter.js` | 5 种格式导出 + 打印 + 剪贴板复制 |
| `assets/js/markdown.js` | 轻量 Markdown 渲染器（标题/列表/引用/代码/表格/行内），供详情页正文使用 |
| `assets/js/app.js` | hash 路由、视图渲染、事件绑定、**阅读设置 / 划线批注 / 我的笔记**；`window.FGApp` 暴露内部方法供自检 |
| `data/regulations.js` | 自动生成，勿手改；**启动必载**：全库元信息 + 门类 + 分组 + 正文分片清单（`window.FG_DATA`，约 2.2MB，不含正文） |
| `data/party_NN.js` | 自动生成，勿手改；党内法规正文分片（`window.FG_PARTY`，7 片，按需加载） |
| `data/flk_NN.js` | 自动生成，勿手改；国家法律法规正文分片（`window.FG_FLK`，12 片，按需加载） |
| `data/hubei_NN.js` | 自动生成，勿手改；湖北地方法规正文分片（`window.FG_HUBEI`，5 片，按需加载） |
| `tools/crawl_flk_ctx.js` | flk 正文附件下载主力：真实 Chrome + 独立浏览器上下文隔离下载目录 |
| `tools/crawl_flk_direct.py` | flk 正文直连下载备选（风控收紧时 Chrome 仍可用，直连反而可能失败） |
| `tools/fetch_flk_doc.py` | 补抓「附件是旧版 .doc」的少数法规（用本机 Word COM 转 docx） |
| `tools/fetch_flk_pdf.py` | 补抓「只有 PDF」的法规（PyMuPDF 抽文字；扫描件抽不出，只能跳过） |
| `tools/verify_flk_mapping.py` | 数据体检：核对「正文 ↔ 编号」是否张冠李戴，改动抓取逻辑后必跑 |
| `tools/finish_flk.py` | docx → 章节结构（`--docs`）、详情元数据（`--details`）、汇总（`--merge`） |
| `tools/section_parser.py` | 章节解析核心：标题识别、「目 录」块剥离、层级判定（1=章/编，2=节）、标题续行合并、docx 结构化解析 |
| `tools/repair_flk_sections.py` | 用 docx（优先）或缓存 json 重算全部 sections 与 level |
| `tools/crawl_hubei.py` | 湖北法规库抓取：列表 + 详情正文（`--reparse` 只按缓存重算章节结构） |
| `tools/fetch_hubei_doc.py` | 下载湖北法规的 .doc 原件，用 Word COM 批量转成 .docx |
| `tools/hubei_check.py` | 湖北数据体检：区域分布、层级、伪章、标题一致性 |
| `tools/word_html.py` | **已停用**：原 docx → Word 预览 HTML 分片（`data/word_NN.js`）。脚本保留便于恢复，但构建流程不再调用 |
| `tools/crawl_12371.py` | 抓共产党员网「党章党规」专页的 12 个分类页（条目在页面里的 JS 数组 `itemELMT<id>` 里，不是渲染好的 HTML） |
| `tools/crawl_12371_docs.py` | 抓 12371 详情页正文（`div.con` 容器），用**源页面的加粗标记**识别分段标题；缓存里保存原文片段，改解析逻辑可 `--reparse` 免重抓 |
| `tools/js_literal.py` | 极简 JS 字面量解析器（12371 的条目数组是 JS 对象字面量，`brief` 字段里还有 HTML 双引号，不能用 json.loads） |
| `tools/dedup_12371.py` | 12371 与现有党内法规的去重比对报告（标题归一 + 正文相似度） |
| `tools/build_dataset.py` | 合并三个数据源 → 元信息 `data/regulations.js` + 正文分片 `data/party_NN.js` / `data/flk_NN.js` / `data/hubei_NN.js`（按字数切，`CHUNK_CHARS`）；**内含去重规则**（`dedup_flk_versions` / `dedup_flk_same_title` / `dedup_party_records`） |
| `tools/wrong_owner.py` | 数据体检：找「不同标题却同一篇正文」的串档组，并用 docx 标题区判定真正的主人 |
| `tools/make_fix_items.py` | 为串档条目生成重抓清单（给 `crawl_flk_ctx.js` 用） |
| `tools/check_fix.py` | 校验重抓回来的 docx 是否还对得上自己的标题 |
| `tools/install_fix.py` | 把修好的 docx 装回 `tools/flk_cache/` |
| `tools/dup_report.py` | 全库重复概览：跨源同标题 + 各源内同标题 |
| `tools/verify_build.py` | 抽查重建后关键条目（版本保留、日期、沿革） |
| `tools/final_check.py` | 重建后总核验：条目数、清单与记录标题一致性 |
| `tools/make_selftest.py` | 生成 `tools/selftest.html`（169 项断言；会先按需加载全部分片再断言） |
| `tools/make_dark_page.py` | 生成深/浅色临时页（`_dark.html` / `_light.html`）供截图与打印目检 |
| `tools/shot.py` | 批量截图（`python tools\shot.py <名称> <url> [宽] [高]`），每次清 profile 的缓存与 localStorage，并强制 `prefers-reduced-motion` |
| `tools/shot_read.js` | 阅读三件套逐状态截图（`node tools/shot_read.js [docId]`）：六种背景 / 阅读面板 / 划线浮条 / 批注框 / 笔记抽屉 / 我的笔记页 / 窄屏 / 深色站点，最后出一份打印 PDF |
| `tools/probe_search.js` | 检索页时序探针：打印「分片加载数 / 索引命中数 / 页面结果数」随时间的变化，定位「索引好了但页面还是 0 条」这类问题 |
| `tools/pdf_to_png.py` | PDF 逐页渲染成 PNG，供打印排版目检 |
| `tools/pdf_find.py` | 在 PDF 里定位关键词所在页码（只用于找页，判读仍靠看图） |
| `tools/crop_zoom.py` | 裁切并放大 PNG 的指定区域（`python tools\crop_zoom.py <png> <out> <x> <y> <w> <h> [scale]`），查细节用 |
| `tools/verify_download.js` | 验证导出真的落盘（`node tools\verify_download.js <id> <fmt>`，fmt: md/txt/json/csv/html） |
| `tools/measure_article.js` | 量正文几何：字号、行距、缩进、版心宽度（必须带 `--window-size=1440,1050`） |
| `tools/measure_home.js` | 量首页几何：门类卡片宽度、底部色条宽度、统计卡与双栏宽度 |
| `tools/measure_tl.js` | 量时间轴几何：轴线位置、圆点是否落在轴线上 |
| `tools/shot_js.js` | 截「需要交互才出现」的状态（如展开的导出菜单）：`node tools\shot_js.js <名称> <url> <js>` |
| `tools/shot_mobile.js` | **移动端截图**：`node tools\shot_mobile.js <名称> <url> [宽=390] [高=844] [等待ms] [dark] [full]`。用 CDP `Emulation.setDeviceMetricsOverride` 量真实手机视口——`--window-size` 在 Windows 上会被钳到 504px，截出来是**裁切图**，看着像布局溢出其实是截图窗口被钳 |
| `tools/eval_js.js` | 通用页面探针：`node tools\eval_js.js <url> <js表达式> [等待毫秒] [宽] [高]`，在真实 Chrome 里执行表达式并打印结果，调试前端比插日志快 |
| `tools/verify_export_ui.js` | UI 级导出验证：真的去点详情页的「导出本篇」，确认 md / html 落盘 |
| `tools/extract_flk_home.js` | 从 flk.npc.gov.cn 首页抓取国徽 / 横幅底图 / 页面水印（内联 SVG 与 data URI 都要扫） |
| `tools/prep_images.py` | 把 flk 素材处理成本地资源：压尺寸、量化、底部渐隐成透明（原件留 `tools/_flkraw/`） |
| `functions/api/[[path]].js` | **Cloudflare Pages Function**：第四套后端，边缘检索（详见下文） |
| `tools/cloudflare_function_selftest.mjs` | 边缘函数自检（146 项断言）：与既有 Node 服务端逐条比对 |
| `部署指南.md` | 面向使用者的部署手册：GitHub 同步 + Cloudflare Pages 逐步操作 |

## 并行产物：Mini App 与原生微信小程序

除静态站点外，仓库里还有两个**并列**的客户端产物，都不在 `index.html` / `assets/` / `data/` 里改动原站：

| 目录 | 产物 | 说明 |
| --- | --- | --- |
| `miniapps/falv-mini-app/` | Mini App（MiniMax Code 插件包） | 客户端 `miniapp/client/`（hash 路由 + 9 视图）+ Node 服务端 `miniapp/node/`（7 个 API + 静态托管） |
| `wechat/` | 原生微信小程序源码 | 8 个页面（`.wxml`/`.wxss`/`.js`/`.json`）+ `utils/` + 23 张本地 PNG 图标，**零第三方依赖**，对接同一套 API |

**共同架构：服务端持有全量语料，客户端只取元信息 / 检索结果 / 单篇正文。**
原因：正文 41MB 超出微信小程序包体上限（主包 2MB / 总包 20MB），只能走服务端。

- **共享 API 契约**（两端复用，改一处必须同步另一处）：
  `/api/meta` `/api/search` `/api/recs` `/api/suggest` `/api/doc` `/api/timeline` `/api/export`。
  `sort` ∈ `relevance|new|old|title`，`size` ≤ 100。
- **共享正文渲染契约**：`/api/doc` 的 `blocks[]`，`type` 仅 `h2/h3/clause/item/note/p`；
  两端都按结构化块原生渲染，不用 Markdown，也不用 `rich-text`（仅 `snippetHtml`/`summaryHtml` 用）。
- **语料载荷**：`miniapp/node/corpus/{meta,bodies}.json.gz`（合计 11.3MB），
  由 `node tools\build_miniapp_corpus.mjs .` 从 `data/` **可复现地**重建（改数据后必须重跑）。
- **检索语义**沿用 `assets/js/search.js` 的子串匹配 + 字段加权（不引入分词器，零依赖）。
- **自检**：服务端 `node tools\miniapp_selftest.mjs`（55 项断言）；
  微信小程序 `cd wechat && node tools\check_all.mjs`（6 项检查 / 63 项断言）；
  本地起后端给开发者工具用：`node wechat\tools\serve.mjs`（默认 `127.0.0.1:8765`）。
- **已知差异**：微信小程序没有字符级选区 API，划线批注改成「按正文块（clause/item/p）批注」，
  数据结构保留 `s`/`e` 偏移字段以便将来升级；`/api/meta` 不含 `records` 明细，
  小程序端在收藏/浏览时存**标题快照**，Mini App 端用 `/api/recs` 按 id 批量补。

### 第三种形态：纯静态部署（公网链接）

`miniapps/falv-mini-app/miniapp/client/static-api.js` 是**第三套后端**：
在没有 Node 运行时的静态托管上，用浏览器里的 `data/` 分片 + `assets/js/search.js`
实现同一套 `/api/*` 契约，客户端 `app.js` 一行都不用改（`api()` 里有分支：
有 `window.FGStaticAPI` 就走它，否则走服务端 fetch）。

- **构建**：`node tools\build_static_site.mjs .` → `dist/falv-web/`
  （index.html + app.css/app.js/static-api.js + search.js + `data/` 25 个分片，41.4MB）。
  **加 `--no-corpus` 可跳过边缘检索语料**（纯静态托管用不到那 11.3MB；
  部署到 Cloudflare Pages 时**不能**加，边缘函数要从 `/corpus/*.json.gz` 取语料）。
- **发布**：`node tools\publish_github_pages.mjs .` → 同步到 `.publish/falv-ku/` 再推 GitHub Pages。
  **`.publish/` 里才是 git 仓库**——`dist/` 是构建输出，`build_static_site.mjs` 每次会整个重建它。
- **自检**：`node tools\static_site_selftest.mjs`（65 项断言）——
  在 Node 里造最小浏览器环境加载 static-api.js，逐条打 `/api/*`，
  **断言静态版与服务端版结果一致**（例如「党内监督」两边都是 127 条）。
- **两段式检索（重要）**：`/api/search` **不再等正文分片下完**——
  先用「标题/摘要/标签/发文机关」这些元信息出结果（毫秒级，零额外下载），
  24 个正文分片在后台并行下载，每片到达就 `Search.refreshDoc()` 增量建索引，
  **全部到齐后自动重查刷新**。客户端据此显示「正在补充全文命中」。
  实测「党内监督」首屏 5ms 出 89 条，索引就绪后 127 条（与服务端一致）。
- **代价（必须写进 README/说明里）**：首次发起**非空检索**仍要下载全部 24 个正文分片
  （传输约 12MB，仅此一次，之后走浏览器缓存）；门类浏览与打开单篇只加载 1 片（约 1.8MB）。
  **要彻底消掉这 12MB，只能用第四种形态（边缘检索）。**
- **兼容性**：`app.css` 已按 Chrome 69 改写——**flex `gap` 全部换成子项 margin**
  （Chrome 84 才支持 flex gap），`inset: 0` 换成四边偏移；
  Grid 的 `gap` 可以留（Chrome 57 就支持）。
- **推 GitHub 的坑**：git 凭据助手必须是
  `!'C:/Program Files/GitHub CLI/gh.exe' auth git-credential`（**路径要带引号**，
  少了引号 git 解析失败就会退回交互式弹窗，push 挂在那儿不动）；
  `gh auth setup-git` 负责写这条配置。发布脚本里已设 `GIT_TERMINAL_PROMPT=0`，
  凭据拿不到就直接报错而不是卡住。

### 第四种形态：Cloudflare Pages Functions（边缘检索）

`functions/api/[[path]].js` 是**第四套后端**：把同一套 `/api/*` 契约搬到 Cloudflare 边缘，
**手机不再需要下载正文分片**（只下几十 KB 的检索结果）。

- **语料来源**：`miniapps/falv-mini-app/miniapp/node/corpus/{meta,bodies}.json.gz`（11.3MB），
  由 `tools/build_miniapp_corpus.mjs` 从 `data/` 可复现重建；
  `build_static_site.mjs` 会把它们拷进 `dist/falv-web/corpus/`，
  边缘函数用 **`env.ASSETS.fetch()`** 读，再用 `DecompressionStream('gzip')` 解压。
- **内存策略（Workers 单实例上限 128MB，这是最关键的约束）**：
  常驻只有 `meta.json`（解析后约 10MB）+ `bodies.json.gz` 的**压缩字节**（11.4MB）；
  检索时**流式解压**，边解压边切元素、逐个算分算完即丢，**41MB 正文从不整体驻留**；
  再加一层**预筛**（命中不了的元素连 `JSON.parse` 都不做）。
  实测常驻约 24MB，窄查询 0.29s / 宽查询 0.45s / 单篇详情 0.20s。
- **必须知道的前提**：**免费 Workers 套餐每次请求只有 10ms CPU**，
  全库扫描要 0.3 秒以上 → 免费额度会被打爆，**边缘检索需要 Workers Paid（约 $5/月）**。
  不想付钱就退回第三种形态（纯静态 + 两段式检索）。
- **自检**：`node tools\cloudflare_function_selftest.mjs`（146 项断言）——
  在 Node 里造假的 `env.ASSETS.fetch()`，把**同一份语料**喂给既有 `corpus.mjs` 作基准，
  逐条比对 6 个 query + 7 个预筛压力用例的 `total` / `hits[].id` / `hits[].score` /
  `snippetHtml`，以及 `/api/meta` `/api/doc` `/api/timeline` `/api/suggest` `/api/recs`
  和 5 种导出（导出按**字节**比，`Response.text()` 会剥掉 CSV 的 BOM）。
- **降级**：没有 ASSETS binding / 语料缺失 → HTTP 503 + `{error:'corpus_unavailable'}`
  （绝不抛未捕获异常）；`/api/meta` `/api/recs` `/api/suggest` `/api/timeline`
  只依赖 meta，**语料只有一半也能用**。
- **部署**：`部署指南.md` 有面向使用者的逐步操作（Pages 控制台点哪里、
  构建命令 `node tools/build_static_site.mjs .`、输出目录 `dist/falv-web`）。

## 第四种形态之外：客户端首页的职责划分（改版后）

Mini App 客户端与微信小程序首页**结构一致**，职责单一，不互相重复：

| 区块 | 内容 | 为什么放这儿 |
|---|---|---|
| 检索卡 | 全站唯一搜索入口 + 库规模统计 | 「打开就能用」 |
| 法规体系 | **5 个体系**的概览卡片（体系名 + 门类数 + 门类名一行） | 门类明细在「体系」页，**不在首页再列一遍** |
| 最近检索 | 本机检索历史（`fg.history.v1`） | 党务工作者反复查同样的词 |
| 最新发布 | 按公布日期倒序取 6 条（`/api/search?sort=new`） | 数据驱动，**不硬编码法规 id** |

- **「最近浏览 / 收藏 / 笔记 / 自建」统一放在「我的」页**，首页不再重复。
- 改版前门类在**三处**出现（首页门类磁贴 + 首页体系分组 + 底部「体系」tab），
  现在只在「体系」tab 出现一次。
- **统计条必须用 `grid-template-columns: repeat(4, minmax(0, 1fr))`**：
  flex 布局下数值太长会把相邻两格挤在一起（`min-width:0` 不够，
  还得给数值本身加 `white-space:nowrap; overflow:hidden; text-overflow:ellipsis`）。
  单位放**标签**里（「1347.2」+「万字」），不要拼进数值。
- 微信小程序 WXSS **不要用 CSS Grid**（老 WebView 支持不稳），一律 flex + 百分比宽度。

## 门类与分组

`CATEGORIES`（`tools/build_dataset.py`）：宪法 / 法律 / 行政法规 / 监察法规（国家法律法规）
+ 党章 / 准则 / 条例 / 规定 / 规则 / 办法 / 细则 / 规范性文件（党内法规）
+ 组工文件 / 党务知识（党务资料）+ 本机自建（本机数据）
+ 地方性法规 / 自治条例单行条例（湖北地方法规）。

`GROUPS`：国家法律法规 / 党内法规 / 党务资料 / 本机数据 / 湖北地方法规。
首页卡片、侧栏、检索范围下拉都读 `GROUPS`。

首页 7 个门类卡片（宪法/法律/行政法规/监察法规/党内法规/党务资料/湖北地方法规）**平铺一行**，
配色由各自的 `tone` 决定（`''`/`gold`/`blue`/`teal`/`purple`/`slate`，见 `assets/css/style.css` 的
`.flk-cat i` 渐变）。**相邻卡片的 tone 不能重复**（曾出现党务资料与湖北地方法规同为 teal）——
湖北用 `slate`。本机数据组在首页被排除（数量为 0）。

## 易踩的坑

- **命令行里手写中文百分号编码极易出错**：URL 少写/多写一个字节就会变成**另一个词**
  （`%E7%BD%9A` 是「罚」不是「网」，`%E5%9C%B0` 是「地」不是「区」）。
  排查「检索没结果」时**先确认 URL 编码对不对**，再怀疑代码 ——
  用 `tools/eval_js.js` 直接调 `Search.search('关键词')` 对比页面上的 `.result-count`。
- **数据层存纯文本，条号加粗在前端做**：正文里的「第X条」一律存纯文本，
  由 `app.js` 的 `sectionMarkdown` 统一转成 `**第X条**` 渲染。
  若把 `**` 写进数据，纯文本导出（.txt）就会带一堆星号。
  共产党员网页面的条号原本是 `<strong>`，解析时要**剥标签而不是转成 `**`**
  —— 源页面存在嵌套 `<strong>`，转义后会拼出 `****xxx**` 这种脏标题。
- **`index.html` 的资源版本号由 `build_dataset.py` 自动刷新**：版本号 = 日期 + 数据指纹
  （payload 的 md5 前 8 位）+ **前端资源指纹**（`assets/js/*.js` 与 `assets/css/style.css`
  的 md5 前 8 位，见 `asset_fingerprint()`），数据或前端代码任一变动版本号就变，
  浏览器不会命中旧缓存。
  `regulations.js` / `style.css` / `assets/js/*.js` 的标签不在分片标记块里，
  以前要手工 bump，忘了就会「重建完还显示旧数据」—— 现在由 `patch_index_versions()` 统一处理。
  **只跟数据挂钩是不够的**：改了 `app.js` 而数据没变时版本号不动，浏览器继续用旧 app.js，
  页面看起来「改了没生效」—— 这是本项目踩过的坑，别退回只算数据指纹。
- **`#/browse` 不带门类参数 = 门类总览页**，不是第一个门类的条目列表。
  侧栏「分类浏览」与首页「全部条目 ›」都指向 `#/browse`（无参数）；
  早先 `renderBrowse()` 里 `catById(catId) || CATS[0]` 把空参数回退到第一个门类，
  点进去只能看到「宪法」一部 —— 现在空参数走 `renderBrowseIndex()`（按 5 个体系分组列全部门类），
  非法 catId 显示「未找到该门类」而不是回退。**新增路由必须自测**：
  自检里要有 `#/browse` 无参数的断言（断言「门类数 = 17 且不是单门类条目列表」），
  否则这类「回退到默认值」的 bug 抓不到。
- **低配机器上的三处性能坑（都实测过，别改回去）**：
  1. **启动只解析元信息**：正文 39MB 曾一次性当 JS 对象字面量解析，低配机白屏好几秒。
     现在 `data/regulations.js` 只放元信息（2.2MB），正文拆 24 片按需加载
     （按字数切，每片约 60 万字 ≈ 1.8MB：`CHUNK_CHARS`）。
     改数据结构时**必须同步维护两处**：每条记录的 `bf`（自己的正文在哪个分片）
     与分片里的 `id`；`tools/final_check.py` 会核对「元信息 ↔ 正文」一一对应。
  2. **长列表必须分批渲染**：时间轴原本一次渲染 2,706 张卡片 = **13,043 个 DOM 节点**，
     滚动直接卡死。现在时间轴先出 ≤200 张卡片、体系/门类页先出 120 条，
     底部「再显示」**只往尾部追加**（`insertAdjacentHTML`），不重绘已渲染的部分。
  3. **入场动画别给每个子元素**：`.view > *` 全部动画 = 时间轴一次 60 多个合成层，
     无 GPU 的机器直接卡。现在只作用于前 6 个（`:nth-child(-n+6)`）。
  - 附带：搜索框的输入联想必须**防抖 150ms**，否则每敲一个键都全量扫库。
  - 附带：**边加载边建索引**。`ensureBodies(keys, onDone, onProgress, onChunk)` 的第 4 参
    `onChunk` 在**每一片到达时**就把它并回记录并 `Search.refreshDoc()` 增量建索引，
    不必等 24 片全部下完才出检索结果。
  - 分片是「数组的数组」，取新到的那一片必须用 `flattenChunks()` 展开一层；
    直接 `out.concat(window.FG_PARTY)` 或 `arr.slice(before)` 都会少展开一层 →
    整组正文没并回 → 检索命中从 195 掉到 109（这个坑踩过一次）。
- **`route()` 里的正文加载不能写成「拿全表去 ensureBodies」**：
  `ensureBodies()` 在「没有待加载项」时会立刻回调 `onDone`，
  若 `onDone` 里又调 `route()`，就成无限递归（页面停在加载态、检索 0 结果）。
  必须先筛出**还没加载**的分片再判断。
- **源文档里的「目 录」不是正文**：12371 的规划纲要类文件正文前面带一段目录，
  目录条目（第一章 发展背景 / 第一节 发展基础）和正文标题长得一模一样，
  混进正文会让摘要里塞进目录文字、目录里出现「正文根本没有的章」。
  `crawl_12371_docs.strip_toc_block()` 负责剥离。
- **`shot.py` 必须强制 `prefers-reduced-motion`**：`--virtual-time-budget` 只快进定时器，
  **不推进 compositor 驱动的 CSS 动画**，于是 `.view` 的入场动画（`fgEnter`）被截在早期帧
  （opacity≈0.25）。深色页表现为「整块正文发灰发暗、几乎读不清」——
  看着像配色坏了，其实计算样式完全正常（`--ink` = #e9ecf2），**是截图时机问题，不是样式问题**。
  排查这类现象要先分清「渲染坏了」和「截早了」：用 `tools/eval_js.js` 在同一会话里读
  `getComputedStyle` 的 color 与 opacity，再对比像素峰值，别急着改 CSS。
  `shot.py` 已加 `--force-prefers-reduced-motion`；`--print-to-pdf` 也要加（同样会截到动画帧）。
- **侧栏是「范围导航器」，不是功能菜单**：检索组 3 个（全库检索／分类浏览／立法时间轴）
  ＋ 我的组 3 个（我的收藏／自建条目／**我的笔记**），门类收进可折叠的**法规体系树**（5 体系 → 17 门类）。
  不要往侧栏里加「导出」「常用检索」这类功能入口——它们与顶栏重复；也不要加「首页」链接
  （首页无侧栏，永远看不到）。进入某门类/体系时自动展开对应体系，当前项高亮。
- **图标一律内联 SVG**：字符图标（★☆◆▦◷⌕∅）与 emoji 全部淘汰，统一走
  `assets/js/app.js` 的 `ICON` 常量（24×24 线性图标，`stroke=currentColor`）。
  收藏的实心/空心两态用 `ICON.starFill` / `ICON.star`，空状态用 `ICON.none/warn/search/pen/clock`。
- **顶栏搜索框要撑满，不要给它设固定上限**：
  早先 `.searchbar` 卡了 `max-width: 720px`，而右侧按钮组又紧贴着搜索框，
  结果顶栏内容只占左边 1170px，右边空出 240px —— 看着像没排完。
  现在搜索框 `flex: 1 1 auto` 且不设上限，右侧按钮组自然贴到视口右缘；
  `.topbar-inner` 的 `padding` 与 `.view` 一致（30px），**顶栏右缘与内容区右缘严格对齐**。
- **按钮系统三级 + 固定高度**：`.btn` 36px / `.btn-sm` 30px / `.btn-xs` 26px，
  变 primary / ghost / danger；`.btn` 是 flex，`.btn > svg { margin-right: 6px }`（禁 `gap`）。
  `.exp-ctl` 必须是 `inline-flex`，否则内部按钮会上下堆叠。
- **时间轴整条收窄 980px**：满宽卡片里只放两行字，右侧空一大片；
  `.tl-card` 用 flex 两栏（标题占主位、元信息靠右不换行），`.tl-card` 是 `<a>` 必须给 flex 盒模型。
- **flk 的历史版本附件会「串档」**：下载某些历史版本（`bbbs` 以 `ff808081`/`ff808181`/`2c909fdd`
  开头）时，服务端可能返回**另一部法规**的 docx —— 文件名是对的，内容却是别人的。
  本轮体检出 9 条（用 `tools/wrong_owner.py` 按正文指纹找「不同标题却同一篇正文」的组，
  再用 docx 标题区判定谁才是主人；**判定主人要用「完整标题包含」，不能用前缀**——
  「全国人大常委会关于设立烈士纪念日的决定」与「……设立南京大屠杀死难者国家公祭日的决定」
  前 12 字完全相同，前缀匹配会认错主人）。8 条重抓即修复，1 条服务端始终不返回正确附件，已移除。
  换完 docx 一定要跑 `repair_flk_sections.py` 重算 sections（缓存里的 json 还是旧正文）。
- **`tools/verify_flk_mapping.py` 的标题校验太弱，会漏判串档**：它用「标题是否出现在正文前几行」
  判断，而错配文件的前言里**恰好提到另一部法律名**（如大气污染防治法前言提到
  「《关于修改〈中华人民共和国野生动物保护法〉等十五部法律的决定》」）→ 误判为匹配。
  严格校验要用 docx **标题行区**（逐行累加，遇到说明段「（…」或章标题即停）。
- **flk 的 `sxx`（时效性）语义**：1=已废止、2=**已修改**（被后续修订取代，不是「未修改」）、
  3=有效、4=尚未生效。写错标签会让「旧版」看起来像「现行版」。
- **同一标题在 flk 里有两种来源**：一是同一部法规的**历史版本**（靠 `lsyg` 沿革链 + 时效性判定，
  只留现行版）；二是**同名但不同的文件**（历年《国务院关于修改和废止部分行政法规的决定》、
  《全国人大常委会组成人员守则》等）——后者必须保留，标题后补版本后缀区分。
  只按标题归并会误删真法规。
- **flk 的 docx 开头带一段「目 录」**，目录条目长得和正文标题一模一样（「第八章 其他规定」「分 则」）。
  早期解析器把目录当正文切分点 → 目录里出现「正文根本没有的章」、正文顶部混进「分 则 / 附 则」。
  现在统一走 `tools/section_parser.py`：目录块 = 「目 录」标记后、每个条目名都会在正文里
  **再次出现**的最长前缀；判定不了的那一条（正文没有同名标题）留给正文当标题。
- **「有标题但正文为空」的章节必须保留**：章标题后面常常紧跟节标题（如「第二章 自然人」→「第一节 …」），
  章本身没有正文；若按空正文过滤，目录里就会少一级（又变成「正文没有第X章」）。
  `assets/js/exporter.js` 的 `sectionsOf()` 过滤条件是 `text || name`。
- **docx 必须按 OOXML 结构解析，不能用「正则剥标签 + 按 \n 切行」**：
  flk 导出的 docx 是美化过的 XML，标签之间带 CRLF 缩进；剥完标签后每个 run 边界都残留换行，
  而条文里的「第一条」是黑体 run、正文是仿宋 run → 「第一条」和正文被拆成两行，
  Markdown 视图里条号就单独成段了。段落边界只认 `<w:p>`，段内换行只认 `<w:br/>`。
  解析统一放在 `tools/section_parser.py` 的 `docx_blocks()` / `docx_lines()`，
  `finish_flk.py`、`repair_flk_sections.py` 都调它，别再各写一份。
- **正文一致性护栏要比「内容指纹」而不是「逐行」**：`repair_flk_sections.py` 的 `body_key()`
  会去掉所有空白再比对，换行位置变了也不误报；逐行比对在改了行合并逻辑后会整片报警。
- **章节标题可能被排版折行**：湖北条例里「第一节 人民代表大会及其常务委员会有关人员」在源文档
  中是两行（下一行「的任免」）。不合并的话标题被截断、后半截变成正文，目录条目名也跟正文
  对不上（目录块剥离随之失效，一级章节数会少一大截）。`section_parser.merge_heading_continuations()`
  把短续行并回标题——判定要排除「本身就是标题」的行，否则「第一章」会把「第二章」吞进去。
- **湖北的正文来自 `<pre>`，不是 docx**：抓的是 `index_xq.jsp` 里的 `<div class="con"><pre>`，
  开头有「目 录」块、章节标题可能折行；解析仍走 `section_parser`，但行清洗要额外剔除
  零宽字符（U+200B 等），否则摘要会变成一个看不见的零宽空格。
- **湖北附件是 .doc**：Word 97-2003 的 OLE2 复合文档，要借本机 Word COM 转 .docx 才能用于
  章节重建与正文校验（页面端已不用 Word 预览）；
  `fetch_hubei_doc.py` 复用同一个 Word 实例批量转换（逐个启停 Word 会慢十倍）。
  少量文件会被 Office 的「文件存在安全问题」保护模式拦下，属正常损耗。
- **Word 预览已下线**：原先 `data/word_NN.js` 的预览 HTML 用 `.pv-doc` 容器选择器上样式，
  正文段落输出裸 `<p>`，只有需要覆盖时才带 class（`n` 无缩进 / `c` 居中 / `r` 右对齐 /
  `f1` 首行 1 字 / `l1` `l2` `l4` 左缩进）；一级标题用 `<h3>`、二级用 `<h4>`。
  这些代码与 `data/word_NN.js`（约 29.6 MB）已删；`tools/word_html.py` 保留但不在构建流程里，
  原始 docx 仍在 `tools/flk_cache/`、`tools/hubei_cache/`，要恢复随时可以。
- **条目的 id 顺序由 `build_dataset.load_flk_corpus()` 决定**（按 `flk_cache` 里 **文件名字典序**，
  不是 `flk_meta.json` 的顺序，也不是 `flk_corpus.json` 的顺序）。
  任何要按 id 生成的数据**必须复用同一个 loader**，否则会张冠李戴。
- **日期口径要统一**：三个源各有一套日期字段（flk 有 `gbrq` 公布日 / `adopted` 通过日 /
  `revised` 修订日，湖北有 `published` 公布日），历史上时间轴按 `doc.year` 分组却显示
  `doc.adopted`，出现「2026 年组里挂着 2016 年的卡片」。现在统一口径：
  **`published` = 现行版本公布日**（flk 取 `gbrq`→`revised`→`adopted`；湖北取详情页「公布日期」；
  党内由 `build_dataset.parse_party_published()` 从摘要里取最后一个「发布/印发/公布/颁布」
  或「修订/修正/修改」事件日，「自X起施行」不算），**`year` 一律由 `published` 推导**，
  前端时间轴分组与卡片显示都用 `published`（`app.js` 的 `pubDate()` / `pubYear()`，
  `search.js` 的 `pubYearOf()`）。源数据确实没有日期的 154 部**不要编造**。
- **详情页用 Grid 排版：正文居中、目录挂右**。`.doc-layout` 是 `grid-template-columns: minmax(0,1fr) 240px`，
  标题卡与正文卡都在第 1 列（`grid-row: 1 / 2`），靠 `max-width:780px + margin:auto` 居中，
  目录在第 2 列并 `grid-row: 1 / span 2`（sticky）。**两者的居中基准必须一致**，
  否则标题卡与正文卡会错开（曾出现 120px 偏差）。
  **列间距用 margin（`.toc { margin-left: 20px }`）而不是 `gap`** —— `gap` 简写在 Chrome 69 的
  flex 上不生效，且项目禁用项里就列着 `gap`，自检的兼容性扫描会直接判 FAIL。
  打印时 `.doc-layout` 必须改回 `display: block`，否则正文会被目录列挤成窄条。
- **「导出本篇」要真的导出**：早先它只是个跳转到导出中心的链接（用户还得再选格式再点导出），
  现在是「点主按钮直接下载 Markdown + 旁边 ▾ 展开 md/txt/html/json/csv」。
  改动后用 `node tools\verify_export_ui.js <docId>` 做 UI 级验证：真的去点按钮，确认文件落盘。
- **阅读主题的变量必须挂在 `.doc-layout` 上，并且显式写一次 `color: var(--ink)`**：
  `color` 是「继承解析后的值」，只重定义 `--ink` 并不会让没写 `color` 的后代（标题卡 `h1`、
  元信息值 `.dmg .v`）跟着变——夜间主题下就成了黑底黑字。
  同理 `--rd-w`（版心宽度）也要挂在 `.doc-layout` 上，`.doc-head` 与 `.article-box` 都用
  `max-width: var(--rd-w, 780px)`，否则标题卡与正文卡宽度不一致、左右错开。
- **入场动画的 fill-mode 只能用 `backwards`，不能用 `both`/`forwards`**：
  `both` 会把最后一帧的 `transform` 一直留在元素上，Chrome 把 `transform: none`
  算成**单位矩阵 `matrix(1,0,0,1,0,0)`** —— 而**任何非 `none` 的 transform 都会成为
  `position: fixed` 后代的包含块**。于是详情页里的划线浮条、批注框、笔记抽屉全都相对
  文档卡定位而不是相对视口：内联 `top` 是对的，渲染位置却偏出整整一个文档高度，
  看上去就是「框没有跟随文本」（曾偏 9000px）。
  判据：浮层的 `getBoundingClientRect().top` 必须等于它的内联 `style.top`。
  历史上 `.hit-nav` 被写成 `.view > *:not(.hit-nav)` 就是同一个坑的痕迹。
- **`position: fixed` 的浮层不要放在 `.doc-layout` 里**：`.doc-layout` 是 `.view > *`，
  即使 fill-mode 改成 `backwards`，**动画播放的那 0.2 秒里它的 transform 仍非 none**，
  包含块照样被劫持。稳妥做法是把浮层挂在 `#view` 下（`.view`/`.view > *` 都没有 transform，
  包含块恒为视口）；代价是拿不到 `.doc-layout[data-rd]` 的阅读主题配色，
  要另外用 `html[data-rd="…"]` 给一份（`applyReadConfig` 同时把 `data-rd` 写到 `<html>`）。
  批注框是 `position: absolute`（挂在 `.article-box` 内），absolute 不受 fixed 包含块影响。
- **`--force-prefers-reduced-motion` 会掩盖这类布局 bug**：
  关掉动效后动画根本不跑，`transform` 保持 `none`，包含块不被劫持，截图看着一切正常；
  真实浏览器里却是坏的。`tools/shot.py` 用它是因为 `--virtual-time-budget` 只快进定时器、
  不推进 compositor 动画（会把 `.view` 入场动画截在 opacity≈0.25 的早期帧）；
  而 `tools/shot_read.js` 走 CDP 真实等待，**刻意不加**这个开关。
  **同理，自检里不要用 `setTimeout` 判定「动画播完」**——dump-dom 的虚拟时间会快进定时器，
  但 compositor 动画不跟着走，量到的仍是动画第一帧。查动画配置要**静态读 CSS 源码**。
- **批注框要真正跟着划线走**：它用 `position: absolute` 挂在 `.article-box`（`position: relative`）内，
  坐标是「划线 rect − 正文卡 rect」（两个都是视口相对值，相减即抵消滚动），
  滚动时随正文一起移动；划线贴着正文卡顶部时改放到划线下方。
  用 `position: fixed` 就会停在视口里跟文字分家。
- **划线的 `<mark>` 不能跟检索高亮共用样式**：
  检索高亮走 `mark, .hl { color: inherit; font-weight: 700 }` +
  `[data-theme="dark"] mark { color: #ffd9de }`（深色站点下浅粉色）。
  划线要用 `mark.fg-hl`（特异性 0,1,1，`[data-theme="dark"] mark.fg-hl` 更强）把
  颜色、字重、底色都拿回来，否则深色站点里批注变粉、打印到白底上几乎看不清。
  打印时 `@media print` 还要把 `mark` 的背景去掉（浏览器默认不打印背景色）、改用下划线表示。
- **划线铺回正文前先拆**：Chrome 69 没有 `CSS.highlights`（Chrome 105+），只能用 `splitText`
  手工包 `<mark class="fg-hl">`。每次铺之前必须先把已有的 `<mark>` 拆回纯文本，
  否则「新增一条划线后重铺全部」会在旧划线里再套一层 `<mark>`（划线越点越厚、点击落到内层）。
- **划线浮层是 `position: fixed`，坐标取视口相对值**：选区靠近视口下边缘时要把 `top` 往回收，
  否则整条浮条飘到屏幕外看不见（曾出现 `top=9429px`）。
- **详情页的浮层「点外面收起」不能每次渲染都往 `document` 挂监听器**：
  翻过几篇法规后旧监听器仍在，会把新面板点没、还会越积越多。
  用模块级 `docPopCtx` 指向当前详情页的浮层，由 `boot()` 里**唯一**那个监听器处理；
  `route()` 离开详情页时把 `docPopCtx` 置空。
- **`.article-toolbar .right` 必须是 flex**：工具条里加了「Aa」「笔记」两个按钮后，
  普通块级 div 会让它们换行掉到第二行。
- **卡片类 `<a>` 必须 `display:block`**：inline 的 `<a>` 只在自己的行盒上画背景与边框，
  里面的块级子元素却按父级宽度铺开 —— 看着像「卡片没画完」。时间轴的 `.tl-card` 踩过这个坑。
  同类还有 `.suggest-item`、`.doc-row`、`.result-card`（都在 CSS 里显式给了 display）。
- **时间轴轴线要用品牌色**：轴线早先取 `--line`（浅灰），会被卡片左边框混淆，
  看着像断成一段段；改成 `--brand-line` 后才看得出是时间轴。圆点 `left` 要按
  「轴线到 item 左边缘的距离 + 圆点半径」算，才能精确落在轴线上。
- **正文的条目序号必须保留原文写法**：
  `sectionMarkdown` 早先把「（一）xxx」转成 Markdown 列表项「- 一、xxx」——
  一是把原文的「（一）」改写成了「一、」，与原文对不上；
  二是渲染出来带一颗黑点（公文里的条目序号本来就没有列表符号）。
  现在只把序号加粗（`**（一）**`），写法原样保留，与「第X条」的处理一致。
  全库约 **5.2 万行、1869 部法规**走这条路径（`tools/scan_numbering.py` 可复核）。
  **导出不受影响**：txt/md 导出走的是数据层纯文本（`Exporter.fullText`），
  不经过 `sectionMarkdown`，所以不会漏出 `**`。
- **不要靠行首形态自动识别「一、」是标题**：
  看着像标题的「一、总体要求」其实只占少数 —— 全库 3180 行「一、」开头的行里，
  **2093 行是条目正文**（如「一、无论什么级别的干部参加学习培训都是普通学员…」），
  按长度阈值（≤20 字只有 509 行）硬判也会误伤。真正的根因是**部分文件没切出章节结构**
  （标题混在正文里），要在数据层解决（`crawl_12371_docs.py --reparse`），不要在渲染层猜。
- **正文不做悬挂缩进**：法条按中文公文规范**首行缩进两字**（`.article p.md-clause { text-indent: 2em }`，
  `padding-left` 保持 0），条号用 `<span class="md-no">` 加粗、**不能**做成 inline-block 定宽块
  （定宽块是悬挂缩进时代的产物）。正文栏 780px（内容约 676px）/ 字号 17px / 行距 2.02（约 39 汉字/行），
  内容页统一 1240px 居中版心。
- **顶栏不放五角星 logo**：早期用过五角星，与首页国徽视觉冲突，已删。
  现在顶栏用**同一枚国徽**（`assets/img/flk-emblem.png`，26px）+ 站名文字，
  首页横幅中央再放大一次（84px）——同一枚国徽两处出现是统一的，不是重复。
- **横幅底图的底部是「红 → 白」渐变**（flk 官网用它接白底页面）。
  直接贴到纸面底色上会留一条白色硬边；`tools/prep_images.py` 已把这段改成
  「红 → 透明」（alpha 渐隐），再由 CSS 渐变接纸色 —— **换图或改尺寸后要重跑该脚本**。
- **深色主题下的横幅渐变起始色必须跟着底色走**：写死浅色会在横幅下缘留白色亮带，
  写死不透明度会在底图自带的渐隐区留下一片亮红雾。
  深色下要叠一层暗化罩（`rgba(13,16,22,.88)`）把渐隐区压住。
- **正文用宋体**（`--ff-serif`，法规原文惯例，中文小字长文更耐读），
  标题与元信息用黑体（`--ff`）；章标题引导线用国徽金 `--gold-line`。
- `$$` 辅助函数的第二个参数是 **根元素**，不能把 root 拼进选择器字符串（`document [data-fav]` 会抛异常）。
- 路由要先把 hash 里的 `?query` 剥离再解析路径，否则 `#/search?q=…` 会当成不存在的页面。
- 改 hash 会触发异步 `hashchange` → 重新渲染当前页；自检里点按钮前要先等重渲染结束，
  否则刚点完就被覆盖。
- 人民网页面里 `&nbsp;` 与不带分号的 `&nbsp` 混用，解析前要补分号，否则正文里会出现字面量实体。
- 源页面「章节名」字段与「章节正文首行」重复，渲染和导出都要跳过这一行。
- **flk 接口带创宇盾（WZWS）风控**：直接用 requests 调 `/law-search/download/*` 会被 JS 挑战拦截
  （返回一段混淆 JS，它会构造隐藏表单 POST 到 `/WZWSREL<base64>`）；
  纯脚本算不出挑战值（`tools/wzws_solve.js` 试过 Node 沙箱，混淆脚本会做环境检测后静默退出），
  正文附件必须由真实 Chrome 下载。`flfgDetails` / `search/list` 等 JSON 接口在完成一次
  `search/list` POST 拿到 `wzws_cid` Cookie 后可用；**直连下载在风控收紧时会整片失效**，
  Chrome 反而始终能拿到文件（挑战由浏览器原生解决）。
- **风控会升级**：先是 JS 挑战，再变成**图形验证码页**（「访问验证」+ `/waf_text_captcha`）。
  出现验证码就意味着这个 IP 被限流了，必须**停止一切请求、冷却十几分钟**再继续，
  并把下载间隔拉大（`crawl_flk_ctx.js` 的第 5 个参数，稳态 2–4 秒）。
- **`Browser.setDownloadBehavior` 是浏览器级命令**：多并发 worker 各自设不同 `downloadPath` 会互相覆盖，
  结果是 A 篇的文件被记到 B 篇名下（历史上真出现过 17 篇错配）。
  **正确做法**：每个 worker 建独立浏览器上下文 `Target.createBrowserContext()`，
  再用 `Browser.setDownloadBehavior({browserContextId})` 把下载目录按上下文隔离
  —— 见 `tools/crawl_flk_ctx.js`。保存前再用「文件名里的标题」反查一次标题，兜底防张冠李戴。
- `fs.readSync(fd, buffer, offset, length, position)` 参数别写漏 `fd`。
- CDP `Fetch` 域在「文件下载」型响应上拿不到 body（`Can only get response body on requests captured
  after headers received`），别指望用它绕过下载目录。
- flk 列表接口的 `title` 字段被**截断到约 39 字**，做标题比对只能比前 12 字（去标点后）。
- flk 的 `flfgDetails` 接口有严格限流：并发 4 个线程会被挡成验证页，**要用 1–2 线程 + 每次请求后 sleep**；
  它返回的 `lsyg` 字段就是「修订沿革」（同一部法规的历次版本），值得入库。
- 附件格式不止 docx：极少数是 Word 97-2003 的 **.doc**（OLE2 复合文档，魔数 `D0CF11E0`），
  用 `tools/fetch_flk_doc.py` 借本机 Word COM 转换；另有 `format=pdf` 可取（但可能是扫描件，抽不出文字）。
- 正文全量较大时 `search.js` 里不要无条件 `text.toLowerCase()`（会多占一份内存），
  当前实现仅在文本含大写字母时才复制。
