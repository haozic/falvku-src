/**
 * Cloudflare Pages Function —— 法规库边缘检索后端（第 4 套后端）
 * ===========================================================================
 *
 * 目的
 *   手机访问静态站时不必下载 39MB 正文：全文检索放到 Cloudflare 边缘跑，
 *   手机只取回结果页。API 契约与既有三套后端**逐条对齐**（字段名、排序、
 *   评分语义都不能变）：
 *     - miniapps/falv-mini-app/miniapp/node/server.mjs   Node 服务端（基准）
 *     - wechat/tools/serve.mjs                           微信小程序本地 API
 *     - miniapps/falv-mini-app/miniapp/client/static-api.js  浏览器内静态数据层
 *
 * 路由（Pages Functions 文件名约定：functions/api/[[path]].js 匹配 /api/* 全部路径）
 *   GET /api/meta            门类、体系、统计（**不含** records 明细，1.4MB）
 *   GET /api/search?q=&cat=&group=&sort=&page=&size=
 *   GET /api/recs?ids=a,b,c  按 id 批量取元信息（收藏/笔记/最近浏览用）
 *   GET /api/suggest?q=      标题联想，最多 8 条
 *   GET /api/doc?id=&q=      单篇详情（目录 + 结构化块 + 纯文本 + 摘要高亮）
 *   GET /api/timeline        立法时间轴（按年倒序）
 *   GET /api/export?ids=&fmt= txt | md | json | csv | html（返回文件内容本身）
 *
 *   sort ∈ relevance | new | old | title；size ≤ 100
 *   blocks[].type ∈ h2 | h3 | clause | item | note | p
 *
 * 语料来源与读取路径
 *   通过 env.ASSETS.fetch() 读构建输出目录里的静态资源：
 *     /corpus/meta.json.gz    元信息：门类、体系、2,706 条记录（不含正文）
 *     /corpus/bodies.json.gz  全量正文：11.3MB gzip / 41MB JSON
 *   这两个文件由构建脚本（主线程负责）拷进输出目录，本函数只读不写。
 *   ASSETS 返回的字节可能是 gzip（正常）或未压缩 JSON（兜底），两种都支持。
 *
 * 内存策略（Workers 单实例上限 128MB —— 这是本文件最关键的约束）
 *   正文 JSON 解压后 41MB（UTF-16 落进 V8 约 82MB），解析成对象图更到 160MB+，
 *   **一次性全量驻留必然爆内存**。因此：
 *   1. 常驻内存只有两样：
 *        - meta.json（2.4MB JSON，解析后约 10MB）—— 门类/体系/标题/摘要/年份等
 *        - bodies.json.gz 的**压缩字节**（11.4MB）—— 不解压、只做数据源
 *   2. 检索时用 DecompressionStream('gzip') **流式解压**，边解压边把顶层数组
 *      切成一个个 JSON 元素，逐个 JSON.parse、逐个算分、算完即丢：
 *      实测解压流吐 16KB 一块、共 2,502 块，**41MB 正文从不整体驻留**
 *      （整条流读完 external 只涨 2MB 左右）。
 *   3. 预筛（prefilterSafeFor / metaHasTerm / rawHasTerm）：命中不了的正文元素
 *      **连 JSON.parse 都不做** —— 2,706 篇的 parse 对象图是全库扫描最大的一笔
 *      内存开销，预筛后窄查询只需 parse 命中的一小部分。
 *   4. 缓存有三层，都带上限：
 *        - 命中结果缓存（按查询串，最多 40 条）—— 重复查询零扫描
 *        - 单篇正文 LRU（按字数计预算，最多 800 万字）—— /api/doc 与 /api/export
 *          二次访问免扫描
 *        - 压缩字节本身常驻（11.4MB）
 *      全库检索**不做**正文缓存（2,706 篇会撑爆预算并导致抖动），
 *      只缓存「结果」，因此内存有硬上界。
 *   5. 实测（Node 24，--expose-gc 强制回收后）：常驻堆约 12MB + 压缩字节 11.4MB
 *      ≈ 24MB，远低于 128MB；窄查询约 0.29s、宽查询（约 2,700 命中）约 0.45s、
 *      单篇详情约 0.20s、/api/meta 冷启动约 0.12s，命中缓存命中时 < 1ms。
 *   6. 代价：每次「首次」检索都要流式扫一遍全库。Workers 免费套餐每次请求只有
 *      10ms CPU，**本函数需要 Workers Paid 套餐**（30s CPU / 128MB 内存）；
 *      结果缓存命中时是零扫描的。
 *
 * 降级行为
 *   - 没有 ASSETS binding / 语料文件缺失 / 解压失败 → HTTP 503 +
 *     {error:'corpus_unavailable', message:'…'}，绝不抛未捕获异常。
 *   - /api/meta、/api/recs、/api/suggest、/api/timeline 只依赖 meta.json.gz，
 *     **不碰正文**，语料只有一半也能用。
 *   - 空查询（q 为空）只按元信息排序出全部条目，同样不碰正文。
 *   - 未知路径 → 404 {error:'not_found'}；非 GET/HEAD → 405 {error:'method_not_allowed'}。
 *
 * 兼容性
 *   运行时是现代 V8（Workers），可以现代语法；
 *   但不使用 Node 专属 API（fs/path/zlib）——那些只出现在自检脚本里。
 * ===========================================================================
 */

/* ==========================================================================
   1. 检索内核
   --------------------------------------------------------------------------
   移植自 assets/js/search.js（浏览器版）与
   miniapps/falv-mini-app/miniapp/node/corpus.mjs（服务端版）。
   两者本来就同源；这里取**服务端版**口径（片段宽度 132、命中字段完全一致），
   保证 /api/search 的 total、命中顺序、snippetHtml 与 Node 服务端逐条相同。
   ========================================================================== */

/** 语料不可用（缺 binding / 文件缺失 / 解压失败） */
class CorpusError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = 'CorpusError';
  }
}

function countOf(hay, needle) {
  if (!hay || !needle) return 0;
  let n = 0;
  let i = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}

function escRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtml(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* 字段限定：与 search.js / corpus.mjs 同一张表 */
const FIELD_MAP = {
  '标题': 'title', '题': 'title', 'title': 'title',
  '正文': 'text', '全文': 'text', '内容': 'text', 'text': 'text',
  '机关': 'issuer', '发布机关': 'issuer', 'issuer': 'issuer',
  '标签': 'tags', 'tag': 'tags',
  '摘要': 'summary', 'summary': 'summary'
};

/**
 * 查询解析：短语（引号）、排除（-词）、字段限定（title:民主）。
 * 返回结构与 corpus.mjs 的 parseQuery 完全一致（/api/search 会原样回传）。
 */
function parseQuery(query) {
  const q = String(query || '').trim();
  const res = { raw: q, terms: [], phrases: [], exclude: [], fields: [], scope: 'all', empty: !q };
  if (!q) return res;

  const phraseRe = /"([^"]+)"|“([^”]+)”/g;
  let m;
  while ((m = phraseRe.exec(q)) !== null) {
    const p = (m[1] || m[2] || '').trim();
    if (p) res.phrases.push(p.toLowerCase());
  }
  const rest = q.replace(/"([^"]+)"|“([^”]+)”/g, ' ');

  const parts = rest.split(/[\s,，、;；]+/);
  for (const part of parts) {
    let t = part;
    if (!t) continue;
    let neg = false;
    if (t.charAt(0) === '-' && t.length > 1) { neg = true; t = t.slice(1); }
    const fm = /^([一-龥A-Za-z]+)[:：](.+)$/.exec(t);
    if (fm && FIELD_MAP[fm[1].toLowerCase()]) {
      res.fields.push(FIELD_MAP[fm[1].toLowerCase()]);
      t = fm[2];
    }
    t = t.toLowerCase();
    if (!t) continue;
    if (neg) res.exclude.push(t); else res.terms.push(t);
  }
  if (res.fields.length) res.scope = res.fields[0];
  return res;
}

function fieldOf(doc, field) {
  switch (field) {
    case 'title': return doc.t;
    case 'text': return doc.b;
    case 'issuer': return doc.i;
    case 'tags': return doc.g;
    case 'summary': return doc.s;
    default: return null;
  }
}

/** 字段加权评分：标题 ×12、标签 ×6、摘要 ×4、章节名 ×3、机关 ×4、正文（上限 30） */
function scoreDoc(doc, q) {
  let total = 0;
  const terms = q.terms.concat(q.phrases);
  if (!terms.length) return 1;

  for (const t of terms) {
    let s = 0;
    if (q.scope !== 'all') {
      const hay = fieldOf(doc, q.scope);
      if (!hay || hay.indexOf(t) === -1) return 0;
      s += countOf(hay, t) * (q.scope === 'title' ? 30 : 12);
      total += s;
      continue;
    }
    s += countOf(doc.t, t) * 12;
    s += countOf(doc.g, t) * 6;
    s += countOf(doc.s, t) * 4;
    s += countOf(doc.n, t) * 3;
    s += countOf(doc.i, t) * 4;
    s += Math.min(countOf(doc.b, t), 30);
    total += s;
  }
  /* 短语加权 */
  for (const p of q.phrases) {
    if (doc.t.indexOf(p) !== -1) total += 40;
    if (doc.b.indexOf(p) !== -1) total += 12;
  }
  /* 标题完整匹配额外加分 */
  const bare = doc.t.replace(/[（）()《》\s]/g, '');
  for (const k of q.terms) {
    if (bare.indexOf(k) !== -1) total += 18;
  }
  return total;
}

function isExcluded(doc, q) {
  for (const x of q.exclude) {
    if (doc.b.indexOf(x) !== -1 || doc.t.indexOf(x) !== -1) return true;
  }
  return false;
}

/**
 * 片段摘要：从命中位置前后取一段，尽量从句读处开始。
 * width 默认 132 —— 与服务端 corpus.mjs 一致（静态版用 160，那边另算）。
 */
function makeSnippet(doc, q, width) {
  width = width || 132;
  const terms = q.terms.concat(q.phrases);
  if (!terms.length) {
    const t = (doc.summary || doc.text || '').replace(/\s+/g, ' ').trim();
    return t.slice(0, width) + (t.length > width ? '…' : '');
  }
  const text = (doc.text || '').replace(/\s+/g, ' ');
  const lower = text.toLowerCase();
  /* 正文起点：法规正文第一条之前是「标题 + 说明段 + 目录」，
     在那里截到的上下文全是「（1996年3月17日第八届全国人民代表大会……通过）」这类套话，
     所以优先从第一条之后开始找命中位置。 */
  const bm = text.match(/第[一二三四五六七八九十百零〇\d]+条/);
  const bodyAt = bm ? bm.index : 0;
  let best = -1;
  for (const t of terms) {
    const p = lower.indexOf(t, bodyAt);
    if (p !== -1 && (best === -1 || p < best)) best = p;
  }
  if (best === -1) {
    for (const t of terms) {
      const p = lower.indexOf(t);
      if (p !== -1 && (best === -1 || p < best)) best = p;
    }
  }
  if (best === -1) {
    const s = (doc.summary || '').replace(/\s+/g, ' ').trim();
    return s.slice(0, width) + (s.length > width ? '…' : '');
  }
  const from = Math.max(0, best - 42);
  const to = Math.min(text.length, best + width);
  let seg = text.slice(from, to);
  if (from > 0) {
    const mm = seg.match(/^[^\u3002\uff1b\uff01\uff1f\uff1a\n]{0,26}/);
    if (mm) seg = seg.slice(mm[0].length);
  }
  return (from > 0 ? '…' : '') + seg.trim() + (to < text.length ? '…' : '');
}

/** 高亮：命中词包 <mark>，其余先转义 */
function highlight(text, terms) {
  if (!text) return '';
  const uniq = [];
  const seen = new Set();
  for (const raw of terms || []) {
    const t = String(raw || '').trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(t);
  }
  if (!uniq.length) return escapeHtml(text);
  let re;
  try {
    re = new RegExp(uniq.map(escRe).join('|'), 'gi');
  } catch (e) {
    return escapeHtml(text);
  }
  let out = '';
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    out += escapeHtml(text.slice(last, m.index)) + '<mark>' + escapeHtml(m[0]) + '</mark>';
    last = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++;
  }
  out += escapeHtml(text.slice(last));
  return out;
}

/* ==========================================================================
   2. 正文块 / 目录 / 纯文本
   --------------------------------------------------------------------------
   与 corpus.mjs 的 buildBlocks / buildToc / plainText 同源 ——
   这是浏览器端与微信小程序共用的渲染契约，块类型只有 6 种。
   ========================================================================== */

