const app = getApp();
const api = require('../../utils/api.js');
const store = require('../../utils/store.js');
const util = require('../../utils/util.js');

/**
 * 找出正文块里与目录项同名的标题块，返回其锚点 id。
 * 找不到时给一个唯一的兜底 id（避免多个 wx:key 重复）。
 */
function findAnchor(blocks, name, fallback) {
  for (let i = 0; i < blocks.length; i++) {
    if ((blocks[i].type === 'h2' || blocks[i].type === 'h3') && blocks[i].text === name) {
      return 'sec' + blocks[i].idx;
    }
  }
  return fallback || '';
}

Page({
  data: {
    themeClass: 'theme-light',
    fontSize: 15,
    loading: true,
    error: '',
    doc: null,
    tags: [],
    metaRows: [],
    summaryHtml: '',
    toc: [],
    blocks: [],
    isFav: false,
    markCount: 0,
    /* 批注弹层 */
    showMarkSheet: false,
    sheetMode: 'block',
    sheetTitle: '',
    sheetSub: '',
    markTarget: { idx: 0, type: 'p', text: '' },
    blockMarks: [],
    docMarks: [],
    markDraft: '',
    markColor: 'yellow',
    editingMarkId: '',
    /* 导出弹层 */
    showExport: false,
    exporting: false,
    formats: [
      { id: 'txt', name: '纯文本 .txt', desc: '全文纯文本，适合复制引用' },
      { id: 'md', name: 'Markdown .md', desc: '条号加粗，条理清晰' },
      { id: 'csv', name: '目录 .csv', desc: '元信息表格，可用 Excel 打开' },
      { id: 'json', name: 'JSON .json', desc: '结构化数据，含章节层级' },
      { id: 'html', name: '网页 .html', desc: '排版好的网页，可直接打印' }
    ]
  },

  onLoad: function (options) {
    this.setData({
      themeClass: app.globalData.themeClass,
      fontSize: app.globalData.fontSize
    });
    const id = options && options.id ? options.id : '';
    const q = util.safeDecode(options && options.q ? options.q : '');
    if (!id) {
      this.setData({ loading: false, error: '缺少法规编号' });
      return;
    }
    this.loadDoc(id, q);
  },

  onShow: function () {
    this.setData({ themeClass: app.globalData.themeClass });
    /* 从别的页面回来时收藏状态可能变了 */
    if (this.data.doc) this.setData({ isFav: store.fav.has(this.data.doc.id) });
  },

  onThemeChange: function (themeClass) {
    this.setData({ themeClass: themeClass });
    if (this.data.doc && this.data.doc.summary) {
      this.setData({ summaryHtml: util.styleMarks(this.data.doc.summaryHtml, themeClass === 'theme-dark') });
    }
  },

  onShareAppMessage: function () {
    const d = this.data.doc;
    return {
      title: d ? d.title : '法规库',
      path: '/pages/detail/index?id=' + (d ? encodeURIComponent(d.id) : '')
    };
  },

  /* ------------------------------------------------------------ 加载 */

  loadDoc: function (id, q) {
    const self = this;
    api.doc(id, q).then(function (d) {
      const blocks = [];
      for (let i = 0; i < d.blocks.length; i++) {
        const b = d.blocks[i];
        blocks.push({
          idx: i,
          type: b.type,
          no: b.no || '',
          text: b.text || '',
          hasMark: false
        });
      }

      const toc = [];
      for (let i = 0; i < (d.toc || []).length; i++) {
        const t = d.toc[i];
        const children = [];
        const kids = t.children || [];
        for (let j = 0; j < kids.length; j++) {
          children.push({
            name: kids[j].name,
            level: 2,
            anchor: findAnchor(blocks, kids[j].name, 'tocmiss' + i + '-' + j)
          });
        }
        toc.push({
          name: t.name,
          level: t.level,
          anchor: findAnchor(blocks, t.name, 'tocmiss' + i),
          children: children
        });
      }

      const metaRows = [];
      function push(k, v) {
        if (v) metaRows.push({ k: k, v: v });
      }
      push('制定机关', d.issuer);
      push('公布日期', util.fmtDate(d.published));
      push('通过日期', util.fmtDate(d.adopted));
      push('施行日期', util.fmtDate(d.effective));
      push('最后修订', util.fmtDate(d.revised));
      push('效力级别', d.flxz);
      push('时效性', d.effect);
      push('正文字数', d.chars ? util.fmtNum(d.chars) : '');
      push('数据来源', d.source);
      push('门类细分', d.sub);

      const tags = (d.tags || []).slice(0, 4);

      self.setData({
        loading: false,
        doc: d,
        tags: tags,
        metaRows: metaRows,
        summaryHtml: util.styleMarks(d.summaryHtml, app.globalData.theme === 'dark'),
        toc: toc,
        blocks: blocks,
        isFav: store.fav.has(d.id)
      });

      try {
        wx.setNavigationBarTitle({ title: d.catName || '法规详情' });
      } catch (e) {
        /* 忽略 */
      }
      wx.showShareMenu({ withShareTicket: true });

      /* 最近浏览（带标题快照） */
      store.recent.push({
        id: d.id,
        title: d.title,
        catName: d.catName,
        published: d.published,
        issuer: d.issuer,
        chars: d.chars
      });

      self.refreshMarks();
    }).catch(function (err) {
      self.setData({ loading: false, error: (err && err.message) ? err.message : '未知错误' });
    });
  },

  /* ------------------------------------------------------------ 批注 */

  /** 批注转成展示用的结构 */
  toMarkView: function (m) {
    return {
      id: m.id,
      blockIndex: m.blockIndex,
      color: m.color || 'yellow',
      note: m.note || '',
      noteText: m.note || '（仅标记，无文字批注）',
      text: m.text || '',
      excerpt: util.excerpt(m.text || '', 100),
      timeText: util.fmtDateShort(m.ts)
    };
  },

  allMarks: function () {
    const doc = this.data.doc;
    if (!doc) return [];
    return store.marks.list(doc.id).map(this.toMarkView);
  },

  marksOfBlock: function (idx) {
    const doc = this.data.doc;
    if (!doc) return [];
    return store.marks.list(doc.id)
      .filter(function (m) { return m.blockIndex === idx; })
      .map(this.toMarkView);
  },

  /** 批注变化后刷新正文标记与计数 */
  refreshMarks: function () {
    const doc = this.data.doc;
    if (!doc) return;
    const marked = {};
    const marks = store.marks.list(doc.id);
    for (let i = 0; i < marks.length; i++) {
      marked[marks[i].blockIndex] = true;
    }
    const blocks = this.data.blocks.map(function (b) {
      return {
        idx: b.idx,
        type: b.type,
        no: b.no,
        text: b.text,
        hasMark: !!marked[b.idx]
      };
    });
    const docMarks = marks.map(this.toMarkView);
    let blockMarks = this.data.blockMarks;
    if (this.data.sheetMode === 'block' && this.data.markTarget) {
      const targetIdx = this.data.markTarget.idx;
      blockMarks = docMarks.filter(function (m) {
        return m.blockIndex === targetIdx;
      });
    }

    this.setData({
      blocks: blocks,
      markCount: marks.length,
      docMarks: docMarks,
      blockMarks: blockMarks
    });
  },

  /** 点正文段落 -> 打开该段的批注面板 */
  onBlockTap: function (e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const b = this.data.blocks[idx];
    if (!b) return;
    this.setData({
      showMarkSheet: true,
      sheetMode: 'block',
      sheetTitle: '添加批注',
      sheetSub: '批注会挂在这段正文上',
      markTarget: { idx: b.idx, type: b.type, text: b.text },
      blockMarks: this.marksOfBlock(idx),
      markDraft: '',
      markColor: 'yellow',
      editingMarkId: ''
    });
  },

  /** 操作条「批注」-> 列出本篇全部批注 */
  openMarkList: function () {
    const docMarks = this.allMarks();
    this.setData({
      showMarkSheet: true,
      sheetMode: 'list',
      sheetTitle: '我的批注（' + docMarks.length + '）',
      sheetSub: '点击批注可跳到对应段落',
      docMarks: docMarks,
      markDraft: '',
      markColor: 'yellow',
      editingMarkId: ''
    });
  },

  closeSheet: function () {
    this.setData({ showMarkSheet: false, editingMarkId: '' });
  },

  onMarkInput: function (e) {
    this.setData({ markDraft: e.detail.value });
  },

  onColorTap: function (e) {
    this.setData({ markColor: e.currentTarget.dataset.color });
  },

  saveMark: function () {
    const d = this.data;
    const note = (d.markDraft || '').trim();
    if (d.editingMarkId) {
      store.marks.update(d.doc.id, d.editingMarkId, { note: note, color: d.markColor });
      this.setData({ editingMarkId: '' });
      this.refreshMarks();
      util.toast('批注已更新');
      return;
    }
    if (d.sheetMode !== 'block' || !d.markTarget) {
      util.toast('请在正文里点一段再添加批注');
      return;
    }
    store.marks.add(d.doc.id, {
      blockIndex: d.markTarget.idx,
      blockType: d.markTarget.type,
      text: d.markTarget.text,
      note: note,
      color: d.markColor,
      docTitle: d.doc.title
    });
    this.setData({ markDraft: '' });
    this.refreshMarks();
    util.toast('批注已保存');
  },

  editMark: function (e) {
    const id = e.currentTarget.dataset.id;
    const doc = this.data.doc;
    if (!doc) return;
    const marks = store.marks.list(doc.id);
    let target = null;
    for (let i = 0; i < marks.length; i++) {
      if (marks[i].id === id) {
        target = marks[i];
        break;
      }
    }
    if (!target) return;
    this.setData({
      editingMarkId: id,
      markDraft: target.note || '',
      markColor: target.color || 'yellow'
    });
  },

  deleteMark: function (e) {
    const id = e.currentTarget.dataset.id;
    const doc = this.data.doc;
    if (!doc) return;
    store.marks.remove(doc.id, id);
    if (this.data.editingMarkId === id) this.setData({ editingMarkId: '', markDraft: '' });
    this.refreshMarks();
    util.toast('已删除批注');
  },

  /** 从批注列表跳到对应段落 */
  jumpMark: function (e) {
    const id = e.currentTarget.dataset.id;
    const doc = this.data.doc;
    if (!doc) return;
    const marks = store.marks.list(doc.id);
    let target = null;
    for (let i = 0; i < marks.length; i++) {
      if (marks[i].id === id) {
        target = marks[i];
        break;
      }
    }
    if (!target) return;
    this.setData({ showMarkSheet: false, editingMarkId: '' });
    const self = this;
    setTimeout(function () {
      wx.pageScrollTo({ selector: '#sec' + target.blockIndex, duration: 300 });
    }, 60);
  },

  /* ------------------------------------------------------------ 目录 */

  onTocTap: function (e) {
    const anchor = e.currentTarget.dataset.anchor;
    if (!anchor || anchor.indexOf('tocmiss') === 0) {
      util.toast('未找到对应段落');
      return;
    }
    wx.pageScrollTo({ selector: '#' + anchor, duration: 300 });
  },

  /* ------------------------------------------------------------ 收藏 / 字号 */

  toggleFav: function () {
    const d = this.data.doc;
    if (!d) return;
    const on = store.fav.toggle(d.id, {
      title: d.title,
      catName: d.catName,
      published: d.published,
      issuer: d.issuer,
      chars: d.chars
    });
    this.setData({ isFav: on });
    util.toast(on ? '已加入收藏' : '已取消收藏');
  },

  cycleFont: function () {
    const next = app.cycleFontSize();
    this.setData({ fontSize: next });
    util.toast('正文字号 ' + next + 'px');
  },

  /* ------------------------------------------------------------ 导出 */

  openExport: function () {
    this.setData({ showExport: true });
  },

  closeExport: function () {
    this.setData({ showExport: false });
  },

  onExport: function (e) {
    const fmt = e.currentTarget.dataset.fmt;
    const doc = this.data.doc;
    if (!doc || this.data.exporting) return;
    const self = this;
    this.setData({ exporting: true });
    api.exportDoc([doc.id], fmt).then(function (content) {
      self.setData({ exporting: false, showExport: false });
      self.deliver(content, fmt);
    }).catch(function (err) {
      self.setData({ exporting: false });
      util.toast('导出失败：' + ((err && err.message) ? err.message : err));
    });
  },

  /**
   * 导出落地：小程序没有浏览器下载，
   * 方案 = 写入小程序本地目录 + 复制到剪贴板 + 分享文件。
   */
  deliver: function (content, fmt) {
    const name = util.exportName(fmt);
    const fs = wx.getFileSystemManager();
    const path = wx.env.USER_DATA_PATH + '/' + name;
    fs.writeFile({
      filePath: path,
      data: content,
      encoding: 'utf8',
      success: function () {
        const items = ['复制到剪贴板'];
        if (typeof wx.shareFileMessage === 'function') items.push('分享文件');
        items.push('取消');
        wx.showActionSheet({
          itemList: items,
          success: function (res) {
            if (res.tapIndex === 0) {
              wx.setClipboardData({
                data: content,
                success: function () { util.toast('已复制全文'); }
              });
            } else if (res.tapIndex === 1) {
              wx.shareFileMessage({
                filePath: path,
                filename: name,
                success: function () { util.toast('已发送'); },
                fail: function () { util.toast('分享失败'); }
              });
            }
          }
        });
      },
      fail: function () {
        wx.setClipboardData({
          data: content,
          success: function () { util.toast('已复制全文（文件写入失败）'); }
        });
      }
    });
  },

  openSource: function () {
    const d = this.data.doc;
    if (!d || !d.url) return;
    wx.setClipboardData({
      data: d.url,
      success: function () { util.toast('原文链接已复制'); }
    });
  }
});
