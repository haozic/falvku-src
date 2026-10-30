/* ==========================================================================
   static-api.js —— 纯前端数据层（静态部署用）

   Mini App 运行时里，正文与检索由 Node 服务端持有（/api/*）。
   部署到静态托管时没有服务端，本文件用同一套契约在浏览器里实现这些接口，
   客户端 app.js 无需改动 —— 它调用的仍是 api('/api/search', …) 这种路径。

   数据来源与网页版静态站完全一致：
     data/regulations.js  -> window.FG_DATA（元信息 2,706 条 + 门类 + 体系 + 分片清单）
     data/<分片>.js       -> window.FG_PARTY / FG_FLK / FG_HUBEI（正文分片，24 片）
   检索引擎复用 assets/js/search.js（window.Search），与网页版语义一致。

   正文分片按需加载：
     - 打开某篇法规  -> 只加载它所在的那 1 片（约 1.8MB）
     - 提交非空检索  -> 需要全文，先加载全部 24 片（约 39MB，仅此一次，之后走浏览器缓存）
     - 门类浏览 / 空检索 -> 不需要正文，不加载任何分片

   兼容性：目标 Chrome 69，不用可选链、空值合并等新语法。
   ========================================================================== */
(function (w) {
  'use strict';

  /* ------------------------------------------------------------ 工具 */

  function assetVersion() {
    var s = document.querySelector('script[src*="app.js"]');
    var m = s && /[?&]v=([^"&]+)/.exec(s.src);
    return m ? m[1] : '';
  }

  var VER = assetVersion();
  var DATA_BASE = 'data/';

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('资源加载失败：' + src)); };
      document.head.appendChild(s);
    });
  }

  /* 分片 key -> 它挂在哪个全局变量上 */
  function bodyGlobalOf(key) {
    if (key.indexOf('flk') === 0) return 'FG_FLK';
    if (key.indexOf('hubei') === 0) return 'FG_HUBEI';
    return 'FG_PARTY';
  }

  /* 「数组的数组」展开一层：分片文件是 window.X.push([...]) */
  function flattenChunks(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var v = list[i];
      if (Object.prototype.toString.call(v) === '[object Array]') out = out.concat(v);
      else out.push(v);
    }
    return out;
  }

  /* ------------------------------------------------------------ 状态 */

  var S = {
    meta: null,
    records: [],
    byId: {},
    bodyLoaded: {},
    metaPromise: null,
    progress: { done: 0, total: 0, key: '' },
    listeners: [],
    /* 正文分片全部到齐后触发一次，客户端据此刷新检索结果 */
    bodiesReady: false,
    readyListeners: []
  };

  function emitProgress(done, total, key) {
    S.progress = { done: done, total: total, key: key };
    for (var i = 0; i < S.listeners.length; i++) {
      try { S.listeners[i](S.progress); } catch (e) { /* 单个监听器出错不影响其它 */ }
    }
  }

  function emitBodiesReady() {
    if (S.bodiesReady) return;
    S.bodiesReady = true;
    for (var i = 0; i < S.readyListeners.length; i++) {
      try { S.readyListeners[i](); } catch (e) { /* 单个监听器出错不影响其它 */ }
    }
  }

  /* ------------------------------------------------------------ 元信息 */

  function loadMeta() {
    if (S.metaPromise) return S.metaPromise;
    S.metaPromise = loadScript(DATA_BASE + 'regulations.js?v=' + VER).then(function () {
      var D = w.FG_DATA || { records: [], categories: [], groups: [] };
      S.meta = D;
      S.records = D.records || [];
      /* 记录里没有 group 字段，体系归属由 categories[].group 回填 */
      var catGroup = {};
      var cats = D.categories || [];
      for (var i = 0; i < cats.length; i++) catGroup[cats[i].id] = cats[i].group || '';
      for (var j = 0; j < S.records.length; j++) {
        var r = S.records[j];
        r.group = catGroup[r.cat] || '';
        S.byId[r.id] = r;
      }
      w.Search.init(D);
      return D;
    });
    return S.metaPromise;
  }

  /* ------------------------------------------------------------ 正文分片 */

  /* 把一批正文并回记录（幂等：重复并入同一个 id 只是覆盖同样的内容） */
  function mergeBodies(bodies) {
    var updated = [];
    for (var i = 0; i < bodies.length; i++) {
      var b = bodies[i];
      if (!b || !b.id) continue;
      var rec = S.byId[b.id];
      if (!rec) continue;
      rec.sections = b.sections || [];
      updated.push(rec);
    }
    return updated;
  }

  /**
   * 加载指定的正文分片。
   * 同一个分片只加载一次：并发调用共享同一个 Promise（避免重复下载 +
   * 重复 push 到 window.FG_* 全局数组里）。
   * @param {string[]} keys 分片 key（如 'party_01'）
   * @returns {Promise<object[]>} 并回记录的记录对象
   */
  var bodyPromises = {};

  function ensureBodies(keys) {
    var ps = [];
    var fresh = [];
    var i;
    for (i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (!k || S.bodyLoaded[k]) continue;
      if (bodyPromises[k]) { ps.push(bodyPromises[k]); continue; }
      if (fresh.indexOf(k) === -1) fresh.push(k);
    }

    for (i = 0; i < fresh.length; i++) {
      (function (key) {
        var gname = bodyGlobalOf(key);
        /* 注意 before 必须在 append 脚本之前取：同一全局下的多个分片会先后 push，
           谁先到谁先取，取到的可能包含别人刚 push 的内容 —— 重复并入是幂等的。 */
        var before = (w[gname] || []).length;
        var p = loadScript(DATA_BASE + key + '.js?v=' + VER).then(function () {
          var arr = w[gname] || [];
          var added = flattenChunks(arr.slice(before));
          S.bodyLoaded[key] = true;
          var up = mergeBodies(added);
          /* 每片到达就立刻增量建索引，不必等 24 片全部下完才见结果 */
          for (var j = 0; j < up.length; j++) w.Search.refreshDoc(up[j]);
          emitProgress(countLoaded(), allBodyKeys().length, key);
          return up;
        }, function (e) {
          /* 失败时清掉缓存的 Promise，允许下次重试 */
          delete bodyPromises[key];
          throw e;
        });
        bodyPromises[key] = p;
        ps.push(p);
      })(fresh[i]);
    }

    if (!ps.length) return Promise.resolve([]);
    return Promise.all(ps).then(function (list) {
      var out = [];
      for (var a = 0; a < list.length; a++) {
        if (!list[a]) continue;
        for (var b = 0; b < list[a].length; b++) out.push(list[a][b]);
      }
      /* 全部正文分片都到齐时通知客户端刷新结果（此时才是真正的全文命中）。
         注意：只加载了其中一片（打开单篇详情）不能算「已就绪」。 */
      if (allBodiesLoaded()) emitBodiesReady();
      return out;
    });
  }

  function countLoaded() {
    var n = 0;
    for (var k in S.bodyLoaded) {
      if (S.bodyLoaded.hasOwnProperty(k) && S.bodyLoaded[k]) n++;
    }
    return n;
  }

  /* 24 个正文分片是否全部载入 */
  function allBodiesLoaded() {
    var keys = allBodyKeys();
    if (!keys.length) return false;
    for (var i = 0; i < keys.length; i++) {
      if (!S.bodyLoaded[keys[i]]) return false;
    }
    return true;
  }

  /* ------------------------------------------------------------ 正文块 */

  /* 与服务端 corpus.mjs 的 buildBlocks 保持一致：两端共用一套渲染契约 */
  function buildBlocks(sections) {
    var blocks = [];
    for (var s = 0; s < (sections || []).length; s++) {
      var sec = sections[s];
      var name = (sec.name || '').trim();
      if (name) blocks.push({ type: sec.level === 2 ? 'h3' : 'h2', text: name });
      var text = sec.text || '';
      var lines = text.split(/\n+/);
      for (var i = 0; i < lines.length; i++) {
        var t = lines[i].trim();
        if (!t) continue;
        /* 源页面「章节名」与正文首行重复，跳过 */
        if (name && t.replace(/\s/g, '') === name.replace(/\s/g, '')) continue;
        var cm = /^(第[一二三四五六七八九十百零〇两]+条)(.*)$/.exec(t);
        if (cm) { blocks.push({ type: 'clause', no: cm[1], text: cm[2].trim() }); continue; }
        var im = /^([（(][一二三四五六七八九十百零〇两\d]+[)）])\s*(.*)$/.exec(t);
        if (im) { blocks.push({ type: 'item', no: im[1], text: im[2] }); continue; }
        if (/^[（(][\s\S]{16,}[）)][。；;]?$/.test(t)) { blocks.push({ type: 'note', text: t }); continue; }
        blocks.push({ type: 'p', text: t });
      }
    }
    return blocks;
  }

  /* 两级目录 */
  function buildToc(sections) {
    var toc = [];
    for (var i = 0; i < (sections || []).length; i++) {
      var sec = sections[i];
      var name = (sec.name || '').trim();
      if (!name) continue;
      var item = { name: name, level: sec.level === 2 ? 2 : 1, count: (sec.text || '').length };
      if (item.level === 1) {
        toc.push(item);
      } else if (toc.length) {
        if (!toc[toc.length - 1].children) toc[toc.length - 1].children = [];
        toc[toc.length - 1].children.push(item);
      } else {
        toc.push(item);
      }
    }
    return toc;
  }

  function plainText(sections) {
    var out = [];
    for (var i = 0; i < (sections || []).length; i++) {
      if (sections[i].name) out.push(sections[i].name);
      if (sections[i].text) out.push(sections[i].text);
    }
    return out.join('\n\n');
  }

  /* ------------------------------------------------------------ 统计 / 时间轴 */

  /* 门类统计：只统计**有法规**的门类（与服务端一致，本机自建类 0 条不出现） */
  function categoryStats() {
    var m = {};
    var i;
    for (i = 0; i < S.records.length; i++) {
      var d = S.records[i];
      if (!m[d.cat]) {
        m[d.cat] = {
          cat: d.cat, name: d.catName, count: 0, chars: 0,
          level: d.level, group: d.group || '', tone: '', desc: '', color: ''
        };
      }
      m[d.cat].count++;
      m[d.cat].chars += d.chars || 0;
    }
    /* 从 categories 补上描述、配色与层级 */
    var cats = (S.meta && S.meta.categories) || [];
    for (i = 0; i < cats.length; i++) {
      var c = cats[i];
      if (!m[c.id]) continue;
      m[c.id].tone = c.tone || '';
      m[c.id].desc = c.desc || '';
      m[c.id].color = c.color || '';
      m[c.id].level = c.level;
      m[c.id].group = c.group || '';
    }
    return m;
  }

  function timeline() {
    var m = {};
    for (var i = 0; i < S.records.length; i++) {
      var d = S.records[i];
      var s = d.published || d.revised || d.adopted || '';
      var y = parseInt(String(s).slice(0, 4), 10) || d.year || 0;
      if (!y) continue;
      if (!m[y]) m[y] = { year: y, count: 0, items: [] };
      m[y].count++;
      m[y].items.push({
        id: d.id, title: d.title, cat: d.cat, catName: d.catName,
        group: d.group || '', published: s, issuer: d.issuer || ''
      });
    }
    var years = Object.keys(m).map(Number).sort(function (a, b) { return b - a; });
    for (var k = 0; k < years.length; k++) {
      var g = m[years[k]];
      g.items.sort(function (a, b) {
        return (a.catName || '').localeCompare(b.catName || '', 'zh-Hans-CN');
      });
    }
    return years.map(function (y) { return m[y]; });
  }

  /* ------------------------------------------------------------ 导出 */

  function csvCell(v) {
    var s = String(v === null || v === undefined ? '' : v);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function fmtDate(iso) {
    if (!iso) return '';
    var p = String(iso).split('-');
    if (p.length === 3) return p[0] + '年' + parseInt(p[1], 10) + '月' + parseInt(p[2], 10) + '日';
    if (p.length === 2) return p[0] + '年' + parseInt(p[1], 10) + '月';
    if (p.length === 1 && /^\d{4}$/.test(p[0])) return p[0] + '年';
    return iso;
  }

  function exportDocs(ids, format) {
    var docs = [];
    for (var i = 0; i < (ids || []).length; i++) {
      var d = S.byId[ids[i]];
      if (d) docs.push(d);
    }
    if (!docs.length) return '';
    var esc = w.Search.escHtml;

    if (format === 'txt') {
      var t = '';
      for (var i1 = 0; i1 < docs.length; i1++) {
        var d1 = docs[i1];
        t += d1.title + '\n';
        var meta = [];
        if (d1.issuer) meta.push('制定机关：' + d1.issuer);
        if (d1.published) meta.push('公布日期：' + d1.published);
        if (d1.effective) meta.push('施行日期：' + d1.effective);
        if (d1.effect) meta.push('时效性：' + d1.effect);
        if (meta.length) t += meta.join('  ') + '\n';
        t += plainText(d1.sections || []) + '\n\n';
      }
      return t;
    }

    if (format === 'md') {
      var m = '';
      for (var i2 = 0; i2 < docs.length; i2++) {
        var d2 = docs[i2];
        m += '# ' + d2.title + '\n\n';
        var meta2 = [];
        if (d2.issuer) meta2.push('制定机关：' + d2.issuer);
        if (d2.published) meta2.push('公布日期：' + d2.published);
        if (d2.effective) meta2.push('施行日期：' + d2.effective);
        if (d2.effect) meta2.push('时效性：' + d2.effect);
        if (meta2.length) m += '> ' + meta2.join('　') + '\n\n';
        var blocks = buildBlocks(d2.sections || []);
        for (var b = 0; b < blocks.length; b++) {
          var blk = blocks[b];
          if (blk.type === 'h2') m += '## ' + blk.text + '\n\n';
          else if (blk.type === 'h3') m += '### ' + blk.text + '\n\n';
          else if (blk.type === 'clause' || blk.type === 'item') m += '**' + blk.no + '** ' + blk.text + '\n\n';
          else if (blk.type === 'note') m += '*' + blk.text + '*\n\n';
          else m += blk.text + '\n\n';
        }
      }
      return m;
    }

    if (format === 'json') {
      var arr = docs.map(function (d) {
        return {
          id: d.id, title: d.title, cat: d.cat, catName: d.catName,
          issuer: d.issuer || '', published: d.published || '',
          effective: d.effective || '', effect: d.effect || '',
          url: d.url || '', source: d.source || '',
          sections: (d.sections || []).map(function (s) {
            return { name: s.name || '', level: s.level || 0, text: s.text || '' };
          })
        };
      });
      return JSON.stringify(arr, null, 2);
    }

    if (format === 'csv') {
      var head = ['标题', '版本', '分类', '门类细分', '效力级别', '时效性', '制定发布机关',
        '公布日期', '通过日期', '最后修订', '施行日期', '主题标签', '正文字数', '数据来源', '原文链接', '摘要'];
      var rows = [head.map(csvCell).join(',')];
      for (var i3 = 0; i3 < docs.length; i3++) {
        var d3 = docs[i3];
        rows.push([
          d3.title, d3.version || '', d3.catName || d3.cat, d3.sub || '',
          d3.flxz || '', d3.effect || '', d3.issuer || '',
          fmtDate(d3.published), fmtDate(d3.adopted), fmtDate(d3.revised), fmtDate(d3.effective),
          (d3.tags || []).join('|'),
          d3.chars || 0, d3.source || '', d3.url || '',
          (d3.summary || '').replace(/\s+/g, ' ')
        ].map(csvCell).join(','));
      }
      return '﻿' + rows.join('\r\n');
    }

    if (format === 'html') {
      var out = '<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n<title>法规汇编</title>\n' +
        '<style>body{font-family:"Songti SC","SimSun",serif;max-width:820px;margin:40px auto;line-height:1.9;padding:0 20px}' +
        'h1{text-align:center;font-size:22px}h2{font-size:18px;margin-top:28px}h3{font-size:16px;margin-top:20px}' +
        '.meta{color:#666;font-size:13px;margin-bottom:24px}.clause .no{font-weight:700}.note{color:#666;font-size:13px}</style>\n' +
        '</head>\n<body>\n';
      for (var i4 = 0; i4 < docs.length; i4++) {
        var d4 = docs[i4];
        out += '<h1>' + esc(d4.title) + '</h1>\n';
        out += '<p class="meta">' + esc(d4.catName || '') + '　' + esc(d4.issuer || '') + '　' + esc(d4.published || '') + '</p>\n';
        var blocks2 = buildBlocks(d4.sections || []);
        for (var b2 = 0; b2 < blocks2.length; b2++) {
          var blk2 = blocks2[b2];
          if (blk2.type === 'h2') out += '<h2>' + esc(blk2.text) + '</h2>\n';
          else if (blk2.type === 'h3') out += '<h3>' + esc(blk2.text) + '</h3>\n';
          else if (blk2.type === 'clause') out += '<p class="clause"><span class="no">' + esc(blk2.no) + '</span> ' + esc(blk2.text) + '</p>\n';
          else if (blk2.type === 'item') out += '<p><strong>' + esc(blk2.no) + '</strong> ' + esc(blk2.text) + '</p>\n';
          else if (blk2.type === 'note') out += '<p class="note">' + esc(blk2.text) + '</p>\n';
          else out += '<p>' + esc(blk2.text) + '</p>\n';
        }
        out += '<hr>\n';
      }
      out += '</body>\n</html>\n';
      return out;
    }

    return '';
  }

  /* ------------------------------------------------------------ 接口实现 */

  function allBodyKeys() {
    return (S.meta && S.meta.bodyFiles) || [];
  }

  function hitOf(h, q) {
    var d = h.doc;
    var terms = q.terms.concat(q.phrases);
    var snip = w.Search.snippet(d, q, 160);
    return {
      id: d.id,
      title: d.title,
      cat: d.cat,
      catName: d.catName,
      group: d.group || '',
      issuer: d.issuer || '',
      published: d.published || '',
      year: d.year,
      chars: d.chars || 0,
      tags: d.tags || [],
      summary: d.summary || '',
      score: h.score,
      snippetHtml: w.Search.highlight(snip, terms)
    };
  }

  function doSearch(params) {
    params = params || {};
    var q = params.q || '';
    var cats = [];
    if (params.cat && params.cat !== 'all') {
      var parts = String(params.cat).split(',');
      for (var i = 0; i < parts.length; i++) if (parts[i]) cats.push(parts[i]);
    }
    /* 体系过滤（与服务端一致）：服务端按「体系」筛 doc.group，
       这里的引擎只认门类，所以把体系展开成门类集合再筛（取交集）。
       注意：记录里的 group 字段是体系**名**（如「党内法规」），
       groups[].id 才是体系 id（如 dangnei）——两种都接受。 */
    if (params.group && params.group !== 'all') {
      var gname = String(params.group);
      var gcats = [];
      var gs = (S.meta && S.meta.groups) || [];
      for (var gi = 0; gi < gs.length; gi++) {
        if (gs[gi].id !== gname && gs[gi].name !== gname) continue;
        for (var gj = 0; gj < gs[gi].cats.length; gj++) {
          if (gcats.indexOf(gs[gi].cats[gj]) === -1) gcats.push(gs[gi].cats[gj]);
        }
      }
      if (cats.length) {
        cats = cats.filter(function (c) { return gcats.indexOf(c) !== -1; });
      } else {
        cats = gcats;
      }
    }
    var sort = params.sort || 'relevance';
    var page = parseInt(params.page || '1', 10) || 1;
    var size = parseInt(params.size || '20', 10) || 20;
    if (size > 100) size = 100;
    if (size < 1) size = 1;

    var res = w.Search.search(q, { cats: cats, sort: sort, page: page, pageSize: size });
    var hits = res.hits.map(function (h) { return hitOf(h, res.query); });
    return {
      query: res.query,
      hits: hits,
      total: res.total,
      pages: res.pages,
      page: res.page,
      took: res.took
    };
  }

  function docOf(rec, q) {
    var terms = [];
    if (q) {
      var pq = w.Search.parse(q);
      terms = pq.terms.concat(pq.phrases);
    }
    return {
      id: rec.id,
      title: rec.title,
      cat: rec.cat,
      catName: rec.catName,
      group: rec.group || '',
      level: rec.level,
      issuer: rec.issuer || '',
      sub: rec.sub || '',
      adopted: rec.adopted || '',
      published: rec.published || '',
      revised: rec.revised || '',
      effective: rec.effective || '',
      year: rec.year,
      summary: rec.summary || '',
      summaryHtml: w.Search.highlight(rec.summary || '', terms),
      tags: rec.tags || [],
      url: rec.url || '',
      source: rec.source || '',
      effect: rec.effect || '',
      flxz: rec.flxz || '',
      chars: rec.chars || 0,
      version: rec.version || '',
      lsyg: rec.lsyg || [],
      toc: buildToc(rec.sections || []),
      blocks: buildBlocks(rec.sections || []),
      plain: plainText(rec.sections || [])
    };
  }

  /* ------------------------------------------------------------ 对外接口 */

  function request(path, params) {
    params = params || {};
    var p = path.replace(/^\/api\//, '');

    if (p === 'meta') {
      return loadMeta().then(function (D) {
        return {
          version: D.version,
          source: D.source,
          note: D.note,
          categories: D.categories || [],
          groups: D.groups || [],
          stats: categoryStats(),
          total: S.records.length,
          totalChars: w.Search.totalChars()
        };
      });
    }

    if (p === 'search') {
      var q = String(params.q || '').trim();
      var needAll = q ? allBodyKeys() : [];
      return loadMeta().then(function () {
        /* 两段式检索：
           ① 立刻用「标题 / 摘要 / 标签 / 发文机关」这些元信息出结果 —— 零额外下载，毫秒级；
           ② 正文分片（24 片，约 39MB 源码 / 传输约 12MB）在后台并行下载，
              每片到达就并回记录、增量重建该条的索引，全文命中随之出现。
           客户端收到 partial=true 时应显示「正在补充全文命中」，等 onBodiesReady 后重查。 */
        var res = doSearch(params);
        var ready = allBodiesLoaded();
        res.partial = needAll.length > 0 && !ready;
        res.loadingBodies = needAll.length > 0 && !ready;
        if (needAll.length && !ready) {
          ensureBodies(needAll).catch(function () { /* 失败不阻塞已出的元信息结果 */ });
        }
        return res;
      });
    }

    if (p === 'recs') {
      var ids = String(params.ids || '').split(',');
      var items = [];
      for (var i = 0; i < ids.length; i++) {
        var id = ids[i].trim();
        if (!id) continue;
        var rec = S.byId[id];
        if (!rec) continue;
        items.push({
          id: rec.id, title: rec.title, cat: rec.cat, catName: rec.catName,
          group: rec.group || '', issuer: rec.issuer || '',
          published: rec.published || '', year: rec.year,
          chars: rec.chars || 0, tags: rec.tags || [], summary: rec.summary || '',
          url: rec.url || '', source: rec.source || '',
          effect: rec.effect || '', flxz: rec.flxz || ''
        });
      }
      return Promise.resolve({ items: items });
    }

    if (p === 'suggest') {
      var sq = String(params.q || '').trim();
      return loadMeta().then(function () {
        var list = w.Search.suggest(sq, 8);
        return {
          items: list.map(function (d) {
            return { id: d.id, title: d.title, catName: d.catName, cat: d.cat };
          })
        };
      });
    }

    if (p === 'doc') {
      var did = String(params.id || '').trim();
      return loadMeta().then(function () {
        var rec = S.byId[did];
        if (!rec) throw new Error('未找到该法规');
        /* 只加载它所在的那一片 */
        return rec.bf ? ensureBodies([rec.bf]) : null;
      }).then(function () {
        return docOf(S.byId[did], params.q || '');
      });
    }

    if (p === 'timeline') {
      return loadMeta().then(function () {
        return { years: timeline() };
      });
    }

    if (p === 'export') {
      var eids = String(params.ids || '').split(',');
      var fmt = params.fmt || 'txt';
      return loadMeta().then(function () {
        /* 导出要正文，先把这几篇所在的分片加载进来 */
        var keys = [];
        for (var i = 0; i < eids.length; i++) {
          var rec = S.byId[eids[i].trim()];
          if (rec && rec.bf && keys.indexOf(rec.bf) === -1) keys.push(rec.bf);
        }
        return keys.length ? ensureBodies(keys) : null;
      }).then(function () {
        return exportDocs(eids.map(function (x) { return x.trim(); }), fmt);
      });
    }

    return Promise.reject(new Error('未知接口：' + path));
  }

  /* 导出是文本而非 JSON，客户端单独走这个入口 */
  function exportText(ids, fmt) {
    return request('/api/export', { ids: ids, fmt: fmt });
  }

  w.FGStaticAPI = {
    enabled: true,
    request: request,
    exportText: exportText,
    onProgress: function (cb) {
      if (typeof cb === 'function') S.listeners.push(cb);
    },
    /* 正文分片全部到齐时回调一次：客户端据此重跑检索，补上全文命中 */
    onBodiesReady: function (cb) {
      if (typeof cb !== 'function') return;
      if (S.bodiesReady) { cb(); return; }
      S.readyListeners.push(cb);
    },
    bodiesReady: function () { return S.bodiesReady; },
    progress: function () { return S.progress; },
    ensureBodies: ensureBodies,
    loadMeta: loadMeta
  };
})(window);