function buildBlocks(sections) {
  const blocks = [];
  for (const sec of sections || []) {
    const name = (sec.name || '').trim();
    if (name) {
      blocks.push({ type: sec.level === 2 ? 'h3' : 'h2', text: name });
    }
    const text = sec.text || '';
    for (const rawLine of text.split(/\n+/)) {
      const t = rawLine.trim();
      if (!t) continue;
      /* 人民网源页面「章节名」与正文首行重复，跳过 */
      if (name && t.replace(/\s/g, '') === name.replace(/\s/g, '')) continue;
      const cm = /^(第[一二三四五六七八九十百零〇两]+条)(.*)$/.exec(t);
      if (cm) {
        blocks.push({ type: 'clause', no: cm[1], text: cm[2].trim() });
        continue;
      }
      const im = /^([（(][一二三四五六七八九十百零〇两\d]+[)）])\s*(.*)$/.exec(t);
      if (im) {
        blocks.push({ type: 'item', no: im[1], text: im[2] });
        continue;
      }
      if (/^[（(][\s\S]{16,}[）)][。；;]?$/.test(t)) {
        blocks.push({ type: 'note', text: t });
        continue;
      }
      blocks.push({ type: 'p', text: t });
    }
  }
  return blocks;
}

function plainText(sections) {
  const out = [];
  for (const sec of sections || []) {
    if (sec.name) out.push(sec.name);
    if (sec.text) out.push(sec.text);
  }
  return out.join('\n\n');
}

/** 两级目录：level 1 是章/编，level 2 是节，挂在上一章的 children 下 */
function buildToc(sections) {
  const toc = [];
  for (const sec of sections || []) {
    const name = (sec.name || '').trim();
    if (!name) continue;
    const item = { name, level: sec.level === 2 ? 2 : 1, count: (sec.text || '').length };
    if (item.level === 1) {
      toc.push(item);
    } else if (toc.length) {
      toc[toc.length - 1].children = toc[toc.length - 1].children || [];
      toc[toc.length - 1].children.push(item);
    } else {
      toc.push(item);
    }
  }
  return toc;
}

/* ==========================================================================
   3. 语料加载（env.ASSETS）
   ========================================================================== */

const CORPUS_META_PATH = '/corpus/meta.json.gz';
const CORPUS_BODIES_PATH = '/corpus/bodies.json.gz';

/* 命中结果缓存条数（同一查询重复提交时零扫描） */
const RESULT_CACHE_MAX = 40;
/* 单篇正文 LRU 的字数预算（约 800 万字 ≈ 16MB） */
const BODY_CACHE_MAX_CHARS = 8 * 1024 * 1024;

/**
 * 模块级状态（同一 isolate 内跨请求复用）
 *   meta        解析后的元信息（门类/体系/2,706 条记录）
 *   docs        检索用文档数组，顺序 = meta.records 顺序（**命中排序的基准顺序**）
 *   bodiesGz    bodies.json.gz 的压缩字节，常驻 11.4MB，不解压
 *   bodyCache   单篇正文 LRU（id → sections）
 *   resultCache 命中结果 LRU（查询串 → 结果）
 */
const STATE = {
  meta: null,
  docs: null,
  byId: null,
  indexById: null,
  metaPromise: null,
  bodiesGz: null,
  bodiesPromise: null,
  bodyCache: new Map(),
  bodyCacheChars: 0,
  resultCache: new Map()
};

function isGzip(bytes) {
  return bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/** 通过 ASSETS binding 读一个静态资源；缺失/失败一律抛 CorpusError（→ 503） */
async function fetchAsset(env, requestUrl, path) {
  if (!env || !env.ASSETS || typeof env.ASSETS.fetch !== 'function') {
    throw new CorpusError('corpus_unavailable',
      '缺少 ASSETS binding：无法读取语料 ' + path + '（Pages 部署需要在 _headers 或控制台绑定静态资源）');
  }
  let res;
  try {
    const target = new URL(path, requestUrl || 'https://falv.pages.dev/');
    res = await env.ASSETS.fetch(new Request(target.href, { method: 'GET' }));
  } catch (e) {
    throw new CorpusError('corpus_unavailable',
      '读取语料 ' + path + ' 失败：' + (e && e.message ? e.message : String(e)));
  }
  if (!res || !res.ok) {
    throw new CorpusError('corpus_unavailable',
      '语料文件不可用：' + path + '（HTTP ' + (res ? res.status : '无响应') + '）');
  }
  return new Uint8Array(await res.arrayBuffer());
}

/** 整体解压（只用于 2.4MB 的元信息；正文走流式解压） */
async function gunzipAll(bytes) {
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  const pump = (async () => { await writer.write(bytes); await writer.close(); })();
  const reader = ds.readable.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) { chunks.push(value); total += value.length; }
    }
  } finally {
    await pump.catch(() => {});
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

async function decodeText(bytes) {
  const raw = isGzip(bytes) ? await gunzipAll(bytes) : bytes;
  return new TextDecoder('utf-8').decode(raw);
}

/**
 * 字节流：gzip 走 DecompressionStream（流式，峰值低）；
 * 未压缩则按 256KB 切片吐出去（兜底路径）。
 */
async function* rawChunks(bytes) {
  if (!isGzip(bytes)) {
    const step = 256 * 1024;
    for (let off = 0; off < bytes.length; off += step) {
      yield bytes.subarray(off, Math.min(off + step, bytes.length));
    }
    return;
  }
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  const pump = (async () => { await writer.write(bytes); await writer.close(); })();
  const reader = ds.readable.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) yield value;
    }
  } finally {
    try { await reader.cancel(); } catch (e) { /* 已结束则忽略 */ }
    await pump.catch(() => {});
  }
}

async function* textChunks(bytes) {
  const dec = new TextDecoder('utf-8');
  for await (const chunk of rawChunks(bytes)) {
    const t = dec.decode(chunk, { stream: true });
    if (t) yield t;
  }
  const tail = dec.decode();
  if (tail) yield tail;
}

/**
 * 顶层 JSON 数组的流式切分器。
 *
 * 输入是解压后的 JSON 文本流（会被切成 64KB 左右的块），
 * 输出是「一个元素一个元素」的原始 JSON 文本。
 * 关键点：
 *   - 字符串内部用 indexOf 跳过（不做逐字符扫描），否则 41MB 正文会慢到不可用；
 *   - 未闭合的字符串/元素跨块时保留缓冲区继续拼；
 *   - 缓冲区及时收缩，峰值只保留「当前元素」。
 */
