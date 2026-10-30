/* ==========================================================================
   store.js —— 本地存储层（收藏 / 自建条目 / 设置 / 最近浏览）
   兼容 file:// 协议；localStorage 不可用时自动降级为内存存储。
   ========================================================================== */
(function (w) {
  'use strict';

  var mem = {};
  var LS = (function () {
    try {
      var k = '__fg_probe__';
      w.localStorage.setItem(k, '1');
      w.localStorage.removeItem(k);
      return w.localStorage;
    } catch (e) {
      return null;
    }
  })();

  var KEY = {
    fav: 'fg.fav.v1',
    custom: 'fg.custom.v1',
    settings: 'fg.settings.v1',
    recent: 'fg.recent.v1',
    marks: 'fg.marks.v1'
  };

  var DEFAULTS = {
    theme: 'light',
    fontSize: 17,
    pageSize: 10,
    lastQuery: '',
    /* 阅读设置（全局默认；单篇可覆盖，见 settings.readPerDoc） */
    readTheme: 'paper',
    readLh: 2.02,
    readFf: 'serif',
    readWidth: 'normal'
  };

  function get(key, fallback) {
    var raw = null;
    try {
      raw = LS ? LS.getItem(key) : mem[key];
    } catch (e) { raw = mem[key]; }
    if (raw === null || raw === undefined) return fallback;
    try {
      var v = JSON.parse(raw);
      return v === null || v === undefined ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  function set(key, value) {
    var raw = JSON.stringify(value);
    mem[key] = raw;
    try { if (LS) LS.setItem(key, raw); } catch (e) { /* 容量超限时仅保留内存副本 */ }
    return value;
  }

  /* ---------------------------------------------------------------- 收藏 */
  var fav = {
    map: function () { return get(KEY.fav, {}) || {}; },
    list: function () {
      var m = fav.map(), out = [];
      for (var id in m) { if (m.hasOwnProperty(id)) out.push({ id: id, ts: m[id].ts || 0, note: m[id].note || '' }); }
      out.sort(function (a, b) { return b.ts - a.ts; });
      return out;
    },
    has: function (id) { return fav.map().hasOwnProperty(id); },
    toggle: function (id) {
      var m = fav.map();
      if (m.hasOwnProperty(id)) { delete m[id]; set(KEY.fav, m); return false; }
      m[id] = { ts: Date.now(), note: '' };
      set(KEY.fav, m);
      return true;
    },
    remove: function (id) { var m = fav.map(); delete m[id]; set(KEY.fav, m); },
    setNote: function (id, note) {
      var m = fav.map();
      if (!m.hasOwnProperty(id)) m[id] = { ts: Date.now(), note: '' };
      m[id].note = note;
      set(KEY.fav, m);
    },
    clear: function () { set(KEY.fav, {}); },
    count: function () { var m = fav.map(), n = 0; for (var k in m) if (m.hasOwnProperty(k)) n++; return n; }
  };

  /* ------------------------------------------------------------ 自建条目 */
  function uid() {
    return 'c' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
  }

  var custom = {
    list: function () { return get(KEY.custom, []) || []; },
    get: function (id) {
      var arr = custom.list();
      for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
      return null;
    },
    save: function (rec) {
      var arr = custom.list();
      var now = Date.now();
      if (!rec.id) {
        rec.id = uid();
        rec.created = now;
      }
      rec.updated = now;
      rec.custom = true;
      var found = false;
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].id === rec.id) { arr[i] = rec; found = true; break; }
      }
      if (!found) arr.unshift(rec);
      set(KEY.custom, arr);
      return rec;
    },
    remove: function (id) {
      var arr = custom.list().filter(function (r) { return r.id !== id; });
      set(KEY.custom, arr);
    },
    replaceAll: function (arr) { set(KEY.custom, arr || []); },
    count: function () { return custom.list().length; }
  };

  /* ------------------------------------------------------- 划线与批注 */
  /* 结构：{ [docId]: [ {id, s, e, t, c, n, ts} ] }
     s/e 是正文纯文本的字符偏移，t 是选中原文，c 是颜色，n 是批注。
     偏移会随法规数据更新漂移，渲染时按 t 回退校验（见 app.js 的 applyMarks）。 */
  var marks = {
    map: function () { return get(KEY.marks, {}) || {}; },
    list: function (docId) {
      var arr = marks.map()[docId] || [];
      return arr.slice().sort(function (a, b) { return a.s - b.s; });
    },
    get: function (docId, id) {
      var arr = marks.list(docId);
      for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
      return null;
    },
    add: function (docId, m) {
      var all = marks.map();
      var arr = all[docId] || [];
      if (!m.id) m.id = 'm' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
      if (!m.ts) m.ts = Date.now();
      arr.push(m);
      all[docId] = arr;
      set(KEY.marks, all);
      return m;
    },
    update: function (docId, id, patch) {
      var all = marks.map();
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
    remove: function (docId, id) {
      var all = marks.map();
      all[docId] = (all[docId] || []).filter(function (m) { return m.id !== id; });
      set(KEY.marks, all);
    },
    clearDoc: function (docId) {
      var all = marks.map();
      delete all[docId];
      set(KEY.marks, all);
    },
    /* 按最近标注时间倒序的分组列表 */
    docs: function () {
      var all = marks.map(), out = [];
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
      var all = marks.map(), n = 0;
      for (var k in all) if (all.hasOwnProperty(k)) n += (all[k] || []).length;
      return n;
    }
  };

  /* ---------------------------------------------------------------- 设置 */
  var settings = {
    all: function () {
      var s = get(KEY.settings, {});
      for (var k in DEFAULTS) if (!s.hasOwnProperty(k)) s[k] = DEFAULTS[k];
      return s;
    },
    get: function (k) { return settings.all()[k]; },
    set: function (k, v) {
      var s = settings.all();
      s[k] = v;
      set(KEY.settings, s);
      return v;
    }
  };

  /* ------------------------------------------------------------ 最近浏览 */
  var recent = {
    list: function () { return get(KEY.recent, []) || []; },
    push: function (id) {
      var arr = recent.list().filter(function (x) { return x !== id; });
      arr.unshift(id);
      set(KEY.recent, arr.slice(0, 24));
    },
    clear: function () { set(KEY.recent, []); }
  };

  w.Store = {
    fav: fav,
    custom: custom,
    settings: settings,
    recent: recent,
    marks: marks,
    persistent: !!LS,
    exportAll: function () {
      return {
        exportedAt: new Date().toISOString(),
        favorites: fav.list(),
        custom: custom.list(),
        settings: settings.all(),
        marks: marks.map()
      };
    },
    importAll: function (data) {
      if (!data || typeof data !== 'object') throw new Error('数据格式不正确');
      if (data.favorites) {
        var m = {};
        data.favorites.forEach(function (f) { m[f.id] = { ts: f.ts || Date.now(), note: f.note || '' }; });
        set(KEY.fav, m);
      }
      if (data.custom) set(KEY.custom, data.custom);
      if (data.settings) set(KEY.settings, data.settings);
      if (data.marks) set(KEY.marks, data.marks);
      return true;
    }
  };
})(window);
