// 比牌动画与本局统计阶段
// 流程：头道→中道→尾道（依次展示）→打枪信息→本垒打→刷新积分→统计面板
import { SCREEN_WIDTH, SCREEN_HEIGHT, SAFE_TOP, SAFE_BOTTOM } from '../render';
import Button from '../ui/Button';
import CardGroup from '../ui/CardGroup';
import Card from '../ui/Card';
import PlayerSeat from '../ui/PlayerSeat';
import { sortByRank } from '../game/card';
import { MSG } from '../net/protocol';

const STAGE_INTERVAL = 1500; // 每个阶段持续毫秒
const STAGES = ['head', 'middle', 'tail', 'gun', 'home', 'panel'];
const LANE_DEFS = [
  { key: 'head', name: '头道' },
  { key: 'middle', name: '中道' },
  { key: 'tail', name: '尾道' },
];
const HAND_TYPE = {
  THREE: 4,
  FULL: 7,
  FOUR: 8,
  STRAIGHT_FLUSH: 9,
  FIVE: 10,
};

export default class SettlePhase {
  constructor(scene) {
    this.scene = scene;
    this.result = null;        // SETTLE_RESULT
    this.stageIdx = 0;
    this.stageStart = 0;
    this.confirmBtn = new Button({
      x: SCREEN_WIDTH / 2 - 68, y: SCREEN_HEIGHT - SAFE_BOTTOM - 58,
      width: 136, height: 44, text: '确认', fontSize: 20,
      onClick: () => this._confirm(),
    });
    this.panelScrollY = 0;
    this._maxPanelScroll = 0;
    this._panelDragging = false;
    this._panelDragLastY = 0;
    this._panelListRect = null;
    this._playedEffects = {};
  }

  // 设置结算结果（来自服务端）
  setResult(result) {
    this.result = result;
    this.stageIdx = 0;
    this.stageStart = Date.now();
    this._confirmed = false;
    // 重置确认按钮：避免上一局已 disabled 的状态遗留导致本局无法点击
    this.confirmBtn.disabled = false;
    this.confirmBtn.text = '确认';
    this.panelScrollY = 0;
    this._maxPanelScroll = 0;
    this._panelDragging = false;
    this._playedEffects = {};
  }

  // 当前阶段名
  get currentStage() { return STAGES[this.stageIdx]; }

  _hasGunEvents() {
    return (this.result.pairs || []).some((p) => p.gunI || p.gunJ);
  }

  _hasHomerunEvents() {
    return (this.result.homeruns || []).length > 0;
  }

  _shouldSkipStage(stage) {
    if (stage === 'gun') return !this._hasGunEvents();
    if (stage === 'home') return !this._hasHomerunEvents();
    return false;
  }

  _advanceStage() {
    let next = Math.min(this.stageIdx + 1, STAGES.length - 1);
    while (next < STAGES.length - 1 && this._shouldSkipStage(STAGES[next])) {
      next += 1;
    }
    this.stageIdx = next;
    this._playStageEffect(STAGES[this.stageIdx]);
  }

  _playStageEffect(stage) {
    if (this._playedEffects[stage]) return;
    if (stage === 'gun' && GameGlobal.music) {
      GameGlobal.music.playShoot();
      this._playedEffects[stage] = true;
    } else if (stage === 'home' && GameGlobal.music) {
      GameGlobal.music.playExplosion();
      this._playedEffects[stage] = true;
    }
  }

  update() {
    if (!this.result) return;
    if (this.currentStage === 'panel') return; // 面板阶段等待确认
    const now = Date.now();
    if (now - this.stageStart >= STAGE_INTERVAL) {
      this._advanceStage();
      this.stageStart = now;
    }
  }

