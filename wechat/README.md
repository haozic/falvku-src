# 法规库 · 原生微信小程序

把已有的「法规库」静态站点 / Mini App 移植成**原生微信小程序源码**（`.wxml` / `.wxss` / `.js` / `.json`），
不是 web-view 套壳。

- 数据：全量 2,706 部法规、约 1,327 万字，由后端服务持有，客户端只取需要的部分；
- 后端 API：复用 `miniapps/falv-mini-app/miniapp/node/` 里已经跑通的那套（契约见下）；
- 依赖：**零第三方依赖**，没有 npm install，没有 CDN，全部图标是本地 PNG。

---

## 1. 目录结构

```
wechat/
├── README.md
├── project.config.json          # 微信开发者工具工程配置
├── project.private.config.json  # 本地私有配置（已 gitignore 的那类）
├── app.js                       # 后端地址常量 / 全局状态 / 主题 / 字号
├── app.json                     # 页面路由 + 原生 tabBar + 深色模式声明
├── app.wxss                     # 设计变量（CSS 变量）+ 通用组件样式
├── theme.json                   # 深色模式下的导航栏配色
├── sitemap.json
├── images/                      # 23 个本地 PNG（tabBar 10 个 + 页面内 13 个）
├── utils/
│   ├── api.js                   # wx.request 封装，对接 6 个后端接口
│   ├── store.js                 # 本地存储：收藏 / 批注 / 最近浏览 / 自建条目 / 设置
│   └── util.js                  # 日期、字数、防抖节流、<mark> 内联样式化
├── pages/
│   ├── home/                    # 首页：检索框 + 门类磁贴 + 体系分组 + 最近浏览
│   ├── search/                  # 检索页：搜索框 + 门类 chips + 排序 + 结果 + 分页
│   ├── detail/                  # 详情页：元信息 + 两级目录 + 正文块 + 底部操作条
│   ├── tree/                    # 法规体系页：5 体系 → 17 门类
│   ├── timeline/                # 立法时间轴
│   ├── mine/                    # 我的：收藏 / 笔记 / 自建条目 / 设置
│   ├── favorites/               # 我的收藏
│   └── notes/                   # 我的笔记
└── tools/                       # 开发期脚本（不进小程序包）
    ├── serve.mjs                # 本地开发后端：常驻纯 API 服务（给开发者工具用）
    ├── gen_icons.mjs            # 生成全部 PNG 图标
    ├── check_json.mjs           # JSON 合法性
    ├── check_wxml.mjs           # WXML 结构（配对 / 属性 / 表达式）
    ├── check_fields.mjs         # WXML 字段 ↔ JS 数据字段 / 事件处理函数交叉核对
    ├── check_icons.mjs          # PNG 签名 / 尺寸 / 非空
    ├── check_compat.mjs         # 基础库 2.9 / Chrome 69 兼容性静态扫描
    ├── api_smoke.mjs            # 起真实后端，打 6 个接口逐条核对契约
    └── check_all.mjs            # 一次跑完全部检查
```

---

## 2. 导入开发者工具

1. 打开**微信开发者工具** → 导入项目 → 目录选 `E:\cursor\法规库\wechat`。
2. AppID：
   - 有自己的 AppID：在「导入项目」时填上，并同步改 `project.config.json` 的 `appid`；
   - 只想先跑起来：选**测试号**（`touristappid`，当前配置就是这个）。
3. **详情 → 本地设置 → 勾选「不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」**。
   （等价于 `project.private.config.json` 里的 `setting.urlCheck: false`，已配好。）

---

## 3. 配置后端地址

后端地址常量在 **`app.js` 顶部**，只有这一处需要改：

```js
// 后端地址：改成你自己的部署地址。微信正式版要求 HTTPS 且域名已在小程序后台配置白名单。
const API_BASE = 'http://127.0.0.1:8765';
```

