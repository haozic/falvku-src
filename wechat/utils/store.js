/**
 * 法规库小程序 · 本地存储
 *
 * 对应 Mini App 客户端的 Store（收藏 / 划线批注 / 最近浏览 / 自建条目 / 设置），
 * 存储介质从 localStorage 换成 wx.setStorageSync。
 *
 * 关键差异（与 Mini App 客户端不同，这里是必须的）：
 *  服务端 /api/meta 只返回门类 / 体系 / 统计，**不含 records 明细**，
 *  所以收藏与最近浏览必须自带标题快照（title / catName / published / issuer / chars），
 *  否则列表页渲染不出标题。客户端 app.js 的 findRecord() 在这个 API 下永远返回 null。
 *
 * 批注数据结构：
 *  { id, docId, docTitle, blockIndex, blockType, text, note, color, ts, s, e }
 *   - blockIndex：正文块下标（稳定锚点，小程序里没有字符级选区 API）
 *   - text：该块的原文（回退匹配用；数据更新后按文本仍可定位）
 *   - s / e：预留的字符偏移（将来换成精确划线时直接填）
 */

const util = require('./util.js');

const KEY = {
  fav: 'fg.fav.v1',
  marks: 'fg.marks.v1',
  recent: 'fg.recent.v1',
  settings: 'fg.settings.v1',
  custom: 'fg.custom.v1'
};

