// 调试日志面板：覆盖在画布上的暗色弹窗
// 功能：
//   1. 顶部分类标签（ALL / CONSOLE / HTTP / WS / ERROR）切换过滤；
//   2. 中部虚拟滚动列表，颜色区分级别/来源；贴底自动跟随；
//   3. 底部工具区：暂停、清空、关闭、发包、会话信息；
//   4. 点击单条 → 详情视图，提供「复制」按钮（wx.setClipboardData）；
//   5. 面板范围内触摸事件被消费，避免穿透；
//   6. 所有交互均带 try/catch 隔离。

import { SCREEN_WIDTH, SCREEN_HEIGHT } from '../render';
import { formatTime, safeStringify } from './util';
import { LOG_LEVEL, LOG_SOURCE } from './log_store';

// 分类标签定义
const TABS = ['ALL', 'CONSOLE', 'HTTP', 'WS', 'ERROR'];

// 颜色映射
const COLOR_BY_LEVEL = {
  debug: '#9aa0a6',
  info: '#dcdcdc',
  warn: '#f4b400',
  error: '#ff5252',
};
const COLOR_BY_SOURCE = {
  console: '#9ad0ff',
  http: '#a5d6a7',
  ws: '#ce93d8',
};

export default class LogPanel {
  constructor(store) {
    this.store = store;
    this.visible = false;
    this.filter = 'ALL';        // 当前分类
    this.paused = false;        // 暂停追加
    this.autoFollow = true;     // 贴底自动跟随
    this.scrollY = 0;           // 列表向上偏移 px
    this.detailEntry = null;    // 详情视图当前条目（null 表示不展示）
    this.lineHeight = 16;       // 单行高度
    this._lastTouchY = 0;       // 触摸滑动起点
    this._dragging = false;     // 列表拖动中
    this._unsub = null;         // LogStore 订阅取消

    this._buildLayout();
    this._initButtons();
    this._subscribe();
  }

  // 计算面板矩形
  _buildLayout() {
    const w = Math.floor(SCREEN_WIDTH * 0.94);
    const h = Math.floor(SCREEN_HEIGHT * 0.72);
    const x = Math.floor((SCREEN_WIDTH - w) / 2);
    const y = Math.floor((SCREEN_HEIGHT - h) / 2);
    this.rect = { x, y, w, h };
    this.headerH = 36;          // 标题栏
    this.tabsH = 28;            // 分类标签栏
    this.toolH = 38;            // 底部工具栏
    this.listRect = {
      x: x + 6,
      y: y + this.headerH + this.tabsH,
      w: w - 12,
      h: h - this.headerH - this.tabsH - this.toolH - 6,
    };
  }

  // 初始化工具按钮命中区域
  _initButtons() {
    // 仅缓存矩形，渲染时重算
    this.btns = {};
  }

  // 订阅日志变更
  _subscribe() {
    if (!this.store) return;
    this._unsub = this.store.subscribe((entry, evt) => {
      if (evt === 'cleared') {
        this.scrollY = 0;
        return;
      }
      if (this.visible && this.autoFollow && !this.paused) {
        // 简单贴底：滚动到最大
        this.scrollY = 0; // 0 表示贴底，按从下往上偏移
      }
    });
  }

  show() { this.visible = true; this.scrollY = 0; this.autoFollow = true; }
  hide() { this.visible = false; this.detailEntry = null; }

  // 当前过滤的条目数组
  _entries() {
    return this.store ? this.store.query(this.filter) : [];
  }

