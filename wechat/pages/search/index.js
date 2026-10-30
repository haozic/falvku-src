const app = getApp();
const api = require('../../utils/api.js');
const util = require('../../utils/util.js');

Page({
  data: {
    themeClass: 'theme-light',
    query: '',
    cats: [],
    activeCat: 'all',
    sort: 'relevance',
    results: [],
    total: 0,
    pages: 1,
    page: 1,
    took: 0,
    countText: '',
    loading: false,
    loadingMore: false,
    hasMore: false
  },

  onLoad: function () {
    this.setData({ themeClass: app.globalData.themeClass });
    this.loadCats();
  },

  onShow: function () {
    this.setData({ themeClass: app.globalData.themeClass });
    const g = app.globalData;
    let need = false;

    /* 从首页 / 体系页跳过来：带门类 */
    if (g.pendingCat) {
      this.setData({ activeCat: g.pendingCat });
      g.pendingCat = '';
      need = true;
    }

    /* 外部带了新检索词 */
    if (g.lastQuery !== this.data.query) {
      this.setData({ query: g.lastQuery });
      need = true;
    }

    /* 首次进入：拉一次全库（按最新排序，避免停在空结果态） */
    if (!this._inited) {
      this._inited = true;
      need = true;
    }

    if (need) this.runSearch(1);
  },

  onThemeChange: function (themeClass) {
    this.setData({ themeClass: themeClass });
    /* 高亮配色跟主题走：本地重刷样式即可，不必重新请求（避免重复追加结果） */
    this.restyle();
  },

  /** 按当前主题重刷片段高亮颜色 */
  restyle: function () {
    const dark = app.globalData.theme === 'dark';
    const results = this.data.results.map(function (r) {
      return Object.assign({}, r, { snippetHtml: util.styleMarks(r.snippetRaw || '', dark) });
    });
    this.setData({ results: results });
  },

  /** 门类 chips */
  loadCats: function () {
    const self = this;
    app.ensureMeta(function (meta) {
      if (!meta) return;
      const cats = [];
      for (let i = 0; i < meta.categories.length; i++) {
        const c = meta.categories[i];
        const st = meta.stats[c.id];
        if (!st || !st.count) continue;
        cats.push({ id: c.id, name: c.name, count: st.count });
      }
      self.setData({ cats: cats });
    });
  },

  onInput: function (e) {
    this.setData({ query: e.detail.value });
  },

  onSearch: function () {
    this.runSearch(1);
  },

  onCatTap: function (e) {
    const id = e.currentTarget.dataset.id;
    if (id === this.data.activeCat) return;
    this.setData({ activeCat: id });
    this.runSearch(1);
  },

  onSortTap: function (e) {
    const s = e.currentTarget.dataset.s;
    if (s === this.data.sort) return;
    this.setData({ sort: s });
    this.runSearch(1);
  },

  loadMore: function () {
    if (this.data.loading || this.data.loadingMore || !this.data.hasMore) return;
    this.runSearch(this.data.page + 1, true);
  },

  /**
   * 执行检索。
   * @param {number} page 从 1 开始
   * @param {boolean} append 是否追加到已有结果
   */
  runSearch: function (page, append) {
    const self = this;
    const q = (this.data.query || '').trim();
    let sort = this.data.sort;
    /* 空查询没有「相关度」可言，按最新在前更符合浏览直觉 */
    if (!q && sort === 'relevance') {
      sort = 'new';
      this.setData({ sort: 'new' });
    }
    app.globalData.lastQuery = q;

    this.setData(append ? { loadingMore: true } : { loading: true, results: [] });

    api.search({
      q: q,
      cat: this.data.activeCat,
      sort: sort,
      page: page,
      size: 20
    }).then(function (res) {
      const dark = app.globalData.theme === 'dark';
      const hits = [];
      for (let i = 0; i < res.hits.length; i++) {
        const h = res.hits[i];
        hits.push({
          id: h.id,
          title: h.title,
          cat: h.cat,
          catName: h.catName,
          group: h.group,
          issuer: h.issuer,
          published: h.published,
          publishedText: util.fmtDate(h.published),
          year: h.year,
          chars: h.chars,
          charsText: util.fmtNum(h.chars),
          summary: h.summary,
          snippetRaw: h.snippetHtml,
          snippetHtml: util.styleMarks(h.snippetHtml, dark)
        });
      }
      const results = append ? self.data.results.concat(hits) : hits;
      self.setData({
        results: results,
        total: res.total,
        pages: res.pages,
        page: res.page,
        took: res.took,
        hasMore: res.page < res.pages,
        loading: false,
        loadingMore: false,
        countText: q ? ('共 ' + res.total + ' 条 · ' + res.took + 'ms') : ('共 ' + res.total + ' 部')
      });
    }).catch(function (err) {
      self.setData({
        loading: false,
        loadingMore: false,
        countText: '',
        results: append ? self.data.results : []
      });
      util.toast('检索失败：' + (err.message || err));
    });
  },

  onDocTap: function (e) {
    const id = e.currentTarget.dataset.id;
    const q = (this.data.query || '').trim();
    wx.navigateTo({
      url: '/pages/detail/index?id=' + encodeURIComponent(id) + '&q=' + encodeURIComponent(q)
    });
  }
});