| 环境 | 怎么配 |
| --- | --- |
| 本地开发 | 保持 `http://127.0.0.1:8765`，并在开发者工具里勾选「不校验合法域名」。<br>后端启动方式见下一节。 |
| 局域网真机预览 | 改成电脑的内网 IP（`http://192.168.x.x:8765`），手机与电脑同一 WiFi；<br>真机预览**仍然需要**「不校验合法域名」，或把内网地址加进「开发设置 → 服务器域名 → request 合法域名」。 |
| 正式发布 | 必须是 **HTTPS** 域名，且在「微信公众平台 → 开发 → 开发管理 → 开发设置 → 服务器域名 → request 合法域名」里登记；<br>然后把 `API_BASE` 改成 `https://你的域名`。 |

> 微信正式版**不允许** `http://`、不允许 IP 地址、也不允许带端口的自定义域名。

### 3.1 怎么起后端

后端代码不在小程序工程里，在仓库的 `miniapps/falv-mini-app/miniapp/node/`。
小程序只需要 **API**（不需要托管网页），所以直接用本工程自带的独立后端即可：

```powershell
cd E:\cursor\法规库\wechat
node tools\serve.mjs
```

它会：

1. 只读地载入 `miniapps/falv-mini-app/miniapp/node/corpus/` 下的全量语料（约 2,706 部法规）；
2. 在 `http://127.0.0.1:8765` 起一个常驻服务，路由与生产环境**逐条对齐**
   （`/api/meta` `/api/search` `/api/recs` `/api/suggest` `/api/doc` `/api/timeline` `/api/export`）。

看到 `法规库 API 已启动：http://127.0.0.1:8765` 之后，回到微信开发者工具点「编译」即可。
**这个终端窗口要一直开着**，关掉后端就没数据了。

常用参数：

```powershell
node tools\serve.mjs --port 9000     # 换端口（记得同步改 app.js 的 API_BASE）
node tools\serve.mjs --host 0.0.0.0  # 允许局域网访问，真机预览用
```

> 另：Mini App 那套服务端（`miniapps/falv-mini-app/miniapp/node/server.mjs`）**不能**单独启动 ——
> 它要托管 Mini App 的静态页，host / port 由 Mini App 运行时注入。
> 想同时跑 Mini App 与微信小程序，用 `tools/serve.mjs` 跑一个独立后端给小程序用即可，两者互不干扰。

### 3.2 后端部署到公网（正式发布前必读）

`tools/serve.mjs` 是**开发用**的本地后端。正式发布需要：

1. 把 `miniapps/falv-mini-app/miniapp/node/` 里的 `corpus.mjs` + `corpus/` 语料
   一起部署到一台服务器，用 `server.mjs` 的路由逻辑起一个对外服务
   （`server.mjs` 的静态托管部分可以省掉）；
2. 套一层 **HTTPS**（微信正式版只允许 HTTPS，不允许 `http://`、不允许 IP、不允许自定义端口）；
3. 在「微信公众平台 → 开发 → 开发管理 → 开发设置 → 服务器域名 → **request 合法域名**」
   里登记这个域名；
4. 把 `wechat/app.js` 的 `API_BASE` 改成 `https://你的域名`。

---

## 4. 后端 API 契约

全部是 `GET`。基址 = `app.js` 的 `API_BASE`。

| 接口 | 参数 | 返回 |
| --- | --- | --- |
| `/api/meta` | — | `{version, source, note, categories[17], groups[5], stats{16}, total, totalChars}` |
| `/api/search` | `q, cat, group, sort, page, size` | `{query, hits[], total, pages, page, took}`，`hits[].snippetHtml` 带 `<mark>` |
| `/api/recs` | `ids` | `{items[]}`，按 id 批量取元信息（本小程序用本地快照，没接这个；Mini App 客户端在用） |
| `/api/suggest` | `q` | `{items[]}`（最多 8 条） |
| `/api/doc` | `id, q` | 详情（含 `toc` / `blocks` / `plain` / `summaryHtml`） |
| `/api/timeline` | — | `{years[]}`（按年倒序） |
| `/api/export` | `ids, fmt` | **文件内容本身**（不是 JSON），`fmt` ∈ `txt/md/json/csv/html` |