  // 触摸入口：返回 true 表示已消费
  handleTouchStart(x, y) {
    if (!this.visible) return false;
    // 详情视图优先
    if (this.detailEntry) {
      return this._handleDetailTouch(x, y);
    }
    // 弹窗（发包/会话信息）若在显示，优先处理
    if (this._modal) {
      return this._handleModalTouch(x, y);
    }
    // 命中判断：面板矩形外不消费（让用户能点击下方按钮也不行 —— 还是消费防止穿透；按需求 5.8 仅消费面板内部）
    if (!this._hitRect(x, y, this.rect)) {
      // 面板外触摸：不消费
      return false;
    }
    // 顶部按钮
    const btns = this.btns;
    if (btns.close && this._hitRect(x, y, btns.close)) { this.hide(); return true; }
    // 分类标签
    if (Array.isArray(btns.tabs)) {
      for (let i = 0; i < btns.tabs.length; i++) {
        if (this._hitRect(x, y, btns.tabs[i])) {
          this.filter = TABS[i];
          this.scrollY = 0;
          return true;
        }
      }
    }
    // 工具栏
    if (btns.pause && this._hitRect(x, y, btns.pause)) { this.paused = !this.paused; return true; }
    if (btns.clear && this._hitRect(x, y, btns.clear)) { this.store && this.store.clear(); this.scrollY = 0; return true; }
    if (btns.send && this._hitRect(x, y, btns.send)) { this._openSendModal(); return true; }
    if (btns.session && this._hitRect(x, y, btns.session)) { this._openSessionModal(); return true; }

    // 列表区域：开始拖动 / 候选点击
    if (this._hitRect(x, y, this.listRect)) {
      this._dragging = true;
      this._lastTouchY = y;
      this._touchStartY = y;
      this._touchStartScroll = this.scrollY;
      return true;
    }
    return true; // 面板内其余区域也消费
  }

  handleTouchMove(x, y) {
    if (!this.visible) return false;
    if (this.detailEntry || this._modal) return false;
    if (!this._dragging) return false;
    const dy = y - this._lastTouchY;
    this._lastTouchY = y;
    this.scrollY += dy; // 向下拖 → 列表往下移 → 显示更早的内容
    // 限制范围
    const all = this._entries();
    const totalH = all.length * this.lineHeight;
    const maxScroll = Math.max(0, totalH - this.listRect.h);
    if (this.scrollY > maxScroll) this.scrollY = maxScroll;
    if (this.scrollY < 0) this.scrollY = 0;
    // 仅当贴底时启用自动跟随
    this.autoFollow = (this.scrollY === 0);
    return true;
  }

  handleTouchEnd(x, y) {
    if (!this.visible) return false;
    if (this.detailEntry || this._modal) return false;
    if (this._dragging) {
      const moved = Math.abs(y - this._touchStartY);
      this._dragging = false;
      // 视为点击：选中条目展示详情
      if (moved < 6 && this._hitRect(x, y, this.listRect)) {
        const idx = this._indexAt(y);
        const list = this._entries();
        const e = list[idx];
        if (e) this.detailEntry = e;
      }
      return true;
    }
    return false;
  }

  // 命中：根据 y 计算列表索引（贴底渲染：底部为最新条目）
  _indexAt(y) {
    const list = this._entries();
    const totalH = list.length * this.lineHeight;
    const visibleH = this.listRect.h;
    // 渲染时第 i 条 y = listRect.bottom - lineHeight - (list.length-1-i)*lineHeight + scrollY
    // 用户屏幕 y → 反推
    const offsetFromBottom = this.listRect.y + this.listRect.h - y - this.scrollY;
    const idxFromEnd = Math.floor(offsetFromBottom / this.lineHeight);
    const idx = list.length - 1 - idxFromEnd;
    return idx;
  }

  _hitRect(x, y, r) {
    return r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  // 渲染入口
  render(ctx) {
    if (!this.visible) return;
    ctx.save();
    // 整屏暗化
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    // 面板背景
    const r = this.rect;
    ctx.fillStyle = 'rgba(20,22,28,0.96)';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);

    this._renderHeader(ctx);
    this._renderTabs(ctx);
    this._renderList(ctx);
    this._renderToolbar(ctx);

    // 详情或弹窗
    if (this.detailEntry) this._renderDetail(ctx);
    if (this._modal) this._renderModal(ctx);
    ctx.restore();
  }

  _renderHeader(ctx) {
    const r = this.rect;
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(r.x, r.y, r.w, this.headerH);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('调试日志面板', r.x + 10, r.y + this.headerH / 2);
    // 总数
    const total = this.store ? this.store.buffer.length : 0;
    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#9aa0a6';
    ctx.fillText(`(${total}条)`, r.x + 110, r.y + this.headerH / 2 + 1);

    // 关闭按钮
    const btnW = 44, btnH = 22;
    const bx = r.x + r.w - btnW - 8;
    const by = r.y + (this.headerH - btnH) / 2;
    ctx.fillStyle = '#e57373';
    ctx.fillRect(bx, by, btnW, btnH);
    ctx.fillStyle = '#fff';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('关闭', bx + btnW / 2, by + btnH / 2);
    this.btns.close = { x: bx, y: by, w: btnW, h: btnH };
  }

