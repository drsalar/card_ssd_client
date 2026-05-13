// 对局打牌阶段：发牌、放牌、开牌
// 提供：手牌区渲染、三道放置区渲染、操作按钮、触摸命中
import { SCREEN_WIDTH, SCREEN_HEIGHT } from '../render';
import Button from '../ui/Button';
import Card, { CARD_WIDTH, CARD_HEIGHT } from '../ui/Card';
import CardGroup from '../ui/CardGroup';
import { sortBySuit, sortByRank } from '../game/card';
import { evaluate } from '../game/hand_evaluator';
import { HAND_PATTERN_DEFS, findPatternCombos } from '../game/hand_pattern';
import { validateLanes } from '../game/lane_validator';
import { MSG } from '../net/protocol';

// 道牌定义
const LANE_DEFS = [
  { key: 'head', name: '头道', size: 3 },
  { key: 'middle', name: '中道', size: 5 },
  { key: 'tail', name: '尾道', size: 5 },
];

export default class PlayPhase {
  constructor(scene) {
    this.scene = scene;
    this._buildButtons();
    // 手牌命中区
    this._handHits = [];
    this._handSlideVisited = new Set();
    this._isHandSliding = false;
    // 三道命中区
    this._laneHits = { head: [], middle: [], tail: [] };
    // 牌型快捷选择缓存
    this._patternCombos = {};
    this._patternCycle = {};
  }

  _buildButtons() {
    const layout = this._getLayout();
    // 排序按钮（手牌上方）
    this.sortRankBtn = new Button({
      x: layout.margin, y: layout.actionY, width: layout.sortW, height: layout.actionBtnH, text: '点数', fontSize: 13,
      onClick: () => { GameGlobal.databus.sortMode = 'rank'; this._applySort(); },
    });
    this.sortSuitBtn = new Button({
      x: layout.margin + layout.sortW + 6, y: layout.actionY, width: layout.sortW, height: layout.actionBtnH, text: '花色', fontSize: 13,
      bgColor: '#999',
      onClick: () => { GameGlobal.databus.sortMode = 'suit'; this._applySort(); },
    });
    // 三道放入按钮（收纳在放置区右侧，避免遮挡玩家）
    this.laneActionBtns = LANE_DEFS.map((def) => ({
      key: def.key,
      size: def.size,
      place: new Button({
        x: 0, y: 0, width: layout.laneBtnW, height: layout.laneBtnH, text: '放入', fontSize: 12,
        onClick: () => this._placeSelected(def.key),
      }),
      cancel: new Button({
        x: 0, y: 0, width: layout.laneBtnW, height: layout.laneBtnH, text: '取消', fontSize: 12,
        bgColor: '#999',
        onClick: () => this._cancelLane(def.key),
      }),
    }));
    // 开牌按钮（手牌上方右侧）
    this.openBtn = new Button({
      x: SCREEN_WIDTH - layout.margin - layout.openW, y: layout.actionY - 4, width: layout.openW, height: 36, text: '开牌',
      bgColor: '#5cb85c', disabled: true,
      onClick: () => this._submit(),
    });
    this.patternBtns = HAND_PATTERN_DEFS.map((def) => ({
      def,
      btn: new Button({
        x: 0, y: 0, width: 48, height: layout.patternBtnH, text: def.label, fontSize: 11,
        bgColor: '#f5a623', disabledColor: '#666',
        onClick: () => this._selectPattern(def.key),
      }),
    }));
    this._updateButtonLayout(layout);
  }