class JsonArraySplitter {
  constructor() {
    this.buf = '';
    this.pos = 0;        // 扫描游标
    this.depth = 0;      // 0=数组前 1=数组内 2=元素对象内
    this.inString = false;
    this.elemStart = -1; // 当前元素在 buf 中的起点
    this.ended = false;
  }

  /** 追加一段文本，返回本次能够完整取出的元素（原始 JSON 文本） */
  push(text) {
    if (text) this.buf += text;
    const out = [];
    const buf = this.buf;
    let pos = this.pos;
    let depth = this.depth;
    let inString = this.inString;
    let elemStart = this.elemStart;

    while (pos < buf.length) {
      if (inString) {
        const q = buf.indexOf('"', pos);
        if (q === -1) break;                 // 字符串未闭合，等下一块
        /* 反斜杠奇数 → 这是被转义的引号，字符串还没结束 */
        let bs = 0;
        let k = q - 1;
        while (k >= pos && buf.charCodeAt(k) === 92) { bs++; k--; }
        if (bs & 1) { pos = q + 1; continue; }
        inString = false;
        pos = q + 1;
        continue;
      }
      const ch = buf.charCodeAt(pos);
      if (ch === 34) {                        // "
        inString = true;
        pos++;
        continue;
      }
      if (ch === 123) {                       // {
        if (depth === 1) elemStart = pos;
        depth++;
        pos++;
        continue;
      }
      if (ch === 125) {                       // }
        depth--;
        pos++;
        if (depth === 1) {
          out.push(buf.slice(elemStart, pos));
          elemStart = -1;
        }
        continue;
      }
      if (ch === 91) {                        // [
        depth++;
        pos++;
        continue;
      }
      if (ch === 93) {                        // ]
        depth--;
        pos++;
        if (depth === 0) { this.ended = true; break; }
        continue;
      }
      pos++;
    }

    /* 收缩缓冲区：元素进行中就保留整个元素，否则只保留未处理的部分 */
    const keepFrom = depth >= 2 ? elemStart : pos;
    if (keepFrom > 0) {
      this.buf = buf.slice(keepFrom);
      pos -= keepFrom;
      if (elemStart >= 0) elemStart -= keepFrom;
    }
    this.pos = pos;
    this.depth = depth;
    this.inString = inString;
    this.elemStart = elemStart;
    return out;
  }
}

/** 快速取元素 id（语料元素形如 {"id":"r0034","sections":[…]}），避免为找 id 而整段 parse */
function quickId(elementText) {
  const m = /^\s*\{\s*"id"\s*:\s*"([^"\\]*)"/.exec(elementText);
  return m ? m[1] : null;
}

/**
 * 流式扫描正文语料。
 * @param {Uint8Array} bytes bodies.json.gz 的字节
 * @param {(raw:string, id:string)=>(boolean|Promise<boolean>)} onElement
 *        回调收到**元素的原始 JSON 文本**与 id，自行决定要不要 JSON.parse
 *        （预筛见 runSearch：绝大多数元素不必解析，这笔对象图是全库扫描
 *        里最大的一笔内存开销）
 * @param {{wantIds:Set<string>|null}} opts 只处理指定 id（null = 全部）
 */
async function scanBodies(bytes, onElement, opts) {
  const wantIds = (opts && opts.wantIds) || null;
  const splitter = new JsonArraySplitter();
  let seen = 0;
  for await (const chunk of textChunks(bytes)) {
    const elements = splitter.push(chunk);
    for (const el of elements) {
      seen++;
      let id = quickId(el);
      if (id === null) {
        /* 语料格式不是预期的 {"id":…} 开头：老实 parse 一次拿 id */
        id = JSON.parse(el).id || '';
      }
      if (wantIds && !wantIds.has(id)) continue;
      const stop = await onElement(el, id);
      if (stop) return seen;
    }
    if (splitter.ended) break;
  }
  return seen;
}

/** 加载并缓存元信息（小语料，常驻） */
async function loadMeta(env, requestUrl) {
  if (STATE.meta) return STATE.meta;
  if (!STATE.metaPromise) {
    STATE.metaPromise = (async () => {
      const bytes = await fetchAsset(env, requestUrl, CORPUS_META_PATH);
      let meta;
      try {
        meta = JSON.parse(await decodeText(bytes));
      } catch (e) {
        throw new CorpusError('corpus_unavailable',
          '元信息解析失败：' + (e && e.message ? e.message : String(e)));
      }
      if (!meta || !meta.records || !meta.records.length) {
        throw new CorpusError('corpus_unavailable', '元信息为空：' + CORPUS_META_PATH);
      }

      /* 门类 → 体系分组：记录里没有 group 字段，需由 categories 回填 */
      const catGroup = new Map();
      const catMeta = new Map();
      for (const c of meta.categories || []) {
        catGroup.set(c.id, c.group || '');
        catMeta.set(c.id, c);
      }

      const docs = [];
      const byId = new Map();
      const indexById = new Map();
      for (const rec of meta.records) {
        const cm = catMeta.get(rec.cat) || {};
        const d = {
          rec,
          id: rec.id,
          title: rec.title || '',
          cat: rec.cat,
          catName: rec.catName || '',
          group: catGroup.get(rec.cat) || '',
          catDesc: cm.desc || '',
          catTone: cm.tone || '',
          catColor: cm.color || '',
          year: rec.year || 0,
          issuer: rec.issuer || '',
          summary: rec.summary || '',
          /* 检索用派生字段（与 corpus.mjs 的 t/s/g/i 同口径） */
          t: (rec.title || '').toLowerCase(),
          s: (rec.summary || '').toLowerCase(),
          g: (rec.tags || []).join(' ').toLowerCase(),
          i: (rec.issuer || '').toLowerCase(),
          n: '',   // 章节名（扫描正文时才知道）
          b: '',   // 正文（扫描正文时才知道）
          text: ''
        };
        indexById.set(d.id, docs.length);
        docs.push(d);
        byId.set(d.id, d);
      }

      STATE.meta = meta;
      STATE.docs = docs;
      STATE.byId = byId;
      STATE.indexById = indexById;
      return meta;
    })().catch((err) => {
      STATE.metaPromise = null;   // 失败后允许重试
      throw err;
    });
  }
  await STATE.metaPromise;
  return STATE.meta;
}