  // 渲染（只渲染中央比牌信息与统计面板）
  render(ctx) {
    if (!this.result) return;
    const stage = this.currentStage;
    this._playStageEffect(stage);
    const SW = SCREEN_WIDTH, SH = SCREEN_HEIGHT;
    // 中央阶段标题
    ctx.save();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const titleMap = {
      head: '比头道', middle: '比中道', tail: '比尾道',
      gun: '打枪结算', home: '本垒打', panel: '本局结算',
    };
    if (stage !== 'panel') {
      ctx.fillText(titleMap[stage] || '', SW / 2, this._compareTitleY());
    }
    ctx.restore();

    // 渲染各玩家三道（头道/中道/尾道阶段时只显示对应道）
    this._renderLanesPerPlayer(ctx, stage);

    // 打枪信息
    if (stage === 'gun') this._renderGunInfo(ctx);
    // 本垒打信息
    if (stage === 'home') this._renderHomerunInfo(ctx);
    // 统计面板
    if (stage === 'panel') {
      this._renderSettlePanel(ctx);
      this.confirmBtn.render(ctx);
    }
  }

  _compareTitleY() {
    return Math.min(SCREEN_HEIGHT * 0.46, Math.max(SAFE_TOP + 150, SCREEN_HEIGHT * 0.42));
  }

