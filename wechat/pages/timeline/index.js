const app = getApp();
const api = require('../../utils/api.js');
const util = require('../../utils/util.js');

/** 每年先展示 5 条，点「展开本年全部」再全展开 */
const YEAR_STEP = 10;
const ITEMS_PER_YEAR = 5;

Page({
  data: {
    themeClass: 'theme-light',
    loading: true,
    error: '',
    years: [],
    renderYears: [],
    total: 0,
    shown: YEAR_STEP,
    hasMoreYears: false
  },

  onLoad: function () {
    this.setData({ themeClass: app.globalData.themeClass });
    this.load();
  },

  onShow: function () {
    this.setData({ themeClass: app.globalData.themeClass });
  },

  onThemeChange: function (themeClass) {
    this.setData({ themeClass: themeClass });
  },

  load: function () {
    const self = this;
    api.timeline().then(function (res) {
      const years = res.years || [];
      let total = 0;
      for (let i = 0; i < years.length; i++) total += years[i].count;
      self.allYears = years;
      self.expanded = {};
      self.setData({ loading: false, years: years, total: total });
      self.build();
    }).catch(function (err) {
      self.setData({
        loading: false,
        error: (err && err.message) ? err.message : '未知错误'
      });
    });
  },

  /** 按当前显示范围重建渲染数据（分批渲染，避免一次性塞进上千个节点） */
  build: function () {
    const shown = this.data.shown;
    const all = this.allYears || [];
    const expanded = this.expanded || {};
    const render = [];
    for (let i = 0; i < all.length && i < shown; i++) {
      const y = all[i];
      const isOpen = !!expanded[y.year];
      const items = [];
      const src = isOpen ? y.items : y.items.slice(0, ITEMS_PER_YEAR);
      for (let j = 0; j < src.length; j++) {
        const it = src[j];
        items.push({
          id: it.id,
          title: it.title,
          cat: it.cat,
          catName: it.catName,
          issuer: it.issuer,
          published: it.published,
          publishedText: util.fmtDate(it.published)
        });
      }
      render.push({
        year: y.year,
        count: y.count,
        total: y.items.length,
        items: items,
        more: !isOpen && y.items.length > ITEMS_PER_YEAR
      });
    }
    this.setData({
      renderYears: render,
      hasMoreYears: all.length > shown
    });
  },

  onExpandYear: function (e) {
    const year = Number(e.currentTarget.dataset.year);
    this.expanded = this.expanded || {};
    this.expanded[year] = true;
    this.build();
  },

  loadMoreYears: function () {
    this.setData({ shown: this.data.shown + YEAR_STEP });
    this.build();
  },

  onDocTap: function (e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/detail/index?id=' + encodeURIComponent(id) });
  }
});
