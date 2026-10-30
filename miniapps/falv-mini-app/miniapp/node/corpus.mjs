// 法规语料加载与检索核心（服务端）。
//
// 设计要点：
//  1. 全量语料常驻内存（约 162MB），检索走子串匹配，与网页版 search.js 同语义，
//     不引入分词器 —— 中文法规检索里子串匹配的效果与分词器相当，且零依赖。
//  2. 正文与元信息一次性载入，客户端只通过 API 取需要的东西。
//  3. 载荷用 gzip 存盘（11.3MB），启动时 gunzip + parse 约 174ms。

import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';

const CHUNK = 64 * 1024;

/* ============================================================ 工具 */

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

/* ============================================================ 语料 */

export async function loadCorpus(corpusDir) {
  const metaRaw = await readFile(join(corpusDir, 'meta.json.gz'));
  const bodyRaw = await readFile(join(corpusDir, 'bodies.json.gz'));
  const meta = JSON.parse(gunzipSync(metaRaw).toString('utf8'));
  const bodies = JSON.parse(gunzipSync(bodyRaw).toString('utf8'));

  const byId = new Map();
  for (const b of bodies) byId.set(b.id, b);

  /* 门类 → 体系分组：记录里没有 group 字段，需由 categories 回填 */
  const catGroup = new Map();
  const catMeta = new Map();
  for (const c of meta.categories || []) {
    catGroup.set(c.id, c.group || '');
    catMeta.set(c.id, c);
  }

  /* 检索索引：正文压平成一段可搜索文本，并记录章节名 */
  const docs = [];
  for (const rec of meta.records) {
    const body = byId.get(rec.id);
    let text = '';
    const secNames = [];
    if (body && body.sections) {
      for (const s of body.sections) {
        if (s.text) text += s.text + '\n';
        if (s.name) secNames.push(s.name);
      }
    }
    const group = catGroup.get(rec.cat) || '';
    const cm = catMeta.get(rec.cat) || {};
    const d = {
      rec,
      id: rec.id,
      title: rec.title || '',
      cat: rec.cat,
      catName: rec.catName || '',
      group,
      catDesc: cm.desc || '',
      catTone: cm.tone || '',
      catColor: cm.color || '',
      year: rec.year || 0,
      issuer: rec.issuer || '',
      summary: rec.summary || '',
      tags: (rec.tags || []).join(' '),
      text,
      sections: (body && body.sections) || [],
      secNames: secNames.join(' ')
    };
    d.t = d.title.toLowerCase();
    d.s = d.summary.toLowerCase();
    d.g = d.tags.toLowerCase();
    d.i = d.issuer.toLowerCase();
    d.n = d.secNames.toLowerCase();
    /* 中文语料几乎不含大写字母，没有时复用原串，避免为上万篇法规复制一份小写副本 */
    d.b = /[A-Z]/.test(text) ? text.toLowerCase() : text;
    docs.push(d);
  }

  const byIdDoc = new Map();
  for (const d of docs) byIdDoc.set(d.id, d);

  return { meta, docs, byId: byIdDoc, totalChars: meta.totalChars || 0 };
}

/* ============================================================ 查询解析 */

const FIELD_MAP = {
  '标题': 'title', '题': 'title', 'title': 'title',
  '正文': 'text', '全文': 'text', '内容': 'text', 'text': 'text',
  '机关': 'issuer', '发布机关': 'issuer', 'issuer': 'issuer',
  '标签': 'tags', 'tag': 'tags',
  '摘要': 'summary', 'summary': 'summary'
};

export function parseQuery(query) {
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

/* ============================================================ 评分 */

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
  for (const p of q.phrases) {
    if (doc.t.indexOf(p) !== -1) total += 40;
    if (doc.b.indexOf(p) !== -1) total += 12;
  }
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

/* ============================================================ 摘要片段 */

export function makeSnippet(doc, q, width) {
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

/* ============================================================ 高亮 */

/* 返回带 <mark> 的 HTML。命中词来自查询解析，调用方负责转义。 */
export function highlight(text, terms) {
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

/* ============================================================ 检索 */

/**
 * @param {object} corpus loadCorpus 的返回值
 * @param {string} query 查询串
 * @param {object} opts { cats, sort, page, pageSize, group }
 */
export function searchCorpus(corpus, query, opts) {
  opts = opts || {};
  const t0 = Date.now();
  const q = parseQuery(query);
  const cats = opts.cats && opts.cats.length ? new Set(opts.cats) : null;
  const group = opts.group && opts.group !== 'all' ? opts.group : null;

  const hits = [];
  for (const d of corpus.docs) {
    if (cats && !cats.has(d.cat)) continue;
    if (group && d.group !== group) continue;
    if (q.exclude.length && isExcluded(d, q)) continue;
    const sc = q.empty ? 1 : scoreDoc(d, q);
    if (sc <= 0) continue;
    hits.push({ doc: d, score: sc });
  }

  const sort = opts.sort || 'relevance';
  if (sort === 'new') {
    hits.sort((a, b) => (b.doc.year || 0) - (a.doc.year || 0) || b.score - a.score);
  } else if (sort === 'old') {
    hits.sort((a, b) => (a.doc.year || 0) - (b.doc.year || 0) || b.score - a.score);
  } else if (sort === 'title') {
    hits.sort((a, b) => a.doc.title.localeCompare(b.doc.title, 'zh-Hans-CN'));
  } else {
    hits.sort((a, b) => b.score - a.score || (b.doc.year || 0) - (a.doc.year || 0));
  }

  const size = Math.min(Math.max(1, opts.pageSize || 20), 100);
  const total = hits.length;
  const pages = Math.max(1, Math.ceil(total / size));
  let page = Math.max(1, opts.page || 1);
  if (page > pages) page = pages;
  const slice = hits.slice((page - 1) * size, page * size);

  const terms = q.terms.concat(q.phrases);
  return {
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
      snippetHtml: highlight(makeSnippet(h.doc, q), terms)
    })),
    total,
    pages,
    page,
    took: Date.now() - t0
  };
}