  // 在每位玩家头像旁绘制对应道的牌与本道分数
  _renderLanesPerPlayer(ctx, stage) {
    const seats = this.scene.getSeatPositions();
    const myOpenid = GameGlobal.databus.user.openid;
    const players = this.result.players || [];
    const stageKey = (stage === 'gun' || stage === 'home' || stage === 'panel') ? null : stage;
    if (!stageKey) return;
    players.forEach((rp) => {
      const seat = seats.find((s) => s.openid === rp.openid);
      if (!seat) return;
      const lane = rp.lanes && rp.lanes[stageKey];
      if (!lane) return;
      const sortedLane = sortByRank(lane);
      const seatIndex = seats.findIndex((s) => s.openid === rp.openid);
      const cardSize = this._compareCardSize(seats.length);
      const layout = this._compareLaneLayout(seat, seatIndex, seats.length, sortedLane.length, cardSize);
      CardGroup.renderLane(ctx, sortedLane, {
        x: layout.x, y: layout.y,
        cardW: cardSize.cardW, cardH: cardSize.cardH, step: cardSize.step,
      });
      // 道分数（加大字号）
      const score = (rp.laneScores && rp.laneScores[stageKey]) || 0;
      ctx.fillStyle = score > 0 ? '#81c784' : score < 0 ? '#e57373' : '#ccc';
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${score >= 0 ? '+' : ''}${score}`, seat.x, seat.y + 60);
      // 牌型名（加大字号）
      const ht = rp.handTypes && rp.handTypes[stageKey];
      if (ht) {
        ctx.fillStyle = '#ffe082';
        ctx.font = 'bold 13px sans-serif';
        ctx.fillText(ht.name || '', seat.x, seat.y + 80);
      }
    });
  }

  _compareCardSize(playerCount) {
    if (playerCount >= 5) return { cardW: 24, cardH: 35, step: 13 };
    if (playerCount >= 4) return { cardW: 27, cardH: 39, step: 15 };
    return { cardW: 30, cardH: 43, step: 16 };
  }

  _compareLaneLayout(seat, seatIndex, playerCount, cardCount, cardSize) {
    const { cardW, cardH, step } = cardSize;
    const groupWidth = Math.max(0, cardCount - 1) * step + cardW;
    const margin = 8;
    const size = seat.size || 52;
    const isTop = seat.y < SCREEN_HEIGHT * 0.42;
    const isBottom = seat.y > SCREEN_HEIGHT * 0.56;
    const isLeft = seat.x < SCREEN_WIDTH * 0.36;
    const isRight = seat.x > SCREEN_WIDTH * 0.64;
    let x = seat.x - groupWidth / 2;
    let y = seat.y - cardH / 2;

    if (isTop) {
      y = seat.y - cardH / 2 - 6 + this._compareSideStagger(isLeft, isRight, playerCount);
      if (isLeft) x = seat.x + size / 2 + 4;
      else if (isRight) x = seat.x - size / 2 - 4 - groupWidth;
    } else if (isBottom) {
      const rightX = seat.x + size / 2 + 8;
      const leftX = seat.x - size / 2 - 8 - groupWidth;
      const bottomStagger = this._compareSideStagger(isLeft, isRight, playerCount);
      y = seat.y - cardH / 2 - 2 + bottomStagger;
      if (rightX + groupWidth <= SCREEN_WIDTH - margin) x = rightX;
      else if (leftX >= margin) x = leftX;
      else y = seat.y - size / 2 - cardH - 8 + bottomStagger;
    } else if (isLeft) {
      x = seat.x + size / 2 + 8;
      y = seat.y - cardH / 2 + this._compareSideStagger(isLeft, isRight, playerCount);
    } else if (isRight) {
      x = seat.x - size / 2 - 8 - groupWidth;
      y = seat.y - cardH / 2 + this._compareSideStagger(isLeft, isRight, playerCount);
    }

    x = Math.max(margin, Math.min(SCREEN_WIDTH - margin - groupWidth, x));
    y = Math.max(SAFE_TOP + 52, Math.min(SCREEN_HEIGHT - SAFE_BOTTOM - cardH - 8, y));
    return { x, y };
  }

  _compareSideStagger(isLeft, isRight, playerCount) {
    if (playerCount < 3 || playerCount > 6) return 0;
    if (isLeft) return -12;
    if (isRight) return 12;
    return 0;
  }

  _renderGunInfo(ctx) {
    const seats = this.scene.getSeatPositions();
    const pairs = this.result.pairs || [];
    const players = this.result.players || [];
    const progress = Math.min(1, Math.max(0, (Date.now() - this.stageStart) / STAGE_INTERVAL));
    let shotIndex = 0;
    pairs.forEach((p) => {
      if (!p.gunI && !p.gunJ) return;
      const winnerIdx = p.gunI ? p.i : p.j;
      const loserIdx = p.gunI ? p.j : p.i;
      const winner = players[winnerIdx];
      const loser = players[loserIdx];
      if (!winner || !loser) return;
      const ws = seats.find((s) => s.openid === winner.openid);
      const ls = seats.find((s) => s.openid === loser.openid);
      if (!ws || !ls) return;
      this._renderShot(ctx, ws, ls, progress, shotIndex);
      shotIndex += 1;
    });
  }

  _renderShot(ctx, fromSeat, toSeat, progress, index) {
    const delay = Math.min(index, 4) * 0.08;
    if (progress < delay) return;
    const duration = Math.max(0.38, 0.82 - delay);
    const local = Math.min(1, Math.max(0, (progress - delay) / duration));
    const sx = fromSeat.x;
    const sy = fromSeat.y;
    const ex = toSeat.x;
    const ey = toSeat.y;
    const dx = ex - sx;
    const dy = ey - sy;
    const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    const ux = dx / len;
    const uy = dy / len;
    const startX = sx + ux * 26;
    const startY = sy + uy * 26;
    const endX = ex - ux * 26;
    const endY = ey - uy * 26;
    const bulletX = startX + (endX - startX) * local;
    const bulletY = startY + (endY - startY) * local;

    ctx.save();
    ctx.strokeStyle = 'rgba(255,213,79,0.35)';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(bulletX, bulletY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#ffecb3';
    ctx.beginPath();
    ctx.arc(bulletX, bulletY, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ff9800';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(bulletX - ux * 12, bulletY - uy * 12);
    ctx.lineTo(bulletX + ux * 8, bulletY + uy * 8);
    ctx.stroke();

    ctx.fillStyle = '#ff7043';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('砰!', startX + ux * 18 - uy * 10, startY + uy * 18 + ux * 10);
    if (local > 0.82) {
      const pulse = 1 + Math.sin(local * Math.PI * 8) * 0.25;
      ctx.strokeStyle = 'rgba(255,112,67,0.9)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(endX, endY, 13 * pulse, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  _renderHomerunInfo(ctx) {
    const homeruns = this.result.homeruns || [];
    if (homeruns.length === 0) return;
    ctx.save();
    ctx.fillStyle = '#ff7043';
    ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`本垒打: ${homeruns.length} 次`, SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2);
    ctx.restore();
  }

  _renderSettlePanel(ctx) {
    const players = this.result.players || [];
    const w = Math.min(SCREEN_WIDTH * 0.94, 430);
    const x = (SCREEN_WIDTH - w) / 2;
    const y = Math.max(SAFE_TOP + 10, 20);
    this.confirmBtn.width = 128;
    this.confirmBtn.height = 42;
    this.confirmBtn.fontSize = 19;
    this.confirmBtn.x = SCREEN_WIDTH / 2 - this.confirmBtn.width / 2;
    this.confirmBtn.y = SCREEN_HEIGHT - SAFE_BOTTOM - 52;
    const h = Math.max(260, this.confirmBtn.y - y - 10);
    const headerH = 40;
    const listX = x + 8;
    const listY = y + headerH;
    const listW = w - 16;
    const listH = h - headerH - 6;
    const rowH = this._settleRowHeight(players.length, listH);
    const contentH = rowH * players.length;
    this._maxPanelScroll = Math.max(0, contentH - listH);
    this.panelScrollY = Math.max(0, Math.min(this.panelScrollY, this._maxPanelScroll));
    this._panelListRect = { x: listX, y: listY, w: listW, h: listH };

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    ctx.fillStyle = '#fff';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#333';
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('本局结算', x + w / 2, y + 10);

    ctx.save();
    ctx.beginPath();
    ctx.rect(listX, listY, listW, listH);
    ctx.clip();
    players.forEach((rp, i) => {
      const ry = listY + i * rowH - this.panelScrollY;
      if (ry > listY + listH || ry + rowH < listY) return;
      this._renderSettleRowBackground(ctx, rp, listX, ry, listW, rowH - 6, i);
      this._renderPlayerSettleRow(ctx, rp, listX + 8, ry + 6, listW - 16, rowH - 12);
    });
    ctx.restore();

    if (this._maxPanelScroll > 0) {
      const barH = Math.max(28, listH * listH / contentH);
      const barY = listY + (listH - barH) * (this.panelScrollY / this._maxPanelScroll);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      Card._roundRect(ctx, x + w - 8, barY, 4, barH, 2);
      ctx.fill();
    }
    ctx.restore();
  }

  _settleRowHeight(playerCount, listH) {
    if (playerCount >= 5) return Math.max(104, Math.min(124, Math.floor(listH / 5)));
    if (playerCount >= 3) return 140;
    return 166;
  }

  _renderSettleRowBackground(ctx, rp, x, y, w, h, index) {
    if (!this._isHomerunPlayer(rp)) {
      ctx.fillStyle = index % 2 === 0 ? '#f7f7f7' : '#fff';
      ctx.fillRect(x, y, w, h);
      return;
    }
    const grad = ctx.createLinearGradient(x, y, x + w, y + h);
    grad.addColorStop(0, '#4a1f00');
    grad.addColorStop(0.45, '#ff8f00');
    grad.addColorStop(1, '#ff1744');
    Card._roundRect(ctx, x, y, w, h, 8);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,235,59,0.85)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 4;
    const step = 26;
    for (let sx = x - h; sx < x + w; sx += step) {
      ctx.beginPath();
      ctx.moveTo(sx, y + h);
      ctx.lineTo(sx + h, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  _isHomerunPlayer(rp) {
    return (this.result.homeruns || []).indexOf(rp.openid) >= 0;
  }

  _renderPlayerSettleRow(ctx, rp, x, y, w, h) {
    const name = this._playerName(rp);
    const tags = this._playerTags(rp);
    const isHomerun = this._isHomerunPlayer(rp);
    // 行头部区域（昵称/标签/分数）高度约 22px，头像取 22px 直径
    const avatarSize = 22;
    const avPlayer = this._roomPlayer(rp) || { openid: rp.openid, nickname: name, avatarUrl: '' };
    const av = PlayerSeat.getAvatar(avPlayer);
    av.fallbackText = name || '?';
    av.render(ctx, x, y, avatarSize);
    const nameX = x + avatarSize + 6;

    ctx.fillStyle = isHomerun ? '#fffde7' : '#333';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(this._ellipsis(name, 7), nameX, y + avatarSize / 2);

    let tagX = x + Math.min(120, Math.max(100, w * 0.28));
    const scoreReservedW = 56;
    tags.forEach((tag) => {
      const maxTw = Math.max(40, x + w - scoreReservedW - tagX - 4);
      const tw = Math.min(maxTw, Math.max(40, ctx.measureText(tag.text).width + 18));
      this._renderSettleTag(ctx, tag, tagX, y + 1, tw, 20);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this._ellipsisByWidth(ctx, tag.text, tw - 10), tagX + tw / 2, y + 11);
      tagX += tw + 4;
    });

    // 总分以三道之和为唯一来源，强制与各道展示对齐，避免后端字段不同源时视觉上自相矛盾
    const ls = rp.laneScores || {};
    const totalScore = (ls.head || 0) + (ls.middle || 0) + (ls.tail || 0);
    ctx.fillStyle = isHomerun ? '#fff176' : (totalScore > 0 ? '#388e3c' : totalScore < 0 ? '#d32f2f' : '#333');
    ctx.font = 'bold 17px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${totalScore >= 0 ? '+' : ''}${totalScore}`, x + w, y + avatarSize / 2);

    const laneTop = y + avatarSize + 5;
    const laneGap = Math.max(23, Math.floor((h - avatarSize - 6) / 3));
    LANE_DEFS.forEach((def, laneIdx) => {
      const ly = laneTop + laneIdx * laneGap;
      this._renderLaneSummary(ctx, rp, def, x, ly, w, laneGap);
    });
  }

  // 取房间中完整的 player 对象（包含 avatarUrl/nickname）
  _roomPlayer(rp) {
    const room = GameGlobal.databus.room;
    const list = (room && room.players) || [];
    return list.find((p) => p.openid === rp.openid) || null;
  }

  _renderLaneSummary(ctx, rp, def, x, y, w, laneGap) {
    const cards = sortByRank((rp.lanes && rp.lanes[def.key]) || []);
    const ht = (rp.handTypes && rp.handTypes[def.key]) || {};
    const score = (rp.laneScores && rp.laneScores[def.key]) || 0;
    const isHomerun = this._isHomerunPlayer(rp);
    const centerY = y + Math.min(14, laneGap / 2);
    ctx.fillStyle = isHomerun ? '#fffde7' : '#444';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${def.name}:`, x, centerY);

    const scoreColW = 34;
    const typeGap = 10;
    const rightColW = Math.max(112, Math.min(132, w * 0.34));
    const typeColW = Math.max(58, rightColW - scoreColW - typeGap);
    const cardsStartX = x + 42;
    const cardsAreaW = w - rightColW - 48;
    const maxCardW = laneGap >= 32 ? 25 : 23;
    const cardGap = Math.max(2, Math.min(4, Math.floor(cardsAreaW / 54)));
    const cardW = Math.max(20, Math.min(maxCardW, Math.floor((cardsAreaW - cardGap * 4) / 5)));
    const cardH = Math.round(cardW * 1.25);
    let cx = cardsStartX;
    cards.forEach((card) => {
      Card.renderCorner(ctx, card, cx, y, { width: cardW, height: cardH });
      cx += cardW + cardGap;
    });

    const typeRightX = x + w - scoreColW - typeGap;
    const scoreRightX = x + w;
    const bonus = this._specialBonusForLane(def.key, ht);
    const typeText = bonus > 0 ? `${ht.name || '未知'} +${bonus}` : (ht.name || '未知');
    ctx.fillStyle = isHomerun ? (bonus > 0 ? '#fff176' : '#fff8e1') : (bonus > 0 ? this._specialBonusColor(bonus) : '#555');
    ctx.font = bonus > 0 ? 'bold 12px sans-serif' : '12px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(this._ellipsisByWidth(ctx, typeText, typeColW), typeRightX, centerY);

    ctx.fillStyle = isHomerun ? (score > 0 ? '#dcedc8' : score < 0 ? '#ffcdd2' : '#fffde7') : (score > 0 ? '#388e3c' : score < 0 ? '#d32f2f' : '#666');
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${score >= 0 ? '+' : ''}${score}`, scoreRightX, centerY);
  }

