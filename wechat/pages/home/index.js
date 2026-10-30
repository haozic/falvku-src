const app = getApp();
const store = require('../../utils/store.js');
const util = require('../../utils/util.js');
const api = require('../../utils/api.js');

/**
 * 首页：只放「打开就能用」的东西，职责单一，不和 tabBar /「我的」页重复。
 *   ① 检索卡   —— 全站唯一的搜索入口 + 库规模概览
 *   ② 法规体系 —— 5 个体系的概览卡片；门类明细在「体系」页，这里不再列第二遍
 *   ③ 最近检索 —— 本机检索历史
 *   ④ 最新发布 —— 数据驱动（按公布日期倒序取 6 条），不硬编码法规 id
 * 「最近浏览 / 收藏 / 笔记 / 自建」属于个人数据，统一放在「我的」页。
 */
Page({
  data: {
    themeClass: 'theme-light',
    query: '',
    loading: true,
    error: '',
    total: 0,
    totalCharsText: '',
    catCount: 0,
    groupCount: 0,
    groups: [],
    history: [],
    latest: []
  },

  onLoad: function () {
    this.setData({ themeClass: app.globalData.themeClass });
    this.load();
  },

  onShow: function () {
    this.setData({
      themeClass: app.globalData.themeClass,
      history: store.history.list()
    });
  },

  onThemeChange: function (themeClass) {
    this.setData({ themeClass: themeClass });
  },

  /** 拉体系 / 统计 */
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
      const groups = [];
      let catCount = 0;
      for (let i = 0; i < meta.groups.length; i++) {
        const g = meta.groups[i];
        const names = [];
        let total = 0;
        for (let j = 0; j < g.cats.length; j++) {
          const st = meta.stats[g.cats[j]];
          if (!st || !st.count) continue;
          names.push(st.name);
          total += st.count;
          catCount++;
        }
        if (!total) continue;
        groups.push({
          id: g.id,
          name: g.name,
          color: g.color || '#c8102e',
          total: total,
          catNames: names.join(' · ')
        });
      }
      self.setData({
        loading: false,
        total: meta.total,
        totalCharsText: util.fmtWan(meta.totalChars),
        catCount: catCount,
        groupCount: groups.length,
        groups: groups
      });
      self.loadLatest();
    });
  },

  /** 最新发布：按公布日期倒序取 6 条 */
  loadLatest: function () {
    const self = this;
    api.search({ sort: 'new', page: 1, size: 6 }).then(function (res) {
      const hits = (res && res.hits) || [];
      self.setData({
        latest: hits.map(function (h) {
          return {
            id: h.id,
            title: h.title,
            catName: h.catName || '',
            publishedText: util.fmtDate(h.published)
          };
        })
      });
    }).catch(function () {
      /* 拿不到就不显示这一块，不影响其它内容 */
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

  /** 点最近检索：直接用这个词检索 */
  onHistoryTap: function (e) {
    const q = e.currentTarget.dataset.q;
    if (!q) return;
    app.globalData.lastQuery = q;
    app.globalData.pendingCat = '';
    wx.switchTab({ url: '/pages/search/index' });
  },

  clearHistory: function () {
    store.history.clear();
    this.setData({ history: [] });
  },

  /** 点体系：跳「体系」页并定位到该体系（门类明细在那一页看） */
  onGroupTap: function (e) {
    const id = e.currentTarget.dataset.id;
    app.globalData.pendingGroup = id || '';
    wx.switchTab({ url: '/pages/tree/index' });
  },

  onDocTap: function (e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/detail/index?id=' + encodeURIComponent(id) });
  },

  goMine: function () {
    wx.switchTab({ url: '/pages/mine/index' });
  },

  goTree: function () {
    app.globalData.pendingGroup = '';
    wx.switchTab({ url: '/pages/tree/index' });
  },

  goTimeline: function () {
    wx.switchTab({ url: '/pages/timeline/index' });
  }
});
