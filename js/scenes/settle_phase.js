// 比牌动画与本局统计阶段
// 流程：头道→中道→尾道（依次展示）→打枪信息→本垒打→刷新积分→统计面板
import { SCREEN_WIDTH, SCREEN_HEIGHT } from '../render';
import Button from '../ui/Button';
import CardGroup from '../ui/CardGroup';
import Card from '../ui/Card';
import { sortByRank } from '../game/card';
import { MSG } from '../net/protocol';

const STAGE_INTERVAL = 1500; // 每个阶段持续毫秒
const STAGES = ['head', 'middle', 'tail', 'gun', 'home', 'panel'];
const LANE_DEFS = [
  { key: 'head', name: '头道' },
  { key: 'middle', name: '中道' },
  { key: 'tail', name: '尾道' },
];

export default class SettlePhase {
  constructor(scene) {
    this.scene = scene;
    this.result = null;        // SETTLE_RESULT
    this.stageIdx = 0;
    this.stageStart = 0;
    this.confirmBtn = new Button({
      x: SCREEN_WIDTH / 2 - 60, y: SCREEN_HEIGHT - 80,
      width: 120, height: 40, text: '确认',
      onClick: () => this._confirm(),
    });
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
      ctx.fillText(titleMap[stage] || '', SW / 2, SH * 0.35);
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
      // 在座位旁绘制牌（朝向中心）
      const dirX = (SCREEN_WIDTH / 2 - seat.x);
      const sign = dirX >= 0 ? 1 : -1;
      const cx = seat.x + sign * 40;
      const cy = seat.y - 30;
      CardGroup.renderLane(ctx, sortedLane, {
        x: cx - (sortedLane.length * 12), y: cy,
        cardW: 22, cardH: 32, step: 12,
      });
      // 道分数
      const score = (rp.laneScores && rp.laneScores[stageKey]) || 0;
      ctx.fillStyle = score > 0 ? '#81c784' : score < 0 ? '#e57373' : '#ccc';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${score >= 0 ? '+' : ''}${score}`, seat.x, seat.y + 60);
      // 牌型名
      const ht = rp.handTypes && rp.handTypes[stageKey];
      if (ht) {
        ctx.fillStyle = '#ffe082';
        ctx.font = '11px sans-serif';
        ctx.fillText(ht.name || '', seat.x, seat.y + 76);
      }
    });
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
    const w = Math.min(SCREEN_WIDTH * 0.96, 430);
    const h = Math.min(SCREEN_HEIGHT - 120, SCREEN_HEIGHT * 0.82);
    const x = (SCREEN_WIDTH - w) / 2;
    const y = Math.max(36, (SCREEN_HEIGHT - h) / 2 - 18);
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    ctx.fillStyle = '#fff';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#333';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('本局结算', x + w / 2, y + 10);

    const players = this.result.players || [];
    const rowH = Math.max(84, Math.floor((h - 52) / Math.max(players.length, 1)));
    players.forEach((rp, i) => {
      const ry = y + 42 + i * rowH;
      ctx.fillStyle = i % 2 === 0 ? '#f7f7f7' : '#fff';
      ctx.fillRect(x + 6, ry - 2, w - 12, rowH - 4);
      this._renderPlayerSettleRow(ctx, rp, x + 12, ry, w - 24, rowH - 6);
    });
    ctx.restore();
  }

  _renderPlayerSettleRow(ctx, rp, x, y, w, h) {
    const name = this._playerName(rp);
    const tags = this._playerTags(rp);
    ctx.fillStyle = '#333';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(this._ellipsis(name, 8), x, y + 2);

    let tagX = x + 66;
    tags.forEach((tag) => {
      const tw = Math.max(34, tag.text.length * 12 + 10);
      Card._roundRect(ctx, tagX, y, tw, 17, 8);
      ctx.fillStyle = tag.color;
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(tag.text, tagX + tw / 2, y + 8.5);
      tagX += tw + 4;
    });

    ctx.fillStyle = rp.finalScore > 0 ? '#388e3c' : rp.finalScore < 0 ? '#d32f2f' : '#333';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(`${rp.finalScore >= 0 ? '+' : ''}${rp.finalScore}`, x + w, y + 2);

    const laneTop = y + 24;
    const laneGap = Math.max(18, Math.floor((h - 28) / 3));
    LANE_DEFS.forEach((def, laneIdx) => {
      const ly = laneTop + laneIdx * laneGap;
      this._renderLaneSummary(ctx, rp, def, x, ly, w);
    });
  }

  _renderLaneSummary(ctx, rp, def, x, y, w) {
    const cards = sortByRank((rp.lanes && rp.lanes[def.key]) || []);
    const ht = (rp.handTypes && rp.handTypes[def.key]) || {};
    const score = (rp.laneScores && rp.laneScores[def.key]) || 0;
    ctx.fillStyle = '#555';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${def.name}:`, x, y + 12);

    const cardW = Math.max(18, Math.min(24, Math.floor((w - 122) / 5)));
    const cardH = Math.max(24, Math.min(30, Math.floor(cardW * 1.28)));
    const cardGap = 3;
    let cx = x + 38;
    cards.forEach((card) => {
      Card.renderCorner(ctx, card, cx, y, { width: cardW, height: cardH });
      cx += cardW + cardGap;
    });

    ctx.fillStyle = '#666';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(this._ellipsis(ht.name || '未知', 6), x + w - 76, y + 12);

    ctx.fillStyle = score > 0 ? '#388e3c' : score < 0 ? '#d32f2f' : '#666';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${score >= 0 ? '+' : ''}${score}`, x + w, y + 12);
  }

  _playerName(rp) {
    const room = GameGlobal.databus.room;
    const player = (room && room.players || []).find((p) => p.openid === rp.openid);
    return player ? (player.nickname || rp.openid.slice(-4)) : rp.openid.slice(-4);
  }

  _playerTags(rp) {
    const tags = [];
    const gunCount = this._gunCount(rp.openid);
    if (gunCount > 0) tags.push({ text: `打枪×${gunCount}`, color: '#ef6c00' });
    if ((this.result.homeruns || []).indexOf(rp.openid) >= 0) tags.push({ text: '全垒打', color: '#d84315' });
    if (rp.hasMa) tags.push({ text: '马牌', color: '#ff9800' });
    return tags;
  }

  _gunCount(openid) {
    const players = this.result.players || [];
    return (this.result.pairs || []).reduce((count, p) => {
      const shooter = p.gunI ? players[p.i] : p.gunJ ? players[p.j] : null;
      return shooter && shooter.openid === openid ? count + 1 : count;
    }, 0);
  }

  _ellipsis(text, maxLen) {
    if (!text || text.length <= maxLen) return text;
    return `${text.slice(0, maxLen - 1)}…`;
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
    return false;
  }

  reset() {
    this.result = null;
    this.stageIdx = 0;
    this._confirmed = false;
    this.confirmBtn.disabled = false;
    this.confirmBtn.text = '确认';
  }
}