  _specialBonusForLane(laneKey, ht) {
    if (!ht || !ht.type) return 0;
    if (laneKey === 'head' && ht.type === HAND_TYPE.THREE) return 2;
    if (laneKey === 'middle') {
      if (ht.type === HAND_TYPE.FULL) return 1;
      if (ht.type === HAND_TYPE.FOUR) return 3;
      if (ht.type === HAND_TYPE.STRAIGHT_FLUSH) return 4;
      if (ht.type === HAND_TYPE.FIVE) return 9;
    }
    if (laneKey === 'tail') {
      if (ht.type === HAND_TYPE.FOUR) return 3;
      if (ht.type === HAND_TYPE.STRAIGHT_FLUSH) return 4;
      if (ht.type === HAND_TYPE.FIVE) return 9;
    }
    return 0;
  }

  _specialBonusColor(bonus) {
    if (bonus >= 5) return '#d32f2f';
    if (bonus >= 3) return '#ef6c00';
    if (bonus >= 1) return '#1976d2';
    return '#555';
  }

  _renderSettleTag(ctx, tag, x, y, w, h) {
    if (tag.kind !== 'gun') {
      Card._roundRect(ctx, x, y, w, h, 9);
      ctx.fillStyle = tag.color;
      ctx.fill();
      return;
    }
    const grad = ctx.createLinearGradient(x, y, x + w, y);
    grad.addColorStop(0, '#3e2723');
    grad.addColorStop(0.55, '#e65100');
    grad.addColorStop(1, '#ff6d00');
    Card._roundRect(ctx, x, y, w, h, 9);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = '#ffd54f';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 8, y + h - 4);
    ctx.lineTo(x + w - 6, y + 4);
    ctx.stroke();
    ctx.fillStyle = '#ffd54f';
    ctx.beginPath();
    ctx.arc(x + 7, y + h / 2, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _playerName(rp) {
    const room = GameGlobal.databus.room;
    const player = (room && room.players || []).find((p) => p.openid === rp.openid);
    return player ? (player.nickname || rp.openid.slice(-4)) : rp.openid.slice(-4);
  }

  _playerTags(rp) {
    const tags = [];
    const gunTargets = this._gunTargets(rp.openid);
    if (gunTargets.length > 0) tags.push({ text: gunTargets.join(','), color: '#ef6c00', kind: 'gun' });
    return tags;
  }

  _gunTargets(openid) {
    const players = this.result.players || [];
    const targets = [];
    (this.result.pairs || []).forEach((p) => {
      const shooter = p.gunI ? players[p.i] : p.gunJ ? players[p.j] : null;
      const loser = p.gunI ? players[p.j] : p.gunJ ? players[p.i] : null;
      if (shooter && loser && shooter.openid === openid) {
        targets.push(this._playerName(loser));
      }
    });
    return targets;
  }

  _ellipsis(text, maxLen) {
    if (!text || text.length <= maxLen) return text;
    return `${text.slice(0, maxLen - 1)}…`;
  }

  _ellipsisByWidth(ctx, text, maxWidth) {
    if (!text || ctx.measureText(text).width <= maxWidth) return text;
    let out = text;
    while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) {
      out = out.slice(0, -1);
    }
    return `${out}…`;
  }