### 正文渲染契约（两端共用，最关键）

`/api/doc` 的 `blocks` 数组是唯一的正文渲染依据。`type` 只有 6 种：

| type | 含义 | 额外字段 | 小程序里的渲染 |
| --- | --- | --- | --- |
| `h2` | 一级章节标题 | `text` | `.a-h2` |
| `h3` | 二级小节标题 | `text` | `.a-h3` |
| `clause` | 条款 | `no`、`text` | `.a-clause`，条号加粗 |
| `item` | 条目序号 | `no`、`text` | `.a-item`，序号加粗 |
| `note` | 立法说明括号段 | `text` | `.a-note`，灰底小字 |
| `p` | 普通段落 | `text` | `.a-p`，首行缩进 2 字 |

**正文一律用原生 `<view>` + `<text>` 渲染，不用 `rich-text`**（`rich-text` 对混排支持有限）。
只有 `snippetHtml`（检索片段）和 `summaryHtml`（摘要）用 `rich-text`。

---

## 5. 功能实现说明

| # | 功能 | 状态 | 说明 |
| --- | --- | --- | --- |
| 1 | 全库检索 | ✅ | 支持「短语」精确匹配、`-排除词`、`标题:字段限定`；前端把输入原样传给后端，解析在服务端。界面上有语法提示行。 |
| 2 | 分类浏览 | ✅ | **按门类**：首页磁贴 / 体系页门类 / 检索页 chips，点进去是「检索页 + 该门类过滤」。**按体系**：体系页 5 个体系 → 17 个门类。 |
| 3 | 详情阅读 | ✅ | 元信息、两级目录（点击 `wx.pageScrollTo` 跳到对应块）、正文按 `blocks` 原生渲染、条号/序号加粗、说明段灰底。 |
| 4 | 收藏夹 | ✅ | 详情页「收藏」→ 「我的 → 我的收藏」。收藏条目带**标题快照**（见 §5.2）。 |
| 5 | 划线批注 / 我的笔记 | ⚠️ **简化实现** | 见 §5.1。 |
| 6 | 立法时间轴 | ✅ | 按年倒序；分批渲染（每次 10 年，每年先出 5 条，可展开）。 |
| 7 | 导出与分享 | ⚠️ **替代方案** | 见 §5.3。 |
| 8 | 深色模式 | ✅ | 跟随 `wx.getSystemInfoSync().theme`；「我的」页可手动切浅/深，也可恢复「跟随系统」。 |
| 9 | 正文字号调节 | ✅ | 15 / 16 / 17 / 18 / 20 循环，详情页底部操作条或「我的」页都可调，全局生效。 |

### 5.1 划线批注：为什么是「按段落批注」而不是「按字符划线」

微信小程序**没有可靠的字符级选区 API**：`<text selectable>` 只能让用户长按选词，
拿不到「起始偏移 / 结束偏移」，也没有 `window.getSelection()` 那样的区间对象。

**采用的替代方案**：正文每个 `clause` / `item` / `p` 块都可以点一下，弹出批注面板，
批注挂在**块下标**上：

```js
{ id, docId, docTitle, blockIndex, blockType, text, note, color, ts, s, e }
```

- `blockIndex`：正文块下标，稳定锚点；
- `text`：该块原文（最多保留 200 字），**按文本回退匹配**用；
- `s` / `e`：预留的字符偏移字段，将来换成精确划线时直接填，不用改数据结构；
- `color`：`yellow / green / blue / pink` 四色，有批注的段落左侧会显示对应色条。

「我的笔记」页按文档分组列出所有批注，点一条跳回对应段落。

### 5.2 收藏 / 最近浏览为什么存「标题快照」