/** 取 bodies.json.gz 的压缩字节（常驻，不解压） */
async function loadBodiesBytes(env, requestUrl) {
  if (STATE.bodiesGz) return STATE.bodiesGz;
  if (!STATE.bodiesPromise) {
    STATE.bodiesPromise = (async () => {
      const bytes = await fetchAsset(env, requestUrl, CORPUS_BODIES_PATH);
      STATE.bodiesGz = bytes;
      return bytes;
    })().catch((err) => {
      STATE.bodiesPromise = null;
      throw err;
    });
  }
  return STATE.bodiesPromise;
}

/* ---------------- 正文 LRU ---------------- */

function bodyCacheGet(id) {
  if (!STATE.bodyCache.has(id)) return null;
  const v = STATE.bodyCache.get(id);
  STATE.bodyCache.delete(id);
  STATE.bodyCache.set(id, v);       // 重新插到队尾 = 最近使用
  return v;
}

function bodyCachePut(id, sections) {
  const chars = sections.reduce((a, s) => a + (s.text ? s.text.length : 0), 0);
  if (STATE.bodyCache.has(id)) {
    STATE.bodyCacheChars -= STATE.bodyCache.get(id).chars;
    STATE.bodyCache.delete(id);
  }
  STATE.bodyCache.set(id, { sections, chars });
  STATE.bodyCacheChars += chars;
  while (STATE.bodyCacheChars > BODY_CACHE_MAX_CHARS && STATE.bodyCache.size > 1) {
    const oldest = STATE.bodyCache.keys().next().value;
    STATE.bodyCacheChars -= STATE.bodyCache.get(oldest).chars;
    STATE.bodyCache.delete(oldest);
  }
}

/**
 * 取一篇正文（走 LRU；未命中则流式扫一次语料）。
 * 只解析需要的元素：元素 id 用正则快速取出，不命中就直接跳过，
 * 不做 JSON.parse —— 这是 /api/doc 也能只花几百毫秒的关键。
 */
async function findBody(env, requestUrl, ids) {
  const want = new Set(ids.filter(Boolean));
  const out = new Map();
  for (const id of want) {
    const cached = bodyCacheGet(id);
    if (cached) out.set(id, cached.sections);
  }
  const missing = new Set([...want].filter((id) => !out.has(id)));
  if (!missing.size) return out;

  const bytes = await loadBodiesBytes(env, requestUrl);
  await scanBodies(bytes, (raw, id) => {
    if (!missing.has(id)) return false;
    const body = JSON.parse(raw);
    out.set(id, body.sections || []);
    bodyCachePut(id, body.sections || []);
    missing.delete(id);
    return missing.size === 0;      // 全部找到就停
  }, { wantIds: missing });

  for (const id of missing) out.delete(id);
  return out;
}

/* ==========================================================================
   4. 检索
   ========================================================================== */

/**
 * 预筛：判断「这个正文元素要不要 JSON.parse」。
 *
 * 全库扫描里最大的一笔内存开销是 JSON.parse 出来的对象图（2,706 篇合计
 * 160MB+ 的瞬时垃圾）。但绝大多数元素根本不可能命中，可以在 parse 之前
 * 就把它们丢掉：
 *   - 元信息（标题/标签/摘要/机关）里没有检索词 → 不可能靠元信息得分；
 *   - 元素的**原始 JSON 文本**里没有检索词 → 正文章节名与正文里也不会有。
 * 两者都不成立 → 这篇必然 score=0，可以整篇跳过，连 parse 都不用做。
 *
 * 前提（否则「原文里找不到」推不出「解析后也找不到」）：
 *   检索词里不能有 JSON 会转义的字符 —— 控制字符、"、\ 会被写成 \n / \" / \\
 *   （原文里是反斜杠形式，字面匹配不到）；也不能有 ASCII 字母
 *   （参考实现会把正文转小写后匹配，原文里的大写形式字面匹配不到）。
 *   有这类词时整个查询放弃预筛，退回「篇篇都 parse」，结果依然正确。
 */