  _renderTabs(ctx) {
    const r = this.rect;
    const tabsY = r.y + this.headerH;
    ctx.fillStyle = '#111418';
    ctx.fillRect(r.x, tabsY, r.w, this.tabsH);
    const pad = 6;
    const tabW = Math.floor((r.w - pad * 2) / TABS.length);
    const rects = [];
    for (let i = 0; i < TABS.length; i++) {
      const tx = r.x + pad + i * tabW;
      const ty = tabsY + 4;
      const tw = tabW - 4;
      const th = this.tabsH - 8;
      const active = this.filter === TABS[i];
      ctx.fillStyle = active ? '#ff8a00' : '#2a2f3a';
      ctx.fillRect(tx, ty, tw, th);
      ctx.fillStyle = active ? '#fff' : '#cfd2d6';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(TABS[i], tx + tw / 2, ty + th / 2);
      rects.push({ x: tx, y: ty, w: tw, h: th });
    }
    this.btns.tabs = rects;
  }

  _renderList(ctx) {
    const lr = this.listRect;
    // 背景
    ctx.fillStyle = '#0c0e12';
    ctx.fillRect(lr.x, lr.y, lr.w, lr.h);
    // 裁剪
    ctx.save();
    ctx.beginPath();
    ctx.rect(lr.x, lr.y, lr.w, lr.h);
    ctx.clip();

    const list = this._entries();
    const lh = this.lineHeight;
    // 贴底渲染：从底部往上画；scrollY 表示往上滚动多少 px
    const bottomY = lr.y + lr.h - 4 + this.scrollY;
    ctx.font = '11px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    for (let i = list.length - 1; i >= 0; i--) {
      const yLine = bottomY - (list.length - 1 - i) * lh;
      if (yLine < lr.y - lh) break;          // 上方不可见
      if (yLine > lr.y + lr.h + lh) continue; // 下方暂时不可见
      const e = list[i];
      const txt = this._formatLine(e);
      ctx.fillStyle = COLOR_BY_LEVEL[e.level] || '#dcdcdc';
      // 来源色块（短前缀）
      const srcColor = COLOR_BY_SOURCE[e.source] || '#dcdcdc';
      ctx.fillStyle = srcColor;
      ctx.fillText('●', lr.x + 4, yLine);
      ctx.fillStyle = COLOR_BY_LEVEL[e.level] || '#dcdcdc';
      // 截断单行
      const maxW = lr.w - 22;
      const drawn = this._truncateForWidth(ctx, txt, maxW);
      ctx.fillText(drawn, lr.x + 16, yLine);
    }
    ctx.restore();