  _confirm() {
    if (this._confirmed) return;
    this._confirmed = true;
    GameGlobal.socket.send(MSG.ROUND_CONFIRM, {});
    this.confirmBtn.disabled = true;
    this.confirmBtn.text = '等待其他玩家...';
  }

  handleTouch(x, y) {
    if (this.currentStage !== 'panel') return false;
    if (this.confirmBtn.handleTouch(x, y)) return true;
    if (this._isPointInPanelList(x, y)) {
      this._panelDragging = true;
      this._panelDragLastY = y;
      return true;
    }
    return false;
  }

  handleTouchMove(x, y) {
    if (this.currentStage !== 'panel') return false;
    if (!this._panelDragging) return false;
    const dy = y - this._panelDragLastY;
    this._panelDragLastY = y;
    this.panelScrollY = Math.max(0, Math.min(this._maxPanelScroll, this.panelScrollY - dy));
    return true;
  }

  handleTouchEnd() {
    if (!this._panelDragging) return false;
    this._panelDragging = false;
    return true;
  }

  _isPointInPanelList(x, y) {
    const r = this._panelListRect;
    return !!r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  reset() {
    this.result = null;
    this.stageIdx = 0;
    this._confirmed = false;
    this.confirmBtn.disabled = false;
    this.confirmBtn.text = '确认';
    this.panelScrollY = 0;
    this._maxPanelScroll = 0;
    this._panelDragging = false;
    this._playedEffects = {};
  }
}
