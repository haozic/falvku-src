/* ==========================================================================
   app.js —— 应用主体：路由、视图渲染与交互
   ========================================================================== */
(function (w, d) {
  'use strict';

  var $ = function (sel, root) { return (root || d).querySelector(sel); };
  var $$ = function (sel, root) {
    var ctx = root || d;
    if (ctx === d || ctx.nodeType === 9) return Array.prototype.slice.call(d.querySelectorAll(sel));
    return Array.prototype.slice.call(ctx.querySelectorAll(sel));
  };

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function num(n) { return String(n || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  /* 分部标题（第X编 / 第X篇 / 总则 / 分则 / 附则 / 序言）：
     层级上算一级，但视觉上要能和「第X章」区分开。 */
  var PART_RE = /^(第[一二三四五六七八九十百零〇两\d]+(分)?[编篇卷部]|总\s*则|分\s*则|附\s*则|序\s*言)/;
  function isPartTitle(nm) { return PART_RE.test(String(nm || '').replace(/\s+/g, '')); }

  /* 章节正文 → Markdown 源文本。
     条文编号（第一条）加粗；条目序号（一、／（一））也加粗，但**保留原文写法**。 */
  function sectionMarkdown(sec, name) {
    var out = [];
    var lines = String((sec && sec.text) || '').split(/\n+/);
    var first = true;
    lines.forEach(function (line) {
      var t = line.trim();
      if (!t) return;
      /* 人民网源页面「章节名」与正文首行重复，去掉 */
      if (first && name && t.replace(/\s/g, '') === name.replace(/\s/g, '')) { first = false; return; }
      first = false;
      var m = /^(第[一二三四五六七八九十百零〇两]+条)(.*)$/.exec(t);
      if (m) {
        out.push('**' + m[1] + '**' + (m[2] ? ' ' + m[2].trim() : ''));
        return;
      }
      /* 二级条目序号（一）（二）…：
         早先转成 Markdown 列表（"- 一、xxx"），有两个问题——
         一是把原文的「（一）」改写成了「一、」，与原文对不上；
         二是渲染出来带一颗黑点，公文里的条目序号本来就没有列表符号。
         现在保留原文的编号写法（含全角/半角括号），只把序号加粗，
         与「第X条」的处理一致。全库约 5.2 万行、1869 部法规走这条路径。 */
      var li = /^([（(][一二三四五六七八九十百零〇两\d]+[)）])\s*(.*)$/.exec(t);
      if (li) {
        out.push('**' + li[1] + '**' + (li[2] ? ' ' + li[2] : ''));
        return;
      }
      out.push(t);
    });
    return out.join('\n\n');
  }

  function fmtDate(iso) {
    if (!iso) return '';
    var p = String(iso).split('-');
    if (p.length === 3) return p[0] + '年' + parseInt(p[1], 10) + '月' + parseInt(p[2], 10) + '日';
    if (p.length === 2) return p[0] + '年' + parseInt(p[1], 10) + '月';
    if (p.length === 1 && /^\d{4}$/.test(p[0])) return p[0] + '年';
    return iso;
  }

  /* 条目的「公布日期」：优先 published（现行版本公布日），
     退回 revised / adopted；只有年份时显示「YYYY年」。 */
  function pubDate(doc) {
    if (!doc) return '';
    return doc.published || doc.revised || doc.adopted || '';
  }

  /* 公布日期所属年份：与时间轴分组口径一致。 */
  function pubYear(doc) {
    if (!doc) return 0;
    var s = pubDate(doc);
    var y = parseInt(String(s).slice(0, 4), 10);
    if (y) return y;
    return doc.year || 0;
  }

  function byId(id) { return d.getElementById(id); }

  /* ================================================================ 状态 */
  var state = {
    cats: [],
    sort: 'relevance',
    page: 1,
    lastIds: [],
    lastLabel: '检索结果'
  };

  var CATS = (window.FG_DATA && window.FG_DATA.categories) || [];
  var GROUPS = (window.FG_DATA && window.FG_DATA.groups) || [];

  /* 首页视觉素材
     国徽与建筑剪影改为 assets/img/ 下的本地图片（取自国家法律法规数据库 flk.npc.gov.cn 首页），
     随站点打包，不产生任何外部请求。 */
  var EMBLEM_IMG = '<img class="flk-emblem" src="assets/img/flk-emblem.png" alt="" aria-hidden="true">';

  /* 图标系统：24×24 线性图标，统一 stroke=currentColor。
     早期用 ◆▦★✎◷⇩ 这类字符当图标，不同字体下字形不一致，很不专业。 */
  function svg(paths, size) {
    return '<svg viewBox="0 0 24 24" width="' + (size || 17) + '" height="' + (size || 17) +
      '" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      paths + '</svg>';
  }
  var ICON = {
    search: svg('<circle cx="11" cy="11" r="7"/><path d="M16.5 16.5L21 21"/>'),
    grid: svg('<rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/>'),
    clock: svg('<circle cx="12" cy="12" r="8.4"/><path d="M12 7.2V12l3.2 2.1"/>'),
    star: svg('<path d="M12 3.9l2.6 5.3 5.8.85-4.2 4.1 1 5.8L12 17.3l-5.2 2.65 1-5.8-4.2-4.1 5.8-.85L12 3.9z"/>'),
    starFill: svg('<path fill="currentColor" stroke="none" d="M12 3.9l2.6 5.3 5.8.85-4.2 4.1 1 5.8L12 17.3l-5.2 2.65 1-5.8-4.2-4.1 5.8-.85L12 3.9z"/>'),
    pen: svg('<path d="M4.5 19.5h15"/><path d="M13.2 4.8l6 6L9.4 20.6l-6 1 1-6 8.8-10.8z"/>'),
    down: svg('<path d="M12 3.8v10.4"/><path d="M7.8 10.4L12 14.6l4.2-4.2"/><path d="M4.6 16.4v2.2a1.8 1.8 0 001.8 1.8h11.2a1.8 1.8 0 001.8-1.8v-2.2"/>'),
    plus: svg('<path d="M12 5.2v13.6M5.2 12h13.6"/>'),
    /* 门类图标 */
    book: svg('<path d="M4 5.6A2.6 2.6 0 016.6 3H19v17.4H6.6A2.6 2.6 0 004 23V5.6z"/><path d="M4 17.8A2.6 2.6 0 016.6 15.2H19"/>', 22),
    scale: svg('<path d="M12 4v16"/><path d="M6.4 20h11.2"/><path d="M5 7.6h14"/><path d="M5 7.6L2.4 13h5.2L5 7.6z"/><path d="M19 7.6L16.4 13h5.2L19 7.6z"/>', 22),
    stamp: svg('<rect x="4.2" y="10.4" width="15.6" height="8.6" rx="1.6"/><path d="M8.4 10.4V7.6a3.6 3.6 0 017.2 0v2.8"/><path d="M7.4 14.6h9.2"/>', 22),
    shield: svg('<path d="M12 3.2l7.2 2.9v5.6c0 4.3-3 8.1-7.2 9.6-4.2-1.5-7.2-5.3-7.2-9.6V6.1L12 3.2z"/><path d="M9 12l2.2 2.2 4.3-4.6"/>', 22),
    flag: svg('<path d="M6.2 21V3.6"/><path d="M6.2 4.6h11.4l-2.6 3.7 2.6 3.7H6.2z"/><path d="M6.2 21h4"/>', 22),
    folder: svg('<path d="M3.6 7.6A1.8 1.8 0 015.4 5.8h4.3l2 2.6h7.1a1.8 1.8 0 011.8 1.8v8.2a1.8 1.8 0 01-1.8 1.8H5.4a1.8 1.8 0 01-1.8-1.8V7.6z"/>', 22),
    pin: svg('<path d="M12 21.2s6.4-6.3 6.4-10.6a6.4 6.4 0 10-12.8 0c0 4.3 6.4 10.6 6.4 10.6z"/><circle cx="12" cy="10.5" r="2.4"/>', 22),
    /* 空状态 */
    none: svg('<circle cx="12" cy="12" r="8.4"/><path d="M6.4 6.4l11.2 11.2"/>'),
    warn: svg('<path d="M12 3.6l9.2 16H2.8L12 3.6z"/><path d="M12 9.4v4.4"/><path d="M12 16.4v.2"/>')
  };
  var CAT_ICON = {
    xianfa: ICON.book, falv: ICON.scale, xingzheng: ICON.stamp, jiancha: ICON.shield,
    dangnei: ICON.flag, dangwu: ICON.folder, hubei: ICON.pin
  };

  /* ================================================================ 工具 */
  function toast(msg) {
    var root = byId('toastRoot');
    if (!root) return;
    var el = d.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(function () { el.className = 'toast show'; }, 10);
    setTimeout(function () {
      el.className = 'toast';
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 300);
    }, 2200);
  }

  function catById(id) {
    for (var i = 0; i < CATS.length; i++) if (CATS[i].id === id) return CATS[i];
    return null;
  }

  function catColor(id) {
    var c = catById(id);
    return c ? c.color : '#8a93a5';
  }

  function hashQuery() {
    var h = (w.location.hash || '').split('?')[1] || '';
    var out = {};
    if (!h) return out;
    h.split('&').forEach(function (kv) {
      if (!kv) return;
      var p = kv.split('=');
      out[decodeURIComponent(p[0])] = decodeURIComponent((p[1] || '').replace(/\+/g, ' '));
    });
    return out;
  }

  function go(hash) {
    if (w.location.hash === hash) route();
    else w.location.hash = hash;
  }

  function titleOf(doc) {
    return doc.title + (doc.version ? '（' + doc.version + '）' : '');
  }

  function docUrl(id) { return '#/doc/' + encodeURIComponent(id); }

  /* ============================================================ 初始化 */
  function boot() {
    applyTheme(Store.settings.get('theme'));
    var n = Search.init(mergeData());
    indexCustom();
    bindGlobal();
    renderSideCats();
    refreshCounts();
    var bi = byId('buildInfo');
    if (bi) {
      bi.textContent = ((window.FG_DATA && window.FG_DATA.version) || '') + ' 版 · 共 ' + n + ' 条 · 本地离线可用';
    }
    w.addEventListener('hashchange', route);
    route();
  }

  /* 合并全库元信息（window.FG_DATA）与已加载的正文分片
     （window.FG_PARTY / window.FG_FLK / window.FG_HUBEI）。

     正文分片是按需加载的：启动只载元信息，打开详情页/检索时才把分片挂上来，
     这里把分片里的正文并回对应记录（记录对象是同一批，重复并入是幂等的）。 */
  var bodyMapCache = null;

  function bodyRecordMap() {
    if (bodyMapCache) return bodyMapCache;
    bodyMapCache = {};
    var recs = (window.FG_DATA && window.FG_DATA.records) || [];
    for (var i = 0; i < recs.length; i++) bodyMapCache[recs[i].id] = recs[i];
    return bodyMapCache;
  }

  /* 把一批正文并回记录，返回被更新的记录（供增量建索引用） */
  function mergeBodies(bodies) {
    var map = bodyRecordMap(), updated = [];
    for (var i = 0; i < (bodies || []).length; i++) {
      var rec = map[bodies[i].id];
      if (rec) {
        rec.sections = bodies[i].sections || [];
        updated.push(rec);
      }
    }
    return updated;
  }

  /* 正文分片是「数组的数组」：window.FG_FLK = [ [记录…], [记录…] ]。
     统一用这个函数展开一层，避免某一路少展开一层导致正文并不回去。 */
  function flattenChunks(list) {
    var out = [];
    for (var i = 0; i < (list || []).length; i++) {
      var part = list[i];
      if (Object.prototype.toString.call(part) === '[object Array]') out = out.concat(part);
      else out.push(part);
    }
    return out;
  }

  function loadedBodies() {
    var out = [];
    if (window.FG_PARTY) out = out.concat(flattenChunks(window.FG_PARTY));
    if (window.FG_FLK) out = out.concat(flattenChunks(window.FG_FLK));
    if (window.FG_HUBEI) out = out.concat(flattenChunks(window.FG_HUBEI));
    return out;
  }

  function mergeData() {
    var base = window.FG_DATA || { records: [], categories: [] };
    var recs = base.records || [];
    mergeBodies(loadedBodies());
    return {
      version: base.version, source: base.source, note: base.note,
      categories: base.categories || [], groups: base.groups || [],
      records: recs
    };
  }

  /* ================================================ 正文按需加载
     启动只解析 data/regulations.js 的元信息（约 2.2MB），
     正文（data/flk_*.js / data/hubei_*.js / data/party_*.js，共约 39MB）按需加载：
     打开详情页只加载该条目所在的那一个分片，检索才需要全部分片。
     低配机器上这一下把启动的解析量降了 20 多倍。

     分片一个一个加载：每解析完一个就把主线程让回浏览器，
     进度提示才有机会刷新，不会一次解析 39MB 把页面卡死。 */
  var bodyLoaded = {};      // 已加载的正文分片 key

  function assetVersion() {
    var s = document.querySelector('script[src*="assets/js/app.js"]');
    var m = s && /[?&]v=([^"&]+)/.exec(s.src);
    return m ? m[1] : '';
  }

  function bodyFileList() {
    return (window.FG_DATA && window.FG_DATA.bodyFiles) || [];
  }

  function ensureBodies(keys, onDone, onProgress, onChunk) {
    var need = [];
    for (var i = 0; i < keys.length; i++) {
      if (keys[i] && !bodyLoaded[keys[i]] && need.indexOf(keys[i]) < 0) need.push(keys[i]);
    }
    if (!need.length) { if (onDone) onDone(); return; }
    var total = need.length;
    var left = total;
    /* 并行发起：网络/磁盘读可以重叠，每个分片各自是一个脚本任务，
       解析间隙浏览器还能刷新进度提示，不会一次把主线程占满几秒。 */
    need.forEach(function (key) {
      var gname = bodyGlobalOf(key);
      var before = (window[gname] || []).length;
      var s = document.createElement('script');
      s.src = 'data/' + key + '.js?v=' + assetVersion();
      s.onload = function () {
        bodyLoaded[key] = true;
        /* 这一片刚挂上来的正文（可能有别的同源分片也同时到了，一并取走也无妨，
           重复并入是幂等的）—— 立刻并回记录并增量建索引，
           用户能更早看到已能检索的内容，不必等全部 24 片都下完。 */
        if (onChunk) {
          var arr = window[gname] || [];
          var added = flattenChunks(arr.slice(before));
          if (added.length) onChunk(added);
        }
        left--;
        if (onProgress) onProgress(total - left, total, key);
        if (!left && onDone) onDone();
      };
      s.onerror = function () {
        if (w.console && w.console.error) w.console.error('[body]', key);
        toast('正文分片加载失败：' + key);
        left--;
        if (onProgress) onProgress(total - left, total, key);
        if (!left && onDone) onDone();
      };
      document.head.appendChild(s);
    });
  }

  /* 分片 key → 它挂在哪个全局变量上 */
  function bodyGlobalOf(key) {
    if (key.indexOf('flk') === 0) return 'FG_FLK';
    if (key.indexOf('hubei') === 0) return 'FG_HUBEI';
    return 'FG_PARTY';
  }

  function showBodyLoading(total) {
    var v = byId('view');
    if (!v) return;
    v.innerHTML = '<div class="empty"><div class="empty-icon">' + ICON.clock + '</div>' +
      '<div>正在加载正文…</div>' +
      '<div class="load-tip" id="bodyLoadTip">首次使用需要载入正文分片（共 ' + total + ' 个，约 39MB，仅此一次）</div></div>';
  }

  function updateBodyLoading(done, total, key) {
    var t = byId('bodyLoadTip');
    if (t) t.textContent = '已加载 ' + done + ' / ' + total + ' 个分片（' + key + '）…';
  }

  /* 导出前确保这些条目所在的正文分片已加载 —— 否则导出的正文是空的 */
  function exportWithBodies(docs, fmt, name, done) {
    var keys = [];
    for (var i = 0; i < docs.length; i++) {
      var doc = docs[i];
      if (doc && doc.bf && !bodyLoaded[doc.bf] && keys.indexOf(doc.bf) < 0) keys.push(doc.bf);
    }
    if (!keys.length) { done(); return; }
    toast('正在加载正文…');
    ensureBodies(keys, function () {
      /* Search.init 会清空索引，自建条目必须重新挂回去，否则检索不到 */
      Search.init(mergeData());
      indexCustom();
      done();
    });
  }


  function indexCustom() {
    Store.custom.list().forEach(function (rec) {
      var r = Search.addDoc(normalizeCustom(rec));
    });
  }

  function normalizeCustom(rec) {
    var text = rec.text || '';
    var sections = rec.sections && rec.sections.length
      ? rec.sections
      : [{ name: rec.sectionName || '', text: text }];
    return {
      id: rec.id,
      title: rec.title || '未命名条目',
      cat: rec.cat || 'local',
      catName: (catById(rec.cat || 'local') || {}).name || '本机自建',
      level: (catById(rec.cat || 'local') || {}).level || 99,
      issuer: rec.issuer || '',
      adopted: rec.adopted || '',
      published: rec.adopted || '',
      effective: rec.effective || '',
      year: rec.adopted ? parseInt(String(rec.adopted).slice(0, 4), 10) : 0,
      summary: rec.summary || '',
      tags: rec.tags || [],
      url: rec.url || '',
      chars: text.replace(/\s/g, '').length,
      sections: sections,
      custom: true,
      version: ''
    };
  }

  /* ============================================================ 主题 */
  function applyTheme(t) {
    d.documentElement.setAttribute('data-theme', t === 'dark' ? 'dark' : 'light');
    Store.settings.set('theme', t === 'dark' ? 'dark' : 'light');
  }

  /* ======================================================== 全局事件 */
  function bindGlobal() {
    // 顶栏搜索
    var form = byId('searchForm'), input = byId('searchInput'), sug = byId('suggest');
    var clearBtn = byId('searchClear');
    if (!form || !input) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      hideSuggest();
      go('#/search?q=' + encodeURIComponent(input.value.trim()));
      input.blur();
    });
    /* 输入联想：低配机器上每次按键都跑一遍 suggest（扫全部条目标题）会明显卡，
       所以防抖 150ms 再算 —— 打完字停一下就出结果，手感更顺。 */
    var sugTimer = 0;
    input.addEventListener('input', function () {
      var v = input.value.trim();
      if (clearBtn) clearBtn.hidden = !v;
      if (!v || !sug) { hideSuggest(); return; }
      clearTimeout(sugTimer);
      sugTimer = setTimeout(function () {
        var list = Search.suggest(v, 8);
        if (!list.length) { hideSuggest(); return; }
        var parsed = Search.parse(v);
        var terms = parsed.terms.concat(parsed.phrases);
        var html = '';
        list.forEach(function (doc) {
          html += '<a class="suggest-item" href="' + docUrl(doc.id) + '">' +
            '<span class="st">' + Search.highlight(doc.title, terms) + '</span>' +
            '<span class="sm">' + esc(doc.catName) + (doc.year ? ' · ' + doc.year + '年' : '') + '</span></a>';
        });
        sug.innerHTML = html;
        sug.hidden = false;
      }, 150);
    });
    input.addEventListener('blur', function () { setTimeout(hideSuggest, 160); });
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        input.value = ''; this.hidden = true; hideSuggest(); input.focus();
      });
    }
    d.addEventListener('click', function (e) {
      // 长列表的「再显示一批」
      var mb = e.target.closest ? e.target.closest('[data-more]') : null;
      if (mb) { onMore(mb.getAttribute('data-more')); return; }
      if (sug && !sug.contains(e.target) && e.target !== input) hideSuggest();
    });

    // 主题切换
    var themeBtn = byId('themeBtn');
    if (themeBtn) {
      themeBtn.addEventListener('click', function () {
        var cur = d.documentElement.getAttribute('data-theme');
        applyTheme(cur === 'dark' ? 'light' : 'dark');
      });
    }

    // 侧栏抽屉
    var sideToggle = byId('sideToggle'), sidebar = byId('sidebar'), scrim = byId('scrim');
    if (sideToggle && sidebar) {
      sideToggle.addEventListener('click', function () {
        sidebar.classList.toggle('open');
        if (scrim) scrim.hidden = !sidebar.classList.contains('open');
      });
    }
    if (scrim) {
      scrim.addEventListener('click', function () {
        if (sidebar) sidebar.classList.remove('open');
        scrim.hidden = true;
      });
    }

    /* 结果卡片上的「导出」：直接下载这一条，不要再跳到导出中心让人多选一次 */
    d.addEventListener('click', function (e) {
      var el = e.target.closest ? e.target.closest('[data-exp]') : null;
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      var doc = Search.get(el.getAttribute('data-exp'));
      if (!doc) { toast('未找到该条目'); return; }
      exportWithBodies([doc], 'md', doc.title, function () {
        var res = Exporter.exportDocs([doc], 'md', doc.title);
        toast(res.ok ? ('已导出 ' + res.name) : res.msg);
      });
    });

    /* 详情页浮层（阅读设置面板、导出格式菜单）的「点外面收起」：
       整个应用只挂这一个监听器。渲染详情页时把当前浮层登记到 docPopCtx，
       离开详情页时置空 —— 否则翻页后旧监听器会把新面板点没。 */
    d.addEventListener('click', function (e) {
      var c = docPopCtx;
      if (!c) return;
      if (c.panel && !c.panel.hidden && !c.panel.contains(e.target) &&
        !(c.btn && (c.btn === e.target || c.btn.contains(e.target)))) {
        c.panel.hidden = true;
      }
      if (c.expMenu && !c.expMenu.hasAttribute('hidden') && c.expMenu.parentNode &&
        !c.expMenu.parentNode.contains(e.target)) {
        c.expMenu.setAttribute('hidden', '');
        if (c.expToggle) c.expToggle.setAttribute('aria-expanded', 'false');
      }
    });

    // 快捷键
    d.addEventListener('keydown', function (e) {
      var tag = (e.target.tagName || '').toLowerCase();
      if (e.key === '/' && tag !== 'input' && tag !== 'textarea') {
        e.preventDefault();
        input.focus();
        input.select();
      } else if (e.key === 'Escape') {
        hideSuggest();
        closeModal();
      }
    });

    // 弹层关闭
    $$('#modalRoot [data-close]').forEach(function (el) {
      el.addEventListener('click', closeModal);
    });
  }

  function hideSuggest() { var s = byId('suggest'); if (s) { s.hidden = true; s.innerHTML = ''; } }

  /* ========================================================== 侧栏体系树 */
  /* 早先把 16 个门类全部平铺在侧栏，首屏塞不下、也分不清层级。
     现在收成「体系 → 门类」两级手风琴：默认只显示 4 个体系，
     点开才看门类；进入某门类时该体系会自动展开并高亮。 */
  var sideTree = { open: '' };

  function renderSideCats() {
    var counts = Search.byCategory();
    var box = byId('sideCats');
    if (!box) return;
    var groups = GROUPS.length ? GROUPS : [{ id: '', name: '全部门类', cats: CATS.map(function (c) { return c.id; }) }];
    var html = '';
    groups.forEach(function (g) {
      var n = 0;
      (g.cats || []).forEach(function (id) { if (counts[id]) n += counts[id].count; });
      var open = (sideTree.open === g.id);
      html += '<div class="tree' + (open ? ' open' : '') + '">' +
        '<button type="button" class="tree-head" data-g="' + g.id + '" aria-expanded="' + (open ? 'true' : 'false') + '">' +
        '<span class="ti" aria-hidden="true"></span>' +
        '<span class="tg">' + esc(g.name) + '</span>' +
        '<span class="n">' + num(n) + '</span></button>' +
        '<div class="tree-body"' + (open ? '' : ' hidden') + '>';
      (g.cats || []).forEach(function (id) {
        var c = catById(id);
        if (!c) return;
        var info = counts[id];
        html += '<a href="#/browse/' + id + '" data-cat="' + id + '">' +
          '<span class="dot" style="background:' + c.color + '"></span>' +
          '<span class="t">' + esc(c.name) + '</span>' +
          '<span class="n">' + (info ? info.count : 0) + '</span></a>';
      });
      html += '</div></div>';
    });
    box.innerHTML = html;
    $$('#sideCats .tree-head').forEach(function (b) {
      b.addEventListener('click', function () {
        var g = b.getAttribute('data-g');
        sideTree.open = (sideTree.open === g) ? '' : g;
        renderSideCats();
        var route = curRoute();
        markActive(route.name, route.arg);
      });
    });
  }

  function curRoute() {
    var raw = (w.location.hash || '').replace(/^#\/?/, '');
    var qi = raw.indexOf('?');
    var path = qi >= 0 ? raw.slice(0, qi) : raw;
    var parts = path.split('/');
    return { name: parts[0] || 'home', arg: parts[1] ? decodeURIComponent(parts[1]) : '' };
  }

  function refreshCounts() {
    $('#favCountSide').textContent = Store.fav.count();
    $('#customCountSide').textContent = Store.custom.count();
    var mc = byId('marksCountSide');
    if (mc) mc.textContent = Store.marks.count();
  }

  /* ============================================================ 路由 */
  function route() {
    var raw = (w.location.hash || '').replace(/^#\/?/, '');
    var qi = raw.indexOf('?');
    var path = qi >= 0 ? raw.slice(0, qi) : raw;
    var parts = path.split('/');
    var name = parts[0] || 'home';
    var arg = parts[1] ? decodeURIComponent(parts[1]) : '';
    var q = hashQuery();
    hideSuggest();
    var view = byId('view');
    if (!view) return;
    /* 离开详情页：注销浮层上下文，免得 document 监听器去操作已卸载的节点 */
    if (name !== 'doc') docPopCtx = null;
    if (d.body) {
      d.body.className = (name === 'home') ? 'home-page' : '';
      var tg = byId('sideToggle');
      if (tg) tg.hidden = (name === 'home');
    }

    /* 体系树：进入某个门类/体系时，自动展开它所在的体系，
       否则用户会看到一棵树却不知道自己在哪一枝。 */
    var openG = '';
    if (name === 'group') {
      openG = arg;
    } else if (name === 'browse' && arg) {
      for (var gi = 0; gi < GROUPS.length; gi++) {
        if ((GROUPS[gi].cats || []).indexOf(arg) >= 0) { openG = GROUPS[gi].id; break; }
      }
    }
    if (openG) sideTree.open = openG;
    renderSideCats();

    /* 正文按需加载：详情页只需要该条目所在的那个分片，检索需要全部分片。
       缺正文时先加载（带进度提示），加载完再渲染。
       注意要先筛掉「还没加载的分片」：直接拿全表去 ensureBodies 会因为
       「没有待加载项」而立刻回调，route() 重入就变成无限递归。 */
    var needBodies = null;
    if (name === 'doc') {
      var doc = Search.get(arg);
      if (doc && doc.bf && !bodyLoaded[doc.bf]) needBodies = [doc.bf];
    } else if (name === 'search' && (q.q || '').trim()) {
      needBodies = bodyFileList();
    }
    if (needBodies && needBodies.length) {
      var missing = [];
      for (var bi = 0; bi < needBodies.length; bi++) {
        if (!bodyLoaded[needBodies[bi]]) missing.push(needBodies[bi]);
      }
      if (missing.length) {
        showBodyLoading(missing.length);
        ensureBodies(missing, function () { route(); }, updateBodyLoading, function (bodies) {
          /* 每片到达就并回并增量建索引：不必等 24 片全下完才见结果 */
          var updated = mergeBodies(bodies);
          for (var i = 0; i < updated.length; i++) Search.refreshDoc(updated[i]);
        });
        return;
      }
    }

    try {
      if (name === 'home') renderHome();
      else if (name === 'search') renderSearch(q);
      else if (name === 'doc') renderDoc(arg, q);
      else if (name === 'browse') renderBrowse(arg);
      else if (name === 'group') renderGroup(arg);
      else if (name === 'favorites') renderFavorites();
      else if (name === 'notes') renderNotes(q);
      else if (name === 'custom') renderCustom();
      else if (name === 'add') renderAdd(arg);
      else if (name === 'timeline') renderTimeline();
      else if (name === 'export') renderExport(q);
      else { view.innerHTML = '<div class="empty"><div class="empty-icon">' + ICON.none + '</div>页面不存在</div>'; }
    } catch (err) {
      view.innerHTML = '<div class="card"><div class="empty"><div class="empty-icon">' + ICON.warn + '</div>' +
        '<div>页面渲染出错：' + esc(err && err.message ? err.message : String(err)) + '</div>' +
        '<div style="margin-top:10px"><a class="btn btn-sm" href="#/home">返回首页</a></div></div></div>';
      if (w.console && w.console.error) w.console.error('[render]', err);
    }

    markActive(name, arg);
    w.scrollTo(0, 0);
  }

  function markActive(name, arg) {
    $$('.side-link').forEach(function (a) { a.classList.remove('active'); });
    var map = { home: '#/home', search: '#/search', browse: '#/browse', group: '#/browse', favorites: '#/favorites', custom: '#/custom', notes: '#/notes', timeline: '#/timeline', export: '#/export' };
    var target = map[name];
    if (target) {
      $$('.side-link').forEach(function (a) {
        if (a.getAttribute('href') === target) a.classList.add('active');
      });
    }
    /* 体系树：标出当前门类 / 当前体系 */
    $$('#sideCats a[data-cat]').forEach(function (a) {
      a.classList.remove('active');
      if (a.getAttribute('data-cat') === arg) a.classList.add('active');
    });
    $$('#sideCats .tree-head').forEach(function (b) {
      b.classList.remove('active');
      if (b.getAttribute('data-g') === arg) b.classList.add('active');
    });
  }

  /* ============================================================ 首页 */
  function renderHome() {
    var stats = Search.byCategory();
    var chars = Search.totalChars();
    var all = Search.all();
    var catCount = Object.keys(stats).length;

    /* ---- 门类卡片矩阵 ---- */
    function sumCats(cats) {
      var n = 0, c = 0;
      (cats || []).forEach(function (id) {
        if (stats[id]) { n += stats[id].count; c += stats[id].chars; }
      });
      return { n: n, c: c };
    }
    var catCards = '';
    ['xianfa', 'falv', 'xingzheng', 'jiancha'].forEach(function (id) {
      var c = catById(id);
      if (!c) return;
      var info = stats[id] || { count: 0 };
      catCards += '<a class="flk-cat ' + (c.tone || '') + '" href="#/browse/' + id + '">' +
        '<span class="ci">' + (CAT_ICON[id] || '') + '</span>' +
        '<span class="cn">' + esc(c.name) + '</span>' +
        '<span class="cc">' + num(info.count) + ' 部</span><i></i></a>';
    });
    GROUPS.forEach(function (g) {
      if (g.id === 'guojia' || g.id === 'local') return;
      var info = sumCats(g.cats);
      catCards += '<a class="flk-cat ' + (g.tone || '') + '" href="#/group/' + g.id + '">' +
        '<span class="ci">' + (CAT_ICON[g.id] || '') + '</span>' +
        '<span class="cn">' + esc(g.name) + '</span>' +
        '<span class="cc">' + num(info.n) + ' 部</span><i></i></a>';
    });

    /* ---- 检索范围下拉 ---- */
    var scopeOpt = '<option value="">全库检索</option>';
    GROUPS.forEach(function (g) {
      scopeOpt += '<option value="g:' + g.id + '">' + esc(g.name) + '</option>';
    });
    CATS.forEach(function (c) {
      scopeOpt += '<option value="c:' + c.id + '">' + esc(c.name) + '</option>';
    });

    /* ---- 热门检索词 ---- */
    var hotWords = [
      '纪律处分', '基层党组织', '干部选拔任用', '党务公开', '民主生活会',
      '民法典', '行政处罚', '食品安全', '劳动合同', '环境保护', '监察法', '立法法'
    ];
    var hotHtml = hotWords.map(function (t) {
      return '<a href="#/search?q=' + encodeURIComponent(t) + '">' + esc(t) + '</a>';
    }).join('');

    /* ---- 新法速递 ---- */
    var latest = all.filter(function (d) { return pubDate(d); }).sort(function (a, b) {
      var x = pubDate(a), y = pubDate(b);
      if (x !== y) return x < y ? 1 : -1;
      return (pubYear(b) || 0) - (pubYear(a) || 0);
    }).slice(0, 22);
    var latestHtml = latest.map(function (d) {
      return '<li><a href="' + docUrl(d.id) + '">' +
        '<span class="bullet" style="background:' + catColor(d.cat) + '"></span>' +
        '<span class="lt">' + esc(d.title) + '</span>' +
        '<span class="lcat" style="background:' + catColor(d.cat) + '">' + esc(d.catName) + '</span>' +
        '<span class="lm">' + esc(fmtDate(pubDate(d))) + '</span></a></li>';
    }).join('');

    /* ---- 核心党内法规 ---- */
    var featured = [
      '中国共产党章程', '关于新形势下党内政治生活的若干准则', '中国共产党纪律处分条例',
      '中国共产党问责条例', '中国共产党巡视工作条例', '中国共产党组织工作条例',
      '中国共产党党组工作条例', '中国共产党党内法规制定条例'
    ];
    var featHtml = '';
    featured.forEach(function (t) {
      var doc = null;
      for (var i = 0; i < all.length; i++) { if (all[i].title === t) { doc = all[i]; break; } }
      if (!doc) return;
      featHtml += '<li><a href="' + docUrl(doc.id) + '">' +
        '<span class="bullet" style="background:' + catColor(doc.cat) + '"></span>' +
        '<span class="lt">' + esc(doc.title) + '</span>' +
        '<span class="lm">' + esc(doc.issuer || doc.catName) + '</span></a></li>';
    });

    /* ---- 主题标签 ---- */
    var tagCount = {};
    all.forEach(function (x) {
      (x.tags || []).forEach(function (t) { tagCount[t] = (tagCount[t] || 0) + 1; });
    });
    var tagList = Object.keys(tagCount).sort(function (a, b) { return tagCount[b] - tagCount[a]; }).slice(0, 18);
    var tagHtml = tagList.map(function (t) {
      return '<a class="tag" href="#/search?q=' + encodeURIComponent(t) + '">' + esc(t) + ' <b style="opacity:.6">' + tagCount[t] + '</b></a>';
    }).join(' ');

    /* ---- 全库门类目录 ---- */
    var dirHtml = '';
    CATS.forEach(function (c) {
      var info = stats[c.id] || { count: 0, chars: 0 };
      dirHtml += '<li' + (info.count ? '' : ' class="zero"') + '><a href="#/browse/' + c.id + '">' +
        '<span class="bullet" style="background:' + c.color + '"></span>' +
        '<span class="lt">' + esc(c.name) + '</span>' +
        '<span class="lm">' + num(info.count) + ' 部 · ' + num(info.chars) + ' 字</span></a></li>';
    });

    /* ---- 快捷入口 ---- */
    /* 原先这里有个「快捷入口」面板（6 条链接），与侧栏完全重复，
       首页右栏因此被撑高、两栏参差 —— 已删除，入口统一由侧栏承担。 */
    var quickHtml = '';

    $('#view').innerHTML =
      '<section class="flk-hero">' +
      '<div class="flk-hero-inner">' +
      '<div class="flk-brand">' + EMBLEM_IMG +
      '<div class="flk-brand-text"><h1>法律法规库</h1>' +
      '<p>党内法规 · 国家法律法规 · 离线全文检索</p></div></div>' +
      '<div class="flk-rule"></div>' +
      '<form class="flk-search" id="heroForm" autocomplete="off">' +
      '<select id="heroScope" aria-label="检索范围">' + scopeOpt + '</select>' +
      '<input type="text" id="heroInput" placeholder="请输入法规名称、关键词或条文内容…" aria-label="法规检索">' +
      '<button type="submit" class="flk-search-btn" title="检索" aria-label="检索">' +
      '<svg viewBox="0 0 24 24" width="21" height="21"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16.5 16.5L21 21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
      '</button></form>' +
      '<div class="flk-search-foot">' +
      '<label><input type="radio" name="heroMode" value="fuzzy" checked>模糊检索</label>' +
      '<label><input type="radio" name="heroMode" value="exact">精确匹配</label>' +
      '<span class="tip">支持 "短语"、-排除词、标题:词</span></div>' +
      '<div class="flk-hot">' + hotHtml + '</div>' +
      '</div></section>' +

      '<div class="home-body"><div class="flk-cats">' + catCards + '</div>' +

      '<div class="stat-row">' +
      '<div class="stat"><div class="v">' + num(Search.count()) + '</div><div class="k">收录法规</div></div>' +
      '<div class="stat"><div class="v">' + num(chars) + '<small>字</small></div><div class="k">正文总字数</div></div>' +
      '<div class="stat"><div class="v">' + catCount + '</div><div class="k">法规门类</div></div>' +
      '<div class="stat"><div class="v v-sm">' + esc((window.FG_DATA && window.FG_DATA.version) || '—') +
      '</div><div class="k">数据版本</div></div>' +
      '</div>' +

      '<div class="home-cols" style="margin-top:22px">' +
      '<div class="home-col">' +
      '<div class="panel"><div class="panel-head"><h3>新法速递</h3>' +
      '<a class="more" href="#/search?sort=new">按时间查看全部 ›</a></div>' +
      '<div class="panel-body"><ul class="link-list">' + latestHtml + '</ul></div></div>' +
      '</div>' +
      '<div class="home-col">' +
      '<div class="panel"><div class="panel-head"><h3>全库门类</h3>' +
      '<a class="more" href="#/browse">全部条目 ›</a></div>' +
      '<div class="panel-body"><ul class="link-list">' + dirHtml + '</ul></div></div>' +
      '<div class="panel"><div class="panel-head"><h3>核心党内法规</h3>' +
      '<a class="more" href="#/group/dangnei">党内法规体系 ›</a></div>' +
      '<div class="panel-body"><ul class="link-list">' + featHtml + '</ul></div></div>' +
      '<div class="panel"><div class="panel-head"><h3>常用检索主题</h3></div>' +
      '<div class="card card-pad tag-row" style="border:0;box-shadow:none;background:transparent">' + tagHtml + '</div></div>' +
      '</div></div></div>' +

      '<footer class="home-foot">' +
      '<div class="home-foot-inner">' +
      '<div class="home-foot-col">' +
      '<div class="home-foot-k">内容来源</div>' +
      '<div class="home-foot-v">国家法律法规数据库（flk.npc.gov.cn）· 人民网党建频道「党章党规」书架 · 共产党员网「党章党规」专页（12371.cn） · 湖北法规库</div>' +
      '</div>' +
      '<div class="home-foot-col">' +
      '<div class="home-foot-k">离线说明</div>' +
      '<div class="home-foot-v">数据随页面内置，断网可用；条文以官方发布文本为准。</div>' +
      '</div>' +
      '</div>' +
      '<img class="home-foot-hall" src="assets/img/flk-bg-bottom.png" alt="" aria-hidden="true">' +
      '<img class="home-foot-huabiao" src="assets/img/flk-bg-left.png" alt="" aria-hidden="true">' +
      '</footer>';

    /* 事件 */
    var hf = byId('heroForm');    hf.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = byId('heroInput').value.trim();
      var modeEl = $('#view input[name=heroMode]:checked');
      var mode = modeEl ? modeEl.value : 'fuzzy';
      if (mode === 'exact' && v && v.charAt(0) !== '"') v = '"' + v + '"';
      var sel = byId('heroScope').value;
      var p = [];
      if (v) p.push('q=' + encodeURIComponent(v));
      var cats = '';
      if (sel) {
        var parts = sel.split(':');
        if (parts[0] === 'c') {
          cats = parts[1];
        } else {
          for (var gi = 0; gi < GROUPS.length; gi++) {
            if (GROUPS[gi].id === parts[1]) { cats = (GROUPS[gi].cats || []).join(','); break; }
          }
        }
      }
      if (cats) p.push('cat=' + cats);
      go('#/search' + (p.length ? '?' + p.join('&') : ''));
    });
  }

  /* ======================================================== 检索结果 */
  function renderSearch(q) {
    var query = q.q || '';
    var sort = q.sort || 'relevance';
    var cats = q.cat ? q.cat.split(',') : [];
    var page = parseInt(q.p || '1', 10);
    var scope = q.scope || 'all';

    var res = Search.search(query, { cats: cats, sort: sort, page: page, pageSize: 10, scope: scope });
    state.cats = cats;
    state.sort = sort;
    state.lastIds = res.hits.map(function (h) { return h.doc.id; });
    state.lastLabel = '检索结果';

    var counts = Search.byCategory();
    var filterHtml = '';
    CATS.forEach(function (c) {
      var info = counts[c.id] || { count: 0 };
      var on = cats.indexOf(c.id) !== -1;
      filterHtml += '<label class="filter-item"><input type="checkbox" data-cat="' + c.id + '"' + (on ? ' checked' : '') + '>' +
        '<span class="dot" style="background:' + c.color + '"></span>' + esc(c.name) +
        '<span class="n">' + info.count + '</span></label>';
    });

    var hitsHtml = '';
    if (!res.hits.length) {
      hitsHtml = '<div class="card"><div class="empty"><div class="empty-icon">' + ICON.search + '</div>' +
        '<div>没有检索到匹配的法规</div>' +
        '<div style="margin-top:10px;font-size:12.5px">可尝试减少关键词、去掉限定符，或改用「-」排除干扰词</div></div></div>';
    } else {
      res.hits.forEach(function (h) {
        hitsHtml += resultCard(h.doc, res.query, scope);
      });
    }

    var pagerHtml = '';
    if (res.pages > 1) {
      pagerHtml = '<div class="pager">';
      pagerHtml += '<button data-page="' + (res.page - 1) + '"' + (res.page <= 1 ? ' disabled' : '') + '>上一页</button>';
      var list = pageList(res.page, res.pages);
      list.forEach(function (p) {
        if (p === '...') pagerHtml += '<span class="gap">…</span>';
        else pagerHtml += '<button data-page="' + p + '"' + (p === res.page ? ' class="on"' : '') + '>' + p + '</button>';
      });
      pagerHtml += '<button data-page="' + (res.page + 1) + '"' + (res.page >= res.pages ? ' disabled' : '') + '>下一页</button>';
      pagerHtml += '</div>';
    }

    var qstr = [];
    if (query) qstr.push('q=' + encodeURIComponent(query));
    if (cats.length) qstr.push('cat=' + cats.join(','));
    if (sort !== 'relevance') qstr.push('sort=' + sort);
    var baseHash = '#/search' + (qstr.length ? '?' + qstr.join('&') : '');

    $('#view').innerHTML =
      '<div class="page-head"><h2 class="page-title">' +
      (query ? '检索：' + esc(query) : '全部法规') + '</h2>' +
      '<p class="page-sub">共 ' + num(res.total) + ' 条结果' +
      (query ? '，耗时 ' + res.took + ' 毫秒' : '') +
      '　·　检索语法：<code>"短语"</code> 精确匹配、<code>-词</code> 排除、<code>标题:词</code> 限定字段</p></div>' +
      '<div class="search-layout"><div class="filters">' +
      '<div class="filter-card"><div class="filter-title">法规门类</div>' + filterHtml + '</div>' +
      '<div class="filter-card"><div class="filter-title">检索范围</div>' +
      '<select id="scopeSel" style="width:100%;border:1px solid var(--line);border-radius:8px;background:var(--surface-2);padding:7px 9px">' +
      '<option value="all">全部字段</option><option value="title">仅标题</option><option value="text">仅正文</option>' +
      '<option value="issuer">仅发布机关</option><option value="tags">仅标签</option>' +
      '</select></div>' +
      '<div class="filter-card"><div class="filter-title">快速操作</div>' +
      '<div class="btn-row"><a class="btn btn-sm btn-ghost" href="#/export?scope=results">导出本页结果</a>' +
      '<a class="btn btn-sm btn-ghost" href="#/favorites">我的收藏</a></div></div>' +
      '</div><div class="results">' +
      '<div class="result-bar"><span class="result-count">找到 <b>' + num(res.total) + '</b> 条</span>' +
      '<div class="result-tools"><span class="st" style="font-size:12px;color:var(--ink-3);margin-right:8px">排序</span>' +
      '<select id="sortSel"><option value="relevance"' + (sort === 'relevance' ? ' selected' : '') + '>相关度</option>' +
      '<option value="new"' + (sort === 'new' ? ' selected' : '') + '>最新在前</option>' +
      '<option value="old"' + (sort === 'old' ? ' selected' : '') + '>最早在前</option>' +
      '<option value="title"' + (sort === 'title' ? ' selected' : '') + '>标题</option></select></div></div>' +
      hitsHtml + pagerHtml + '</div></div>';

    $('#scopeSel').value = scope;

    // 事件
    $$('#view [data-cat]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var sel = $$('#view [data-cat]').filter(function (x) { return x.checked; })
          .map(function (x) { return x.getAttribute('data-cat'); });
        var p = [];
        if (query) p.push('q=' + encodeURIComponent(query));
        if (sel.length) p.push('cat=' + sel.join(','));
        if (sort !== 'relevance') p.push('sort=' + sort);
        go('#/search' + (p.length ? '?' + p.join('&') : ''));
      });
    });
    $('#sortSel').addEventListener('change', function () {
      var p = [];
      if (query) p.push('q=' + encodeURIComponent(query));
      if (cats.length) p.push('cat=' + cats.join(','));
      p.push('sort=' + this.value);
      go('#/search?' + p.join('&'));
    });
    $('#scopeSel').addEventListener('change', function () {
      var p = [];
      if (query) p.push('q=' + encodeURIComponent(query));
      if (cats.length) p.push('cat=' + cats.join(','));
      p.push('scope=' + this.value);
      go('#/search?' + p.join('&'));
    });
    $$('#view [data-page]').forEach(function (b) {
      b.addEventListener('click', function () {
        var p = [];
        if (query) p.push('q=' + encodeURIComponent(query));
        if (cats.length) p.push('cat=' + cats.join(','));
        if (sort !== 'relevance') p.push('sort=' + sort);
        p.push('p=' + b.getAttribute('data-page'));
        go('#/search?' + p.join('&'));
      });
    });
    bindResultActions();
  }

  function pageList(cur, total) {
    if (total <= 7) {
      var a = []; for (var i = 1; i <= total; i++) a.push(i); return a;
    }
    var out = [1];
    var s = Math.max(2, cur - 1), e = Math.min(total - 1, cur + 1);
    if (s > 2) out.push('...');
    for (var j = s; j <= e; j++) out.push(j);
    if (e < total - 1) out.push('...');
    out.push(total);
    return out;
  }

  function resultCard(doc, parsed, scope) {
    var terms = parsed.terms.concat(parsed.phrases);
    var snip = Search.snippet(doc, parsed, 140);
    var fav = Store.fav.has(doc.id);
    var badges = '<span class="tag" style="border-color:' + catColor(doc.cat) + '33;color:' + catColor(doc.cat) + '">' + esc(doc.catName) + '</span>';
    if (doc.sub) badges += '<span class="tag tag-line">' + esc(doc.sub) + '</span>';
    if (doc.version) badges += '<span class="tag tag-line">' + esc(doc.version) + '</span>';
    if (doc.effect) {
      var dead = (doc.effect === '已废止' || doc.effect === '尚未生效');
      badges += '<span class="tag' + (dead ? ' tag-warn' : ' tag-ok') + '">' + esc(doc.effect) + '</span>';
    }
    if (doc.custom) badges += '<span class="tag tag-brand">自建</span>';
    var meta = [];
    if (doc.issuer) meta.push('<span>' + esc(doc.issuer) + '</span>');
    if (doc.revised || doc.adopted) meta.push('<span>' + fmtDate(pubDate(doc)) + '</span>');
    meta.push('<span>' + num(doc.chars) + ' 字</span>');
    if (doc.tags && doc.tags.length) meta.push('<span><i>#</i>' + esc(doc.tags.slice(0, 3).join(' ')) + '</span>');

    return '<article class="result-card" data-id="' + esc(doc.id) + '">' +
      '<div class="rc-head"><a class="rc-title" href="' + docUrl(doc.id) + '">' + Search.highlight(doc.title, terms) + '</a>' +
      '<div class="rc-badges">' + badges + '</div></div>' +
      '<div class="rc-snip">' + Search.highlight(snip, terms) + '</div>' +
      '<div class="rc-meta">' + meta.join('') + '</div>' +
      '<div class="rc-actions">' +
      '<button class="fav-btn' + (fav ? ' on' : '') + '" data-fav="' + esc(doc.id) + '" title="' + (fav ? '取消收藏' : '收藏') + '">' + (fav ? ICON.starFill : ICON.star) + '</button>' +
      '<a class="btn btn-xs btn-ghost" href="' + docUrl(doc.id) + '">阅读全文</a>' +
      '<button class="btn btn-xs btn-ghost" data-exp="' + esc(doc.id) + '">导出</button>' +
      '<div class="right"><a class="btn btn-xs btn-ghost" href="' + docUrl(doc.id) + '">详情 ›</a></div>' +
      '</div></article>';
  }

  function bindResultActions(root) {
    $$('[data-fav]', root).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-fav');
        var on = Store.fav.toggle(id);
        btn.className = 'fav-btn' + (on ? ' on' : '');
        btn.innerHTML = on ? ICON.starFill : ICON.star;
        btn.setAttribute('title', on ? '取消收藏' : '收藏');
        refreshCounts();
        toast(on ? '已加入收藏' : '已取消收藏');
      });
    });
  }

  /* ============================================================ 详情 */
  function renderDoc(id, q) {
    var doc = Search.get(id);
    if (!doc) {
      $('#view').innerHTML = '<div class="empty"><div class="empty-icon">' + ICON.none + '</div>未找到该条目</div>';
      return;
    }
    Store.recent.push(id);

    var parsed = Search.parse(q.q || '');
    var terms = parsed.terms.concat(parsed.phrases);

    /* 目录：只做两级 —— 一级「第X章」（含编/篇/总则等分部），二级「第X节」。
       二级条目挂在其上方最近的一级条目下面。 */
    var tocHtml = '';
    var secs = Exporter.sectionsOf(doc);
    var docHref = '#/doc/' + encodeURIComponent(id);
    /* 党内法规的第 0 节常常以法规本身的名字作标题（内容是印发通知），
       与页头的大标题重复 —— 不进目录，也不再在正文里重复一次标题。 */
    var baseTitleKey = String(doc.title || '').replace(/\s/g, '').replace(/（[^）]*）$/, '');
    function isTitleSection(nm) {
      var k = String(nm || '').replace(/\s/g, '').replace(/（[^）]*）$/, '');
      return !!k && k === baseTitleKey;
    }
    var tocItems = [];
    secs.forEach(function (s, i) {
      if (!s.name) return;
      if (isTitleSection(s.name)) return;
      tocItems.push({
        i: i,
        nm: s.name.replace(/\s+/g, ' ').trim(),
        lv: (s.level === 2) ? 2 : 1
      });
    });
    var tocInner = '';
    var subBuf = [];
    function flushSub() {
      if (!subBuf.length) return;
      tocInner += '<ul class="toc-sub">' + subBuf.join('') + '</ul>';
      subBuf = [];
    }
    tocItems.forEach(function (it) {
      if (it.lv === 2) {
        subBuf.push('<li><a class="toc-l2' + (isPartTitle(it.nm) ? ' toc-part' : '') +
          '" href="' + docHref + '" data-anchor="sec' + it.i + '">' + esc(it.nm) + '</a></li>');
      } else {
        flushSub();
        tocInner += '<a class="toc-l1' + (isPartTitle(it.nm) ? ' toc-part' : '') +
          '" href="' + docHref + '" data-anchor="sec' + it.i + '">' + esc(it.nm) + '</a>';
      }
    });
    flushSub();
    tocHtml = tocInner;

    /* 正文：默认 Markdown 渲染；章/节标题单独输出（保留锚点，供目录跳转与检索定位） */
    var mdHtml = '';
    /* 源文档首行常是居中的法规标题（与页头大标题重复）。正文里那行抽出来，
       改成正文开头一个居中的文档标题，读起来才像法规原件。 */
    var rawTitle = String(doc.title || '').replace(/\s/g, '');
    var baseTitle = rawTitle.replace(/（[^）]*）$/, '');
    var titleDone = false;
    secs.forEach(function (s, i) {
      var name = (s.name || '').replace(/\s+/g, ' ').trim();
      /* 与法规同名的一节（党内法规常见）不再重复输出标题 */
      var showName = name && !isTitleSection(name);
      if (showName) {
        var lv = (s.level === 2) ? 2 : 1;
        mdHtml += '<h3 id="sec' + i + '" class="sec-h sec-lv' + lv + '">' +
          Search.highlight(name, terms) + '</h3>';
      }
      var src = sectionMarkdown(s, name);
      if (!titleDone && i === 0 && !name) {
        var first = src.split('\n\n')[0] || '';
        var fk = first.replace(/\s/g, '');
        if (fk && (fk === rawTitle || fk === baseTitle)) {
          mdHtml += '<div class="doc-title-md">' + Search.highlight(first, terms) + '</div>';
          src = src.slice(first.length).replace(/^\n+/, '');
          titleDone = true;
        }
      }
      mdHtml += FGMarkdown.render(src, {
        hl: function (t) { return Search.highlight(t, terms); }
      });
    });

    var fav = Store.fav.has(doc.id);
    var isLaw = doc.source === '国家法律法规数据库';
    var meta = [
      ['法规门类', esc(doc.catName) + (doc.sub ? '（' + esc(doc.sub) + '）' : '') +
        (doc.version ? '（' + esc(doc.version) + '）' : '')],
      ['制定/发布机关', esc(doc.issuer || '—')]
    ];
    if (doc.flxz) meta.push(['效力级别', esc(doc.flxz)]);
    if (doc.effect) meta.push(['时效性', esc(doc.effect)]);
    // 日期口径：published = 现行版本公布日；adopted = 初版通过日；revised = 最后修订日
    var pub = doc.published || '';
    if (pub) meta.push(['公布日期', fmtDate(pub)]);
    if (doc.adopted && doc.adopted !== pub) meta.push([isLaw ? '通过日期' : '首次通过', fmtDate(doc.adopted)]);
    if (doc.revised && doc.revised !== doc.adopted && doc.revised !== pub) meta.push(['最后修订', fmtDate(doc.revised)]);
    meta.push(['施行日期', fmtDate(doc.effective) || '—']);
    meta.push(['正文篇幅', num(doc.chars) + ' 字']);
    meta.push(['数据来源', doc.custom ? '本机自建' : esc(doc.source || '收录法规')]);
    var metaHtml = '';
    meta.forEach(function (m) {
      metaHtml += '<div class="dmg"><div class="k">' + m[0] + '</div><div class="v">' + m[1] + '</div></div>';
    });

    var badges = '';
    (doc.tags || []).forEach(function (t) {
      badges += '<a class="tag tag-line" href="#/search?q=' + encodeURIComponent(t) + '">#' + esc(t) + '</a>';
    });

    /* 修订沿革：同一部法规的历次版本（来自国家法律法规数据库的历史沿革字段） */
    var lsygHtml = '';
    var lsyg = doc.lsyg || [];
    if (lsyg.length > 1) {
      var items = lsyg.map(function (v) {
        var label = esc(v.title || '') + (v.date ? '（' + esc(v.date) + '）' : '');
        var href = v.bbbs ? '#/search?q=' + encodeURIComponent(v.title || '') : '';
        return '<li>' + (href ? '<a href="' + href + '">' + label + '</a>' : label) + '</li>';
      }).join('');
      lsygHtml = '<div class="doc-history"><div class="t">修订沿革</div><ul>' + items + '</ul></div>';
    }

    $('#view').innerHTML =
      '<div class="doc-layout" id="docLayout">' +
      '<div class="doc-head">' +
      '<div class="doc-kicker">' +
      '<span class="tag" style="border-color:' + catColor(doc.cat) + '44;color:' + catColor(doc.cat) + '">' + esc(doc.catName) + '</span>' +
      badges +
      (doc.year ? '<span class="tag tag-line">' + doc.year + '年</span>' : '') +
      '</div>' +
      '<h1>' + Search.highlight(doc.title, terms) + '</h1>' +
      (doc.summary ? '<div class="rc-snip" style="margin-top:0">' + Search.highlight(doc.summary, terms) + '</div>' : '') +
      '<div class="doc-meta-grid">' + metaHtml + '</div>' +
      lsygHtml +
      '<div class="doc-actions">' +
      '<button class="btn btn-sm ' + (fav ? 'btn-primary' : 'btn-ghost') + '" id="favBtn">' + (fav ? ICON.starFill : ICON.star) + '<span>' + (fav ? '已收藏' : '收藏') + '</span></button>' +
      '<span class="exp-ctl">' +
      '<button class="btn btn-sm btn-ghost" id="expDocBtn" title="直接导出本篇法规（Markdown）">导出本篇</button>' +
      '<button class="btn btn-sm btn-ghost exp-caret" id="expDocToggle" title="其它格式" aria-haspopup="true" aria-expanded="false">▾</button>' +
      '<span class="exp-menu" id="expDocMenu" hidden>' +
      '<button data-fmt="md">Markdown<em>.md</em></button>' +
      '<button data-fmt="txt">纯文本<em>.txt</em></button>' +
      '<button data-fmt="html">网页<em>.html</em></button>' +
      '<button data-fmt="json">数据<em>.json</em></button>' +
      '<button data-fmt="csv">表格<em>.csv</em></button>' +
      '</span></span>' +
      '<button class="btn btn-sm btn-ghost" id="copyBtn">复制全文</button>' +
      '<button class="btn btn-sm btn-ghost" id="printBtn">打印</button>' +
      (doc.custom ? '<a class="btn btn-sm btn-ghost" href="#/add/' + encodeURIComponent(doc.id) + '">编辑</a>' +
        '<button class="btn btn-sm btn-danger" id="delCustom">删除</button>' : '') +
      '<span class="doc-actions-right">' +
      '<a class="btn btn-sm btn-ghost" href="#/browse/' + doc.cat + '">同类法规</a>' +
      '<a class="btn btn-sm btn-ghost" href="' + (doc.url ? esc(doc.url) : '#') + '"' +
      (doc.url ? ' target="_blank" rel="noopener"' : '') + '>官方原文 ↗</a>' +
      '</span></div></div>' +

      '<div class="article-box" id="articleBox">' +
      '<div class="article-toolbar"><span class="st">' + num(doc.chars) + ' 字 · ' + secs.length + ' 节</span>' +
      '<div class="right">' +
      '<span class="font-ctl"><button id="fsDown" title="缩小字号">A−</button><button id="fsUp" title="放大字号">A+</button></span>' +
      '<button class="btn btn-xs btn-ghost" id="readBtn" title="阅读设置：背景、字号、行距、字体、版心">Aa</button>' +
      '<button class="btn btn-xs btn-ghost" id="markDrawerBtn" title="本文划线与批注">笔记<span class="md-count" id="markDrawerCount"></span></button>' +
      '</div>' +
      '<div class="read-panel" id="readPanel" hidden></div>' +
      '</div>' +
      '<article class="article" id="article">' + mdHtml + '</article>' +
      /* 批注框放进正文卡里：.article-box 是 position:relative，
         批注框就能用「相对正文卡」的坐标定位，滚动时跟着划线一起走。 */
      '<div class="mark-edit" id="markEdit" hidden>' +
      '<div class="me-head">批注</div>' +
      '<textarea id="markNoteText" rows="3" placeholder="写下你的理解、疑问或适用要点…"></textarea>' +
      '<div class="me-actions">' +
      '<button class="btn btn-xs btn-danger" id="markDel">删除划线</button>' +
      '<span class="me-sp"></span>' +
      '<button class="btn btn-xs btn-ghost" id="markCancel">取消</button>' +
      '<button class="btn btn-xs btn-primary" id="markSave">保存</button>' +
      '</div></div>' +
      '</div>' +
      (tocHtml ? '<aside class="toc"><div class="toc-card"><div class="toc-title">目录</div>' + tocHtml + '</div></aside>' : '') +
      '</div>' +
      /* 划线浮条与笔记抽屉放在 .doc-layout 之外（#view 的直接子元素）：
         .doc-layout 是 .view > *，入场动画会给它留下 transform，
         而任何非 none 的 transform 都会成为 position:fixed 后代的包含块 ——
         浮层放在它里面就会相对文档定位而不是相对视口，位置偏出整页高度。
         放在外面后，浮层的包含块恒为视口（.view / #view 上没有 transform）。
         抽屉的夜间配色改用 html[data-rd="night"] 单独给。 */
      '<div class="mark-tip" id="markTip" hidden>' +
      '<button class="mt-color mt-y" data-mc="yellow" title="黄色划线"></button>' +
      '<button class="mt-color mt-g" data-mc="green" title="绿色划线"></button>' +
      '<button class="mt-color mt-b" data-mc="blue" title="蓝色划线"></button>' +
      '<button class="mt-color mt-p" data-mc="pink" title="粉色划线"></button>' +
      '<span class="mt-sep"></span>' +
      '<button class="mt-note" id="markNoteBtn">写批注</button>' +
      '</div>' +
      '<aside class="mark-drawer" id="markDrawer"></aside>' +
      '<div class="hit-nav" id="hitNav"><div class="t" id="hitText">0 / 0</div>' +
      '<button class="btn btn-xs" id="hitPrev">↑</button> <button class="btn btn-xs" id="hitNext">↓</button></div>';

    // 收藏
    byId('favBtn').addEventListener('click', function () {
      var on = Store.fav.toggle(doc.id);
      this.className = 'btn btn-sm ' + (on ? 'btn-primary' : 'btn-ghost');
      this.innerHTML = (on ? ICON.starFill : ICON.star) + '<span>' + (on ? '已收藏' : '收藏') + '</span>';
      refreshCounts();
      toast(on ? '已加入收藏' : '已取消收藏');
    });

    /* 字号 / 阅读设置：共用一套状态（全局默认 + 单篇可覆盖） */
    var art = byId('article');
    var rc = readConfig(doc.id);

    function hasOverride() {
      var per = Store.settings.get('readPerDoc') || {};
      return !!(per && per[doc.id]);
    }
    function setReadValue(patch) {
      saveReadConfig(doc.id, patch, hasOverride());
      applyReadConfig(doc.id);
      refreshReadPanel();
      rc = readConfig(doc.id);
    }
    function refreshReadPanel() {
      var panel = byId('readPanel');
      if (panel) panel.innerHTML = readPanelHtml(doc.id);
    }

    applyReadConfig(doc.id);
    byId('fsUp').addEventListener('click', function () { setReadValue({ fs: Math.min(24, rc.fs + 1) }); });
    byId('fsDown').addEventListener('click', function () { setReadValue({ fs: Math.max(13, rc.fs - 1) }); });

    var readBtn = byId('readBtn');
    readBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var panel = byId('readPanel');
      if (panel.hidden) { refreshReadPanel(); panel.hidden = false; }
      else panel.hidden = true;
    });
    byId('readPanel').addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('#rpReset')) {
        if (hasOverride()) {
          /* 本篇有覆盖值：删掉它就回到全局设置，不必动全局默认 */
          clearReadConfig(doc.id);
          toast('已恢复全局设置');
        } else {
          /* 本篇没覆盖值：把全局默认改回出厂值 */
          Store.settings.set('readTheme', 'paper');
          Store.settings.set('fontSize', 17);
          Store.settings.set('readLh', 2.02);
          Store.settings.set('readFf', 'serif');
          Store.settings.set('readWidth', 'normal');
          toast('已恢复默认');
        }
        applyReadConfig(doc.id);
        refreshReadPanel();
        return;
      }
      var b = e.target.closest ? e.target.closest('[data-rd-theme],[data-rd-fs],[data-rd-lh],[data-rd-ff],[data-rd-width]') : null;
      if (!b) return;
      var only = byId('rpOnlyThis').checked;
      var patch = {};
      if (b.hasAttribute('data-rd-theme')) patch.theme = b.getAttribute('data-rd-theme');
      if (b.hasAttribute('data-rd-fs')) patch.fs = parseFloat(b.getAttribute('data-rd-fs'));
      if (b.hasAttribute('data-rd-lh')) patch.lh = parseFloat(b.getAttribute('data-rd-lh'));
      if (b.hasAttribute('data-rd-ff')) patch.ff = b.getAttribute('data-rd-ff');
      if (b.hasAttribute('data-rd-width')) patch.width = b.getAttribute('data-rd-width');
      if (only) {
        /* 勾了「本篇单独设置」：先把当前生效值存成这篇的覆盖，再改 */
        var per = Store.settings.get('readPerDoc') || {};
        if (!per[doc.id]) { per[doc.id] = readConfig(doc.id); Store.settings.set('readPerDoc', per); }
      }
      saveReadConfig(doc.id, patch, only);
      applyReadConfig(doc.id);
      refreshReadPanel();
    });
    byId('readPanel').addEventListener('change', function (e) {
      if (e.target.id !== 'rpOnlyThis') return;
      if (e.target.checked) {
        var per = Store.settings.get('readPerDoc') || {};
        if (!per[doc.id]) { per[doc.id] = readConfig(doc.id); Store.settings.set('readPerDoc', per); }
      } else {
        clearReadConfig(doc.id);
      }
      applyReadConfig(doc.id);
      refreshReadPanel();
    });
    /* 点面板外面收起 —— 由 boot() 里的唯一 document 监听器处理，
       这里只登记当前详情页的浮层。 */
    docPopCtx = { panel: byId('readPanel'), btn: readBtn, expMenu: null, expToggle: null };

    /* 划线与批注 */
    initMarking(doc, art);

    // 复制
    byId('copyBtn').addEventListener('click', function () {
      var ok = Exporter.copyText(Exporter.fullText(doc));
      toast(ok ? '已复制全文到剪贴板' : '复制失败，请手动选择正文');
    });

    // 打印
    byId('printBtn').addEventListener('click', function () { w.print(); });

    /* 导出本篇：点按钮直接下载 Markdown；旁边的小箭头展开其它格式。
       以前这里只是个跳转到导出中心的链接，用户还得再选一次格式再点导出。 */
    function exportThisDoc(fmt) {
      var res = Exporter.exportDocs([doc], fmt, doc.title);
      toast(res.ok ? ('已导出 ' + res.name) : res.msg);
    }
    byId('expDocBtn').addEventListener('click', function () { exportThisDoc('md'); });
    var expToggle = byId('expDocToggle'), expMenu = byId('expDocMenu');
    expToggle.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = expMenu.hasAttribute('hidden');
      if (open) { expMenu.removeAttribute('hidden'); expToggle.setAttribute('aria-expanded', 'true'); }
      else { expMenu.setAttribute('hidden', ''); expToggle.setAttribute('aria-expanded', 'false'); }
    });
    expMenu.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button[data-fmt]') : null;
      if (!b) return;
      expMenu.setAttribute('hidden', '');
      expToggle.setAttribute('aria-expanded', 'false');
      exportThisDoc(b.getAttribute('data-fmt'));
    });
    // 点菜单外面收起（同样交给 boot() 里的唯一 document 监听器）
    if (docPopCtx) { docPopCtx.expMenu = expMenu; docPopCtx.expToggle = expToggle; }

    // 删除自建
    if (byId('delCustom')) {
      byId('delCustom').addEventListener('click', function () {
        openModal('确认删除', '<p>确定删除自建条目「' + esc(doc.title) + '」？此操作不可撤销。</p>', [
          { text: '取消', cls: 'btn btn-ghost' },
          {
            text: '确认删除', cls: 'btn btn-danger', primary: true, act: function () {
              Store.custom.remove(doc.id);
              Search.removeDoc(doc.id);
              refreshCounts();
              toast('已删除');
              go('#/custom');
            }
          }
        ]);
      });
    }

    // 目录锚点
    $$('#view [data-anchor]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        var target = byId(a.getAttribute('data-anchor'));
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    // 命中导航
    initHitNav(art);
  }

  function initHitNav(art) {
    /* 排除划线标记：那是用户的批注高亮，不是检索命中，
       混进来会让「1/1」跳转指向一条无关的划线。 */
    var marks = $$('mark:not(.fg-hl)', art);
    var nav = byId('hitNav');
    /* 换视图后要重新挂接：先克隆掉旧的按钮，避免监听器叠加 */
    var hp = byId('hitPrev'), hn = byId('hitNext');
    if (hp && hp.parentNode) { var np = hp.cloneNode(true); hp.parentNode.replaceChild(np, hp); }
    if (hn && hn.parentNode) { var nn = hn.cloneNode(true); hn.parentNode.replaceChild(nn, hn); }
    if (!marks.length) { if (nav) nav.classList.remove('show'); return; }
    var idx = 0;
    function show() {
      marks.forEach(function (m, i) { m.style.background = ''; });
      var cur = marks[idx];
      cur.style.background = 'rgba(200,16,46,.42)';
      cur.scrollIntoView({ behavior: 'smooth', block: 'center' });
      byId('hitText').textContent = (idx + 1) + ' / ' + marks.length;
    }
    nav.classList.add('show');
    byId('hitPrev').addEventListener('click', function () { idx = (idx - 1 + marks.length) % marks.length; show(); });
    byId('hitNext').addEventListener('click', function () { idx = (idx + 1) % marks.length; show(); });
    byId('hitText').textContent = '1 / ' + marks.length;
  }

  /* ====================================================== 长列表分批渲染
     低配机器上一次把上千行塞进 DOM 会明显发涩：时间轴原本 13,043 个节点、
     体系页 5,241 个、门类页 2,838 个，滚动和切页都卡。
     统一改成「先渲染一批 + 底部再显示一批」，点击时只往列表尾部追加，
     不重绘已经渲染过的部分。 */
  var LIST_PAGE = 120;        // 条目列表每批条数
  var TL_CARDS = 200;         // 时间轴每批最多渲染多少张卡片
  var paging = {};            // 各列表的分页状态

  function docRowsHtml(list, from, to) {
    var out = '';
    for (var i = from; i < to; i++) {
      var doc = list[i];
      out += '<a class="doc-row" href="' + docUrl(doc.id) + '">' +
        '<span class="dot" style="background:' + catColor(doc.cat) + '"></span>' +
        '<span class="tt">' + esc(doc.title) + (doc.version ? ' <span style="font-weight:400;color:var(--ink-4);font-size:12px">（' + esc(doc.version) + '）</span>' : '') + '</span>' +
        '<span class="mt">' + esc(doc.issuer || doc.catName) + (pubDate(doc) ? ' · ' + fmtDate(pubDate(doc)) : '') + '</span></a>';
    }
    return out;
  }

  function moreBox(key, p) {
    var rest = p.total - p.shown;
    var html = '<div class="list-more">';
    if (rest > 0) {
      html += '<button class="btn btn-sm btn-ghost" id="more-' + key + '" data-more="' + key + '">' +
        p.label(rest, p.shown) + '</button>';
    }
    return html + '</div>';
  }

  function onMore(key) {
    var p = paging[key];
    if (!p) return;
    var from = p.shown;
    var to = p.end(from);
    if (to <= from) return;
    p.shown = to;
    var box = byId(p.box);
    if (box) box.insertAdjacentHTML('beforeend', p.render(from, to));
    var rest = p.total - to;
    var btn = byId('more-' + key);
    if (!btn) return;
    if (rest <= 0) btn.parentNode.innerHTML = '';
    else btn.textContent = p.label(rest, to);
  }

  /* ================================================ 阅读设置（微信读书式）
     正文区独立的版式：背景 / 字号 / 行距 / 字体 / 版心宽度。
     作用范围：全局默认 + 单篇可覆盖（存在 settings.readPerDoc 里）。 */

  /* 详情页浮层的「点外面收起」需要 document 级监听，但不能每次渲染都挂一个：
     翻过几篇法规后旧监听器仍在，会把新面板点没、还会越积越多。
     用模块级 ctx 指向当前详情页的浮层，由 boot() 里唯一那个监听器处理。 */
  var docPopCtx = null;

  var READ_THEMES = [
    { id: 'paper', name: '纸白' },
    { id: 'cream', name: '羊皮' },
    { id: 'green', name: '护眼' },
    { id: 'blue', name: '青瓷' },
    { id: 'gray', name: '素灰' },
    { id: 'night', name: '夜间' }
  ];
  var READ_LH = [{ v: 1.7, n: '紧凑' }, { v: 2.02, n: '标准' }, { v: 2.4, n: '宽松' }];
  var READ_FF = [{ v: 'serif', n: '宋体' }, { v: 'sans', n: '黑体' }, { v: 'kai', n: '楷体' }];
  var READ_WIDTH = [
    { v: 'narrow', n: '窄', px: 660 },
    { v: 'normal', n: '标准', px: 780 },
    { v: 'wide', n: '宽', px: 900 }
  ];

  function readConfig(docId) {
    var cfg = {
      theme: Store.settings.get('readTheme') || 'paper',
      fs: parseFloat(Store.settings.get('fontSize')) || 17,
      lh: parseFloat(Store.settings.get('readLh')) || 2.02,
      ff: Store.settings.get('readFf') || 'serif',
      width: Store.settings.get('readWidth') || 'normal'
    };
    var per = Store.settings.get('readPerDoc') || {};
    var p = per[docId];
    if (p) {
      for (var k in p) if (p.hasOwnProperty(k)) cfg[k] = p[k];
    }
    return cfg;
  }

  function saveReadConfig(docId, patch, onlyThis) {
    if (onlyThis) {
      var per = Store.settings.get('readPerDoc') || {};
      var p = per[docId] || {};
      for (var k in patch) if (patch.hasOwnProperty(k)) p[k] = patch[k];
      per[docId] = p;
      Store.settings.set('readPerDoc', per);
    } else {
      var g = { theme: 'readTheme', fs: 'fontSize', lh: 'readLh', ff: 'readFf', width: 'readWidth' };
      for (var key in patch) {
        if (!patch.hasOwnProperty(key)) continue;
        Store.settings.set(g[key] || key, patch[key]);
      }
    }
  }

  function clearReadConfig(docId) {
    var per = Store.settings.get('readPerDoc') || {};
    delete per[docId];
    Store.settings.set('readPerDoc', per);
  }

  function applyReadConfig(docId) {
    var box = byId('articleBox');
    if (!box) return;
    var c = readConfig(docId);
    /* 主题变量挂在 .doc-layout 上（不是 .article-box）：
       正文卡、标题卡、目录卡、批注框都靠继承拿到同一套配色。
       版心宽度也挂在这里，标题卡与正文卡才会跟着一起变宽、一起居中。
       另外把 data-rd 也写到 <html> 上：笔记抽屉在 .doc-layout 之外，
       它要靠 html[data-rd] 才能拿到夜间配色。 */
    var layout = byId('docLayout');
    var theme = c.theme;
    if (layout) {
      layout.setAttribute('data-rd', theme);
      layout.style.setProperty('--rd-fs', c.fs + 'px');
      layout.style.setProperty('--rd-lh', String(c.lh));
      layout.style.setProperty('--rd-ff', c.ff === 'sans' ? 'var(--ff)' : (c.ff === 'kai' ? 'var(--ff-kai)' : 'var(--ff-serif)'));
      var px = 780;
      for (var i = 0; i < READ_WIDTH.length; i++) if (READ_WIDTH[i].v === c.width) px = READ_WIDTH[i].px;
      layout.style.setProperty('--rd-w', px + 'px');
    }
    if (d.documentElement) d.documentElement.setAttribute('data-rd', theme);
    /* 兜底：正文卡上再写一份（老页面结构没有 #docLayout 时不至于失效） */
    box.style.setProperty('--rd-fs', c.fs + 'px');
    box.style.setProperty('--rd-lh', String(c.lh));
    box.style.setProperty('--rd-ff', c.ff === 'sans' ? 'var(--ff)' : (c.ff === 'kai' ? 'var(--ff-kai)' : 'var(--ff-serif)'));
    var px2 = 780;
    for (var j = 0; j < READ_WIDTH.length; j++) if (READ_WIDTH[j].v === c.width) px2 = READ_WIDTH[j].px;
    box.style.setProperty('--rd-w', px2 + 'px');
  }

  /* 阅读设置面板的 HTML */
  function readPanelHtml(docId) {
    var c = readConfig(docId);
    var per = (Store.settings.get('readPerDoc') || {})[docId];
    var themes = READ_THEMES.map(function (t) {
      return '<button class="rp-theme rp-t-' + t.id + (c.theme === t.id ? ' on' : '') + '" data-rd-theme="' + t.id + '" title="' + t.n + '"></button>';
    }).join('');
    function seg(list, cur, attr) {
      return list.map(function (o) {
        return '<button class="rp-seg-btn' + (String(cur) === String(o.v) ? ' on' : '') + '" data-' + attr + '="' + o.v + '">' + o.n + '</button>';
      }).join('');
    }
    return '<div class="rp-row"><div class="rp-k">背景</div><div class="rp-themes">' + themes + '</div></div>' +
      '<div class="rp-row"><div class="rp-k">字号</div><div class="rp-seg">' +
      '<button class="rp-seg-btn" data-rd-fs="' + (c.fs - 1) + '">A−</button>' +
      '<span class="rp-val">' + c.fs + '</span>' +
      '<button class="rp-seg-btn" data-rd-fs="' + (c.fs + 1) + '">A+</button></div></div>' +
      '<div class="rp-row"><div class="rp-k">行距</div><div class="rp-seg">' + seg(READ_LH, c.lh, 'rd-lh') + '</div></div>' +
      '<div class="rp-row"><div class="rp-k">字体</div><div class="rp-seg">' + seg(READ_FF, c.ff, 'rd-ff') + '</div></div>' +
      '<div class="rp-row"><div class="rp-k">版心</div><div class="rp-seg">' + seg(READ_WIDTH, c.width, 'rd-width') + '</div></div>' +
      '<div class="rp-foot">' +
      '<label class="rp-only"><input type="checkbox" id="rpOnlyThis"' + (per ? ' checked' : '') + '> 本篇单独设置</label>' +
      '<button class="btn btn-xs btn-ghost" id="rpReset">恢复默认</button></div>';
  }

  /* ============================================== 划线与批注 */
  var MARK_COLORS = {
    yellow: { name: '黄', bg: 'rgba(255, 216, 92, .55)' },
    green: { name: '绿', bg: 'rgba(150, 214, 140, .50)' },
    blue: { name: '蓝', bg: 'rgba(140, 190, 230, .50)' },
    pink: { name: '粉', bg: 'rgba(240, 170, 190, .50)' }
  };

  /* 正文纯文本的字符偏移表：按文档顺序累加所有文本节点的长度。
     划线锚点就是这串字符里的起止位置（法规数据是静态的，偏移稳定）。 */
  function textIndex(art) {
    var walker = document.createTreeWalker(art, 4 /* NodeFilter.SHOW_TEXT */, null, false);
    var map = [], total = 0, n;
    while ((n = walker.nextNode())) {
      map.push({ node: n, start: total, end: total + n.length });
      total += n.length;
    }
    return { map: map, total: total };
  }

  function sliceText(idx, s, e) {
    var out = '';
    for (var i = 0; i < idx.map.length; i++) {
      var it = idx.map[i];
      if (it.end <= s || it.start >= e) continue;
      var ns = Math.max(0, s - it.start), ne = Math.min(it.node.length, e - it.start);
      if (ne > ns) out += it.node.nodeValue.slice(ns, ne);
    }
    return out;
  }

  /* 按原文回退定位：法规数据更新后偏移会漂移，用选中的原文找回位置 */
  function findText(idx, needle) {
    if (!needle) return null;
    var full = sliceText(idx, 0, idx.total);
    var at = full.indexOf(needle);
    if (at < 0) return null;
    return { s: at, e: at + needle.length };
  }

  /* 把 [s,e) 包进 <mark class="fg-hl"> */
  function wrapHighlight(art, s, e, m) {
    var idx = textIndex(art);
    if (s < 0 || e > idx.total || e <= s) return null;
    var pieces = [];
    for (var i = 0; i < idx.map.length; i++) {
      var it = idx.map[i];
      if (it.end <= s || it.start >= e) continue;
      var ns = Math.max(0, s - it.start), ne = Math.min(it.node.length, e - it.start);
      if (ne > ns) pieces.push({ node: it.node, s: ns, e: ne });
    }
    if (!pieces.length) return null;
    for (var k = 0; k < pieces.length; k++) {
      var p = pieces[k];
      var node = p.node;
      var es = Math.min(p.e, node.length);
      if (es <= p.s) continue;
      var target = node;
      if (p.s > 0) target = node.splitText(p.s);
      if (es - p.s < target.length) target.splitText(es - p.s);
      var mk = document.createElement('mark');
      mk.className = 'fg-hl fg-hl-' + (m.c || 'yellow');
      mk.setAttribute('data-mark', m.id);
      if (m.n) mk.setAttribute('data-has-note', '1');
      if (target.parentNode) {
        target.parentNode.replaceChild(mk, target);
        mk.appendChild(target);
      }
    }
    return m.id;
  }

  /* 先把已有的 <mark class="fg-hl"> 拆回纯文本，再重新铺一遍。
     不拆的话，「新增一条划线后重铺全部」会在已有划线里再套一层 <mark>，
     划线越点越厚、点击命中也会落到内层。 */
  function unwrapHighlights(art) {
    var mks = art.querySelectorAll('mark.fg-hl');
    for (var i = 0; i < mks.length; i++) {
      var mk = mks[i];
      if (!mk.parentNode) continue;
      while (mk.firstChild) mk.parentNode.insertBefore(mk.firstChild, mk);
      mk.parentNode.removeChild(mk);
    }
  }

  /* 把已存的划线铺回正文。返回没能复原的条数（法规更新导致原文对不上）。 */
  function applyMarks(docId, art) {
    var list = Store.marks.list(docId);
    if (!list.length) return 0;
    unwrapHighlights(art);
    var lost = 0;
    /* 从前往后铺：后一条的偏移不会被前一条的包裹影响，
       也避免两条划线落在同一段文字里时出现嵌套。 */
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      var idx = textIndex(art);
      var s = m.s, e = m.e;
      var got = sliceText(idx, s, e);
      if (e > idx.total || !m.t || got.slice(0, m.t.length) !== m.t) {
        var alt = findText(idx, m.t);
        if (!alt) { lost++; continue; }
        s = alt.s; e = alt.e;
      }
      wrapHighlight(art, s, e, m);
    }
    return lost;
  }

  /* 当前选区所在的小节名（笔记列表里当上下文用） */
  function sectionNameAt(art, container) {
    var el = container && container.nodeType === 1 ? container : (container ? container.parentNode : null);
    while (el && el !== art) {
      if (el.className && /(^|\s)sec-h(\s|$)/.test(el.className)) return (el.textContent || '').trim();
      if (el.tagName === 'H3' || el.tagName === 'H4') return (el.textContent || '').trim();
      el = el.parentNode;
    }
    return '';
  }

  /* 详情页的划线/批注交互 */
  function initMarking(doc, art) {
    var tip = byId('markTip');
    var edt = byId('markEdit');
    var drawer = byId('markDrawer');
    var dBtn = byId('markDrawerBtn');
    if (!tip || !edt || !art) return;
    var curRange = null, curText = '', curMark = null, curColor = 'yellow';

    function hideTip() { tip.hidden = true; curRange = null; curText = ''; }
    function hideEditor() { edt.hidden = true; curMark = null; }

    function onSelect() {
      var sel = w.getSelection ? w.getSelection() : null;
      if (!sel || !sel.rangeCount || sel.isCollapsed) { hideTip(); return; }
      var range = sel.getRangeAt(0);
      if (!art.contains(range.commonAncestorContainer)) { hideTip(); return; }
      var text = sel.toString();
      if (!text || text.length < 2) { hideTip(); return; }
      curRange = range; curText = text;
      var rect = range.getBoundingClientRect();
      tip.hidden = false;
      /* 浮条是 fixed 定位，坐标取视口相对值；选区靠近下边缘时要往回收，
         否则整条浮条会飘到屏幕外看不见。 */
      var top = rect.top - tip.offsetHeight - 10;
      if (top < 8) top = rect.bottom + 10;
      if (top + tip.offsetHeight > w.innerHeight - 8) top = w.innerHeight - tip.offsetHeight - 8;
      if (top < 8) top = 8;
      tip.style.top = top + 'px';
      var left = rect.left + rect.width / 2 - tip.offsetWidth / 2;
      tip.style.left = Math.max(8, Math.min(left, w.innerWidth - tip.offsetWidth - 8)) + 'px';
    }

    function makeMark(range, text, color, note) {
      if (!range) return null;
      var pre = document.createRange();
      pre.selectNodeContents(art);
      try { pre.setEnd(range.startContainer, range.startOffset); } catch (e) { return null; }
      var start = pre.toString().length;
      var len = range.toString().length;
      if (!len) return null;
      var end = start + len;
      /* 同一段文字不重复划：已存在同样的范围就更新批注，不新增 */
      var exist = Store.marks.list(doc.id);
      for (var i = 0; i < exist.length; i++) {
        if (exist[i].s === start && exist[i].e === end) {
          if (note !== undefined) Store.marks.update(doc.id, exist[i].id, { n: note });
          return exist[i];
        }
      }
      return Store.marks.add(doc.id, {
        s: start, e: end,
        t: String(text || '').slice(0, 500),
        c: color || 'yellow',
        n: note || '',
        sec: sectionNameAt(art, range.startContainer)
      });
    }

    art.addEventListener('mouseup', function () { setTimeout(onSelect, 10); });
    art.addEventListener('touchend', function () { setTimeout(onSelect, 10); });

    tip.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-mc]') : null;
      if (b) {
        curColor = b.getAttribute('data-mc');
        var m = makeMark(curRange, curText, curColor);
        if (m) {
          applyMarks(doc.id, art);
          renderDrawer();
          refreshCounts();
          toast('已划线（点划线可写批注）');
        }
        hideTip();
        hideEditor();
        if (w.getSelection) w.getSelection().removeAllRanges();
        return;
      }
      if (e.target.closest && e.target.closest('#markNoteBtn')) {
        var m2 = makeMark(curRange, curText, curColor);
        if (!m2) { hideTip(); return; }
        applyMarks(doc.id, art);
        renderDrawer();
        refreshCounts();
        curMark = m2.id;
        byId('markNoteText').value = m2.n || '';
        edt.hidden = false;
        placeEditor();
        hideTip();
        if (w.getSelection) w.getSelection().removeAllRanges();
      }
    });

    /* 批注框定位：坐标相对正文卡（.article-box，position:relative）。
       两个 rect 都是视口相对值，相减即抵消滚动 —— 框会跟着划线走，
       滚动页面时不会停在原地跟文字分家。 */
    function placeEditor() {
      var mk = curMark ? art.querySelector('.fg-hl[data-mark="' + curMark + '"]') : null;
      if (!mk) return;
      var host = byId('articleBox');
      if (!host) return;
      var rect = mk.getBoundingClientRect();
      var hostRect = host.getBoundingClientRect();
      var top = rect.top - hostRect.top - edt.offsetHeight - 10;
      /* 划线贴着正文卡顶部时，框改放到划线下方，别压到标题卡上 */
      if (top < 0) top = rect.bottom - hostRect.top + 10;
      var left = rect.left - hostRect.left;
      var maxLeft = host.clientWidth - edt.offsetWidth;
      if (left > maxLeft) left = maxLeft;
      if (left < 0) left = 0;
      edt.style.top = top + 'px';
      edt.style.left = left + 'px';
    }

    /* 点划线 → 打开批注编辑框 */
    art.addEventListener('click', function (e) {
      var mk = e.target.closest ? e.target.closest('.fg-hl') : null;
      if (!mk) { hideEditor(); return; }
      var id = mk.getAttribute('data-mark');
      var m = Store.marks.get(doc.id, id);
      if (!m) return;
      curMark = id;
      byId('markNoteText').value = m.n || '';
      edt.hidden = false;
      placeEditor();
    });

    byId('markSave').addEventListener('click', function () {
      if (!curMark) { hideEditor(); return; }
      Store.marks.update(doc.id, curMark, { n: byId('markNoteText').value });
      hideEditor();
      applyMarks(doc.id, art);
      renderDrawer();
      toast('批注已保存');
    });
    byId('markCancel').addEventListener('click', hideEditor);
    byId('markDel').addEventListener('click', function () {
      if (!curMark) { hideEditor(); return; }
      var mk = art.querySelector('.fg-hl[data-mark="' + curMark + '"]');
      if (mk && mk.parentNode) {
        /* 直接把 <mark> 拆开，正文其它划线不受影响 */
        while (mk.firstChild) mk.parentNode.insertBefore(mk.firstChild, mk);
        mk.parentNode.removeChild(mk);
      }
      Store.marks.remove(doc.id, curMark);
      hideEditor();
      renderDrawer();
      refreshCounts();
      toast('已删除划线');
    });

    function renderDrawer() {
      var list = Store.marks.list(doc.id);
      if (dBtn) {
        var lbl = byId('markDrawerCount');
        if (lbl) lbl.textContent = list.length ? String(list.length) : '';
      }
      if (!drawer) return;
      if (!list.length) {
        drawer.innerHTML = '<div class="md-title">本文划线</div>' +
          '<div class="md-empty">还没有划线<br><span>选中正文即可划线并写批注</span></div>';
        return;
      }
      drawer.innerHTML = '<div class="md-title">本文划线 <span class="md-n">' + list.length + '</span></div>' +
        list.map(function (m) {
          return '<div class="md-item" data-goto="' + m.id + '">' +
            '<div class="mi-t">' + esc(m.t) + '</div>' +
            (m.n ? '<div class="mi-n">' + esc(m.n) + '</div>' : '') +
            (m.sec ? '<div class="mi-s">' + esc(m.sec) + '</div>' : '') +
            '</div>';
        }).join('');
    }

    if (drawer) {
      drawer.addEventListener('click', function (e) {
        var it = e.target.closest ? e.target.closest('[data-goto]') : null;
        if (!it) return;
        var mk = art.querySelector('.fg-hl[data-mark="' + it.getAttribute('data-goto') + '"]');
        if (mk) mk.scrollIntoView({ block: 'center' });
      });
    }
    if (dBtn) {
      dBtn.addEventListener('click', function () {
        if (drawer) drawer.classList.toggle('open');
      });
    }
    var lost = applyMarks(doc.id, art);
    if (lost) toast('有 ' + lost + ' 条划线因法规更新未能复原');
    renderDrawer();
  }

  /* ============================================================ 分类浏览 */
  function renderBrowse(catId) {
    /* 不带门类参数时列出全部门类（侧栏「分类浏览」与首页「全部条目 ›」都走这里）。
       早先这里直接回退到第一个门类，点进去只能看到「宪法」一部。 */
    if (!catId) { renderBrowseIndex(); return; }
    var cat = catById(catId);
    if (!cat) {
      $('#view').innerHTML = '<div class="empty"><div class="empty-icon">' + ICON.none +
        '</div>未找到该门类</div>';
      return;
    }
    var list = Search.all().filter(function (x) { return x.cat === cat.id; });
    list.sort(function (a, b) { return (b.year || 0) - (a.year || 0) || (b.level || 0) - (a.level || 0); });

    var p = {
      total: list.length, shown: 0, unit: '部', box: 'browseList',
      end: function (from) { return Math.min(from + LIST_PAGE, list.length); },
      label: function (rest) { return '再显示 ' + Math.min(LIST_PAGE, rest) + ' 部（还有 ' + rest + ' 部）'; },
      render: function (from, to) { return docRowsHtml(list, from, to); }
    };
    paging.browse = p;
    p.shown = p.end(0);

    $('#view').innerHTML =
      '<div class="cat-hero"><span class="bar" style="background:' + cat.color + '"></span>' +
      '<div><h2>' + esc(cat.name) + '</h2><p>' + esc(cat.desc) + '</p></div>' +
      '<div class="right"><div class="n">' + list.length + '</div><div class="l">部法规</div></div></div>' +
      '<div class="result-bar"><span class="result-count">共 <b>' + list.length + '</b> 部，按时间倒序</span>' +
      '<div class="result-tools"><a class="btn btn-sm btn-ghost" href="#/export?scope=cat&id=' + cat.id + '">导出本门类</a></div></div>' +
      '<div class="doc-list" id="browseList">' + p.render(0, p.shown) + '</div>' +
      moreBox('browse', p);
  }

  /* 分类浏览的总览页：按体系分组列出全部门类。
     5 个体系、17 个门类，各体系高度差很多（党内法规 8 个门类 vs 本机自建 1 个），
     单纯平铺两列必然留一个大洞。这里显式分两栏，按「门类行数 + 面板头」的
     估算高度贪心分配到较矮的一栏，列高才接近。 */
  function renderBrowseIndex() {
    var stats = Search.byCategory();
    var cols = [[], []];
    var h = [0, 0];

    GROUPS.forEach(function (g, gi) {
      var items = '';
      var n = 0;
      (g.cats || []).forEach(function (id) {
        var c = catById(id);
        if (!c) return;
        var info = stats[id] || { count: 0, chars: 0 };
        n++;
        items += '<li' + (info.count ? '' : ' class="zero"') + '><a href="#/browse/' + id + '">' +
          '<span class="bullet" style="background:' + c.color + '"></span>' +
          '<span class="lt">' + esc(c.name) + '</span>' +
          '<span class="lm">' + num(info.count) + ' 部 · ' + num(info.chars) + ' 字</span></a></li>';
      });
      if (!items) return;
      /* order = 该体系在 GROUPS 里的原序号：窄屏时两栏合并成单列（见 CSS 的
         display:contents），靠 order 把显示顺序还原成「国家法律法规 → 党内法规 → …」。 */
      var panel = '<div class="panel" style="order:' + (gi + 1) + '"><div class="panel-head"><h3>' + esc(g.name) + '</h3>' +
        '<a class="more" href="#/group/' + g.id + '">按体系查看 ›</a></div>' +
        '<div class="panel-body"><ul class="link-list">' + items + '</ul></div></div>';
      var i = h[0] <= h[1] ? 0 : 1;
      cols[i].push(panel);
      h[i] += n * 40 + 60;      // 每行约 40px，面板头约 60px
    });

    var total = Search.count();
    $('#view').innerHTML =
      '<div class="page-head"><h2 class="page-title">分类浏览</h2>' +
      '<p class="page-sub">共 ' + CATS.length + ' 个门类 · ' + num(total) + ' 部法规 · 点击门类查看条目</p></div>' +
      '<div class="browse-groups">' +
      '<div class="browse-col">' + cols[0].join('') + '</div>' +
      '<div class="browse-col">' + cols[1].join('') + '</div>' +
      '</div>';
  }

  /* ========================================================== 分组浏览 */
  function renderGroup(groupId) {
    var g = null;
    for (var i = 0; i < GROUPS.length; i++) if (GROUPS[i].id === groupId) g = GROUPS[i];
    if (!g) {
      $('#view').innerHTML = '<div class="empty"><div class="empty-icon">' + ICON.none + '</div>未找到该法规体系</div>';
      return;
    }
    var cats = g.cats || [];
    var list = Search.all().filter(function (x) { return cats.indexOf(x.cat) !== -1; });
    list.sort(function (a, b) {
      return pubDate(b).localeCompare(pubDate(a)) || (b.year || 0) - (a.year || 0);
    });

    var p = {
      total: list.length, shown: 0, unit: '部', box: 'groupList',
      end: function (from) { return Math.min(from + LIST_PAGE, list.length); },
      label: function (rest) { return '再显示 ' + Math.min(LIST_PAGE, rest) + ' 部（还有 ' + rest + ' 部）'; },
      render: function (from, to) { return docRowsHtml(list, from, to); }
    };
    paging.group = p;
    p.shown = p.end(0);

    var subHtml = '';
    cats.forEach(function (id) {
      var c = catById(id);
      if (!c) return;
      var n = list.filter(function (x) { return x.cat === id; }).length;
      subHtml += '<a class="btn btn-sm btn-ghost" href="#/browse/' + id + '">' + esc(c.name) + ' ' + n + '</a>';
    });

    $('#view').innerHTML =
      '<div class="cat-hero"><span class="bar" style="background:' + (g.color || '#c8102e') + '"></span>' +
      '<div><h2>' + esc(g.name) + '</h2><p>' + esc(g.desc || '') + '</p></div>' +
      '<div class="right"><div class="n">' + list.length + '</div><div class="l">部法规</div></div></div>' +
      '<div class="result-bar"><span class="result-count">共 <b>' + list.length + '</b> 部，按公布日期倒序</span>' +
      '<div class="result-tools">' + subHtml + '</div></div>' +
      '<div class="doc-list" id="groupList">' + (p.render(0, p.shown) || '<div class="empty">该体系暂无内容</div>') + '</div>' +
      moreBox('group', p);
  }

  /* ========================================================== 收藏 */
  function renderFavorites() {
    var favs = Store.fav.list();
    if (!favs.length) {
      $('#view').innerHTML = '<div class="empty"><div class="empty-icon">' + ICON.starFill + '</div>' +
        '<div>收藏夹是空的</div><div style="margin-top:10px"><a class="btn btn-sm" href="#/search">去检索法规</a></div></div>';
      return;
    }
    var html = '';
    var totalChars = 0;
    favs.forEach(function (f) {
      var doc = Search.get(f.id);
      if (!doc) return;
      totalChars += doc.chars || 0;
      html += '<article class="result-card" data-id="' + esc(doc.id) + '">' +
        '<div class="rc-head"><a class="rc-title" href="' + docUrl(doc.id) + '">' + esc(doc.title) + '</a>' +
        '<div class="rc-badges"><span class="tag" style="border-color:' + catColor(doc.cat) + '44;color:' + catColor(doc.cat) + '">' + esc(doc.catName) + '</span></div></div>' +
        '<div class="rc-snip">' + esc(doc.summary || '') + '</div>' +
        '<div class="rc-meta"><span>' + esc(doc.issuer || '—') + '</span>' +
        '<span>' + (fmtDate(doc.adopted) || '—') + '</span>' +
        '<span>' + num(doc.chars) + ' 字</span>' +
        '<span>收藏于 ' + new Date(f.ts).toLocaleDateString('zh-CN') + '</span></div>' +
        '<div class="rc-actions">' +
        '<button class="fav-btn on" data-fav="' + esc(doc.id) + '" title="取消收藏">' + ICON.starFill + '</button>' +
        '<button class="btn btn-xs btn-ghost" data-note="' + esc(doc.id) + '">备注</button>' +
        '<button class="btn btn-xs btn-ghost" data-exp="' + esc(doc.id) + '">导出</button>' +
        '<div class="right"><a class="btn btn-xs btn-ghost" href="' + docUrl(doc.id) + '">查看 ›</a></div>' +
        '</div></article>';
    });

    $('#view').innerHTML =
      '<div class="page-head"><h2 class="page-title">我的收藏</h2>' +
      '<p class="page-sub">共 ' + favs.length + ' 部 · 合计 ' + num(totalChars) + ' 字 · 数据保存在本机浏览器中</p></div>' +
      '<div class="result-bar"><span class="result-count"></span>' +
      '<div class="result-tools"><button class="btn btn-sm btn-ghost" id="favExport">导出全部收藏</button>' +
      '<button class="btn btn-sm btn-danger" id="favClear">清空收藏</button></div></div>' +
      html;

    bindResultActions();
    $$('#view [data-note]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-note');
        var cur = '';
        Store.fav.list().forEach(function (f) { if (f.id === id) cur = f.note || ''; });
        openModal('收藏备注', '<div class="form-row"><label>为「' + esc((Search.get(id) || {}).title || '') + '」添加备注</label>' +
          '<textarea id="noteInput" style="min-height:110px">' + esc(cur) + '</textarea></div>', [
          { text: '取消', cls: 'btn btn-ghost' },
          {
            text: '保存', cls: 'btn btn-primary', primary: true, act: function () {
              Store.fav.setNote(id, byId('noteInput').value);
              toast('备注已保存');
            }
          }
        ]);
      });
    });
    byId('favExport').addEventListener('click', function () {
      var docs = favs.map(function (f) { return Search.get(f.id); }).filter(Boolean);
      exportWithBodies(docs, 'md', '我的收藏', function () {
        Exporter.exportDocs(docs, 'md', '我的收藏');
        toast('已导出 ' + docs.length + ' 部法规');
      });
    });
    byId('favClear').addEventListener('click', function () {
      openModal('清空收藏', '<p>将移除全部 ' + favs.length + ' 条收藏记录，是否继续？</p>', [
        { text: '取消', cls: 'btn btn-ghost' },
        {
          text: '确认清空', cls: 'btn btn-danger', primary: true, act: function () {
            Store.fav.clear(); refreshCounts(); toast('收藏夹已清空'); route();
          }
        }
      ]);
    });
  }

  /* ====================================================== 自建条目 */
  function renderCustom() {
    var list = Store.custom.list();
    var html = '';
    list.forEach(function (rec) {
      html += '<article class="result-card" data-id="' + esc(rec.id) + '">' +
        '<div class="rc-head"><a class="rc-title" href="' + docUrl(rec.id) + '">' + esc(rec.title) + '</a>' +
        '<div class="rc-badges"><span class="tag tag-brand">自建</span>' +
        '<span class="tag tag-line">' + esc((catById(rec.cat) || {}).name || '自定义') + '</span></div></div>' +
        '<div class="rc-snip">' + esc(rec.summary || (rec.text || '').slice(0, 120)) + '</div>' +
        '<div class="rc-meta"><span>' + esc(rec.issuer || '—') + '</span>' +
        '<span>' + (fmtDate(rec.adopted) || '—') + '</span>' +
        '<span>' + num((rec.text || '').replace(/\s/g, '').length) + ' 字</span>' +
        '<span>更新于 ' + new Date(rec.updated || rec.created).toLocaleDateString('zh-CN') + '</span></div>' +
        '<div class="rc-actions">' +
        '<a class="btn btn-xs btn-ghost" href="#/add/' + encodeURIComponent(rec.id) + '">编辑</a>' +
        '<button class="btn btn-xs btn-ghost" data-exp="' + esc(rec.id) + '">导出</button>' +
        '<div class="right"><button class="btn btn-xs btn-danger" data-del="' + esc(rec.id) + '">删除</button></div>' +
        '</div></article>';
    });

    $('#view').innerHTML =
      '<div class="page-head"><h2 class="page-title">自建条目</h2>' +
      '<p class="page-sub">补充本机需要但库中未收录的法规、地方规定与学习笔记，保存在浏览器本地</p></div>' +
      '<div class="result-bar"><span class="result-count">共 <b>' + list.length + '</b> 条</span>' +
      '<div class="result-tools">' +
      '<button class="btn btn-sm btn-ghost" id="impBtn">导入备份</button>' +
      '<button class="btn btn-sm btn-ghost" id="expBtn">导出备份</button>' +
      '<a class="btn btn-sm btn-primary" href="#/add">＋ 新增条目</a></div></div>' +
      (html || '<div class="card"><div class="empty"><div class="empty-icon">' + ICON.pen + '</div>还没有自建条目</div></div>') +
      '<input type="file" id="fileInput" accept="application/json" hidden>';

    $$('#view [data-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-del');
        var rec = Store.custom.get(id);
        openModal('确认删除', '<p>确定删除「' + esc(rec ? rec.title : '') + '」？</p>', [
          { text: '取消', cls: 'btn btn-ghost' },
          {
            text: '确认删除', cls: 'btn btn-danger', primary: true, act: function () {
              Store.custom.remove(id);
              Search.removeDoc(id);
              refreshCounts();
              toast('已删除');
              route();
            }
          }
        ]);
      });
    });

    byId('expBtn').addEventListener('click', function () {
      var data = Store.exportAll();
      Exporter.download('法律法规库_备份_' + new Date().toISOString().slice(0, 10) + '.json',
        JSON.stringify(data, null, 2), 'application/json');
      toast('备份已导出');
    });
    byId('impBtn').addEventListener('click', function () { byId('fileInput').click(); });
    byId('fileInput').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var data = JSON.parse(reader.result);
          Store.importAll(data);
          Store.custom.list().forEach(function (r) { Search.addDoc(normalizeCustom(r)); });
          refreshCounts();
          toast('导入成功');
          route();
        } catch (err) {
          toast('导入失败：' + err.message);
        }
      };
      reader.readAsText(f);
    });
  }

  /* ====================================================== 新增/编辑 */
  function renderAdd(id) {
    var rec = id ? Store.custom.get(id) : null;
    var cats = CATS.map(function (c) {
      var sel = (rec && rec.cat === c.id) ? ' selected' : (!rec && c.id === 'local' ? ' selected' : '');
      return '<option value="' + c.id + '"' + sel + '>' + esc(c.name) + '</option>';
    }).join('');

    $('#view').innerHTML =
      '<div class="page-head"><h2 class="page-title">' + (rec ? '编辑条目' : '新增条目') + '</h2>' +
      '<p class="page-sub">自建条目与库内法规一同参与检索，可随时导出或删除</p></div>' +
      '<div class="form-card">' +
      '<div class="form-row"><label>标题<span class="hint">必填</span></label>' +
      '<input type="text" id="fTitle" value="' + esc(rec ? rec.title : '') + '" placeholder="如：XX 单位党内民主生活会实施细则"></div>' +
      '<div class="form-two"><div class="form-row"><label>门类</label><select id="fCat">' + cats + '</select></div>' +
      '<div class="form-row"><label>发布机关</label><input type="text" id="fIssuer" value="' + esc(rec ? rec.issuer : '') + '" placeholder="如：中共 XX 委员会"></div></div>' +
      '<div class="form-two"><div class="form-row"><label>发布日期</label><input type="date" id="fDate" value="' + esc(rec ? rec.adopted : '') + '"></div>' +
      '<div class="form-row"><label>施行日期</label><input type="date" id="fEff" value="' + esc(rec ? rec.effective : '') + '"></div></div>' +
      '<div class="form-row"><label>主题标签<span class="hint">以顿号或逗号分隔</span></label>' +
      '<input type="text" id="fTags" value="' + esc(rec ? (rec.tags || []).join('、') : '') + '" placeholder="如：民主生活会、基层党建"></div>' +
      '<div class="form-row"><label>摘要<span class="hint">用于检索结果列表</span></label>' +
      '<input type="text" id="fSummary" value="' + esc(rec ? rec.summary : '') + '"></div>' +
      '<div class="form-row"><label>正文<span class="hint">每行一段，支持换行分段</span></label>' +
      '<textarea id="fText" placeholder="粘贴法规全文…">' + esc(rec ? (rec.text || '') : '') + '</textarea></div>' +
      '<div class="form-row"><label>原文链接<span class="hint">选填</span></label>' +
      '<input type="text" id="fUrl" value="' + esc(rec ? rec.url : '') + '" placeholder="https://"></div>' +
      '<div class="btn-row"><button class="btn btn-primary" id="saveBtn">保存条目</button>' +
      '<a class="btn btn-ghost" href="#/custom">返回列表</a>' +
      (rec ? '<button class="btn btn-danger" id="cancelBtn">取消编辑</button>' : '') + '</div>' +
      '</div>';

    byId('saveBtn').addEventListener('click', function () {
      var title = byId('fTitle').value.trim();
      if (!title) { toast('请填写标题'); byId('fTitle').focus(); return; }
      var tags = byId('fTags').value.split(/[、,，;；\s]+/).filter(function (x) { return x; });
      var payload = {
        id: rec ? rec.id : '',
        title: title,
        cat: byId('fCat').value,
        issuer: byId('fIssuer').value.trim(),
        adopted: byId('fDate').value,
        effective: byId('fEff').value,
        tags: tags,
        summary: byId('fSummary').value.trim(),
        text: byId('fText').value,
        url: byId('fUrl').value.trim()
      };
      var saved = Store.custom.save(payload);
      Search.addDoc(normalizeCustom(saved));
      refreshCounts();
      toast(rec ? '已更新条目' : '已新增条目');
      go('#/doc/' + saved.id);
    });
    if (byId('cancelBtn')) {
      byId('cancelBtn').addEventListener('click', function () { go('#/custom'); });
    }
  }

  /* ========================================================= 时间轴 */
  function renderTimeline() {
    var byYear = Search.byYear();
    var years = Object.keys(byYear).sort(function (a, b) { return b - a; });
    if (!years.length) {
      $('#view').innerHTML = '<div class="empty"><div class="empty-icon">' + ICON.clock + '</div>暂无带年份的条目</div>';
      return;
    }
    /* 先按年份分组算好每组的 HTML，再按「卡片数」分批渲染：
       一次把 2,706 张卡片全塞进 DOM（13,043 个节点）在低配机器上必卡。 */
    var groups = years.map(function (y) {
      var list = byYear[y].slice().sort(function (a, b) {
        return (b.level || 0) - (a.level || 0) || pubDate(b).localeCompare(pubDate(a));
      });
      var html = '<div class="tl-year"><h3>' + y + ' 年<span class="n">' + list.length + ' 条</span></h3><div class="tl-items">';
      list.forEach(function (doc) {
        // 分组年份与显示日期必须同源（published），否则会出现「2025 年 / 2016 年 11 月 30 日」这种错位
        var d = fmtDate(pubDate(doc)) || (y + '年');
        html += '<div class="tl-item"><a class="tl-card" href="' + docUrl(doc.id) + '">' +
          '<div class="tt">' + esc(doc.title) + '</div>' +
          '<div class="mm"><span style="color:' + catColor(doc.cat) + '">●</span> ' + esc(doc.catName) +
          ' · ' + esc(doc.issuer || '—') + ' · ' + esc(d) + '</div></a></div>';
      });
      html += '</div></div>';
      return { year: y, n: list.length, html: html };
    });

    /* 一批至少 TL_CARDS 张卡片（至少一个年份），点一次「再显示」追加一批 */
    function batchEnd(from) {
      var n = 0, i = from;
      while (i < groups.length && n < TL_CARDS) { n += groups[i].n; i++; }
      return Math.max(i, from + 1);
    }

    var p = {
      total: groups.length, shown: 0, unit: '个年份', box: 'tlList',
      end: batchEnd,
      label: function (rest, from) { return '再显示更早的 ' + (batchEnd(from) - from) + ' 个年份（还有 ' + rest + ' 个年份）'; },
      render: function (from, to) {
        var out = '';
        for (var i = from; i < to; i++) out += groups[i].html;
        return out;
      }
    };
    paging.tl = p;
    p.shown = p.end(0);

    $('#view').innerHTML =
      '<div class="page-head"><h2 class="page-title">立法时间轴</h2>' +
      '<p class="page-sub">按现行版本的公布日期归集，可用于观察法规体系演进脉络</p></div>' +
      '<div id="tlList">' + p.render(0, p.shown) + '</div>' +
      moreBox('tl', p);
  }

  /* ========================================================= 导出中心 */
  function renderExport(q) {
    var scope = q.scope || 'all';
    var docId = q.id || '';

    var scopes = [
      { id: 'results', name: '当前检索结果', n: state.lastIds.length, desc: '上次检索命中的条目' },
      { id: 'all', name: '全部收录法规', n: Search.count(), desc: '库内所有条目' },
      { id: 'fav', name: '我的收藏', n: Store.fav.count(), desc: '收藏夹内的条目' },
      { id: 'custom', name: '自建条目', n: Store.custom.count(), desc: '本机新增的条目' },
      { id: 'notes', name: '我的笔记', n: Store.marks.count(), desc: '正文里的划线与批注' },
      { id: 'cat', name: '指定门类', n: 0, desc: '选择某一门类导出' },
      { id: 'doc', name: '单篇法规', n: docId ? 1 : 0, desc: '仅导出一篇法规' }
    ];

    var scopeHtml = '';
    scopes.forEach(function (s) {
      var on = scope === s.id;
      scopeHtml += '<div class="scope-item' + (on ? ' on' : '') + '" data-scope="' + s.id + '">' +
        '<span class="check"></span><span class="nm">' + s.name + '</span>' +
        '<span class="n">' + (s.id === 'cat' ? '选择' : s.n) + ' 条</span></div>';
    });

    var formats = [
      { id: 'md', name: 'Markdown', desc: '适合 Obsidian / 飞书 / 语雀等笔记工具二次编辑', ext: '.md' },
      { id: 'txt', name: '纯文本', desc: '带元信息分隔线，便于打印与归档', ext: '.txt' },
      { id: 'html', name: '单文件网页', desc: '含内嵌样式，可直接双击打开或转 PDF', ext: '.html' },
      { id: 'json', name: 'JSON', desc: '结构化数据，便于二次开发与迁移', ext: '.json' },
      { id: 'csv', name: 'CSV 表格', desc: '元数据清单，可用 Excel 打开（UTF-8 BOM）', ext: '.csv' }
    ];
    var fmtHtml = '';
    formats.forEach(function (f) {
      fmtHtml += '<div class="export-card"><h4>' + f.name + ' <span style="font-weight:400;color:var(--ink-4);font-size:12px">' + f.ext + '</span></h4>' +
        '<p>' + f.desc + '</p>' +
        '<button class="btn btn-sm" data-fmt="' + f.id + '">导出</button></div>';
    });

    $('#view').innerHTML =
      '<div class="page-head"><h2 class="page-title">导出中心</h2>' +
      '<p class="page-sub">选择导出范围与格式，生成的文件保存在浏览器默认下载目录</p></div>' +
      '<div class="card card-pad" style="margin-bottom:18px"><div class="filter-title">导出范围</div>' +
      '<div class="scope-list">' + scopeHtml + '</div>' +
      (scope === 'cat' ? '<div class="form-row" style="margin-bottom:0"><label>选择门类</label><select id="expCat">' +
        CATS.map(function (c) { return '<option value="' + c.id + '">' + esc(c.name) + '</option>'; }).join('') + '</select></div>' : '') +
      (scope === 'doc' ? '<div class="form-row" style="margin-bottom:0"><label>选择法规</label><select id="expDoc">' +
        Search.all().slice(0, 400).map(function (doc) {
          return '<option value="' + esc(doc.id) + '"' + (doc.id === docId ? ' selected' : '') + '>' + esc(doc.title) + '</option>';
        }).join('') + '</select></div>' : '') +
      '</div>' +
      '<div class="section-head"><h3 class="section-title">导出格式</h3></div>' +
      '<div class="export-grid">' + fmtHtml + '</div>' +
      '<div class="section"><div class="section-head"><h3 class="section-title">备份与迁移</h3></div>' +
      '<div class="card card-pad"><p class="page-sub" style="margin-bottom:12px">' +
      '导出的 JSON 备份包含收藏夹、自建条目与偏好设置，可在另一台电脑上通过「自建条目 → 导入备份」恢复。</p>' +
      '<div class="btn-row"><button class="btn btn-sm" id="bkExp">导出完整备份</button>' +
      '<a class="btn btn-sm btn-ghost" href="#/custom">前往导入</a></div></div></div>';

    $$('#view [data-scope]').forEach(function (el) {
      el.addEventListener('click', function () {
        var p = [];
        var s = el.getAttribute('data-scope');
        p.push('scope=' + s);
        if (s === 'doc' && docId) p.push('id=' + encodeURIComponent(docId));
        go('#/export?' + p.join('&'));
      });
    });

    $$('#view [data-fmt]').forEach(function (b) {
      b.addEventListener('click', function () {
        var fmt = b.getAttribute('data-fmt');
        /* 笔记不是法规条目，单独导出（Markdown / JSON） */
        if (scope === 'notes') {
          var n = Store.marks.count();
          if (!n) { toast('还没有划线'); return; }
          var day = new Date().toISOString().slice(0, 10);
          if (fmt === 'json') {
            Exporter.download('我的笔记_' + day + '.json', JSON.stringify(Store.marks.map(), null, 2), 'application/json');
          } else if (fmt === 'txt') {
            Exporter.download('我的笔记_' + day + '.txt', notesMarkdown().replace(/^#+\s*/gm, ''), 'text/plain');
          } else {
            Exporter.download('我的笔记_' + day + '.md', notesMarkdown(), 'text/markdown');
          }
          toast('已导出 ' + n + ' 条笔记');
          return;
        }
        var docs = collectDocs(scope, docId);
        if (!docs.length) { toast('该范围内没有可导出的内容'); return; }
        exportWithBodies(docs, fmt, scopeLabel(scope), function () {
          var res = Exporter.exportDocs(docs, fmt, scopeLabel(scope));
          toast(res.msg);
        });
      });
    });

    byId('bkExp').addEventListener('click', function () {
      Exporter.download('法律法规库_完整备份_' + new Date().toISOString().slice(0, 10) + '.json',
        JSON.stringify(Store.exportAll(), null, 2), 'application/json');
      toast('备份已导出');
    });
  }

  function scopeLabel(scope) {
    switch (scope) {
      case 'fav': return '我的收藏';
      case 'custom': return '自建条目';
      case 'notes': return '我的笔记';
      case 'results': return '检索结果';
      case 'cat': return '门类法规';
      case 'doc': return '单篇法规';
      default: return '党内法规汇编';
    }
  }

  /* 全部划线与批注导出成 Markdown */
  function notesMarkdown() {
    var out = ['# 我的笔记', '', '导出时间：' + new Date().toLocaleString('zh-CN'), ''];
    Store.marks.docs().forEach(function (g) {
      var doc = Search.get(g.id);
      out.push('## ' + (doc ? titleOf(doc) : g.id));
      out.push('');
      g.list.slice().sort(function (a, b) { return a.s - b.s; }).forEach(function (m) {
        out.push('> ' + String(m.t || '').replace(/\n/g, ' '));
        if (m.n) { out.push('>'); out.push('> **批注**：' + String(m.n).replace(/\n/g, ' ')); }
        out.push('');
      });
    });
    return out.join('\n');
  }

  /* ============================================================== 我的笔记 */
  function renderNotes(q) {
    var kw = String(q.k || '').trim().toLowerCase();
    var groups = Store.marks.docs();
    var total = 0, shown = 0, html = '';

    groups.forEach(function (g) {
      var doc = Search.get(g.id);
      var title = doc ? titleOf(doc) : (g.id + '（库中已无此条目）');
      var items = g.list.filter(function (m) {
        if (!kw) return true;
        var hay = (String(m.t || '') + ' ' + String(m.n || '') + ' ' + String(m.sec || '') + ' ' + title).toLowerCase();
        return hay.indexOf(kw) >= 0;
      });
      if (!items.length) return;
      total += items.length;
      shown += items.length;
      html += '<div class="notes-group">' +
        '<div class="ng-head"><a href="' + (doc ? docUrl(g.id) : '#') + '">' + esc(title) + '</a>' +
        '<span class="ng-n">' + items.length + ' 条</span></div>' +
        items.slice().sort(function (a, b) { return a.s - b.s; }).map(function (m) {
          var day = m.ts ? fmtDate(new Date(m.ts).toISOString().slice(0, 10)) : '';
          return '<div class="ng-item">' +
            '<div class="ni-t">' + esc(m.t) + '</div>' +
            (m.n ? '<div class="ni-n">' + esc(m.n) + '</div>' : '') +
            '<div class="ni-s">' + esc(m.sec || '') + (day ? ' · ' + day : '') + '</div>' +
            '</div>';
        }).join('') + '</div>';
    });

    $('#view').innerHTML =
      '<div class="page-head"><h2 class="page-title">我的笔记</h2>' +
      '<p class="page-sub">共 ' + total + ' 条划线' + (kw ? '（筛选：' + esc(kw) + '）' : '') + ' · 在正文里选中文字即可划线并写批注</p></div>' +
      '<form class="notes-bar" id="notesForm">' +
      '<input type="text" id="notesKw" value="' + esc(kw) + '" placeholder="搜索划线、批注或法规名…">' +
      '<button class="btn btn-sm btn-primary" type="submit">搜索</button>' +
      '<a class="btn btn-sm btn-ghost" href="#/export?scope=notes">导出笔记</a>' +
      '</form>' +
      (shown ? html : '<div class="empty"><div class="empty-icon">' + ICON.pen + '</div>' +
        (groups.length ? '没有匹配的笔记' : '还没有划线。<br><span style="font-size:13px;color:var(--ink-4)">打开任意法规，选中正文即可划线、写批注。</span>') + '</div>');

    var form = byId('notesForm');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        go('#/notes' + (byId('notesKw').value.trim() ? '?k=' + encodeURIComponent(byId('notesKw').value.trim()) : ''));
      });
    }
  }

  function collectDocs(scope, docId) {
    switch (scope) {
      case 'results':
        return state.lastIds.map(function (id) { return Search.get(id); }).filter(Boolean);
      case 'fav':
        return Store.fav.list().map(function (f) { return Search.get(f.id); }).filter(Boolean);
      case 'custom':
        return Store.custom.list().map(function (r) { return Search.get(r.id); }).filter(Boolean);
      case 'cat': {
        var sel = byId('expCat');
        var cid = sel ? sel.value : 'dangzhang';
        return Search.all().filter(function (x) { return x.cat === cid; });
      }
      case 'doc': {
        var pick = byId('expDoc');
        var id = (pick && pick.value) || docId;
        var doc = id ? Search.get(id) : null;
        return doc ? [doc] : [];
      }
      default:
        return Search.all();
    }
  }

  /* =========================================================== 弹层 */
  function openModal(title, bodyHtml, buttons) {
    var root = byId('modalRoot');
    byId('modalTitle').textContent = title;
    byId('modalBody').innerHTML = bodyHtml;
    var foot = byId('modalFoot');
    foot.innerHTML = '';
    (buttons || []).forEach(function (b) {
      var btn = d.createElement('button');
      btn.className = b.cls || 'btn btn-ghost';
      btn.textContent = b.text;
      btn.addEventListener('click', function () {
        if (b.act) {
          var keep = b.act();
          if (keep === false) return;
        }
        closeModal();
      });
      foot.appendChild(btn);
    });
    root.hidden = false;
  }

  function closeModal() {
    var root = byId('modalRoot');
    if (!root) return;
    root.hidden = true;
    byId('modalBody').innerHTML = '';
  }

  /* =========================================================== 启动 */
  // 对外暴露少量内部方法，便于自动化测试
  w.FGApp = {
    normalizeCustom: normalizeCustom,
    route: route,
    collectDocs: collectDocs,
    indexCustom: indexCustom,
    mergeData: mergeData,
    /* 侧栏计数刷新（划线增删后要同步「我的笔记」的角标） */
    refreshCounts: refreshCounts,
    /* 正文按需加载：自检页与自动化脚本要用它把正文分片全部挂上来 */
    ensureBodies: ensureBodies,
    bodyFileList: bodyFileList,
    bodyLoaded: bodyLoaded
  };

  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', boot);
  else boot();

})(window, document);