  // 根据屏幕尺寸计算牌桌安全布局
  _getLayout() {
    const SW = SCREEN_WIDTH;
    const SH = SCREEN_HEIGHT;
    const room = GameGlobal.databus.room;
    const playerCount = room && Array.isArray(room.players) ? room.players.length : 0;
    const margin = Math.max(8, Math.floor(SW * 0.025));
    const sideSafeRate = playerCount >= 5 ? 0.24 : playerCount >= 3 ? 0.21 : 0.18;
    const sideSafeMin = playerCount >= 5 ? 96 : 64;
    const sideSafeMax = playerCount >= 5 ? 122 : 96;
    const sideSafe = Math.max(sideSafeMin, Math.min(sideSafeMax, Math.floor(SW * sideSafeRate)));
    const laneW = Math.min(SW - margin * 2, Math.max(220, Math.min(430, SW - sideSafe * 2)));
    const laneX = Math.floor((SW - laneW) / 2);
    const handCardW = Math.max(30, Math.min(CARD_WIDTH, Math.floor(SW / 11.2)));
    const handCardH = Math.round(handCardW * CARD_HEIGHT / CARD_WIDTH);
    const patternBtnH = Math.max(22, Math.min(28, Math.floor(SH * 0.04)));
    const patternGap = Math.max(4, Math.min(8, Math.floor(SH * 0.012)));
    const bottomGap = Math.max(22, Math.min(42, Math.floor(SH * 0.055)));
    const patternY = SH - bottomGap - patternBtnH;
    const handY = Math.max(0, patternY - patternGap - handCardH);
    const actionBtnH = Math.max(24, Math.min(30, Math.floor(SH * 0.045)));
    const actionY = Math.max(Math.floor(SH * 0.50), handY - actionBtnH - 8);
    const topSafe = Math.max(86, Math.floor(SH * 0.18));
    const availableH = Math.max(108, actionY - topSafe - 6);
    const laneGap = Math.max(5, Math.min(10, Math.floor(SH * 0.012)));
    const laneH = Math.max(34, Math.min(76, Math.floor((availableH - laneGap * 2) / 3)));
    const laneTotalH = laneH * 3 + laneGap * 2;
    const table = this.scene && this.scene._getTableLayout
      ? this.scene._getTableLayout(room && room.phase, handY)
      : { cy: Math.floor(SH * 0.39) };
    const preferredLaneY0 = table.cy - Math.floor(laneTotalH * 0.48);
    const maxLaneY0 = actionY - laneTotalH - 10;
    const laneY0 = Math.max(topSafe, Math.min(preferredLaneY0, maxLaneY0));
    const laneBtnW = Math.max(48, Math.min(58, Math.floor(laneW * 0.20)));
    const laneBtnH = Math.max(20, Math.min(28, Math.floor(laneH * 0.42)));
    const sortW = Math.max(58, Math.min(70, Math.floor(SW * 0.18)));
    const openW = Math.max(76, Math.min(90, Math.floor(SW * 0.23)));
    const labelW = Math.max(48, Math.min(66, Math.floor((laneW - laneBtnW - 14) * 0.28)));
    const cardsAreaW = Math.max(88, laneW - labelW - laneBtnW - 20);
    const laneCardHByHeight = Math.max(28, Math.min(50, laneH - 12));
    const laneCardWByHeight = Math.round(laneCardHByHeight * CARD_WIDTH / CARD_HEIGHT);
    const laneCardWByWidth = Math.floor(cardsAreaW / 3.65);
    const laneCardW = Math.max(24, Math.min(laneCardWByHeight, laneCardWByWidth));
    const laneCardH = Math.round(laneCardW * CARD_HEIGHT / CARD_WIDTH);
    const laneStep = Math.max(10, Math.min(Math.floor(laneCardW * 0.68), Math.floor((cardsAreaW - laneCardW) / 4)));
    return {
      margin, laneX, laneY0, laneW, laneH, laneGap,
      laneBtnW, laneBtnH, sortW, openW, actionY, actionBtnH,
      handY, handCardW, handCardH, patternY, patternBtnH, patternGap,
      laneCardW, laneCardH, laneStep, labelW,
    };
  }

