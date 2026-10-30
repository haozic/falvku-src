const app = getApp();
const store = require('../../utils/store.js');
const util = require('../../utils/util.js');

Page({
  data: {
    themeClass: 'theme-light',
    query: '',
    loading: true,
    error: '',
    total: 0,
    totalCharsText: '',
    cats: [],
    groups: [],
    recent: []
  },

  onLoad: function () {
    this.setData({ themeClass: app.globalData.themeClass });
    this.load();
  },

  onShow: function () {
    this.setData({
      themeClass: app.globalData.themeClass,
      recent: this.pickRecent()
    });
  },

  onThemeChange: function (themeClass) {
    this.setData({ themeClass: themeClass });
  },

  /** 最近浏览（带标题快照，最多 6 条） */
  pickRecent: function () {
    return store.recent.list().slice(0, 6).map(function (r) {
      return {
        id: r.id,
        title: r.title || r.id,
        catName: r.catName || '',
        published: r.published || '',
        publishedText: util.fmtDate(r.published),
        issuer: r.issuer || ''
      };
    });
  },

  /** 拉门类 / 体系 / 统计 */
  load: function () {
    const self = this;
    this.setData({ loading: true, error: '' });
    app.ensureMeta(function (meta, err) {
      if (!meta) {
        self.setData({
          loading: false,
          error: (err && err.message) ? err.message : '未知错误'
        });
        return;
      }
      const cats = [];
      for (let i = 0; i < meta.categories.length; i++) {
        const c = meta.categories[i];
        const st = meta.stats[c.id];
        if (!st || !st.count) continue;
        cats.push({ id: c.id, name: c.name, tone: c.tone || '', count: st.count });
      }
      const groups = [];
      for (let i = 0; i < meta.groups.length; i++) {
        const g = meta.groups[i];
        const gs = [];
        let total = 0;
        for (let j = 0; j < g.cats.length; j++) {
          const st = meta.stats[g.cats[j]];
          if (!st || !st.count) continue;
          gs.push({ id: g.cats[j], name: st.name, count: st.count });
          total += st.count;
        }
        if (!total) continue;
        groups.push({
          id: g.id,
          name: g.name,
          color: g.color || '#c8102e',
          desc: g.desc || '',
          total: total,
          cats: gs
        });
      }
      self.setData({
        loading: false,
        total: meta.total,
        totalCharsText: util.fmtNum(meta.totalChars),
        cats: cats,
        groups: groups
      });
    });
  },

  onInput: function (e) {
    this.setData({ query: e.detail.value });
  },

  /** 去检索页 */
  onSearch: function () {
    const q = (this.data.query || '').trim();
    app.globalData.lastQuery = q;
    app.globalData.pendingCat = '';
    wx.switchTab({ url: '/pages/search/index' });
  },

  /** 点门类：跳检索页并按门类过滤（分类浏览的入口） */
  onCatTap: function (e) {
    const id = e.currentTarget.dataset.id;
    app.globalData.pendingCat = id;
    app.globalData.lastQuery = '';
    wx.switchTab({ url: '/pages/search/index' });
  },

  onDocTap: function (e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/detail/index?id=' + encodeURIComponent(id) });
  },

  goMine: function () {
    wx.switchTab({ url: '/pages/mine/index' });
  }
});
