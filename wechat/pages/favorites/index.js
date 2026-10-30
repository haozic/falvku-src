const app = getApp();
const store = require('../../utils/store.js');
const util = require('../../utils/util.js');

Page({
  data: {
    themeClass: 'theme-light',
    list: []
  },

  onLoad: function () {
    this.setData({ themeClass: app.globalData.themeClass });
  },

  onShow: function () {
    this.setData({ themeClass: app.globalData.themeClass });
    this.refresh();
  },

  onThemeChange: function (themeClass) {
    this.setData({ themeClass: themeClass });
  },

  refresh: function () {
    const list = store.fav.list().map(function (f) {
      return {
        id: f.id,
        title: f.title || f.id,
        catName: f.catName || '',
        published: f.published || '',
        publishedText: util.fmtDate(f.published),
        issuer: f.issuer || '',
        timeText: util.fmtDateShort(f.ts)
      };
    });
    this.setData({ list: list });
  },

  onDocTap: function (e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/detail/index?id=' + encodeURIComponent(id) });
  },

  onRemove: function (e) {
    const id = e.currentTarget.dataset.id;
    const self = this;
    wx.showModal({
      title: '取消收藏',
      content: '确定取消收藏这条法规？',
      success: function (res) {
        if (!res.confirm) return;
        store.fav.remove(id);
        self.refresh();
        util.toast('已取消收藏');
      }
    });
  }
});