  // 同步动态布局到按钮命中区
  _updateButtonLayout(layout) {
    this.sortRankBtn.x = layout.margin;
    this.sortRankBtn.y = layout.actionY;
    this.sortRankBtn.width = layout.sortW;
    this.sortRankBtn.height = layout.actionBtnH;
    this.sortSuitBtn.x = layout.margin + layout.sortW + 6;
    this.sortSuitBtn.y = layout.actionY;
    this.sortSuitBtn.width = layout.sortW;
    this.sortSuitBtn.height = layout.actionBtnH;
    this.openBtn.x = SCREEN_WIDTH - layout.margin - layout.openW;
    this.openBtn.y = layout.actionY - 4;
    this.openBtn.width = layout.openW;
    this.openBtn.height = layout.actionBtnH + 8;
    const visiblePatterns = this._getVisiblePatternItems();
    const gap = 4;
    const btnW = Math.max(40, Math.min(54, Math.floor((SCREEN_WIDTH - layout.margin * 2 - gap * (visiblePatterns.length - 1)) / visiblePatterns.length)));
    visiblePatterns.forEach((item, i) => {
      item.btn.visible = true;
      item.btn.x = layout.margin + i * (btnW + gap);
      item.btn.y = layout.patternY;
      item.btn.width = btnW;
      item.btn.height = layout.patternBtnH;
      item.btn.fontSize = btnW < 44 ? 10 : 11;
    });
    this.patternBtns.forEach((item) => {
      if (visiblePatterns.indexOf(item) < 0) item.btn.visible = false;
    });
    this.laneActionBtns.forEach((b, i) => {
      const y = layout.laneY0 + i * (layout.laneH + layout.laneGap);
      const btnX = layout.laneX + layout.laneW - layout.laneBtnW - 6;
      const btnY = y + Math.max(2, Math.floor((layout.laneH - layout.laneBtnH * 2 - 4) / 2));
      b.place.x = btnX;
      b.place.y = btnY;
      b.place.width = layout.laneBtnW;
      b.place.height = layout.laneBtnH;
      b.cancel.x = btnX;
      b.cancel.y = btnY + layout.laneBtnH + 4;
      b.cancel.width = layout.laneBtnW;
      b.cancel.height = layout.laneBtnH;
    });
  }

  _getVisiblePatternItems() {
    const room = GameGlobal.databus.room;
    // 五墩按本局实际玩家数（真人 + bot）决定是否展示，与房间 maxPlayers 上限解耦
    const playerCount = room && Array.isArray(room.players) ? room.players.length : 0;
    const showFive = (playerCount || 0) >= 5;
    return this.patternBtns.filter((item) => item.def.key !== 'five' || showFive);
  }

  _refreshPatternButtons() {
    const hand = GameGlobal.databus.myHand;
    this.patternBtns.forEach((item) => {
      if (!item.btn.visible) {
        item.btn.disabled = true;
        this._patternCombos[item.def.key] = [];
        return;
      }
      const combos = findPatternCombos(hand, item.def.key);
      this._patternCombos[item.def.key] = combos;
      item.btn.disabled = combos.length === 0;
    });
  }

  _selectPattern(key) {
    const combos = this._patternCombos[key] || findPatternCombos(GameGlobal.databus.myHand, key);
    if (!combos.length) return;
    const next = this._patternCycle[key] || 0;
    const combo = combos[next % combos.length];
    GameGlobal.databus.selectedCards = combo.indices.slice();
    this._patternCycle[key] = (next + 1) % combos.length;
    this._resetHandSlide();
  }

  _resetPatternCycle() {
    this._patternCycle = {};
  }

  // 进入阶段时刷新排序按钮颜色与按钮状态
  enter() {
    this._validation = null;
    this._applySort();
    this._refreshOpenBtn();
  }

  // 应用排序
  _applySort() {
    const mode = GameGlobal.databus.sortMode;
    this.sortSuitBtn.bgColor = mode === 'suit' ? '#4a90e2' : '#999';
    this.sortRankBtn.bgColor = mode === 'rank' ? '#4a90e2' : '#999';
    const hand = GameGlobal.databus.myHand;
    GameGlobal.databus.myHand = (mode === 'suit') ? sortBySuit(hand) : sortByRank(hand);
    GameGlobal.databus.selectedCards = [];
    this._resetHandSlide();
    this._resetPatternCycle();
  }

  _toggleHandCard(idx) {
    const sel = GameGlobal.databus.selectedCards;
    const pos = sel.indexOf(idx);
    if (pos >= 0) sel.splice(pos, 1);
    else sel.push(idx);
  }

  _resetHandSlide() {
    this._isHandSliding = false;
    this._handSlideVisited.clear();
  }

  _slideToggleHandAt(x, y) {
    const idx = CardGroup.hitTest(this._handHits, x, y);
    if (idx < 0 || this._handSlideVisited.has(idx)) return false;
    this._toggleHandCard(idx);
    this._handSlideVisited.add(idx);
    return true;
  }