    // 暂停标识
    if (this.paused) {
      ctx.save();
      ctx.fillStyle = 'rgba(244,180,0,0.85)';
      ctx.fillRect(lr.x + lr.w - 64, lr.y + 4, 60, 16);
      ctx.fillStyle = '#000';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('已暂停', lr.x + lr.w - 34, lr.y + 12);
      ctx.restore();
    }
  }

  _formatLine(e) {
    const t = formatTime(e.time);
    return `${t} [${(e.level || 'info').toUpperCase()}] [${e.source}] ${e.text || ''}`;
  }

  // 按宽度截断
  _truncateForWidth(ctx, text, maxW) {
    if (!text) return '';
    if (ctx.measureText(text).width <= maxW) return text;
    let lo = 0, hi = text.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const s = text.slice(0, mid) + '…';
      if (ctx.measureText(s).width <= maxW) lo = mid + 1;
      else hi = mid;
    }
    return text.slice(0, Math.max(0, lo - 1)) + '…';
  }

  _renderToolbar(ctx) {
    const r = this.rect;
    const ty = r.y + r.h - this.toolH;
    ctx.fillStyle = '#111418';
    ctx.fillRect(r.x, ty, r.w, this.toolH);
    const buttons = [
      { key: 'pause', text: this.paused ? '恢复' : '暂停', color: this.paused ? '#5cb85c' : '#6c757d' },
      { key: 'clear', text: '清空', color: '#e57373' },
      { key: 'send', text: '发包', color: '#1e88e5' },
      { key: 'session', text: '会话', color: '#8e24aa' },
    ];
    const pad = 8;
    const total = buttons.length;
    const bw = Math.floor((r.w - pad * (total + 1)) / total);
    const bh = this.toolH - 12;
    for (let i = 0; i < total; i++) {
      const bx = r.x + pad + i * (bw + pad);
      const by = ty + 6;
      const b = buttons[i];
      ctx.fillStyle = b.color;
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.text, bx + bw / 2, by + bh / 2);
      this.btns[b.key] = { x: bx, y: by, w: bw, h: bh };
    }
  }

  // ========== 详情视图 ==========
  _renderDetail(ctx) {
    const e = this.detailEntry;
    if (!e) return;
    // 蒙层
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    // 面板
    const w = Math.floor(SCREEN_WIDTH * 0.86);
    const h = Math.floor(SCREEN_HEIGHT * 0.6);
    const x = Math.floor((SCREEN_WIDTH - w) / 2);
    const y = Math.floor((SCREEN_HEIGHT - h) / 2);
    ctx.fillStyle = '#1c1f26';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#444';
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    // 标题
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`${formatTime(e.time)}  [${(e.level || '').toUpperCase()}]  [${e.source}]`, x + 12, y + 10);
    // 正文（自动换行）
    ctx.fillStyle = '#dcdcdc';
    ctx.font = '12px monospace';
    const text = e.text || '';
    const lines = this._wrapText(ctx, text, w - 24);
    let lineY = y + 38;
    const maxLineY = y + h - 56;
    for (let i = 0; i < lines.length && lineY < maxLineY; i++) {
      ctx.fillText(lines[i], x + 12, lineY);
      lineY += 16;
    }
    // 复制按钮
    const cw = 80, ch = 28;
    const cbx = x + w - cw - 12;
    const cby = y + h - ch - 10;
    ctx.fillStyle = '#1e88e5';
    ctx.fillRect(cbx, cby, cw, ch);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('复制', cbx + cw / 2, cby + ch / 2);
    // 关闭按钮
    const closeW = 80;
    const closeX = x + 12;
    ctx.fillStyle = '#6c757d';
    ctx.fillRect(closeX, cby, closeW, ch);
    ctx.fillStyle = '#fff';
    ctx.fillText('关闭', closeX + closeW / 2, cby + ch / 2);
    this._detailRects = {
      panel: { x, y, w, h },
      copy: { x: cbx, y: cby, w: cw, h: ch },
      close: { x: closeX, y: cby, w: closeW, h: ch },
    };
  }

  _handleDetailTouch(x, y) {
    const rs = this._detailRects;
    if (!rs) { this.detailEntry = null; return true; }
    if (this._hitRect(x, y, rs.copy)) {
      this._copyDetail();
      return true;
    }
    if (this._hitRect(x, y, rs.close)) { this.detailEntry = null; return true; }
    if (!this._hitRect(x, y, rs.panel)) { this.detailEntry = null; return true; }
    return true;
  }

  _copyDetail() {
    const e = this.detailEntry;
    if (!e) return;
    const text = `${formatTime(e.time)} [${(e.level || '').toUpperCase()}] [${e.source}] ${e.text || ''}`;
    try {
      if (typeof wx !== 'undefined' && wx.setClipboardData) {
        wx.setClipboardData({
          data: text,
          success: () => { this._toast('已复制'); },
          fail: () => { this._toast('复制失败'); },
        });
      } else {
        this._toast('环境不支持复制');
      }
    } catch (err) { this._toast('复制异常'); }
  }

  _toast(msg) {
    try {
      if (GameGlobal.toast) GameGlobal.toast.show(msg, 1200);
    } catch (e) {}
  }

  _wrapText(ctx, text, maxW) {
    const lines = [];
    const raw = String(text || '');
    // 按 \n 拆段，再按宽度断行
    const segs = raw.split(/\r?\n/);
    for (let s = 0; s < segs.length; s++) {
      let cur = segs[s];
      if (cur === '') { lines.push(''); continue; }
      while (cur.length) {
        if (ctx.measureText(cur).width <= maxW) { lines.push(cur); break; }
        // 二分查找最大可放置长度
        let lo = 1, hi = cur.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (ctx.measureText(cur.slice(0, mid)).width <= maxW) lo = mid + 1;
          else hi = mid;
        }
        const cut = Math.max(1, lo - 1);
        lines.push(cur.slice(0, cut));
        cur = cur.slice(cut);
      }
    }
    return lines;
  }

  // ========== 弹窗（发包 / 会话信息） ==========
  _openSendModal() {
    const sock = GameGlobal.socket;
    if (!sock || !sock.connected) {
      this._toast('Socket 未连接');
      return;
    }
    if (typeof wx === 'undefined' || typeof wx.showModal !== 'function') {
      this._modal = { type: 'tip', text: '当前环境不支持原生输入' };
      return;
    }
    // 第一步：输入 type
    wx.showModal({
      title: '发包-Step1',
      content: '请输入 type（如 LOGIN、PLACE_CARDS）',
      editable: true,
      placeholderText: 'type',
      success: (r1) => {
        if (!r1.confirm) return;
        const type = (r1.content || '').trim();
        if (!type) { this._toast('type 为空'); return; }
        // 第二步：输入 JSON data
        wx.showModal({
          title: '发包-Step2',
          content: '请输入 JSON 格式 data，可留空',
          editable: true,
          placeholderText: '{}',
          success: (r2) => {
            if (!r2.confirm) return;
            const raw = (r2.content || '').trim();
            let data = {};
            if (raw) {
              try { data = JSON.parse(raw); }
              catch (e) { this._toast('JSON 格式错误'); return; }
            }
            try { sock.send(type, data); this._toast('已发送'); }
            catch (e) { this._toast('发送失败'); }
          },
        });
      },
    });
  }

  _openSessionModal() {
    const databus = GameGlobal.databus;
    const sock = GameGlobal.socket;
    const snap = {
      user: databus && {
        openid: databus.user.openid,
        nickname: databus.user.nickname,
      },
      scene: databus && databus.scene,
      room: databus && databus.room ? {
        id: databus.room.id,
        phase: databus.room.phase,
        currentRound: databus.room.currentRound,
        players: (databus.room.players || []).map((p) => ({
          openid: p.openid, nickname: p.nickname, ready: p.ready, offline: p.offline,
        })),
      } : null,
      socket: sock && {
        connected: sock.connected,
        connecting: sock.connecting,
        retry: sock.retry,
        url: sock.url,
      },
    };
    this._modal = {
      type: 'session',
      title: '会话信息',
      text: safeStringify(snap, 4000),
    };
  }

  _renderModal(ctx) {
    const m = this._modal;
    if (!m) return;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    const w = Math.floor(SCREEN_WIDTH * 0.86);
    const h = Math.floor(SCREEN_HEIGHT * 0.6);
    const x = Math.floor((SCREEN_WIDTH - w) / 2);
    const y = Math.floor((SCREEN_HEIGHT - h) / 2);
    ctx.fillStyle = '#1c1f26';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#444';
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(m.title || '提示', x + 12, y + 10);
    ctx.fillStyle = '#dcdcdc';
    ctx.font = '12px monospace';
    const lines = this._wrapText(ctx, m.text || '', w - 24);
    let lineY = y + 38;
    const maxLineY = y + h - 56;
    for (let i = 0; i < lines.length && lineY < maxLineY; i++) {
      ctx.fillText(lines[i], x + 12, lineY);
      lineY += 16;
    }
    // 关闭按钮
    const cw = 80, ch = 28;
    const cbx = x + w - cw - 12;
    const cby = y + h - ch - 10;
    ctx.fillStyle = '#6c757d';
    ctx.fillRect(cbx, cby, cw, ch);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('关闭', cbx + cw / 2, cby + ch / 2);
    // 复制
    const copyX = x + 12;
    ctx.fillStyle = '#1e88e5';
    ctx.fillRect(copyX, cby, cw, ch);
    ctx.fillStyle = '#fff';
    ctx.fillText('复制', copyX + cw / 2, cby + ch / 2);
    this._modalRects = {
      panel: { x, y, w, h },
      close: { x: cbx, y: cby, w: cw, h: ch },
      copy: { x: copyX, y: cby, w: cw, h: ch },
    };
  }

  _handleModalTouch(x, y) {
    const rs = this._modalRects;
    if (!rs) { this._modal = null; return true; }
    if (this._hitRect(x, y, rs.close)) { this._modal = null; return true; }
    if (this._hitRect(x, y, rs.copy)) {
      const m = this._modal;
      if (m) {
        try {
          if (typeof wx !== 'undefined' && wx.setClipboardData) {
            wx.setClipboardData({ data: m.text || '', success: () => this._toast('已复制') });
          }
        } catch (e) {}
      }
      return true;
    }
    if (!this._hitRect(x, y, rs.panel)) { this._modal = null; return true; }
    return true;
  }
}
