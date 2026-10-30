/* 法规库 Mini App · 客户端
 *
 * 数据全部来自同源 API（服务端持有全量语料），客户端只存本地状态：
 * 收藏、自建条目、划线批注、最近浏览、阅读设置。
 *
 * 与原生微信小程序共用同一套 API 契约，页面结构一一对应。
 */
(function () {
  'use strict';

  /* ============================================================ 工具 */

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!attrs.hasOwnProperty(k)) continue;
        var v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'text') node.textContent = v;
        else if (k.indexOf('on') === 0 && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v === true ? '' : v);
      }
    }
    if (children) {
      for (var i = 0; i < children.length; i++) {
        var c = children[i];
        if (c === null || c === undefined || c === false) continue;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      }
    }
    return node;
  }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtDate(iso) {
    if (!iso) return '';
    var p = String(iso).split('-');
    if (p.length === 3) return p[0] + '年' + parseInt(p[1], 10) + '月' + parseInt(p[2], 10) + '日';
    if (p.length === 2) return p[0] + '年' + parseInt(p[1], 10) + '月';
    if (p.length === 1 && /^\d{4}$/.test(p[0])) return p[0] + '年';
    return iso;
  }

  function fmtNum(n) {
    n = Number(n) || 0;
    if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + '万字';
    return n + '字';
  }

  function debounce(fn, wait) {
    var t = null;
    return function () {
      var args = arguments;
      var self = this;
      if (t) clearTimeout(t);
      t = setTimeout(function () { t = null; fn.apply(self, args); }, wait);
    };
  }

  /* ============================================================ 图标 */

  var ICON = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V20h13V9.5"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M16.5 16.5 21 21"/>',
    tree: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/>',
    clock: '<circle cx="12" cy="12" r="8.4"/><path d="M12 7.2V12l3.2 2.1"/>',
    me: '<circle cx="12" cy="8" r="3.6"/><path d="M4.8 20c0-3.4 3.2-5.6 7.2-5.6s7.2 2.2 7.2 5.6"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    star: '<path d="M12 3.9l2.6 5.3 5.8.85-4.2 4.1 1 5.8L12 17.3l-5.2 2.65 1-5.8-4.2-4.1 5.8-.85L12 3.9z"/>',
    starFill: '<path d="M12 3.9l2.6 5.3 5.8.85-4.2 4.1 1 5.8L12 17.3l-5.2 2.65 1-5.8-4.2-4.1 5.8-.85L12 3.9z" fill="currentColor"/>',
    mark: '<path d="M4.5 19.5h6"/><path d="M13.5 5.5l5 5-9.5 9.5-5.5.5.5-5.5 9.5-9.5z"/><path d="M11.8 7.2l5 5"/>',
    down: '<path d="M12 4v12"/><path d="M7 12l5 5 5-5"/><path d="M4.5 20h15"/>',
    chev: '<path d="M9 5l7 7-7 7"/>',
    none: '<circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/>',
    pen: '<path d="M4.5 19.5h15"/><path d="M13.2 4.8l6 6L9.4 20.6l-6 1 1-6 8.8-10.8z"/>',
    trash: '<path d="M4.5 6.5h15"/><path d="M9 6.5V4.8h6v1.7"/><path d="M6.5 6.5 7.4 20h9.2l.9-13.5"/>'
  };

  function svg(name, size) {
    return '<svg viewBox="0 0 24 24" width="' + (size || 20) + '" height="' + (size || 20) +
      '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      ICON[name] + '</svg>';
  }

  /* ============================================================ 本地存储 */

  var LS = (function () {
    try {
      var k = '__fg_probe__';
      window.localStorage.setItem(k, '1');
      window.localStorage.removeItem(k);
      return window.localStorage;
    } catch (e) { return null; }
  })();
  var mem = {};

  var KEY = {
    fav: 'fg.fav.v1', custom: 'fg.custom.v1', settings: 'fg.settings.v1',
    recent: 'fg.recent.v1', marks: 'fg.marks.v1', history: 'fg.history.v1'
  };

  function get(key, fallback) {
    var raw = null;
    try { raw = LS ? LS.getItem(key) : mem[key]; } catch (e) { raw = mem[key]; }
    if (raw === null || raw === undefined) return fallback;
    try {
      var v = JSON.parse(raw);
      return v === null || v === undefined ? fallback : v;
    } catch (e) { return fallback; }
  }

  function set(key, value) {
    var raw = JSON.stringify(value);
    mem[key] = raw;
    try { if (LS) LS.setItem(key, raw); } catch (e) { /* 容量不足时仅留内存副本 */ }
    return value;
  }

  var Store = {
    fav: {
      map: function () { return get(KEY.fav, {}) || {}; },
      list: function () {
        var m = Store.fav.map(), out = [];
        for (var id in m) if (m.hasOwnProperty(id)) out.push({ id: id, ts: m[id].ts || 0, note: m[id].note || '' });
        out.sort(function (a, b) { return b.ts - a.ts; });
        return out;
      },
      has: function (id) { return Store.fav.map().hasOwnProperty(id); },
      toggle: function (id) {
        var m = Store.fav.map();
        if (m.hasOwnProperty(id)) { delete m[id]; set(KEY.fav, m); return false; }
        m[id] = { ts: Date.now(), note: '' };
        set(KEY.fav, m);
        return true;
      },
      count: function () { var m = Store.fav.map(), n = 0; for (var k in m) if (m.hasOwnProperty(k)) n++; return n; }
    },
    marks: {
      map: function () { return get(KEY.marks, {}) || {}; },
      list: function (docId) {
        var arr = Store.marks.map()[docId] || [];
        return arr.slice().sort(function (a, b) { return a.s - b.s; });
      },
      add: function (docId, m) {
        var all = Store.marks.map();
        var arr = all[docId] || [];
        if (!m.id) m.id = 'm' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
        if (!m.ts) m.ts = Date.now();
        arr.push(m);
        all[docId] = arr;
        set(KEY.marks, all);
        return m;
      },
      remove: function (docId, id) {
        var all = Store.marks.map();
        all[docId] = (all[docId] || []).filter(function (m) { return m.id !== id; });
        set(KEY.marks, all);
      },
      update: function (docId, id, patch) {
        var all = Store.marks.map();
        var arr = all[docId] || [];
        for (var i = 0; i < arr.length; i++) {
          if (arr[i].id !== id) continue;
          for (var k in patch) if (patch.hasOwnProperty(k)) arr[i][k] = patch[k];
          arr[i].ts = Date.now();
          break;
        }
        all[docId] = arr;
        set(KEY.marks, all);
      },
      docs: function () {
        var all = Store.marks.map(), out = [];
        for (var id in all) {
          if (!all.hasOwnProperty(id)) continue;
          var arr = (all[id] || []).slice();
          if (!arr.length) continue;
          arr.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
          out.push({ id: id, list: arr, ts: arr[0].ts || 0 });
        }
        out.sort(function (a, b) { return b.ts - a.ts; });
        return out;
      },
      count: function () {
        var all = Store.marks.map(), n = 0;
        for (var k in all) if (all.hasOwnProperty(k)) n += (all[k] || []).length;
        return n;
      }
    },
    custom: {
      list: function () { return get(KEY.custom, []) || []; },
      save: function (rec) {
        var arr = Store.custom.list();
        var now = Date.now();
        if (!rec.id) { rec.id = 'c' + now.toString(36); rec.created = now; }
        rec.updated = now;
        rec.custom = true;
        var found = false;
        for (var i = 0; i < arr.length; i++) if (arr[i].id === rec.id) { arr[i] = rec; found = true; break; }
        if (!found) arr.unshift(rec);
        set(KEY.custom, arr);
        return rec;
      },
      remove: function (id) { set(KEY.custom, Store.custom.list().filter(function (r) { return r.id !== id; })); },
      count: function () { return Store.custom.list().length; }
    },
    recent: {
      list: function () { return get(KEY.recent, []) || []; },
      push: function (id) {
        var arr = Store.recent.list().filter(function (x) { return x !== id; });
        arr.unshift(id);
        set(KEY.recent, arr.slice(0, 24));
      },
      clear: function () { set(KEY.recent, []); }
    },
    /* 检索历史：首页「最近检索」。党务工作者反复查同样的关键词，命中率很高 */
    history: {
      list: function () { return get(KEY.history, []) || []; },
      push: function (q) {
        q = String(q === undefined || q === null ? '' : q).trim();
        if (!q) return;
        var arr = Store.history.list().filter(function (x) { return x !== q; });
        arr.unshift(q);
        set(KEY.history, arr.slice(0, 10));
      },
      remove: function (q) {
        set(KEY.history, Store.history.list().filter(function (x) { return x !== q; }));
      },
      clear: function () { set(KEY.history, []); }
    },
    settings: {
      all: function () {
        var s = get(KEY.settings, {});
        if (!s.fontSize) s.fontSize = 15;
        if (!s.theme) s.theme = 'light';
        return s;
      },
      get: function (k) { return Store.settings.all()[k]; },
      set: function (k, v) { var s = Store.settings.all(); s[k] = v; set(KEY.settings, s); return v; }
    }
  };

  /* ============================================================ API */

  function api(path, params) {
    /* 静态部署：没有 Node 服务端时，改走纯前端数据层（window.FGStaticAPI）。
       两种后端共用同一套 /api/* 契约，视图代码完全不用改。 */
    if (window.FGStaticAPI && window.FGStaticAPI.enabled) {
      return window.FGStaticAPI.request(path, params);
    }
    var qs = '';
    if (params) {
      var parts = [];
      for (var k in params) {
        if (!params.hasOwnProperty(k)) continue;
        if (params[k] === null || params[k] === undefined || params[k] === '') continue;
        parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
      }
      if (parts.length) qs = '?' + parts.join('&');
    }
    return fetch(path + qs, { headers: { accept: 'application/json' } }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  /* ============================================================ 全局状态 */

  var State = {
    meta: null,
    route: { name: 'home', params: {} },
    lastQuery: '',
    cat: 'all',
    group: 'all',
    sort: 'relevance',
    page: 1,
    results: [],
    total: 0,
    pages: 1,
    loading: false,
    loadTip: '',
    /* 静态站两段式检索：partial=true 表示结果只含元信息命中，正文分片仍在下载 */
    partial: false,
    loadingBodies: false,
    searchLoaded: false,
    docCache: {}
  };

  /* ============================================================ 提示条 */

  var toastTimer = null;
  function toast(msg) {
    var root = $('#toastRoot');
    if (!root) return;
    root.textContent = '';
    var t = el('div', { class: 'toast', role: 'status', text: msg });
    root.appendChild(t);
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 2200);
  }

  /* ============================================================ 弹层 */

  var modalRoot = null;
  function closeModal() {
    if (!modalRoot) return;
    modalRoot.hidden = true;
    modalRoot.innerHTML = '';
  }

  function openModal(title, bodyNodes, footNodes) {
    if (!modalRoot) return;
    modalRoot.innerHTML = '';
    modalRoot.hidden = false;
    var box = el('div', { class: 'modal-box', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
    var head = el('header', { class: 'modal-head' }, [
      el('h3', { text: title }),
      el('button', { class: 'icon-btn btn btn-ghost btn-sm', 'aria-label': '关闭', onclick: closeModal, html: '✕' })
    ]);
    var body = el('div', { class: 'modal-body' });
    (bodyNodes || []).forEach(function (n) { if (n) body.appendChild(n); });
    box.appendChild(head);
    box.appendChild(body);
    if (footNodes && footNodes.length) {
      var foot = el('footer', { class: 'modal-foot' });
      footNodes.forEach(function (n) { if (n) foot.appendChild(n); });
      box.appendChild(foot);
    }
    modalRoot.appendChild(el('div', { class: 'modal-mask', onclick: closeModal }));
    modalRoot.appendChild(box);
    var first = body.querySelector('input, textarea, select');
    if (first) first.focus();
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeModal();
  });

  /* ============================================================ 渲染：文档卡片 */

  function docCard(d, snippetHtml) {
    var meta = el('div', { class: 'doc-meta' }, [
      el('span', { class: 'badge badge-accent', text: d.catName || '' })
    ]);
    if (d.published) meta.appendChild(el('span', { text: fmtDate(d.published) }));
    if (d.issuer) meta.appendChild(el('span', { text: d.issuer }));
    if (d.chars) meta.appendChild(el('span', { text: fmtNum(d.chars) }));

    var kids = [el('div', { class: 'doc-title', text: d.title }), meta];
    if (snippetHtml) {
      kids.push(el('div', { class: 'doc-snip', html: snippetHtml }));
    } else if (d.summary) {
      kids.push(el('div', { class: 'doc-snip', text: d.summary }));
    }
    var a = el('a', { class: 'doc-item', href: '#/doc/' + encodeURIComponent(d.id) }, kids);
    return a;
  }

  function emptyState(title, sub, iconName) {
    return el('div', { class: 'empty' }, [
      el('div', { html: svg(iconName || 'none', 40) }),
      el('p', { text: title }),
      sub ? el('p', { class: 'sub', text: sub }) : null
    ]);
  }

  function skeletonList(n) {
    var wrap = el('div');
    for (var i = 0; i < (n || 3); i++) wrap.appendChild(el('div', { class: 'skeleton' }));
    return wrap;
  }

  /* ============================================================ 视图：首页
   *
   * 首页只放「打开就能用」的东西，职责单一，不和底部标签页 / 「我的」页重复：
   *   ① 检索卡   —— 全站唯一的搜索入口 + 库规模概览
   *   ② 法规体系 —— 5 个体系的概览卡片；门类明细在「体系」页，这里不再列第二遍
   *   ③ 最近检索 —— 本机检索历史
   * 「最近浏览 / 收藏 / 笔记 / 自建」是个人数据，统一放在「我的」页。
   */
  function viewHome(view) {
    var meta = State.meta;
    if (!meta) { view.appendChild(skeletonList(3)); return; }

    /* ---------- ① 检索卡 ---------- */
    var input = el('input', {
      type: 'search', placeholder: '检索党章党规、法律法规条文…', 'aria-label': '检索法规',
      onkeydown: function (e) { if (e.key === 'Enter') { e.preventDefault(); goSearch(input.value); } }
    });
    var bar = el('form', {
      class: 'searchbar', role: 'search',
      onsubmit: function (e) { e.preventDefault(); goSearch(input.value); }
    }, [
      el('span', { html: svg('search', 16) }),
      input,
      /* 按钮显式绑定 onclick，不只依赖表单提交：点击、回车、搜索图标三条路径都要能触发 */
      el('button', {
        class: 'btn btn-primary btn-sm', type: 'submit', text: '检索',
        onclick: function (e) { e.preventDefault(); goSearch(input.value); }
      })
    ]);

    function statCell(v, label) {
      return el('div', { class: 'stat-cell' }, [
        el('b', { text: v }),
        el('span', { text: label })
      ]);
    }
    function wan(n) {
      n = Number(n) || 0;
      /* 只返回数字，单位放在标签里（「1347.2」+「万字」），
         否则数值太长会把相邻两格挤在一起 */
      if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '');
      return String(n);
    }
    var catTotal = 0;
    for (var ck in meta.stats) {
      if (meta.stats.hasOwnProperty(ck) && meta.stats[ck] && meta.stats[ck].count) catTotal++;
    }
    var hero = el('section', { class: 'card' }, [
      el('div', { class: 'stat-row' }, [
        statCell(String(meta.total || 0), '部法规'),
        statCell(wan(meta.totalChars), '万字'),
        statCell(String(catTotal), '个门类'),
        statCell(String(meta.groups.length), '个体系')
      ]),
      bar
    ]);

    /* ---------- ② 法规体系（体系级概览，门类明细去「体系」页看） ---------- */
    var sysGrid = el('div', { class: 'sys-grid' });
    meta.groups.forEach(function (g) {
      var total = 0, names = [];
      g.cats.forEach(function (cid) {
        var st = meta.stats[cid];
        if (!st || !st.count) return;
        total += st.count;
        names.push(st.name);
      });
      if (!total) return;
      sysGrid.appendChild(el('a', { class: 'sys-card', href: '#/tree/' + g.id }, [
        el('div', { class: 'sys-top' }, [
          el('span', { class: 'group-dot', style: 'background:' + (g.color || 'var(--mcode-accent)') }),
          el('span', { class: 'sys-name', text: g.name }),
          el('span', { class: 'sys-count', text: total + ' 部' })
        ]),
        el('div', { class: 'sys-cats', text: names.join(' · ') })
      ]));
    });

    /* ---------- ③ 最近检索 ---------- */
    var hist = Store.history.list();

    view.appendChild(el('section', { class: 'section' }, [hero]));
    view.appendChild(el('section', { class: 'section' }, [
      el('div', { class: 'section-head' }, [
        el('span', { class: 'section-title', text: '法规体系' }),
        el('a', { class: 'section-more', href: '#/tree', text: '全部门类 ›' })
      ]),
      sysGrid
    ]));
    if (hist.length) {
      var hbox = el('div', { class: 'chips' });
      hist.forEach(function (q) {
        hbox.appendChild(el('button', {
          class: 'chip', type: 'button', text: q,
          onclick: function () { goSearch(q); }
        }));
      });
      view.appendChild(el('section', { class: 'section' }, [
        el('div', { class: 'section-head' }, [
          el('span', { class: 'section-title', text: '最近检索' }),
          el('button', {
            class: 'section-more', style: 'background:none;border:0;padding:0', text: '清空',
            onclick: function () { Store.history.clear(); route(); }
          })
        ]),
        hbox
      ]));
    }

    /* ---------- ④ 最新发布（数据驱动，不硬编码法规 id） ---------- */
    var latestBox = el('div', { class: 'doc-list' });
    var latestSection = el('section', { class: 'section' }, [
      el('div', { class: 'section-head' }, [
        el('span', { class: 'section-title', text: '最新发布' }),
        el('a', { class: 'section-more', href: '#/timeline', text: '时间轴 ›' })
      ]),
      latestBox
    ]);
    view.appendChild(latestSection);
    api('/api/search', { sort: 'new', page: 1, size: 6 }).then(function (res) {
      latestBox.innerHTML = '';
      (res.hits || []).forEach(function (r) { latestBox.appendChild(docCard(r)); });
      if (!latestBox.children.length) latestSection.style.display = 'none';
    }).catch(function () {
      latestSection.style.display = 'none';
    });
  }

  /* 收藏 / 笔记 / 最近浏览里的条目元信息。
     /api/meta 不带全量 records（那有 1.4MB），所以按 id 批量取，随用随取。 */
  var recCache = {};

  function findRecord(id) {
    return recCache[id] || null;
  }

  function loadRecords(ids) {
    var need = [];
    ids.forEach(function (id) {
      if (!recCache[id] && need.indexOf(id) === -1) need.push(id);
    });
    if (!need.length) return Promise.resolve(ids.map(findRecord));
    return api('/api/recs', { ids: need.join(',') }).then(function (res) {
      (res.items || []).forEach(function (r) { recCache[r.id] = r; });
      return ids.map(findRecord);
    }).catch(function () {
      return ids.map(findRecord);
    });
  }

  /* ============================================================ 视图：检索 */

  function viewSearch(view) {
    var q = State.lastQuery;
    var input = el('input', {
      type: 'search', value: q, placeholder: '检索法规标题、条文、发布机关…', 'aria-label': '检索法规',
      onkeydown: function (e) { if (e.key === 'Enter') { e.preventDefault(); runSearch(input.value, 1); } }
    });
    var bar = el('form', {
      class: 'searchbar', role: 'search',
      onsubmit: function (e) { e.preventDefault(); runSearch(input.value, 1); }
    }, [
      el('span', { html: svg('search', 16) }),
      input,
      el('button', {
        class: 'btn btn-primary btn-sm', type: 'submit', text: '检索',
        onclick: function (e) { e.preventDefault(); runSearch(input.value, 1); }
      })
    ]);
    view.appendChild(el('section', { class: 'section' }, [bar]));

    /* 门类筛选 */
    if (State.meta) {
      var chips = el('div', { class: 'chips' });
      chips.appendChild(el('button', {
        class: 'chip', 'aria-pressed': State.cat === 'all' ? 'true' : 'false', text: '全部门类',
        onclick: function () { State.cat = 'all'; runSearch(State.lastQuery, 1); }
      }));
      State.meta.categories.forEach(function (c) {
        var st = State.meta.stats[c.id];
        if (!st || !st.count) return;
        chips.appendChild(el('button', {
          class: 'chip', 'aria-pressed': State.cat === c.id ? 'true' : 'false',
          text: c.name + ' ' + st.count,
          onclick: function () { State.cat = c.id; runSearch(State.lastQuery, 1); }
        }));
      });
      view.appendChild(el('section', { class: 'section' }, [
        el('div', { class: 'section-desc', style: 'margin-bottom:8px', text: '支持语法：「短语」精确匹配、-排除词、标题:字段限定' }),
        chips
      ]));
    }

    var sortSel = el('select', {
      class: 'sort-select', 'aria-label': '排序方式',
      onchange: function (e) { State.sort = e.target.value; runSearch(State.lastQuery, 1); }
    }, [
      el('option', { value: 'relevance', text: '相关度' }),
      el('option', { value: 'new', text: '最新在前' }),
      el('option', { value: 'old', text: '最早在前' }),
      el('option', { value: 'title', text: '按标题' })
    ]);
    sortSel.value = State.sort;

    var count = el('span', { class: 'count' });
    var listBox = el('div', { class: 'doc-list' });
    var moreBtn = el('button', {
      class: 'btn', style: 'width:100%;margin-top:12px', text: '加载更多',
      onclick: function () { runSearch(State.lastQuery, State.page + 1, true); }
    });
    moreBtn.hidden = true;

    view.appendChild(el('div', { class: 'toolbar' }, [
      sortSel, count
    ]));
    view.appendChild(listBox);
    view.appendChild(moreBtn);

    if (State.loading) {
      listBox.appendChild(skeletonList(4));
      count.textContent = '检索中…';
      return;
    }

    if (!State.lastQuery && State.page === 1) {
      /* 首次进入检索页：展示全库，按最新排序 */
      count.textContent = '共 ' + State.total + ' 部';
    } else {
      count.textContent = '共 ' + State.total + ' 条 · 用时 ' + (State.took || 0) + 'ms';
    }

    /* 静态站：正文分片还在后台下载 —— 先出元信息命中，等索引建好再补全文命中 */
    if (State.loadingBodies) {
      listBox.appendChild(el('div', { class: 'load-tip', id: 'loadTip', text: State.loadTip || '正在载入全文索引…' }));
    }

    if (!State.results.length) {
      if (State.loadingBodies) {
        listBox.appendChild(emptyState('正在建立全文索引', '首次检索需下载正文分片（约 12MB，仅此一次）', 'clock'));
      } else {
        listBox.appendChild(emptyState('没有找到匹配的法规', '换个关键词，或调整门类筛选', 'search'));
      }
    } else {
      State.results.forEach(function (r) { listBox.appendChild(docCard(r, r.snippetHtml)); });
    }
    if (State.page < State.pages) moreBtn.hidden = false;
  }

  /* ============================================================ 视图：门类 */

  function viewCat(view, catId) {
    var meta = State.meta;
    var cat = null;
    meta.categories.forEach(function (c) { if (c.id === catId) cat = c; });
    if (!cat) {
      view.appendChild(emptyState('未找到该门类', '', 'none'));
      return;
    }
    var st = meta.stats[catId] || { count: 0 };
    view.appendChild(el('div', { class: 'list-head' }, [
      el('h2', { text: cat.name }),
      el('span', { class: 'badge', text: st.count + ' 部' })
    ]));
    if (cat.desc) view.appendChild(el('div', { class: 'section-desc', style: 'margin-bottom:12px', text: cat.desc }));

    var listBox = el('div', { class: 'doc-list' });
    view.appendChild(listBox);
    listBox.appendChild(skeletonList(4));

    api('/api/search', { cat: catId, sort: 'new', page: 1, size: 40 }).then(function (res) {
      listBox.innerHTML = '';
      if (!res.hits.length) {
        listBox.appendChild(emptyState('该门类暂无条目', '', 'none'));
        return;
      }
      res.hits.forEach(function (r) { listBox.appendChild(docCard(r)); });
      if (res.pages > 1) {
        var more = el('button', { class: 'btn', style: 'width:100%;margin-top:12px', text: '加载更多' });
        var page = 1;
        more.onclick = function () {
          page++;
          api('/api/search', { cat: catId, sort: 'new', page: page, size: 40 }).then(function (r2) {
            r2.hits.forEach(function (r) { listBox.appendChild(docCard(r)); });
            if (page >= r2.pages) more.remove();
          });
        };
        view.appendChild(more);
      }
    }).catch(function (err) {
      listBox.innerHTML = '';
      listBox.appendChild(emptyState('加载失败', String(err.message || err), 'none'));
    });
  }

  /* ============================================================ 视图：详情 */

  function viewDoc(view, id) {
    var q = State.lastQuery;
    var box = el('div');
    view.appendChild(box);
    box.appendChild(skeletonList(2));

    api('/api/doc', { id: id, q: q }).then(function (d) {
      State.docCache[id] = d;
      Store.recent.push(id);
      box.innerHTML = '';
      renderDoc(box, d);
      updateActionBar(d);
    }).catch(function (err) {
      box.innerHTML = '';
      box.appendChild(emptyState('加载失败', String(err.message || err), 'none'));
    });
  }

  function renderDoc(box, d) {
    /* 头部 */
    var tags = el('div', { class: 'hero-tags' });
    tags.appendChild(el('span', { class: 'badge badge-accent', text: d.catName }));
    if (d.group) tags.appendChild(el('span', { class: 'badge', text: d.group }));
    if (d.effect) tags.appendChild(el('span', { class: 'badge badge-ok', text: d.effect }));
    if (d.flxz) tags.appendChild(el('span', { class: 'badge', text: d.flxz }));
    (d.tags || []).slice(0, 4).forEach(function (t) {
      tags.appendChild(el('span', { class: 'badge', text: t }));
    });

    var metaGrid = el('div', { class: 'meta-grid' });
    var rows = [
      ['制定机关', d.issuer],
      ['公布日期', fmtDate(d.published)],
      ['通过日期', fmtDate(d.adopted)],
      ['施行日期', fmtDate(d.effective)],
      ['最后修订', fmtDate(d.revised)],
      ['正文字数', d.chars ? fmtNum(d.chars) : ''],
      ['数据来源', d.source],
      ['门类细分', d.sub]
    ];
    rows.forEach(function (r) {
      if (!r[1]) return;
      metaGrid.appendChild(el('div', {}, [
        el('span', { class: 'k', text: r[0] }),
        el('span', { class: 'v', text: r[1], title: r[1] })
      ]));
    });

    box.appendChild(el('div', { class: 'doc-hero' }, [
      el('h1', { text: d.title }),
      tags,
      metaGrid
    ]));

    /* 目录 */
    if (d.toc && d.toc.length) {
      var toc = el('div', { class: 'toc' }, [el('div', { class: 'toc-title', text: '目录' })]);
      d.toc.forEach(function (t) {
        toc.appendChild(el('a', {
          class: 'toc-item', href: '#', text: t.name,
          onclick: function (e) { e.preventDefault(); scrollToName(t.name); }
        }));
        if (t.children) {
          t.children.forEach(function (c2) {
            toc.appendChild(el('a', {
              class: 'toc-item lv2', href: '#', text: c2.name,
              onclick: function (e) { e.preventDefault(); scrollToName(c2.name); }
            }));
          });
        }
      });
      box.appendChild(el('section', { class: 'section' }, [toc]));
    }

    /* 正文 */
    var article = el('article', { class: 'article', id: 'article' });
    d.blocks.forEach(function (b) {
      if (b.type === 'h2') {
        article.appendChild(el('h2', { text: b.text, 'data-name': b.text }));
      } else if (b.type === 'h3') {
        article.appendChild(el('h3', { text: b.text, 'data-name': b.text }));
      } else if (b.type === 'clause') {
        article.appendChild(el('p', { class: 'md-no' }, [
          el('span', { class: 'clause-no', text: b.no }),
          el('span', { text: ' ' + b.text })
        ]));
      } else if (b.type === 'item') {
        article.appendChild(el('p', { class: 'md-item' }, [
          el('span', { class: 'item-no', text: b.no }),
          el('span', { text: ' ' + b.text })
        ]));
      } else if (b.type === 'note') {
        article.appendChild(el('p', { class: 'md-note', text: b.text }));
      } else {
        article.appendChild(el('p', { text: b.text }));
      }
    });
    box.appendChild(el('section', { class: 'section' }, [article]));

    applyMarks(article, d.id);

    /* 来源链接 */
    if (d.url) {
      box.appendChild(el('section', { class: 'section' }, [
        el('a', {
          class: 'btn', href: d.url, target: '_blank', rel: 'noreferrer',
          html: svg('down', 16) + '<span>查看原文（' + esc(d.source || '来源站点') + '）</span>'
        })
      ]));
    }
  }

  function scrollToName(name) {
    var nodes = $$('[data-name]');
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].getAttribute('data-name') === name) {
        nodes[i].scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
    }
  }

  /* ---------------------------------------------------------- 划线批注 */

  /* 批注存的是正文纯文本的字符偏移。数据更新会让偏移漂移，
     渲染时按原文回退校验（与网页版 app.js 的 applyMarks 同一策略）。 */
  function applyMarks(article, docId) {
    var list = Store.marks.list(docId);
    if (!list.length) return;

    var walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT, null, false);
    var nodes = [];
    var total = 0;
    var n;
    while ((n = walker.nextNode())) { nodes.push({ node: n, start: total, len: n.nodeValue.length }); total += n.nodeValue.length; }

    function locate(s, e) {
      for (var i = 0; i < nodes.length; i++) {
        var it = nodes[i];
        if (s >= it.start && e <= it.start + it.len) {
          return { node: it.node, offset: s - it.start, len: e - s };
        }
      }
      return null;
    }

    function findText(text) {
      for (var i = 0; i < nodes.length; i++) {
        var it = nodes[i];
        var idx = it.node.nodeValue.indexOf(text);
        if (idx !== -1) return { node: it.node, offset: idx, len: text.length };
      }
      return null;
    }

    list.forEach(function (m) {
      var loc = locate(m.s, m.e);
      if (!loc) {
        if (m.t) {
          var alt = findText(m.t);
          if (alt) loc = alt;
        }
        if (!loc) return;
      }
      var range = document.createRange();
      try {
        range.setStart(loc.node, loc.offset);
        range.setEnd(loc.node, loc.offset + loc.len);
      } catch (e) { return; }
      var span = document.createElement('span');
      span.className = 'hl';
      span.setAttribute('data-color', m.c || 'yellow');
      span.setAttribute('data-mark-id', m.id);
      try {
        span.appendChild(range.extractContents());
        range.insertNode(span);
      } catch (e) { return; }
    });
  }

  /* ---------------------------------------------------------- 详情操作条 */

  var actionBar = null;

  function updateActionBar(d) {
    if (!actionBar) return;
    actionBar.innerHTML = '';
    var isFav = Store.fav.has(d.id);

    actionBar.appendChild(el('button', {
      class: 'btn', 'aria-pressed': isFav ? 'true' : 'false',
      html: svg(isFav ? 'starFill' : 'star', 16) + '<span>' + (isFav ? '已收藏' : '收藏') + '</span>',
      onclick: function () {
        var on = Store.fav.toggle(d.id);
        updateActionBar(d);
        toast(on ? '已加入收藏' : '已取消收藏');
        refreshCounts();
      }
    }));

    actionBar.appendChild(el('button', {
      class: 'btn',
      html: svg('mark', 16) + '<span>批注 ' + Store.marks.list(d.id).length + '</span>',
      onclick: function () { openMarkPanel(d); }
    }));

    actionBar.appendChild(el('button', {
      class: 'btn',
      html: svg('down', 16) + '<span>导出</span>',
      onclick: function () { openExport(d); }
    }));

    actionBar.appendChild(el('button', {
      class: 'btn', 'aria-label': '正文字号',
      html: '<span style="font-size:13px">Aa</span>',
      onclick: function () { cycleFontSize(d); }
    }));
  }

  function cycleFontSize(d) {
    var sizes = [15, 16, 17, 18, 20];
    var cur = Store.settings.get('fontSize') || 15;
    var next = sizes[(sizes.indexOf(cur) + 1) % sizes.length];
    Store.settings.set('fontSize', next);
    var art = $('#article');
    if (art) art.style.fontSize = next + 'px';
    toast('正文字号 ' + next + 'px');
  }

  function openMarkPanel(d) {
    var marks = Store.marks.list(d.id);
    var listBox = el('div');
    if (!marks.length) {
      listBox.appendChild(el('div', { class: 'section-desc', style: 'margin-bottom:12px', text: '在正文中选中一段文字即可添加划线批注。' }));
    } else {
      marks.forEach(function (m) {
        var note = el('textarea', {
          placeholder: '写点批注…', 'aria-label': '批注内容',
          onchange: function (e) { Store.marks.update(d.id, m.id, { n: e.target.value }); toast('批注已保存'); }
        });
        note.value = m.n || '';
        listBox.appendChild(el('div', { class: 'note-item', 'data-color': m.c || 'yellow' }, [
          el('div', { class: 'note-quote', text: '「' + m.t + '」' }),
          note,
          el('button', {
            class: 'btn btn-danger btn-sm', style: 'margin-top:8px', text: '删除',
            onclick: function () {
              Store.marks.remove(d.id, m.id);
              closeModal();
              var art = $('#article');
              if (art) { art.innerHTML = ''; renderDoc($('#view'), d); }
              updateActionBar(d);
              toast('已删除批注');
            }
          })
        ]));
      });
    }
    openModal('我的批注（' + marks.length + '）', [listBox], [
      el('button', { class: 'btn', text: '关闭', onclick: closeModal })
    ]);
  }

  function openExport(d) {
    var fmts = [
      { id: 'txt', name: '纯文本 .txt', desc: '全文纯文本，适合复制引用' },
      { id: 'md', name: 'Markdown .md', desc: '条号加粗，条理清晰' },
      { id: 'html', name: '网页 .html', desc: '排版好的网页，可直接打印' },
      { id: 'json', name: 'JSON .json', desc: '结构化数据，含章节层级' },
      { id: 'csv', name: '目录 .csv', desc: '元信息表格，可用 Excel 打开' }
    ];
    var body = el('div');
    fmts.forEach(function (f) {
      body.appendChild(el('button', {
        class: 'me-row', style: 'border-bottom:1px solid var(--mcode-border)',
        onclick: function () { doExport(d, f.id); }
      }, [
        el('span', { class: 'm-label' }, [
          el('div', { style: 'font-weight:500', text: f.name }),
          el('div', { class: 'm-count', text: f.desc })
        ]),
        el('span', { html: svg('chev', 16) })
      ]));
    });
    openModal('导出本篇', [body], [
      el('button', { class: 'btn', text: '取消', onclick: closeModal })
    ]);
  }

  function doExport(d, fmt) {
    closeModal();
    /* 静态部署下导出走纯前端数据层（同样产出 txt/md/json/csv/html 五种内容） */
    if (window.FGStaticAPI && window.FGStaticAPI.enabled) {
      window.FGStaticAPI.exportText(d.id, fmt).then(function (text) {
        downloadText(text, d.title, fmt);
      }).catch(function (err) { toast('导出失败：' + (err.message || err)); });
      return;
    }
    fetch('/api/export?ids=' + encodeURIComponent(d.id) + '&fmt=' + encodeURIComponent(fmt))
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then(function (text) {
        downloadText(text, d.title, fmt);
      })
      .catch(function (err) { toast('导出失败：' + (err.message || err)); });
  }

  function downloadText(text, title, fmt) {
    var names = { txt: 'txt', md: 'md', json: 'json', csv: 'csv', html: 'html' };
    var name = String(title || '法规').replace(/[\\/:*?"<>|]/g, '_').slice(0, 50) + '.' + (names[fmt] || 'txt');
    var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    toast('已导出 ' + name);
  }

  /* ============================================================ 视图：体系 */

  function viewTree(view, param) {
    var meta = State.meta;
    if (!meta) { view.appendChild(skeletonList(3)); return; }

    /* #/tree/<groupId>：从首页体系卡片直接落到某个体系 */
    if (param) {
      var known = false;
      meta.groups.forEach(function (g) { if (g.id === param) known = true; });
      if (known) State.group = param;
    }

    var chips = el('div', { class: 'chips' });
    chips.appendChild(el('button', {
      class: 'chip', 'aria-pressed': State.group === 'all' ? 'true' : 'false', text: '全部体系',
      onclick: function () { State.group = 'all'; route(); }
    }));
    meta.groups.forEach(function (g) {
      chips.appendChild(el('button', {
        class: 'chip', 'aria-pressed': State.group === g.id ? 'true' : 'false', text: g.name,
        onclick: function () { State.group = g.id; route(); }
      }));
    });
    view.appendChild(el('section', { class: 'section' }, [chips]));

    meta.groups.forEach(function (g) {
      if (State.group !== 'all' && State.group !== g.id) return;
      var total = 0;
      g.cats.forEach(function (cid) { if (meta.stats[cid]) total += meta.stats[cid].count; });
      if (!total) return;

      var block = el('div', { class: 'group-block' }, [
        el('div', { class: 'group-head' }, [
          el('span', { class: 'group-dot', style: 'background:' + (g.color || 'var(--mcode-accent)') }),
          el('span', { class: 'group-name', text: g.name }),
          el('span', { class: 'group-count', text: total + ' 部' })
        ]),
        g.desc ? el('div', { class: 'section-desc', style: 'margin:6px 0 8px', text: g.desc }) : null
      ]);
      var cl = el('div', { class: 'chips' });
      g.cats.forEach(function (cid) {
        var st = meta.stats[cid];
        if (!st || !st.count) return;
        cl.appendChild(el('a', { class: 'chip', href: '#/cat/' + cid, text: st.name + ' ' + st.count }));
      });
      block.appendChild(cl);
      view.appendChild(el('section', { class: 'section' }, [block]));
    });
  }

  /* ============================================================ 视图：时间轴 */

  function viewTimeline(view) {
    var box = el('div');
    view.appendChild(box);
    box.appendChild(skeletonList(3));

    api('/api/timeline').then(function (res) {
      box.innerHTML = '';
      if (!res.years.length) {
        box.appendChild(emptyState('暂无时间轴数据', '', 'clock'));
        return;
      }
      res.years.forEach(function (y) {
        var items = el('div', { class: 'doc-list' });
        y.items.slice(0, 5).forEach(function (it) {
          items.appendChild(docCard({
            title: it.title, catName: it.catName, published: it.published,
            issuer: it.issuer, chars: 0
          }));
        });
        var more = y.items.length > 5
          ? el('a', { class: 'section-more', href: '#/cat/' + (y.items[0].cat), text: '本年 ' + y.count + ' 部 ›' })
          : null;
        box.appendChild(el('div', { class: 'tl-year' }, [
          el('div', { class: 'tl-rail' }, [el('span', { class: 'tl-dot' })]),
          el('div', { class: 'tl-content' }, [
            el('div', { class: 'tl-y' }, [
              el('span', { text: String(y.year) }),
              el('span', { class: 'tl-count', text: y.count + ' 部' })
            ]),
            items,
            more
          ])
        ]));
      });
    }).catch(function (err) {
      box.innerHTML = '';
      box.appendChild(emptyState('加载失败', String(err.message || err), 'none'));
    });
  }

  /* ============================================================ 视图：我的 */

  function viewMe(view) {
    /* 这个页面也会被「切换主题 / 改字号」直接重画，所以自己先清空 */
    view.innerHTML = '';
    var favs = Store.fav.list();
    var notes = Store.marks.docs();
    var custom = Store.custom.list();
    var recent = Store.recent.list();

    var rows = el('div', { class: 'card' });
    function row(label, count, href, iconName) {
      rows.appendChild(el('a', { class: 'me-row', href: href }, [
        el('span', { html: svg(iconName, 18) }),
        el('span', { class: 'm-label', text: label }),
        el('span', { class: 'm-count', text: String(count) }),
        el('span', { html: svg('chev', 16) })
      ]));
    }
    row('我的收藏', favs.length, '#/favorites', 'star');
    row('我的笔记', notes.length, '#/notes', 'mark');
    row('自建条目', custom.length, '#/custom', 'pen');
    view.appendChild(el('section', { class: 'section' }, [rows]));

    /* 阅读设置 */
    var fs = Store.settings.get('fontSize') || 15;
    var settingCard = el('div', { class: 'card' }, [
      el('div', { class: 'me-row', style: 'border-bottom:0' }, [
        el('span', { class: 'm-label', text: '正文字号' }),
        el('span', { class: 'm-count', text: fs + 'px' }),
        el('button', {
          class: 'btn btn-sm', text: '切换',
          onclick: function () {
            var sizes = [15, 16, 17, 18, 20];
            var next = sizes[(sizes.indexOf(fs) + 1) % sizes.length];
            Store.settings.set('fontSize', next);
            viewMe($('#view'));
            toast('正文字号 ' + next + 'px');
          }
        })
      ]),
      el('div', { class: 'me-row' }, [
        el('span', { class: 'm-label', text: '深色模式' }),
        el('button', {
          class: 'btn btn-sm', 'aria-pressed': document.documentElement.getAttribute('data-theme') === 'dark' ? 'true' : 'false',
          text: document.documentElement.getAttribute('data-theme') === 'dark' ? '开' : '关',
          onclick: function () { toggleTheme(); viewMe($('#view')); }
        })
      ])
    ]);
    view.appendChild(el('section', { class: 'section' }, [settingCard]));

    /* 最近浏览 */
    if (recent.length) {
      var rl = el('div', { class: 'doc-list' });
      var recentSection = el('section', { class: 'section' }, [
        el('div', { class: 'section-head' }, [
          el('span', { class: 'section-title', text: '最近浏览' }),
          el('button', {
            class: 'section-more', style: 'background:none;border:0', text: '清空',
            onclick: function () { Store.recent.clear(); viewMe($('#view')); }
          })
        ]),
        rl
      ]);
      view.appendChild(recentSection);
      loadRecords(recent.slice(0, 8)).then(function (recs) {
        recs.forEach(function (r) { if (r) rl.appendChild(docCard(r)); });
        if (!rl.children.length) recentSection.style.display = 'none';
      });
    }

    /* 关于 */
    view.appendChild(el('section', { class: 'section' }, [
      el('div', { class: 'section-desc', style: 'text-align:center;padding:12px 0' }, [
        el('div', { text: '内容来源：国家法律法规数据库 · 人民网党建频道 · 共产党员网党章党规 · 湖北法规库' }),
        el('div', { style: 'margin-top:4px', text: '共 ' + (State.meta ? State.meta.total : 0) + ' 部法规 · ' + (State.meta ? fmtNum(State.meta.totalChars) : '') })
      ])
    ]));
  }

  /* ============================================================ 视图：收藏 */

  function viewFavorites(view) {
    view.innerHTML = '';
    var favs = Store.fav.list();
    if (!favs.length) {
      view.appendChild(emptyState('还没有收藏', '在详情页点「收藏」即可加入', 'star'));
      return;
    }
    var listBox = el('div', { class: 'doc-list' });
    view.appendChild(listBox);
    listBox.appendChild(skeletonList(2));

    loadRecords(favs.map(function (f) { return f.id; })).then(function (recs) {
      listBox.innerHTML = '';
      var shown = 0;
      favs.forEach(function (f, i) {
        var r = recs[i];
        if (!r) return;
        shown++;
        var del = el('button', {
          class: 'btn btn-danger btn-sm', style: 'margin-top:10px', text: '取消收藏',
          onclick: function () {
            Store.fav.toggle(f.id);
            viewFavorites($('#view'));
            refreshCounts();
            toast('已取消收藏');
          }
        });
        /* 取消收藏是按钮，不能塞进 <a> 里（嵌套交互元素）——用容器包住卡片与按钮 */
        var wrap = el('div', { class: 'doc-item', style: 'padding:0;overflow:hidden' }, [
          el('a', {
            class: 'card-link', href: '#/doc/' + encodeURIComponent(f.id),
            style: 'padding:14px 16px 0'
          }, [
            el('div', { class: 'doc-title', text: r.title }),
            el('div', { class: 'doc-meta' }, [
              el('span', { class: 'badge badge-accent', text: r.catName || '' }),
              el('span', { text: fmtDate(r.published || '') }),
              el('span', { text: r.issuer || '' })
            ]),
            r.summary ? el('div', { class: 'doc-snip', text: r.summary }) : null
          ]),
          el('div', { style: 'padding:0 16px 14px' }, [del])
        ]);
        listBox.appendChild(wrap);
      });
      if (!shown) listBox.appendChild(emptyState('收藏的条目已不存在', '', 'star'));
    });
  }

  /* ============================================================ 视图：笔记 */

  function viewNotes(view) {
    view.innerHTML = '';
    var notes = Store.marks.docs();
    if (!notes.length) {
      view.appendChild(emptyState('还没有笔记', '在详情页选中文字即可添加划线批注', 'mark'));
      return;
    }
    var box = el('div');
    view.appendChild(box);
    box.appendChild(skeletonList(2));

    loadRecords(notes.map(function (g) { return g.id; })).then(function (recs) {
      box.innerHTML = '';
      notes.forEach(function (grp, i) {
        var r = recs[i];
        var card = el('div', { class: 'card' });
        card.appendChild(el('a', {
          class: 'doc-title', href: '#/doc/' + encodeURIComponent(grp.id),
          style: 'display:block;color:inherit', text: r ? r.title : grp.id
        }));
        grp.list.forEach(function (m) {
          var item = el('div', { class: 'note-item', 'data-color': m.c || 'yellow' }, [
            el('div', { class: 'note-quote', text: '「' + m.t + '」' })
          ]);
          if (m.n) item.appendChild(el('div', { class: 'note-text', text: m.n }));
          item.appendChild(el('div', { class: 'note-doc', text: new Date(m.ts || Date.now()).toLocaleDateString('zh-CN') }));
          card.appendChild(item);
        });
        box.appendChild(el('section', { class: 'section' }, [card]));
      });
    });
  }

  /* ============================================================ 视图：自建条目 */

  function viewCustom(view) {
    view.innerHTML = '';
    var list = Store.custom.list();
    view.appendChild(el('div', { class: 'section' }, [
      el('button', {
        class: 'btn btn-primary', style: 'width:100%',
        html: svg('pen', 16) + '<span>新增条目</span>',
        onclick: function () { openCustomEditor(null); }
      })
    ]));

    if (!list.length) {
      view.appendChild(emptyState('还没有自建条目', '录入本机掌握的规定、笔记或学习材料', 'pen'));
      return;
    }
    var listBox = el('div', { class: 'doc-list' });
    list.forEach(function (r) {
      var card = el('div', { class: 'doc-item' }, [
        el('div', { class: 'doc-title', text: r.title }),
        el('div', { class: 'doc-snip', text: (r.text || '').slice(0, 120) }),
        el('div', { class: 'doc-meta', style: 'margin-top:8px;margin-bottom:0' }, [
          el('button', { class: 'btn btn-sm', text: '编辑', onclick: function () { openCustomEditor(r); } }),
          el('button', {
            class: 'btn btn-danger btn-sm', text: '删除',
            onclick: function () {
              Store.custom.remove(r.id);
              viewCustom($('#view'));
              toast('已删除');
            }
          })
        ])
      ]);
      listBox.appendChild(card);
    });
    view.appendChild(listBox);
  }

  function openCustomEditor(rec) {
    var title = el('input', { type: 'text', placeholder: '条目标题', 'aria-label': '标题' });
    if (rec) title.value = rec.title || '';
    var body = el('textarea', { placeholder: '正文内容…', 'aria-label': '正文' });
    if (rec) body.value = rec.text || '';
    var bodyWrap = el('div', { class: 'field' }, [el('label', { text: '正文' }), body]);

    var foot = [
      el('button', { class: 'btn', text: '取消', onclick: closeModal }),
      el('button', {
        class: 'btn btn-primary', text: '保存',
        onclick: function () {
          var t = title.value.trim();
          if (!t) { toast('请填写标题'); title.focus(); return; }
          Store.custom.save({
            id: rec ? rec.id : undefined,
            title: t,
            text: body.value,
            cat: 'local',
            catName: '本机自建',
            issuer: '',
            published: ''
          });
          closeModal();
          viewCustom($('#view'));
          refreshCounts();
          toast('已保存');
        }
      })
    ];
    openModal(rec ? '编辑条目' : '新增条目', [
      el('div', { class: 'field' }, [el('label', { text: '标题' }), title]),
      bodyWrap
    ], foot);
  }

  /* ============================================================ 路由 */

  var TABS = [
    { name: 'home', label: '首页', icon: 'home' },
    { name: 'search', label: '检索', icon: 'search' },
    { name: 'tree', label: '体系', icon: 'tree' },
    { name: 'timeline', label: '时间轴', icon: 'clock' },
    { name: 'me', label: '我的', icon: 'me' }
  ];

  function parseHash() {
    var h = (location.hash || '#/home').replace(/^#\/?/, '');
    var parts = h.split('/');
    var name = parts[0] || 'home';
    var param = parts.slice(1).join('/');
    return { name: name, param: decodeURIComponent(param) };
  }

  function route() {
    var r = parseHash();
    State.route = { name: r.name, params: { param: r.param } };
    var view = $('#view');
    var bar = $('#topbar');
    view.innerHTML = '';

    /* 顶部栏 */
    var titles = {
      home: ['法规库', '党内法规 · 国家法律法规'],
      search: ['全库检索', '标题 · 条文 · 发布机关'],
      tree: ['法规体系', '5 个体系 · 17 个门类'],
      timeline: ['立法时间轴', '按公布年份回溯'],
      me: ['我的', '收藏 · 笔记 · 设置'],
      doc: ['法规详情', ''],
      cat: ['门类', ''],
      favorites: ['我的收藏', ''],
      notes: ['我的笔记', ''],
      custom: ['自建条目', '']
    };
    var t = titles[r.name] || ['法规库', ''];
    $('#topTitle').textContent = t[0];
    $('#topSub').textContent = t[1];
    bar.classList.toggle('has-back', ['doc', 'cat', 'favorites', 'notes', 'custom'].indexOf(r.name) !== -1);
    $('#backBtn').onclick = function () {
      if (history.length > 1) history.back();
      else location.hash = '#/home';
    };

    /* 底部操作条只在详情页出现；详情页隐藏标签栏，两者不能叠在一起 */
    var isDetail = r.name === 'doc';
    if (actionBar) actionBar.hidden = !isDetail;
    var app = $('#app');
    if (app) app.classList.toggle('detail', isDetail);

    switch (r.name) {
      case 'home': viewHome(view); break;
      case 'search':
        /* #/search/关键词 —— 深链接直达（可分享、可外部跳转）。
           注意 searchLoaded 要先置 true，否则 runSearch 完成后调 route() 会再触发一次，
           形成无限循环。 */
        if (r.param && !State.searchLoaded) {
          State.lastQuery = r.param;
          State.page = 1;
          State.searchLoaded = true;
          runSearch(r.param, 1);
        } else if (!State.searchLoaded) {
          /* 首次进入检索页：拉一次全库（按最新排序），避免停在空结果态 */
          State.searchLoaded = true;
          runSearch(State.lastQuery || '', 1);
        }
        viewSearch(view);
        break;
      case 'tree': viewTree(view, r.param); break;
      case 'timeline': viewTimeline(view); break;
      case 'me': viewMe(view); break;
      case 'doc': viewDoc(view, r.param); break;
      case 'cat': viewCat(view, r.param); break;
      case 'favorites': viewFavorites(view); break;
      case 'notes': viewNotes(view); break;
      case 'custom': viewCustom(view); break;
      default: viewHome(view); break;
    }

    updateTabs(r.name);
    refreshCounts();
    window.scrollTo(0, 0);
  }

  function goSearch(q) {
    State.lastQuery = q === undefined || q === null ? '' : q;
    State.page = 1;
    State.searchLoaded = false;
    if (location.hash !== '#/search') {
      location.hash = '#/search';
    }
    /* hash 变化会触发 hashchange → route()；若本来就在检索页则不会触发，这里补一次 */
    if (parseHash().name === 'search') runSearch(State.lastQuery, 1);
  }

  function runSearch(q, page, append) {
    State.lastQuery = q === undefined ? State.lastQuery : q;
    State.page = page || 1;
    State.loading = true;
    /* 记入本机检索历史：首页「最近检索」用 */
    if (State.lastQuery && String(State.lastQuery).trim()) Store.history.push(State.lastQuery);
    var sort = State.sort;
    /* 空查询没有「相关度」可言，按最新在前更符合浏览直觉 */
    if (!State.lastQuery && sort === 'relevance') { sort = 'new'; State.sort = 'new'; }
    api('/api/search', {
      q: State.lastQuery, cat: State.cat, sort: sort,
      page: State.page, size: 20
    }).then(function (res) {
      State.loading = false;
      State.loadTip = '';
      State.searchLoaded = true;
      State.partial = !!res.partial;
      State.loadingBodies = !!res.loadingBodies;
      State.took = res.took;
      State.total = res.total;
      State.pages = res.pages;
      State.results = append ? State.results.concat(res.hits) : res.hits;
      route();
    }).catch(function (err) {
      State.loading = false;
      State.loadTip = '';
      State.searchLoaded = true;
      toast('检索失败：' + (err.message || err));
      route();
    });
  }

  function updateTabs(active) {
    $$('.tab').forEach(function (t) {
      var isOn = t.getAttribute('data-tab') === active ||
        (active === 'doc' && t.getAttribute('data-tab') === 'search') ||
        (active === 'cat' && t.getAttribute('data-tab') === 'tree');
      if (isOn) t.setAttribute('aria-current', 'page');
      else t.removeAttribute('aria-current');
    });
  }

  function refreshCounts() {
    var favCount = Store.fav.count();
    var noteCount = Store.marks.count();
    var b1 = $('#tabFav');
    var b2 = $('#tabNotes');
    if (b1) b1.textContent = favCount ? favCount : '';
    if (b2) b2.textContent = noteCount ? noteCount : '';
  }

  /* ============================================================ 主题 */

  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t === 'dark' ? 'dark' : 'light');
  }

  function toggleTheme() {
    var cur = document.documentElement.getAttribute('data-theme');
    var next = cur === 'dark' ? 'light' : 'dark';
    Store.settings.set('theme', next);
    applyTheme(next);
  }

  /* ============================================================ 选区划线 */

  var selectionHandler = null;

  function initSelection() {
    /* 在正文里选中文字 → 弹出「划线并批注」气泡 */
    var article = null;
    document.addEventListener('mouseup', function () {
      var sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return;
      var text = sel.toString().trim();
      if (!text || text.length > 400) return;
      var node = sel.getRangeAt(0).commonAncestorContainer;
      var host = node.nodeType === 1 ? node : node.parentNode;
      if (!host || !host.closest || !host.closest('#article')) return;
      showMarkTip(sel, text);
    });
  }

  function showMarkTip(sel, text) {
    var tip = $('#markTip');
    if (!tip) return;
    var range = sel.getRangeAt(0);
    var rect = range.getBoundingClientRect();
    tip.hidden = false;
    tip.textContent = '划线并批注';
    tip.style.left = Math.max(12, Math.min(window.innerWidth - 120, rect.left + rect.width / 2 - 50)) + 'px';
    tip.style.top = Math.max(60, rect.top - 38) + 'px';
    tip.onclick = function () {
      tip.hidden = true;
      var sel2 = window.getSelection();
      if (sel2 && sel2.rangeCount) {
        var r2 = sel2.getRangeAt(0).cloneRange();
        r2.selectNodeContents(r2.commonAncestorContainer);
      }
      openMarkEditor(text);
    };
  }

  function openMarkEditor(text) {
    var note = el('textarea', { placeholder: '写点批注…（可留空）', 'aria-label': '批注内容' });
    var colors = el('div', { class: 'chips', style: 'margin-bottom:12px' });
    var color = 'yellow';
    ['yellow', 'green', 'blue', 'pink'].forEach(function (c) {
      var label = { yellow: '黄', green: '绿', blue: '蓝', pink: '粉' }[c];
      var b = el('button', { class: 'chip', 'aria-pressed': c === 'yellow' ? 'true' : 'false', text: label });
      b.onclick = function () {
        color = c;
        $$('.chip', colors).forEach(function (x) { x.setAttribute('aria-pressed', 'false'); });
        b.setAttribute('aria-pressed', 'true');
      };
      colors.appendChild(b);
    });

    var id = State.route.params.param;
    var d = State.docCache[id];
    var body = el('div', {}, [
      el('div', { class: 'section-desc', style: 'margin-bottom:10px', text: '选中内容' }),
      el('div', { class: 'note-item', 'data-color': color }, [el('div', { class: 'note-quote', text: '「' + text + '」' })]),
      colors,
      el('div', { class: 'field' }, [el('label', { text: '批注' }), note])
    ]);

    openModal('添加批注', [body], [
      el('button', { class: 'btn', text: '取消', onclick: closeModal }),
      el('button', {
        class: 'btn btn-primary', text: '保存',
        onclick: function () {
          if (!d) { closeModal(); return; }
          /* 偏移量按正文纯文本定位：统计选中文字在全文中的位置 */
          var pos = locateOffset(d.plain, text);
          Store.marks.add(id, {
            s: pos >= 0 ? pos : 0,
            e: pos >= 0 ? pos + text.length : text.length,
            t: text, c: color, n: note.value
          });
          closeModal();
          var art = $('#article');
          if (art) {
            var box = $('#view');
            box.innerHTML = '';
            renderDoc(box, d);
            updateActionBar(d);
          }
          toast('已添加批注');
        }
      })
    ]);
  }

  /* 在全文纯文本里找到子串的起始偏移 */
  function locateOffset(plain, text) {
    if (!plain) return -1;
    var probe = text.slice(0, 24);
    return plain.indexOf(probe);
  }

  /* ============================================================ 启动 */

  function boot() {
    var app = $('#app');
    app.innerHTML = '';

    /* 顶栏 */
    var topbar = el('header', { class: 'topbar', id: 'topbar' }, [
      el('button', { class: 'topbar-back', id: 'backBtn', 'aria-label': '返回', html: svg('back', 19) }),
      el('div', {}, [
        el('div', { class: 'topbar-title', id: 'topTitle', text: '法规库' }),
        el('div', { class: 'topbar-sub', id: 'topSub', text: '' })
      ]),
      el('div', { class: 'topbar-actions' }, [
        el('button', {
          class: 'btn btn-ghost btn-icon', 'aria-label': '切换深色模式', title: '切换深色 / 浅色模式',
          html: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/></svg>',
          onclick: toggleTheme
        })
      ])
    ]);
    app.appendChild(topbar);

    app.appendChild(el('main', { class: 'view', id: 'view', tabindex: '-1' }));

    /* 详情页操作条 */
    actionBar = el('div', { class: 'actionbar', id: 'actionBar', hidden: true });
    app.appendChild(actionBar);

    /* 底部标签栏 */
    var tabbar = el('nav', { class: 'tabbar', 'aria-label': '主导航' });
    TABS.forEach(function (t) {
      var iconWrap = el('span', { style: 'position:relative;display:inline-flex' }, [
        el('span', { html: svg(t.icon, 21) })
      ]);
      if (t.name === 'me') {
        iconWrap.appendChild(el('span', { class: 'tab-badge', id: 'tabFav', text: '' }));
      }
      tabbar.appendChild(el('button', {
        class: 'tab', 'data-tab': t.name, 'aria-current': t.name === 'home' ? 'page' : null,
        onclick: function () { location.hash = '#/' + t.name; }
      }, [
        iconWrap,
        el('span', { text: t.label })
      ]));
    });
    app.appendChild(tabbar);

    /* 浮层容器。
       注意：这里不要写 var —— 会遮蔽模块级的 modalRoot，
       导致 openModal() 里 `if (!modalRoot) return` 直接返回，弹层永远打不开。 */
    modalRoot = el('div', { class: 'modal-root', id: 'modalRoot', hidden: true });
    document.body.appendChild(modalRoot);

    var toastRoot = el('div', { class: 'toast-root', id: 'toastRoot', 'aria-live': 'polite' });
    document.body.appendChild(toastRoot);

    var markTip = el('button', { class: 'btn btn-sm btn-primary', id: 'markTip', hidden: true, text: '划线并批注' });
    markTip.style.position = 'fixed';
    markTip.style.zIndex = '70';
    document.body.appendChild(markTip);

    /* 主题 */
    applyTheme(Store.settings.get('theme') || 'light');

    /* 静态部署：正文分片加载进度（首次全文检索要载入 24 片，传输约 12MB） */
    if (window.FGStaticAPI && window.FGStaticAPI.onProgress) {
      window.FGStaticAPI.onProgress(function (p) {
        State.loadTip = (p && p.total)
          ? ('正在载入正文索引，已完成 ' + p.done + ' / ' + p.total + ' 片（约 12MB，仅此一次）')
          : '';
        var tip = document.getElementById('loadTip');
        if (tip) tip.textContent = State.loadTip || '正在载入全文索引…';
      });
    }

    /* 正文索引建好后：如果用户正在检索页，重跑一次把「条文命中」补上 */
    if (window.FGStaticAPI && window.FGStaticAPI.onBodiesReady) {
      window.FGStaticAPI.onBodiesReady(function () {
        State.loadTip = '';
        State.loadingBodies = false;
        if (State.route.name === 'search' && State.lastQuery) {
          runSearch(State.lastQuery, State.page);
        } else {
          var tip = document.getElementById('loadTip');
          if (tip && tip.parentNode) tip.parentNode.removeChild(tip);
        }
      });
    }

    /* 元信息 */
    api('/api/meta').then(function (m) {
      State.meta = m;
      route();
    }).catch(function (err) {
      var view = $('#view');
      view.innerHTML = '';
      view.appendChild(emptyState('无法加载法规库数据', String(err.message || err), 'none'));
    });

    window.addEventListener('hashchange', route);
    initSelection();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.FGApp = {
    state: State, store: Store, api: api, route: route,
    goSearch: goSearch, runSearch: runSearch, toast: toast
  };
})();