  _hitLane(x, y, layout) {
    for (let i = 0; i < LANE_DEFS.length; i++) {
      const laneY = layout.laneY0 + i * (layout.laneH + layout.laneGap);
      if (x >= layout.laneX && x <= layout.laneX + layout.laneW && y >= laneY && y <= laneY + layout.laneH) {
        return LANE_DEFS[i].key;
      }
    }
    return null;
  }

  // 放入选中的牌到指定道
  _placeSelected(laneKey) {
    const db = GameGlobal.databus;
    const def = LANE_DEFS.find((d) => d.key === laneKey);
    const lane = db.myLanes[laneKey];
    if (lane.length > 0) {
      GameGlobal.toast.show('该道已有牌，请先取消');
      return;
    }
    const sel = db.selectedCards;
    if (sel.length !== def.size) {
      GameGlobal.toast.show(`${def.name}需要 ${def.size} 张牌`);
      return;
    }
    // 取出选中牌
    const indices = sel.slice().sort((a, b) => b - a);
    const taken = [];
    indices.forEach((i) => { taken.unshift(db.myHand[i]); });
    // 从手牌移除
    indices.forEach((i) => { db.myHand.splice(i, 1); });
    db.myLanes[laneKey] = sortByRank(taken);
    db.selectedCards = [];
    this._resetHandSlide();
    this._resetPatternCycle();
    // 检查是否两道已放完，自动补第三道
    const placed = LANE_DEFS.filter((d) => db.myLanes[d.key].length > 0);
    if (placed.length === 2 && db.myHand.length > 0) {
      const remain = LANE_DEFS.find((d) => db.myLanes[d.key].length === 0);
      if (remain && db.myHand.length === remain.size) {
        db.myLanes[remain.key] = sortByRank(db.myHand);
        db.myHand = [];
        this._resetPatternCycle();
      }
    }
    this._refreshOpenBtn();
  }

  // 取消该道
  _cancelLane(laneKey) {
    const db = GameGlobal.databus;
    const cards = db.myLanes[laneKey];
    if (!cards || cards.length === 0) return;
    db.myHand = (GameGlobal.databus.sortMode === 'suit')
      ? sortBySuit(db.myHand.concat(cards))
      : sortByRank(db.myHand.concat(cards));
    db.myLanes[laneKey] = [];
    db.selectedCards = [];
    this._resetPatternCycle();
    this._refreshOpenBtn();
  }

  // 三道齐全时刷新校验，并启用/禁用开牌按钮
  _refreshOpenBtn() {
    const { head, middle, tail } = GameGlobal.databus.myLanes;
    if (head.length === 3 && middle.length === 5 && tail.length === 5) {
      const v = validateLanes(head, middle, tail);
      this._validation = v;
      this.openBtn.disabled = !v.ok;
    } else {
      this._validation = null;
      this.openBtn.disabled = true;
    }
  }

  // 提交三道
  _submit() {
    const { head, middle, tail } = GameGlobal.databus.myLanes;
    GameGlobal.socket.send(MSG.SUBMIT_LANES, { head, middle, tail });
  }