后端 `/api/meta` **只返回门类 / 体系 / 统计，不含 `records` 明细**（实测确认），
所以客户端拿不到「按 id 查标题」的能力。

因此小程序在**收藏**和**浏览**的那一刻，把 `{title, catName, published, issuer, chars}`
一起存进本地（`utils/store.js` 的 `fav` / `recent`），列表页直接渲染这份快照。
这样「我的收藏」「最近浏览」不需要额外请求，也不需要后端补接口。

> 小程序端选择存快照而不是调 `/api/recs`，是因为快照是**收藏那一刻的真实元信息**，
> 即使日后法规被修订，收藏列表里显示的仍是你收藏时的样子。
>
> 后端另有 `GET /api/recs?ids=a,b,c`（按 id 批量取元信息）可用，
> Mini App 客户端就是用它给「收藏 / 笔记 / 最近浏览」补标题的 —— 两端做法不同，但都能正确显示。

### 5.3 导出：没有浏览器下载，所以是「写文件 + 复制 + 分享」

小程序没有 `<a download>` / Blob 下载。采用的方案：

1. `GET /api/export?ids=…&fmt=…` 拿到**文件内容字符串**；
2. 用 `wx.getFileSystemManager().writeFile` 写到 `wx.env.USER_DATA_PATH/法规汇编_YYYY-MM-DD.txt`；
3. 弹 ActionSheet 让用户选：
   - **复制到剪贴板**（`wx.setClipboardData`）—— 5 种格式都能用，最实用；
   - **分享文件**（`wx.shareFileMessage`，基础库 2.8.0+）—— 把文件直接发到微信聊天。

`wx.openDocument` 只支持 `doc/docx/xls/xlsx/ppt/pptx/pdf`，**不支持 `txt/md/csv/json/html`**，
所以本工程没有走 `openDocument` 这条路。

> 另：后端 `exportDocs()` 返回了 `filename`，但 `/api/export` 的 HTTP 响应**没有把文件名带出来**
> （`server.mjs` 只发 `content` + `Content-Type`），所以文件名由前端用 `util.exportName()` 生成。

### 5.4 分享

详情页实现了 `onShareAppMessage()`（分享该篇法规），并在 `onLoad` 里 `wx.showShareMenu()`。

### 5.5 底部操作条 vs 原生 tabBar（方案说明）

需求里既写了「详情页底部操作条用 `position: fixed`」，又提到「详情页保留原生 tabBar」——
这两条在微信里**不能同时成立**：原生 tabBar 只在 `tabBar.list` 里列出的页面显示，
**别的页面本来就没有 tabBar**。

本工程的做法：

- 原生 `tabBar`（5 项：首页 / 检索 / 体系 / 时间轴 / 我的）用于 5 个主页面；
- `detail` / `favorites` / `notes` 是**普通页面**（`navigateTo` 进入），自带原生返回按钮，
  **页面底部没有 tabBar**，所以可以放心用 `position: fixed` 的底部操作条（收藏 / 批注 / 导出 / 字号），
  操作条带 `env(safe-area-inset-bottom)` 安全区内边距；
- 正文容器 `.root` 额外留了 `padding-bottom: 96px`，不会被操作条盖住。

---

## 6. 开发期自检（不需要微信开发者工具）

```powershell
cd E:\cursor\法规库\wechat

node tools\check_all.mjs        # 一次跑完全部检查
```

或单独跑：

