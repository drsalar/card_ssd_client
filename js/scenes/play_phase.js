// 对局打牌阶段：发牌、放牌、开牌
// 提供：手牌区渲染、三道放置区渲染、操作按钮、触摸命中
import { SCREEN_WIDTH, SCREEN_HEIGHT } from '../render';
import Button from '../ui/Button';
import Card, { CARD_WIDTH, CARD_HEIGHT } from '../ui/Card';
import CardGroup from '../ui/CardGroup';
import { sortBySuit, sortByRank } from '../game/card';
import { evaluate } from '../game/hand_evaluator';
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
    this._updateButtonLayout(layout);
  }

  // 根据屏幕尺寸计算牌桌安全布局
  _getLayout() {
    const SW = SCREEN_WIDTH;
    const SH = SCREEN_HEIGHT;
    const margin = Math.max(8, Math.floor(SW * 0.025));
    const sideSafe = Math.max(56, Math.min(86, Math.floor(SW * 0.18)));
    const laneW = Math.min(SW - margin * 2, Math.max(200, Math.min(460, SW - sideSafe * 2)));
    const laneX = Math.floor((SW - laneW) / 2);
    const handCardW = Math.max(30, Math.min(CARD_WIDTH, Math.floor(SW / 11.2)));
    const handCardH = Math.round(handCardW * CARD_HEIGHT / CARD_WIDTH);
    const bottomGap = Math.max(28, Math.min(56, Math.floor(SH * 0.07)));
    const handY = Math.max(Math.floor(SH * 0.68), SH - handCardH - bottomGap);
    const actionBtnH = Math.max(24, Math.min(30, Math.floor(SH * 0.045)));
    const actionY = Math.max(Math.floor(SH * 0.53), handY - actionBtnH - 8);
    const topSafe = Math.max(86, Math.floor(SH * 0.18));
    const availableH = Math.max(108, actionY - topSafe - 6);
    const laneGap = Math.max(5, Math.min(10, Math.floor(SH * 0.012)));
    const laneH = Math.max(34, Math.min(76, Math.floor((availableH - laneGap * 2) / 3)));
    const laneTotalH = laneH * 3 + laneGap * 2;
    const laneY0 = topSafe + Math.max(0, Math.floor((availableH - laneTotalH) * 0.76));
    const laneBtnW = Math.max(52, Math.min(64, Math.floor(laneW * 0.22)));
    const laneBtnH = Math.max(20, Math.min(28, Math.floor(laneH * 0.42)));
    const sortW = Math.max(58, Math.min(70, Math.floor(SW * 0.18)));
    const openW = Math.max(76, Math.min(90, Math.floor(SW * 0.23)));
    const laneCardH = Math.max(30, Math.min(54, laneH - 12));
    const laneCardW = Math.round(laneCardH * CARD_WIDTH / CARD_HEIGHT);
    const laneStep = Math.max(13, Math.min(22, Math.floor(laneCardW * 0.72)));
    const labelW = Math.max(58, Math.min(82, Math.floor((laneW - laneBtnW - 16) * 0.34)));
    return {
      margin, laneX, laneY0, laneW, laneH, laneGap,
      laneBtnW, laneBtnH, sortW, openW, actionY, actionBtnH,
      handY, handCardW, handCardH, laneCardW, laneCardH, laneStep, labelW,
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
    // 检查是否两道已放完，自动补第三道
    const placed = LANE_DEFS.filter((d) => db.myLanes[d.key].length > 0);
    if (placed.length === 2 && db.myHand.length > 0) {
      const remain = LANE_DEFS.find((d) => db.myLanes[d.key].length === 0);
      if (remain && db.myHand.length === remain.size) {
        db.myLanes[remain.key] = sortByRank(db.myHand);
        db.myHand = [];
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
      // 背景色：根据校验
      let bg = 'rgba(255,255,255,0.10)';
      if (this._validation) {
        bg = this._validation.errors[def.key] ? 'rgba(76,175,80,0.30)' : 'rgba(244,67,54,0.30)';
      }
      ctx.fillStyle = bg;
      ctx.fillRect(layout.laneX, y, layout.laneW, layout.laneH);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(layout.laneX, y, layout.laneW, layout.laneH);
      // 道名标签
      ctx.fillStyle = '#fff';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(`${def.name} (${db.myLanes[def.key].length}/${def.size})`, layout.laneX + 4, y + 4);
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
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(ev.name || '', layout.laneX + layout.laneW - layout.laneBtnW - 12, y + 4);
      }
    });
    // 操作按钮
    this.laneActionBtns.forEach((b) => { b.place.render(ctx); b.cancel.render(ctx); });
    this.sortSuitBtn.render(ctx);
    this.sortRankBtn.render(ctx);
    this.openBtn.render(ctx);

    // 手牌区（底部）
    const handW = SW - layout.margin * 2;
    this._handHits = CardGroup.renderHand(ctx, db.myHand, {
      x: layout.margin, y: layout.handY,
      width: handW,
      cardW: layout.handCardW, cardH: layout.handCardH,
      selected: new Set(db.selectedCards),
    });

    // 提示已开牌
    if (this._submitted) {
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('已开牌，等待其他玩家...', SW / 2, Math.max(layout.actionY - 24, layout.laneY0 - 18));
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