  // 渲染
  render(ctx) {
    const SH = SCREEN_HEIGHT;
    const SW = SCREEN_WIDTH;
    const db = GameGlobal.databus;
    const layout = this._getLayout();
    this._updateButtonLayout(layout);
    // 三道放置区（桌子中部自适应布局）
    LANE_DEFS.forEach((def, i) => {
      const y = layout.laneY0 + i * (layout.laneH + layout.laneGap);
      // 背景色：使用实底框提升清晰度，校验后合法为绿、错误为红
      let bg = 'rgba(20,72,44,0.92)';
      let border = 'rgba(255,255,255,0.72)';
      if (this._validation) {
        const valid = this._validation.errors[def.key];
        bg = valid ? 'rgba(38,116,58,0.94)' : 'rgba(126,45,42,0.94)';
        border = valid ? 'rgba(129,199,132,0.9)' : 'rgba(239,154,154,0.9)';
      }
      ctx.fillStyle = bg;
      Card._roundRect(ctx, layout.laneX, y, layout.laneW, layout.laneH, 5);
      ctx.fill();
      ctx.strokeStyle = border;
      ctx.lineWidth = 1;
      Card._roundRect(ctx, layout.laneX + 0.5, y + 0.5, layout.laneW - 1, layout.laneH - 1, 5);
      ctx.stroke();
      // 道名标签
      const laneLabelX = layout.laneX + 6;
      ctx.fillStyle = '#fff';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(`${def.name} (${db.myLanes[def.key].length}/${def.size})`, laneLabelX, y + 4);
      // 渲染道牌
      const cards = db.myLanes[def.key];
      if (cards.length > 0) {
        CardGroup.renderLane(ctx, cards, {
          x: layout.laneX + layout.labelW, y: y + Math.max(5, Math.floor((layout.laneH - layout.laneCardH) / 2)),
          cardW: layout.laneCardW, cardH: layout.laneCardH, step: layout.laneStep,
        });
      }
      // 牌型标签（如果合法）
      if (cards.length === def.size) {
        const ev = evaluate(cards, def.key === 'head');
        ctx.fillStyle = '#ffe082';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(ev.name || '', laneLabelX, y + layout.laneH - 5);
      }
    });
    // 操作按钮
    this.laneActionBtns.forEach((b) => { b.place.render(ctx); b.cancel.render(ctx); });
    this.sortSuitBtn.render(ctx);
    this.sortRankBtn.render(ctx);
    this.openBtn.render(ctx);
    this._refreshPatternButtons();
    this.patternBtns.forEach((item) => item.btn.render(ctx));

    // 手牌区（底部）
    const handW = SW - layout.margin * 2;
    this._handHits = CardGroup.renderHand(ctx, db.myHand, {
      x: layout.margin, y: layout.handY,
      width: handW,
      cardW: layout.handCardW, cardH: layout.handCardH,
      selected: new Set(db.selectedCards),
    });

    // 提示已开牌：放到手牌区，避免与底部玩家积分重叠
    if (this._submitted) {
      ctx.save();
      const text = '已开牌，等待其他玩家...';
      const y = layout.handY + Math.floor(layout.handCardH * 0.5);
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const textW = ctx.measureText(text).width;
      const boxW = Math.min(SW - layout.margin * 2, textW + 28);
      const boxH = 28;
      ctx.fillStyle = 'rgba(20,72,44,0.86)';
      Card._roundRect(ctx, (SW - boxW) / 2, y - boxH / 2, boxW, boxH, 14);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fillText(text, SW / 2, y);
      ctx.restore();
    }
  }

  // 锁定 UI
  lock() {
    this._submitted = true;
    this.openBtn.disabled = true;
  }
  unlock() {
    this._submitted = false;
    this.openBtn.disabled = true;
  }

  // 触摸
  handleTouch(x, y) {
    if (this._submitted) return false;
    this._resetHandSlide();
    const layout = this._getLayout();
    this._updateButtonLayout(layout);
    if (this.sortSuitBtn.handleTouch(x, y)) return true;
    if (this.sortRankBtn.handleTouch(x, y)) return true;
    if (this.openBtn.handleTouch(x, y)) return true;
    this._refreshPatternButtons();
    for (const item of this.patternBtns) {
      if (item.btn.handleTouch(x, y)) return true;
    }
    for (const b of this.laneActionBtns) {
      if (b.place.handleTouch(x, y)) return true;
      if (b.cancel.handleTouch(x, y)) return true;
    }
    // 点击放置区也可放入当前选中的手牌
    const laneKey = this._hitLane(x, y, layout);
    if (laneKey) {
      this._placeSelected(laneKey);
      return true;
    }
    // 手牌点击切换选中
    const idx = CardGroup.hitTest(this._handHits, x, y);
    if (idx >= 0) {
      this._isHandSliding = true;
      this._toggleHandCard(idx);
      this._handSlideVisited.add(idx);
      return true;
    }
    return false;
  }

  handleTouchMove(x, y) {
    if (this._submitted || !this._isHandSliding) return false;
    return this._slideToggleHandAt(x, y);
  }

  handleTouchEnd() {
    this._resetHandSlide();
  }
}
