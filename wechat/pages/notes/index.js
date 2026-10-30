const app = getApp();
const store = require('../../utils/store.js');
const util = require('../../utils/util.js');

Page({
  data: {
    themeClass: 'theme-light',
    groups: []
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
    const groups = store.marks.docs().map(function (g) {
      const list = g.list.map(function (m) {
        return {
          id: m.id,
          blockIndex: m.blockIndex,
          color: m.color || 'yellow',
          note: m.note || '',
          excerpt: util.excerpt(m.text || '', 120),
          timeText: util.fmtDateShort(m.ts)
        };
      });
      return { id: g.id, title: g.title || g.id, list: list };
    });
    this.setData({ groups: groups });
  },

  onDocTap: function (e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/detail/index?id=' + encodeURIComponent(id) });
  }
});
