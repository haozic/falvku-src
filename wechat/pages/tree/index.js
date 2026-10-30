const app = getApp();

Page({
  data: {
    themeClass: 'theme-light',
    groups: [],
    catCount: 0,
    allOpen: false
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
    app.ensureMeta(function (meta) {
      if (!meta) return;
      const groups = [];
      let catCount = 0;
      for (let i = 0; i < meta.groups.length; i++) {
        const g = meta.groups[i];
        const cats = [];
        let total = 0;
        for (let j = 0; j < g.cats.length; j++) {
          const st = meta.stats[g.cats[j]];
          if (!st || !st.count) continue;
          cats.push({ id: g.cats[j], name: st.name, count: st.count });
          total += st.count;
        }
        if (!total) continue;
        catCount += cats.length;
        groups.push({
          id: g.id,
          name: g.name,
          color: g.color || '#c8102e',
          desc: g.desc || '',
          total: total,
          cats: cats,
          open: true
        });
      }
      self.setData({ groups: groups, catCount: catCount, allOpen: true });
    });
  },

  /** 展开 / 收起某个体系 */
  onToggle: function (e) {
    const id = e.currentTarget.dataset.id;
    const groups = this.data.groups.map(function (g) {
      if (g.id !== id) return g;
      return Object.assign({}, g, { open: !g.open });
    });
    const anyOpen = groups.some(function (g) { return g.open; });
    this.setData({ groups: groups, allOpen: anyOpen });
  },

  toggleAll: function () {
    const open = !this.data.allOpen;
    const groups = this.data.groups.map(function (g) {
      return Object.assign({}, g, { open: open });
    });
    this.setData({ groups: groups, allOpen: open });
  },

  /** 点门类 -> 检索页按该门类浏览 */
  onCatTap: function (e) {
    const id = e.currentTarget.dataset.id;
    app.globalData.pendingCat = id;
    app.globalData.lastQuery = '';
    wx.switchTab({ url: '/pages/search/index' });
  }
});