| 命令 | 检查什么 |
| --- | --- |
| `node tools\check_json.mjs` | 全部 13 个 `.json` 能否 `JSON.parse` |
| `node tools\check_wxml.mjs` | 8 个 `.wxml` 的标签配对、属性写法、`{{ }}` 配对、`wx:if/elif/else` 链 |
| `node tools\check_fields.mjs` | WXML 里用到的每个数据字段 / 事件处理函数，在对应 `index.js` 里是否存在 |
| `node tools\check_icons.mjs` | 23 个 PNG 的签名、尺寸、是否空白；`app.json` 引用的图标是否存在 |
| `node tools\check_compat.mjs` | 可选链 / 空值合并 / `Object.fromEntries` / `.at()` / `replaceAll` / `matchAll` / CSS `gap` / `clamp()` / `:is()` / `inset` / 外链资源 |
| `node tools\api_smoke.mjs` | 起真实后端，用 `http.get` 打 7 个接口，63 项断言核对契约 |
| `node tools\serve.mjs` | **常驻**本地后端，给微信开发者工具联调用（§3.1） |
| `node tools\gen_icons.mjs` | 重新生成全部 PNG 图标（改了图标定义才需要跑） |

`api_smoke.mjs` 会**只读**地加载 `../../miniapps/falv-mini-app/miniapp/node/corpus` 下的语料，
在 `127.0.0.1:8765` 起一个临时服务，打完接口就关掉。端口被占用时用
`$env:FG_PORT_OFFSET=1; node tools\api_smoke.mjs` 换一个端口。

---

## 7. 兼容性

- 目标基础库 **2.9+**（`project.config.json` 的 `libVersion`）。
- **不用**可选链 `?.`、空值合并 `??`、`Object.fromEntries`、`Array.prototype.at`、
  `String.replaceAll`、`matchAll`、`structuredClone`、`globalThis`、`Promise.allSettled`。
- WXSS **不用** flex `gap`（间距一律 margin）、`clamp()`、`:is()`/`:where()`、`aspect-ratio`、
  `backdrop-filter`、`inset`。
- 图标**全部是本地 PNG**，`images/` 下 23 个，**没有任何 `https://` 外链资源**。
- 没有 emoji / 字符图标：所有图标都是 `tools/gen_icons.mjs` 用距离场光栅化出来的真实 PNG。

### 深色模式怎么做的

三层叠加，任何一层单独失效都不会导致页面不可读：

1. `app.json` 里 `"darkmode": true` + `"themeLocation": "theme.json"` —— 官方机制，管原生导航栏；
2. `app.wxss` 里 `@media (prefers-color-scheme: dark)` 给 `page` 一套深色变量 —— 跟随系统；
3. 每个页面根节点挂 `.theme-light` / `.theme-dark`（由 `app.js` 的 `applyTheme()` 决定），
   根节点自己再声明一遍变量，优先级高于继承 —— **手动开关靠这一层覆盖系统设置**。

`app.js` 还会调 `wx.setNavigationBarColor()` 让原生导航栏跟着换色。

---

## 8. 已知限制 / 未实现

| 项 | 状态 | 原因 |
| --- | --- | --- |
| 字符级划线 | 未实现 | 小程序无选区 API，改成「按段落批注」（§5.1），数据结构已为精确划线预留 `s`/`e`。 |
| 导出文件「下载到本机」 | 替代实现 | 小程序沙箱不能写用户可见目录；改成写小程序本地目录 + 复制到剪贴板 + `shareFileMessage` 分享（§5.3）。 |
| 独立「自建条目」页 | 收进「我的」页 | 需求给的文件清单里没有这一页，做成「我的」页里的可展开区块（新增 / 编辑 / 删除都可用）。 |
| 检索框输入联想（`/api/suggest`） | 后端已就绪，前端未接 | 后端接口已实现并通过冒烟测试；本版搜索页没有联想下拉。 |
| `file://` 直接打开 | 不适用 | 小程序不是网页，不存在这个场景；后端必须是 HTTP(S) 服务。 |
| 后端服务部署 | 未包含 | 后端代码在 `miniapps/falv-mini-app/miniapp/node/`，本次**未改动**该目录。 |

---

## 9. 内容来源

国家法律法规数据库（flk.npc.gov.cn）· 人民网党建频道「党章党规」· 共产党员网「党章党规」专页 · 湖北法规库。
全库 2,706 部法规。正文以服务端返回的 Markdown 纯文本为准。