function get(key, fallback) {
  try {
    const raw = wx.getStorageSync(key);
    if (!raw) return fallback;
    const v = JSON.parse(raw);
    return (v === null || v === undefined) ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

function set(key, value) {
  try {
    wx.setStorageSync(key, JSON.stringify(value));
  } catch (e) {
    /* 容量不足时静默失败，不阻断交互 */
  }
  return value;
}

function has(obj, k) {
  return Object.prototype.hasOwnProperty.call(obj, k);
}

const Store = {
  /* ---------------------------------------------------------- 收藏 */

  fav: {
    map: function () {
      const m = get(KEY.fav, {});
      return (m && typeof m === 'object') ? m : {};
    },
    list: function () {
      const m = Store.fav.map();
      const out = [];
      for (const id in m) {
        if (!has(m, id)) continue;
        out.push(m[id]);
      }
      out.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
      return out;
    },
    has: function (id) {
      return has(Store.fav.map(), id);
    },
    /**
     * 收藏 / 取消收藏。
     * @param {string} id
     * @param {object} snapshot {title,catName,published,issuer,chars}
     * @returns {boolean} true 表示现在已收藏
     */
    toggle: function (id, snapshot) {
      const m = Store.fav.map();
      if (has(m, id)) {
        delete m[id];
        set(KEY.fav, m);
        return false;
      }
      const s = snapshot || {};
      m[id] = {
        id: id,
        ts: Date.now(),
        note: '',
        title: s.title || '',
        catName: s.catName || '',
        published: s.published || '',
        issuer: s.issuer || '',
        chars: s.chars || 0
      };
      set(KEY.fav, m);
      return true;
    },
    remove: function (id) {
      const m = Store.fav.map();
      delete m[id];
      set(KEY.fav, m);
    },
    count: function () {
      const m = Store.fav.map();
      let n = 0;
      for (const k in m) {
        if (has(m, k)) n++;
      }
      return n;
    }
  },

  /* ---------------------------------------------------------- 批注 */

  marks: {
    map: function () {
      const m = get(KEY.marks, {});
      return (m && typeof m === 'object') ? m : {};
    },
    /** 某篇文档的全部批注，按块序号排序 */
    list: function (docId) {
      const arr = Store.marks.map()[docId] || [];
      return arr.slice().sort(function (a, b) {
        return (a.blockIndex || 0) - (b.blockIndex || 0) || (a.ts || 0) - (b.ts || 0);
      });
    },
    /**
     * 新增批注。
     * @param {string} docId
     * @param {object} mark {blockIndex,blockType,text,note,color,docTitle}
     */
    add: function (docId, mark) {
      const all = Store.marks.map();
      const arr = all[docId] || [];
      const m = {
        id: mark.id || util.uid('m'),
        docId: docId,
        docTitle: mark.docTitle || '',
        blockIndex: mark.blockIndex || 0,
        blockType: mark.blockType || 'p',
        text: mark.text || '',
        note: mark.note || '',
        color: mark.color || 'yellow',
        ts: mark.ts || Date.now(),
        s: mark.s || 0,
        e: mark.e || 0
      };
      arr.push(m);
      all[docId] = arr;
      set(KEY.marks, all);
      return m;
    },
    remove: function (docId, id) {
      const all = Store.marks.map();
      all[docId] = (all[docId] || []).filter(function (m) { return m.id !== id; });
      set(KEY.marks, all);
    },
    update: function (docId, id, patch) {
      const all = Store.marks.map();
      const arr = all[docId] || [];
      for (let i = 0; i < arr.length; i++) {
        if (arr[i].id !== id) continue;
        for (const k in patch) {
          if (has(patch, k)) arr[i][k] = patch[k];
        }
        arr[i].ts = Date.now();
        break;
      }
      all[docId] = arr;
      set(KEY.marks, all);
    },
    /** 按文档分组，供「我的笔记」页使用 */
    docs: function () {
      const all = Store.marks.map();
      const out = [];
      for (const id in all) {
        if (!has(all, id)) continue;
        const arr = (all[id] || []).slice();
        if (!arr.length) continue;
        arr.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
        out.push({ id: id, title: arr[0].docTitle || id, list: arr, ts: arr[0].ts || 0 });
      }
      out.sort(function (a, b) { return b.ts - a.ts; });
      return out;
    },
    count: function () {
      const all = Store.marks.map();
      let n = 0;
      for (const k in all) {
        if (!has(all, k)) continue;
        n += (all[k] || []).length;
      }
      return n;
    }
  },

  /* ---------------------------------------------------------- 最近浏览 */

  recent: {
    list: function () {
      const v = get(KEY.recent, []);
      return Array.isArray(v) ? v : [];
    },
    /** @param {object} doc {id,title,catName,published,issuer,chars} */
    push: function (doc) {
      if (!doc || !doc.id) return;
      let arr = Store.recent.list().filter(function (x) { return x.id !== doc.id; });
      const item = {
        id: doc.id,
        title: doc.title || '',
        catName: doc.catName || '',
        published: doc.published || '',
        issuer: doc.issuer || '',
        chars: doc.chars || 0,
        ts: Date.now()
      };
      arr.unshift(item);
      set(KEY.recent, arr.slice(0, 24));
    },
    clear: function () {
      set(KEY.recent, []);
    }
  },

  /* ---------------------------------------------------------- 自建条目 */

  custom: {
    list: function () {
      const v = get(KEY.custom, []);
      return Array.isArray(v) ? v : [];
    },
    save: function (rec) {
      const arr = Store.custom.list();
      const now = Date.now();
      const r = {
        id: rec.id || ('c' + now.toString(36)),
        title: rec.title || '',
        text: rec.text || '',
        cat: 'local',
        catName: '本机自建',
        issuer: '',
        published: '',
        created: rec.created || now,
        updated: now,
        custom: true
      };
      let found = false;
      for (let i = 0; i < arr.length; i++) {
        if (arr[i].id === r.id) {
          r.created = arr[i].created || r.created;
          arr[i] = r;
          found = true;
          break;
        }
      }
      if (!found) arr.unshift(r);
      set(KEY.custom, arr);
      return r;
    },
    remove: function (id) {
      set(KEY.custom, Store.custom.list().filter(function (r) { return r.id !== id; }));
    },
    count: function () {
      return Store.custom.list().length;
    }
  },

  /* ---------------------------------------------------------- 设置 */

  settings: {
    all: function () {
      const s = get(KEY.settings, {});
      const o = (s && typeof s === 'object') ? s : {};
      if (!o.fontSize) o.fontSize = 15;
      if (!o.themeMode) o.themeMode = 'auto';
      return o;
    },
    get: function (k) {
      return Store.settings.all()[k];
    },
    set: function (k, v) {
      const s = Store.settings.all();
      s[k] = v;
      set(KEY.settings, s);
      return v;
    }
  }
};

module.exports = Store;
