const app = getApp();
const store = require('../../utils/store.js');
const util = require('../../utils/util.js');

Page({
  data: {
    themeClass: 'theme-light',
    favCount: 0,
    noteCount: 0,
    customCount: 0,
    recentCount: 0,
    total: 0,
    showCustom: false,
    customs: [],
    fontSize: 15,
    darkOn: false,
    themeMode: 'auto',
    themeLabel: '跟随系统',
    recent: [],
    /* 自建条目编辑弹层 */
    showEditSheet: false,
    editId: '',
    draftTitle: '',
    draftText: ''
  },

  onLoad: function () {
    this.setData({ themeClass: app.globalData.themeClass });
    this.refresh();
  },

  onShow: function () {
    this.setData({ themeClass: app.globalData.themeClass });
    this.refresh();
  },

  onThemeChange: function (themeClass) {
    this.setData({ themeClass: themeClass });
  },

  refresh: function () {
    const g = app.globalData;
    const mode = g.themeMode || 'auto';
    const customs = store.custom.list().map(function (r) {
      return {
        id: r.id,
        title: r.title || '',
        excerpt: util.excerpt(r.text || '', 120)
      };
    });
    const recent = store.recent.list().slice(0, 8).map(function (r) {
      return {
        id: r.id,
        title: r.title || r.id,
        catName: r.catName || ''
      };
    });
    this.setData({
      favCount: store.fav.count(),
      noteCount: store.marks.count(),
      customCount: store.custom.count(),
      recentCount: store.recent.list().length,
      total: g.meta ? g.meta.total : 0,
      customs: customs,
      recent: recent,
      fontSize: g.fontSize,
      darkOn: g.theme === 'dark',
      themeMode: mode,
      themeLabel: mode === 'auto' ? '跟随系统' : (mode === 'dark' ? '深色' : '浅色')
    });
  },

  /* ------------------------------------------------------------ 导航 */

  goFavorites: function () {
    wx.navigateTo({ url: '/pages/favorites/index' });
  },

  goNotes: function () {
    wx.navigateTo({ url: '/pages/notes/index' });
  },

  onDocTap: function (e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/detail/index?id=' + encodeURIComponent(id) });
  },

  /* ------------------------------------------------------------ 设置 */

  cycleFont: function () {
    const next = app.cycleFontSize();
    this.setData({ fontSize: next });
    util.toast('正文字号 ' + next + 'px');
  },

  onDarkChange: function (e) {
    const on = e.detail.value;
    const mode = on ? 'dark' : 'light';
    store.settings.set('themeMode', mode);
    app.applyTheme(mode);
    this.setData({
      darkOn: on,
      themeMode: mode,
      themeLabel: on ? '深色' : '浅色'
    });
  },

  useSystemTheme: function () {
    store.settings.set('themeMode', 'auto');
    app.applyTheme('auto');
    this.setData({
      themeMode: 'auto',
      themeLabel: '跟随系统',
      darkOn: app.globalData.theme === 'dark'
    });
  },

  clearRecent: function () {
    const self = this;
    wx.showModal({
      title: '清空最近浏览',
      content: '将清空全部最近浏览记录',
      success: function (res) {
        if (!res.confirm) return;
        store.recent.clear();
        self.refresh();
        util.toast('已清空');
      }
    });
  },

  /* ------------------------------------------------------------ 自建条目 */

  toggleCustom: function () {
    this.setData({ showCustom: !this.data.showCustom });
  },

  newCustom: function () {
    this.setData({
      showEditSheet: true,
      editId: '',
      draftTitle: '',
      draftText: ''
    });
  },

  editCustom: function (e) {
    const id = e.currentTarget.dataset.id;
    const list = store.custom.list();
    let target = null;
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        target = list[i];
        break;
      }
    }
    if (!target) return;
    this.setData({
      showEditSheet: true,
      editId: id,
      draftTitle: target.title || '',
      draftText: target.text || ''
    });
  },

  closeEditSheet: function () {
    this.setData({ showEditSheet: false });
  },

  onTitleInput: function (e) {
    this.setData({ draftTitle: e.detail.value });
  },

  onTextInput: function (e) {
    this.setData({ draftText: e.detail.value });
  },

  saveCustom: function () {
    const title = (this.data.draftTitle || '').trim();
    if (!title) {
      util.toast('请填写标题');
      return;
    }
    store.custom.save({
      id: this.data.editId || undefined,
      title: title,
      text: this.data.draftText || ''
    });
    this.setData({ showEditSheet: false });
    this.refresh();
    util.toast('已保存');
  },

  deleteCustom: function (e) {
    const id = e.currentTarget.dataset.id;
    const self = this;
    wx.showModal({
      title: '删除条目',
      content: '删除后不可恢复',
      success: function (res) {
        if (!res.confirm) return;
        store.custom.remove(id);
        self.refresh();
        util.toast('已删除');
      }
    });
  }
});