function prefilterSafeFor(terms) {
  for (const t of terms) {
    if (!t) return false;
    if (/[\u0000-\u001f"\\A-Za-z]/.test(t)) return false;
  }
  return true;
}

/** 元信息里是否可能命中（字段限定时只看被限定的那一个字段） */
function metaHasTerm(d, q, terms) {
  if (q.scope === 'all') {
    for (const t of terms) {
      if (d.t.indexOf(t) !== -1 || d.g.indexOf(t) !== -1 ||
          d.s.indexOf(t) !== -1 || d.i.indexOf(t) !== -1) return true;
    }
    return false;
  }
  const field = fieldOf(d, q.scope);
  if (!field) return false;
  for (const t of terms) {
    if (field.indexOf(t) !== -1) return true;
  }
  return false;
}

/** 元素的原始 JSON 文本里是否出现检索词 */
function rawHasTerm(raw, terms) {
  for (const t of terms) {
    if (raw.indexOf(t) !== -1) return true;
  }
  return false;
}

/**
 * /api/search 的主流程。
 *
 * 命中顺序的关键：参考实现（corpus.mjs）遍历的是 meta.records 顺序，
 * 排序又是稳定排序 —— 同分时按记录顺序决定先后。
 * 这里扫描正文得到的顺序是 bodies 数组顺序（分片顺序，与记录顺序不同），
 * 因此**必须**用 id 把命中结果收进 Map，最后再按 meta.records 顺序还原，
 * 才能与 Node 服务端给出完全相同的 hits 序列。
 */
async function runSearch(env, requestUrl, params) {
  await loadMeta(env, requestUrl);
  const t0 = Date.now();
  const q = parseQuery(params.q || '');
  const cats = params.cats && params.cats.length ? new Set(params.cats) : null;
  const group = params.group && params.group !== 'all' ? params.group : null;
  const terms = q.terms.concat(q.phrases);

  const cacheKey = JSON.stringify([q.raw, params.cats || null, group || null,
    params.sort || 'relevance', params.page || 1, params.pageSize || 20]);
  const cached = STATE.resultCache.get(cacheKey);
  if (cached) {
    STATE.resultCache.delete(cacheKey);
    STATE.resultCache.set(cacheKey, cached);
    return cached;
  }

  /* 需要正文吗？空查询 / 只有元信息可判的查询不必碰 41MB 正文 */
  const needBodies = terms.length > 0 || q.exclude.length > 0;
  const scored = new Map();   // id → {score, snippetHtml}
  /* 预筛是否可用（见 prefilterSafeFor 的说明） */
  const canPrefilter = prefilterSafeFor(terms);

  if (needBodies) {
    const bytes = await loadBodiesBytes(env, requestUrl);
    await scanBodies(bytes, (raw, id) => {
      const idx = STATE.indexById.get(id);
      if (idx === undefined) return false;         // 正文里多出来的条目直接跳过
      const d = STATE.docs[idx];
      if (cats && !cats.has(d.cat)) return false;
      if (group && d.group !== group) return false;
      /* 预筛：不可能命中的元素不做 JSON.parse */
      if (canPrefilter && !metaHasTerm(d, q, terms) && !rawHasTerm(raw, terms)) return false;

      const body = JSON.parse(raw);
      /* 正文压平成一段可搜索文本，并记录章节名 */
      let text = '';
      const secNames = [];
      for (const s of body.sections || []) {
        if (s.text) text += s.text + '\n';
        if (s.name) secNames.push(s.name);
      }
      const doc = {
        t: d.t, s: d.s, g: d.g, i: d.i,
        n: secNames.join(' ').toLowerCase(),
        /* 中文语料几乎不含大写字母，没有时复用原串，避免复制一份小写副本 */
        b: /[A-Z]/.test(text) ? text.toLowerCase() : text,
        text,
        summary: d.summary,
        year: d.year,
        title: d.title
      };
      if (q.exclude.length && isExcluded(doc, q)) return false;
      const sc = q.empty ? 1 : scoreDoc(doc, q);
      if (sc <= 0) return false;
      scored.set(d.id, { score: sc, snippetHtml: highlight(makeSnippet(doc, q), terms) });
      return false;
    }, {});
  } else {
    /* 空查询：全部条目都算命中，片段取摘要（不碰正文） */
    for (const d of STATE.docs) {
      if (cats && !cats.has(d.cat)) continue;
      if (group && d.group !== group) continue;
      const doc = { t: d.t, s: d.s, g: d.g, i: d.i, n: '', b: '', text: '', summary: d.summary };
      scored.set(d.id, { score: 1, snippetHtml: highlight(makeSnippet(doc, q), terms) });
    }
  }

  /* 按 meta.records 顺序还原命中列表（与参考实现的遍历顺序一致） */
  const hits = [];
  for (const d of STATE.docs) {
    const sc = scored.get(d.id);
    if (!sc) continue;
    hits.push({ doc: d, score: sc.score, snippetHtml: sc.snippetHtml });
  }

  const sort = params.sort || 'relevance';
  if (sort === 'new') {
    hits.sort((a, b) => (b.doc.year || 0) - (a.doc.year || 0) || b.score - a.score);
  } else if (sort === 'old') {
    hits.sort((a, b) => (a.doc.year || 0) - (b.doc.year || 0) || b.score - a.score);
  } else if (sort === 'title') {
    hits.sort((a, b) => a.doc.title.localeCompare(b.doc.title, 'zh-Hans-CN'));
  } else {
    hits.sort((a, b) => b.score - a.score || (b.doc.year || 0) - (a.doc.year || 0));
  }

  const size = Math.min(Math.max(1, params.pageSize || 20), 100);
  const total = hits.length;
  const pages = Math.max(1, Math.ceil(total / size));
  let page = Math.max(1, params.page || 1);
  if (page > pages) page = pages;
  const slice = hits.slice((page - 1) * size, page * size);

  const result = {
    query: q,
    hits: slice.map((h) => ({
      id: h.doc.id,
      title: h.doc.title,
      cat: h.doc.cat,
      catName: h.doc.catName,
      group: h.doc.group,
      issuer: h.doc.issuer,
      published: h.doc.rec.published || '',
      year: h.doc.year,
      chars: h.doc.rec.chars || 0,
      tags: h.doc.rec.tags || [],
      summary: h.doc.summary,
      score: h.score,
      snippetHtml: h.snippetHtml
    })),
    total,
    pages,
    page,
    took: Date.now() - t0
  };

  STATE.resultCache.set(cacheKey, result);
  while (STATE.resultCache.size > RESULT_CACHE_MAX) {
    STATE.resultCache.delete(STATE.resultCache.keys().next().value);
  }
  return result;
}

/** 标题联想（只读元信息，不碰正文） */
function runSuggest(qRaw, limit) {
  limit = limit || 8;
  const q = String(qRaw || '').trim().toLowerCase();
  if (!q) return [];
  const out = [];
  for (const d of STATE.docs) {
    if (d.t.indexOf(q) !== -1 || d.g.indexOf(q) !== -1) out.push(d);
    if (out.length >= limit * 3) break;
  }
  out.sort((a, b) => {
    const ai = a.t.indexOf(q);
    const bi = b.t.indexOf(q);
    if (ai !== bi) return ai - bi;
    return (b.year || 0) - (a.year || 0);
  });
  return out.slice(0, limit).map((d) => ({
    id: d.id, title: d.title, catName: d.catName, cat: d.cat
  }));
}

/** 门类统计（只统计有法规的门类，本机自建类 0 条不出现） */
function categoryStats() {
  const m = {};
  for (const d of STATE.docs) {
    if (!m[d.cat]) {
      m[d.cat] = {
        cat: d.cat, name: d.catName, count: 0, chars: 0,
        level: d.rec.level, group: d.group, tone: '', desc: '', color: ''
      };
    }
    m[d.cat].count++;
    m[d.cat].chars += d.rec.chars || 0;
  }
  for (const c of STATE.meta.categories || []) {
    if (m[c.id]) {
      m[c.id].desc = c.desc || '';
      m[c.id].tone = c.tone || '';
      m[c.id].color = c.color || '';
    }
  }
  return m;
}

/**
 * 立法时间轴：按公布年份分组（published 优先，退回 revised / adopted）。
 * 没有发文日期的条目（党务知识问答等 146 条）自然落到 year=0 被排除。
 */
function runTimeline() {
  const m = {};
  for (const d of STATE.docs) {
    const s = d.rec.published || d.rec.revised || d.rec.adopted || '';
    const y = parseInt(String(s).slice(0, 4), 10) || d.year || 0;
    if (!y) continue;
    if (!m[y]) m[y] = { year: y, count: 0, items: [] };
    m[y].count++;
    m[y].items.push({
      id: d.id, title: d.title, cat: d.cat, catName: d.catName,
      group: d.group, published: s, issuer: d.issuer
    });
  }
  const years = Object.keys(m).map(Number).sort((a, b) => b - a);
  return years.map((y) => {
    const g = m[y];
    g.items.sort((a, b) => (a.catName || '').localeCompare(b.catName || '', 'zh-Hans-CN'));
    return g;
  });
}

/** 单篇详情（与 corpus.mjs 的 docDetail 同结构、同字段顺序） */
function buildDocDetail(d, sections, hlTerms) {
  const rec = d.rec;
  const terms = hlTerms || [];
  return {
    id: d.id,
    title: d.title,
    cat: d.cat,
    catName: d.catName,
    group: d.group,
    level: rec.level,
    issuer: d.issuer,
    sub: rec.sub || '',
    adopted: rec.adopted || '',
    published: rec.published || '',
    revised: rec.revised || '',
    effective: rec.effective || '',
    year: d.year,
    summary: d.summary,
    summaryHtml: highlight(d.summary, terms),
    tags: rec.tags || [],
    url: rec.url || '',
    source: rec.source || '',
    effect: rec.effect || '',
    flxz: rec.flxz || '',
    chars: rec.chars || 0,
    version: rec.version || '',
    lsyg: rec.lsyg || [],
    toc: buildToc(sections),
    blocks: buildBlocks(sections),
    plain: plainText(sections)
  };
}

/* ==========================================================================
   5. 导出
   ========================================================================== */

function csvCell(v) {
  const s = String(v === null || v === undefined ? '' : v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/** 日期格式化：与网页版 exporter.js 的 fmtDate 同规则 */
function fmtDate(iso) {
  if (!iso) return '';
  const p = String(iso).split('-');
  if (p.length === 3) return p[0] + '年' + parseInt(p[1], 10) + '月' + parseInt(p[2], 10) + '日';
  if (p.length === 2) return p[0] + '年' + parseInt(p[1], 10) + '月';
  if (p.length === 1 && /^\d{4}$/.test(p[0])) return p[0] + '年';
  return iso;
}

/**
 * 导出：与 corpus.mjs 的 exportDocs 同格式、同分隔符、同 BOM。
 * 正文从语料流里按需取（只取导出的那几篇）。
 */
function buildExport(docs, format) {
  if (!docs.length) return { filename: 'empty.txt', mime: 'text/plain;charset=utf-8', content: '' };

  const stamp = new Date().toISOString().slice(0, 10);

  if (format === 'txt') {
    let out = '';
    for (const d of docs) {
      out += d.title + '\n';
      const meta = [];
      if (d.issuer) meta.push('制定机关：' + d.issuer);
      if (d.rec.published) meta.push('公布日期：' + d.rec.published);
      if (d.rec.effective) meta.push('施行日期：' + d.rec.effective);
      if (d.rec.effect) meta.push('时效性：' + d.rec.effect);
      if (meta.length) out += meta.join('  ') + '\n';
      out += plainText(d.sections) + '\n\n';
    }
    return { filename: `法规汇编_${stamp}.txt`, mime: 'text/plain;charset=utf-8', content: out };
  }

  if (format === 'md') {
    let out = '';
    for (const d of docs) {
      out += '# ' + d.title + '\n\n';
      const meta = [];
      if (d.issuer) meta.push('制定机关：' + d.issuer);
      if (d.rec.published) meta.push('公布日期：' + d.rec.published);
      if (d.rec.effective) meta.push('施行日期：' + d.rec.effective);
      if (d.rec.effect) meta.push('时效性：' + d.rec.effect);
      if (meta.length) out += '> ' + meta.join('　') + '\n\n';
      for (const b of buildBlocks(d.sections)) {
        if (b.type === 'h2') out += '## ' + b.text + '\n\n';
        else if (b.type === 'h3') out += '### ' + b.text + '\n\n';
        else if (b.type === 'clause') out += `**${b.no}** ${b.text}\n\n`;
        else if (b.type === 'item') out += `**${b.no}** ${b.text}\n\n`;
        else if (b.type === 'note') out += '*' + b.text + '*\n\n';
        else out += b.text + '\n\n';
      }
    }
    return { filename: `法规汇编_${stamp}.md`, mime: 'text/markdown;charset=utf-8', content: out };
  }

  if (format === 'json') {
    const arr = docs.map((d) => ({
      id: d.id, title: d.title, cat: d.cat, catName: d.catName,
      issuer: d.issuer, published: d.rec.published || '',
      effective: d.rec.effective || '', effect: d.rec.effect || '',
      url: d.rec.url || '', source: d.rec.source || '',
      sections: d.sections.map((s) => ({ name: s.name || '', level: s.level || 0, text: s.text || '' }))
    }));
    return {
      filename: `法规汇编_${stamp}.json`,
      mime: 'application/json;charset=utf-8',
      content: JSON.stringify(arr, null, 2)
    };
  }

  if (format === 'csv') {
    /* CSV 是「目录」导出：元信息表，不含正文。16 列表头与网页版 exporter.js 对齐。 */
    const head = ['标题', '版本', '分类', '门类细分', '效力级别', '时效性', '制定发布机关',
      '公布日期', '通过日期', '最后修订', '施行日期', '主题标签', '正文字数', '数据来源', '原文链接', '摘要'];
    const rows = [head.map(csvCell).join(',')];
    for (const d of docs) {
      rows.push([
        d.title, d.rec.version || '', d.catName || d.cat, d.rec.sub || '',
        d.rec.flxz || '', d.rec.effect || '', d.issuer || '',
        fmtDate(d.rec.published), fmtDate(d.rec.adopted), fmtDate(d.rec.revised), fmtDate(d.rec.effective),
        (d.rec.tags || []).join('|'),
        d.rec.chars || 0, d.rec.source || '', d.rec.url || '',
        (d.summary || '').replace(/\s+/g, ' ')
      ].map(csvCell).join(','));
    }
    return {
      filename: `法规目录_${stamp}.csv`,
      mime: 'text/csv;charset=utf-8',
      content: '﻿' + rows.join('\r\n')
    };
  }

  if (format === 'html') {
    let out = '<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n<title>法规汇编</title>\n<style>body{font-family:"Songti SC","SimSun",serif;max-width:820px;margin:40px auto;line-height:1.9;padding:0 20px}h1{text-align:center;font-size:22px}h2{font-size:18px;margin-top:28px}h3{font-size:16px;margin-top:20px}.meta{color:#666;font-size:13px;margin-bottom:24px}.clause .no{font-weight:700}.note{color:#666;font-size:13px}</style>\n</head>\n<body>\n';
    for (const d of docs) {
      out += `<h1>${escapeHtml(d.title)}</h1>\n`;
      out += `<p class="meta">${escapeHtml(d.catName)}　${escapeHtml(d.issuer || '')}　${escapeHtml(d.rec.published || '')}</p>\n`;
      for (const b of buildBlocks(d.sections)) {
        if (b.type === 'h2') out += `<h2>${escapeHtml(b.text)}</h2>\n`;
        else if (b.type === 'h3') out += `<h3>${escapeHtml(b.text)}</h3>\n`;
        else if (b.type === 'clause') out += `<p class="clause"><span class="no">${escapeHtml(b.no)}</span> ${escapeHtml(b.text)}</p>\n`;
        else if (b.type === 'item') out += `<p><strong>${escapeHtml(b.no)}</strong> ${escapeHtml(b.text)}</p>\n`;
        else if (b.type === 'note') out += `<p class="note">${escapeHtml(b.text)}</p>\n`;
        else out += `<p>${escapeHtml(b.text)}</p>\n`;
      }
      out += '<hr>\n';
    }
    out += '</body>\n</html>\n';
    return { filename: `法规汇编_${stamp}.html`, mime: 'text/html;charset=utf-8', content: out };
  }

  return { filename: 'unsupported.txt', mime: 'text/plain;charset=utf-8', content: '' };
}

/* ==========================================================================
   6. 路由
   ========================================================================== */

function jsonResponse(code, obj) {
  return new Response(JSON.stringify(obj), {
    status: code,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function textResponse(code, text, mime, filename) {
  const headers = {
    'content-type': mime || 'text/plain; charset=utf-8',
    'cache-control': 'no-store'
  };
  if (filename) {
    headers['content-disposition'] =
      "attachment; filename*=UTF-8''" + encodeURIComponent(filename);
  }
  return new Response(text, { status: code, headers });
}

/**
 * Cloudflare Pages Functions 入口。
 * 文件名 functions/api/[[path]].js 匹配 /api/* 下的全部路径。
 */
export async function onRequest(context) {
  const { request, env } = context;
  let url;
  try {
    url = new URL(request.url);
  } catch (e) {
    return jsonResponse(400, { error: 'bad_request', message: '无法解析请求 URL' });
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return jsonResponse(405, { error: 'method_not_allowed' });
  }

  /* 子路径：/api/search → search */
  const path = url.pathname.replace(/^\/api\/?/, '').replace(/\/+$/, '');

  try {
    if (path === 'meta') {
      await loadMeta(env, request.url);
      return jsonResponse(200, {
        version: STATE.meta.version,
        source: STATE.meta.source,
        note: STATE.meta.note,
        categories: STATE.meta.categories,
        groups: STATE.meta.groups,
        stats: categoryStats(),
        total: STATE.docs.length,
        totalChars: STATE.meta.totalChars || 0
      });
    }

    if (path === 'search') {
      /* 参数一律用 URLSearchParams 读，不要手工拼百分号编码 */
      const sp = url.searchParams;
      const cat = sp.get('cat') || '';
      const cats = cat && cat !== 'all' ? cat.split(',').filter(Boolean) : null;
      const page = parseInt(sp.get('page') || '1', 10) || 1;
      const sizeRaw = parseInt(sp.get('size') || '20', 10) || 20;
      const result = await runSearch(env, request.url, {
        q: sp.get('q') || '',
        cats,
        group: sp.get('group') || '',
        sort: sp.get('sort') || 'relevance',
        page,
        pageSize: Math.min(Math.max(1, sizeRaw), 100)
      });
      return jsonResponse(200, result);
    }

    if (path === 'recs') {
      await loadMeta(env, request.url);
      const ids = (url.searchParams.get('ids') || '').split(',').map((s) => s.trim()).filter(Boolean);
      const items = [];
      for (const id of ids) {
        const d = STATE.byId.get(id);
        if (!d) continue;
        items.push({
          id: d.id, title: d.title, cat: d.cat, catName: d.catName, group: d.group,
          issuer: d.issuer, published: d.rec.published || '', year: d.year,
          chars: d.rec.chars || 0, tags: d.rec.tags || [], summary: d.summary,
          url: d.rec.url || '', source: d.rec.source || '',
          effect: d.rec.effect || '', flxz: d.rec.flxz || ''
        });
      }
      return jsonResponse(200, { items });
    }

    if (path === 'suggest') {
      await loadMeta(env, request.url);
      const items = runSuggest(url.searchParams.get('q') || '', 8);
      return jsonResponse(200, { items });
    }

    if (path === 'doc') {
      await loadMeta(env, request.url);
      const id = url.searchParams.get('id') || '';
      const q = url.searchParams.get('q') || '';
      const d = STATE.byId.get(id);
      if (!d) return jsonResponse(404, { error: 'not_found' });
      const pq = q ? parseQuery(q) : { terms: [], phrases: [] };
      const terms = pq.terms.concat(pq.phrases);
      const bodies = await findBody(env, request.url, [id]);
      const sections = bodies.get(id);
      if (!sections) return jsonResponse(404, { error: 'not_found' });
      return jsonResponse(200, buildDocDetail(d, sections, terms));
    }

    if (path === 'timeline') {
      await loadMeta(env, request.url);
      return jsonResponse(200, { years: runTimeline() });
    }

    if (path === 'export') {
      await loadMeta(env, request.url);
      const ids = (url.searchParams.get('ids') || '').split(',').map((s) => s.trim()).filter(Boolean);
      const fmt = url.searchParams.get('fmt') || 'txt';
      const bodies = await findBody(env, request.url, ids);
      const docs = [];
      for (const id of ids) {
        const d = STATE.byId.get(id);
        const sections = bodies.get(id);
        if (d && sections) docs.push({ ...d, sections });
      }
      const out = buildExport(docs, fmt);
      return textResponse(200, out.content, out.mime, out.filename);
    }

    return jsonResponse(404, { error: 'not_found' });
  } catch (err) {
    /* 语料不可用 → 503 + 清晰 JSON；其它异常 → 500，同样是 JSON，不抛未捕获异常 */
    if (err instanceof CorpusError) {
      return jsonResponse(503, { error: err.code, message: err.message });
    }
    return jsonResponse(500, {
      error: 'internal_error',
      message: String(err && err.message ? err.message : err)
    });
  }
}
