/* ==========================================================================
   search.js —— 检索引擎（子串匹配 + 字段加权评分 + 片段摘要 + 高亮）
   面向中文语料：不引入分词器，短语与词元均按子串匹配。
   ========================================================================== */
(function (w) {
  'use strict';

  var docs = [];
  var byId = {};

  /* ------------------------------------------------------------- 工具 */
  function escHtml(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escRe(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function countOf(hay, needle) {
    if (!hay || !needle) return 0;
    var n = 0, i = 0;
    while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
    return n;
  }

  /* --------------------------------------------------------- 索引构建 */
  function indexDoc(rec) {
    var text = '';
    var secNames = [];
    if (rec.sections && rec.sections.length) {
      for (var i = 0; i < rec.sections.length; i++) {
        if (rec.sections[i].text) text += rec.sections[i].text + '\n';
        if (rec.sections[i].name) secNames.push(rec.sections[i].name);
      }
    }
    if (!text && rec.text) text = rec.text;
    rec._text = text;
    rec._secmeta = secNames.join(' ');
    rec._title = (rec.title || '').toLowerCase();
    rec._summary = (rec.summary || '').toLowerCase();
    rec._tags = (rec.tags || []).join(' ').toLowerCase();
    rec._issuer = (rec.issuer || '').toLowerCase();
    rec._secnames = secNames.join(' ').toLowerCase();
    // 中文语料几乎不含大写字母，没有时复用原串，避免为上万篇法规复制一份小写副本
    rec._textl = /[A-Z]/.test(text) ? text.toLowerCase() : text;
    rec._chars = rec.chars || text.replace(/\s/g, '').length;
    return rec;
  }

  function init(data) {
    docs = [];
    byId = {};
    var list = (data && data.records) || [];
    for (var i = 0; i < list.length; i++) {
      var r = indexDoc(list[i]);
      docs.push(r);
      byId[r.id] = r;
    }
    return docs.length;
  }

  function addDoc(rec) {
    if (!rec || !rec.id) return null;
    if (byId[rec.id]) {
      var idx = docs.indexOf(byId[rec.id]);
      var r = indexDoc(rec);
      if (idx >= 0) docs[idx] = r; else docs.push(r);
      byId[rec.id] = r;
      return r;
    }
    var d = indexDoc(rec);
    docs.push(d);
    byId[rec.id] = d;
    return d;
  }

  /* 重新索引一条已有记录（正文按需加载后增量更新用）。
     记录对象是同一个，就地刷新派生字段即可，docs 数组与排序都不用动。 */
  function refreshDoc(rec) {
    if (!rec || !rec.id) return null;
    if (!byId[rec.id]) return addDoc(rec);
    indexDoc(rec);
    return rec;
  }

  function removeDoc(id) {
    var d = byId[id];
    if (!d) return false;
    docs.splice(docs.indexOf(d), 1);
    delete byId[id];
    return true;
  }

  function get(id) { return byId[id] || null; }
  function all() { return docs.slice(); }
  function count() { return docs.length; }

  /* --------------------------------------------------------- 查询解析 */
  var FIELD_MAP = {
    '标题': 'title', '题': 'title', 'title': 'title',
    '正文': 'text', '全文': 'text', '内容': 'text', 'text': 'text',
    '机关': 'issuer', '发布机关': 'issuer', 'issuer': 'issuer',
    '标签': 'tags', 'tag': 'tags',
    '摘要': 'summary', 'summary': 'summary'
  };

  function parse(query) {
    var q = (query || '').trim();
    var res = {
      raw: q,
      terms: [],       // 普通词元
      phrases: [],     // "短语"
      exclude: [],     // -排除词
      fields: [],      // 限定字段
      scope: 'all',
      empty: !q
    };
    if (!q) return res;

    // 抽取引号短语
    var phraseRe = /"([^"]+)"|“([^”]+)”/g, m;
    var rest = q;
    while ((m = phraseRe.exec(q)) !== null) {
      var p = (m[1] || m[2] || '').trim();
      if (p) res.phrases.push(p.toLowerCase());
    }
    rest = rest.replace(/"([^"]+)"|“([^”]+)”/g, ' ');

    var parts = rest.split(/[\s,，、;；]+/);
    for (var i = 0; i < parts.length; i++) {
      var t = parts[i];
      if (!t) continue;
      var neg = false;
      if (t.charAt(0) === '-' && t.length > 1) { neg = true; t = t.slice(1); }
      // 字段限定
      var fm = /^([一-龥A-Za-z]+)[:：](.+)$/.exec(t);
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

  /* ------------------------------------------------------------ 评分 */
  function fieldOf(doc, field) {
    switch (field) {
      case 'title': return doc._title;
      case 'text': return doc._textl;
      case 'issuer': return doc._issuer;
      case 'tags': return doc._tags;
      case 'summary': return doc._summary;
      default: return null;
    }
  }

  function scoreDoc(doc, q) {
    var total = 0;
    var terms = q.terms.concat(q.phrases);
    if (!terms.length) return 1;

    for (var i = 0; i < terms.length; i++) {
      var t = terms[i];
      var s = 0;
      if (q.scope !== 'all') {
        // 限定字段：仅该字段命中才算，且只在该字段计分
        var hay = fieldOf(doc, q.scope);
        if (!hay || hay.indexOf(t) === -1) return 0;
        s += countOf(hay, t) * (q.scope === 'title' ? 30 : 12);
        total += s;
        continue;
      }
      s += countOf(doc._title, t) * 12;
      s += countOf(doc._tags, t) * 6;
      s += countOf(doc._summary, t) * 4;
      s += countOf(doc._secnames, t) * 3;
      s += countOf(doc._issuer, t) * 4;
      s += Math.min(countOf(doc._textl, t), 30);
      total += s;
    }
    // 短语加权
    for (var j = 0; j < q.phrases.length; j++) {
      var p = q.phrases[j];
      if (doc._title.indexOf(p) !== -1) total += 40;
      if (doc._textl.indexOf(p) !== -1) total += 12;
    }
    // 标题完整匹配额外加分
    var bare = doc._title.replace(/[（）()《》\s]/g, '');
    for (var k = 0; k < q.terms.length; k++) {
      if (bare.indexOf(q.terms[k]) !== -1) total += 18;
    }
    return total;
  }

  function excluded(doc, q) {
    for (var i = 0; i < q.exclude.length; i++) {
      if (doc._textl.indexOf(q.exclude[i]) !== -1 || doc._title.indexOf(q.exclude[i]) !== -1) return true;
    }
    return false;
  }

  /* ---------------------------------------------------------- 摘要片段 */
  function makeSnippet(doc, q, width) {
    width = width || 132;
    var terms = q.terms.concat(q.phrases);
    if (!terms.length) {
      var t = (doc.summary || doc._text || '').replace(/\s+/g, ' ').trim();
      return t.slice(0, width) + (t.length > width ? '…' : '');
    }
    var text = (doc._text || '').replace(/\s+/g, ' ');
    var lower = text.toLowerCase();
    /* 正文起点：法规正文第一条之前是「标题 + 说明段 + 目录」，
       在那里截到的上下文全是「（1996年3月17日第八届全国人民代表大会……通过）」这类套话，
       所以优先从第一条之后开始找命中位置。 */
    var bm = text.match(/第[一二三四五六七八九十百零〇\d]+条/);
    var bodyAt = bm ? bm.index : 0;
    var best = -1, i, p;
    for (i = 0; i < terms.length; i++) {
      p = lower.indexOf(terms[i], bodyAt);
      if (p !== -1 && (best === -1 || p < best)) best = p;
    }
    if (best === -1) {
      for (i = 0; i < terms.length; i++) {
        p = lower.indexOf(terms[i]);
        if (p !== -1 && (best === -1 || p < best)) best = p;
      }
    }
    if (best === -1) {
      var s = (doc.summary || '').replace(/\s+/g, ' ').trim();
      return s.slice(0, width) + (s.length > width ? '…' : '');
    }
    var from = Math.max(0, best - 42);
    var to = Math.min(text.length, best + width);
    var seg = text.slice(from, to);
    // 尽量从句读处开始
    if (from > 0) {
      var m = seg.match(/^[^\u3002\uff1b\uff01\uff1f\uff1a\n]{0,26}/);
      if (m) seg = seg.slice(m[0].length);
    }
    return (from > 0 ? '…' : '') + seg.trim() + (to < text.length ? '…' : '');
  }

  /* ------------------------------------------------------------ 高亮 */
  function highlight(text, terms) {
    if (!text) return '';
    var uniq = [], seen = {};
    (terms || []).forEach(function (t) {
      t = String(t || '').trim();
      if (!t) return;
      var k = t.toLowerCase();
      if (seen[k]) return;
      seen[k] = 1;
      uniq.push(t);
    });
    if (!uniq.length) return escHtml(text);
    var re;
    try {
      re = new RegExp(uniq.map(escRe).join('|'), 'gi');
    } catch (e) {
      return escHtml(text);
    }
    var out = '', last = 0, m;
    while ((m = re.exec(text)) !== null) {
      out += escHtml(text.slice(last, m.index)) + '<mark>' + escHtml(m[0]) + '</mark>';
      last = m.index + m[0].length;
      if (m[0].length === 0) re.lastIndex++;
    }
    out += escHtml(text.slice(last));
    return out;
  }

  /* ------------------------------------------------------------ 检索 */
  function search(query, opts) {
    opts = opts || {};
    var t0 = (new Date()).getTime();
    var q = parse(query);
    if (opts.scope && opts.scope !== 'all') q.scope = opts.scope;
    var pool = docs;
    if (opts.docs) pool = opts.docs;
    var cats = opts.cats && opts.cats.length ? opts.cats : null;
    var favIds = opts.favIds || null;
    var onlyFav = !!opts.onlyFav;

    var hits = [];
    for (var i = 0; i < pool.length; i++) {
      var d = pool[i];
      if (cats && cats.indexOf(d.cat) === -1) continue;
      if (onlyFav && (!favIds || favIds.indexOf(d.id) === -1)) continue;
      if (q.exclude.length && excluded(d, q)) continue;
      var sc = q.empty ? 1 : scoreDoc(d, q);
      if (sc <= 0) continue;
      hits.push({ doc: d, score: sc });
    }

    var sort = opts.sort || 'relevance';
    if (sort === 'new') {
      hits.sort(function (a, b) { return (b.doc.year || 0) - (a.doc.year || 0) || b.score - a.score; });
    } else if (sort === 'old') {
      hits.sort(function (a, b) { return (a.doc.year || 0) - (b.doc.year || 0) || b.score - a.score; });
    } else if (sort === 'title') {
      hits.sort(function (a, b) { return a.doc.title.localeCompare(b.doc.title, 'zh-Hans-CN'); });
    } else {
      hits.sort(function (a, b) { return b.score - a.score || (b.doc.year || 0) - (a.doc.year || 0); });
    }

    var page = opts.page || 1;
    var size = opts.pageSize || 10;
    var total = hits.length;
    var pages = Math.max(1, Math.ceil(total / size));
    if (page > pages) page = pages;
    var slice = hits.slice((page - 1) * size, page * size);

    return {
      query: q,
      hits: slice,
      total: total,
      pages: pages,
      page: page,
      took: (new Date()).getTime() - t0
    };
  }

  /* -------------------------------------------------------- 搜索建议 */
  function suggest(query, limit) {
    limit = limit || 8;
    var q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    var out = [];
    for (var i = 0; i < docs.length && out.length < limit * 3; i++) {
      var d = docs[i];
      if (d._title.indexOf(q) !== -1 || d._tags.indexOf(q) !== -1) out.push(d);
    }
    out.sort(function (a, b) {
      var ai = a._title.indexOf(q), bi = b._title.indexOf(q);
      if (ai !== bi) return ai - bi;
      return (b.year || 0) - (a.year || 0);
    });
    return out.slice(0, limit);
  }

  /* ------------------------------------------------------- 分类统计 */
  function byCategory() {
    var m = {};
    for (var i = 0; i < docs.length; i++) {
      var d = docs[i];
      if (!m[d.cat]) m[d.cat] = { cat: d.cat, name: d.catName, count: 0, chars: 0, level: d.level };
      m[d.cat].count++;
      m[d.cat].chars += d._chars || 0;
    }
    return m;
  }

  /* 公布年份：与时间轴分组同源（published 优先，退回 year），
     避免出现「分组 2025 / 日期 2016」这类错位。 */
  function pubYearOf(d) {
    var s = d.published || d.revised || d.adopted || '';
    var y = parseInt(String(s).slice(0, 4), 10);
    return y || d.year || 0;
  }

  function byYear() {
    var m = {};
    for (var i = 0; i < docs.length; i++) {
      var y = pubYearOf(docs[i]);
      if (!y) continue;
      if (!m[y]) m[y] = [];
      m[y].push(docs[i]);
    }
    return m;
  }

  function totalChars() {
    var n = 0;
    for (var i = 0; i < docs.length; i++) n += docs[i]._chars || 0;
    return n;
  }

  w.Search = {
    init: init,
    addDoc: addDoc,
    refreshDoc: refreshDoc,
    removeDoc: removeDoc,
    get: get,
    all: all,
    count: count,
    parse: parse,
    search: search,
    highlight: highlight,
    snippet: makeSnippet,
    suggest: suggest,
    byCategory: byCategory,
    byYear: byYear,
    totalChars: totalChars,
    escHtml: escHtml,
    countOf: countOf
  };
})(window);