/* 标题联想 */
export function suggestCorpus(corpus, query, limit) {
  limit = limit || 8;
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const out = [];
  for (const d of corpus.docs) {
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

/* ============================================================ 详情 */

/**
 * 把一条法规的正文切成「块」，供客户端原生渲染。
 * 块类型：
 *   h2 / h3  —— 二级/三级小节标题（来自 sections 的 level）
 *   clause   —— 「第X条」条款
 *   item     —— 「（一）」二级条目
 *   note     —— 立法说明括号段
 *   p        —— 普通段落
 * 这是两端（浏览器与微信小程序）共用的渲染契约。
 */
export function buildBlocks(sections) {
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

/* 全文纯文本（导出与划线批注用） */
export function plainText(sections) {
  const out = [];
  for (const sec of sections || []) {
    if (sec.name) out.push(sec.name);
    if (sec.text) out.push(sec.text);
  }
  return out.join('\n\n');
}

/* 目录（两级） */
export function buildToc(sections) {
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

export function docDetail(corpus, id, hlTerms) {
  const d = corpus.byId.get(id);
  if (!d) return null;
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
    toc: buildToc(d.sections),
    blocks: buildBlocks(d.sections),
    plain: plainText(d.sections)
  };
}

/* ============================================================ 门类统计 */

export function categoryStats(corpus) {
  const m = {};
  for (const d of corpus.docs) {
    if (!m[d.cat]) {
      m[d.cat] = {
        cat: d.cat, name: d.catName, count: 0, chars: 0,
        level: d.rec.level, group: d.group, tone: '', desc: ''
      };
    }
    m[d.cat].count++;
    m[d.cat].chars += d.rec.chars || 0;
  }
  /* 门类描述与配色从元信息回填 */
  for (const c of corpus.meta.categories || []) {
    if (m[c.id]) {
      m[c.id].desc = c.desc || '';
      m[c.id].tone = c.tone || '';
      m[c.id].color = c.color || '';
    }
  }
  return m;
}

/* 立法时间轴：按公布年份分组 */
export function timeline(corpus) {
  const m = {};
  for (const d of corpus.docs) {
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

/* ============================================================ 导出 */

function csvCell(v) {
  const s = String(v === null || v === undefined ? '' : v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/* 日期格式化：与网页版 exporter.js 的 fmtDate 同规则 */
function fmtDate(iso) {
  if (!iso) return '';
  const p = String(iso).split('-');
  if (p.length === 3) return p[0] + '年' + parseInt(p[1], 10) + '月' + parseInt(p[2], 10) + '日';
  if (p.length === 2) return p[0] + '年' + parseInt(p[1], 10) + '月';
  if (p.length === 1 && /^\d{4}$/.test(p[0])) return p[0] + '年';
  return iso;
}

export function exportDocs(corpus, ids, format) {
  const docs = [];
  for (const id of ids || []) {
    const d = corpus.byId.get(id);
    if (d) docs.push(d);
  }
  if (!docs.length) return { filename: 'empty.txt', mime: 'text/plain;charset=utf-8', content: '' };

  const stamp = new Date().toISOString().slice(0, 10);
  const safe = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);

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
        else if (b.type === 'note') out += `*${b.text}*\n\n`;
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
    /* CSV 是「目录」导出：元信息表，不含正文。字段与网页版 exporter.js 的 toCSV 对齐。 */
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
    return { filename: `法规目录_${stamp}.csv`, mime: 'text/csv;charset=utf-8', content: '\ufeff' + rows.join('\r\n') };
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

export { CHUNK };
