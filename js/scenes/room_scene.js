// 对局/房间场景 - 圆环牌桌、座位、准备/退出按钮、阶段调度
import { SCREEN_WIDTH, SCREEN_HEIGHT } from '../render';
import Button from '../ui/Button';
import PlayerSeat from '../ui/PlayerSeat';
import PlayPhase from './play_phase';
import SettlePhase from './settle_phase';
import { MSG } from '../net/protocol';
import eventBus from '../utils/event_bus';
import { SCENES } from '../databus';

// 与服务端 PHASE 保持一致
const PHASE = {
  WAITING: 'waiting',
  PLAYING: 'playing',
  COMPARING: 'comparing',
  MATCH_END: 'match_end',
};

export default class RoomScene {
  constructor() {
    this.playPhase = new PlayPhase(this);
    this.settlePhase = new SettlePhase(this);

    // 顶部按钮
    this.exitBtn = new Button({
      x: SCREEN_WIDTH - 60, y: 10, width: 50, height: 28, text: '退出', fontSize: 12,
      bgColor: '#e57373',
      onClick: () => this._confirmExit(),
    });
    // 准备 / 取消准备 按钮（中央底部）
    this.readyBtn = new Button({
      x: SCREEN_WIDTH / 2 - 60, y: SCREEN_HEIGHT - 60,
      width: 120, height: 40, text: '准备', fontSize: 18,
      bgColor: '#5cb85c',
      onClick: () => this._toggleReady(),
    });
    // 添加电脑玩家按钮（仅房主可见）
    this.addBotBtn = new Button({
      x: SCREEN_WIDTH / 2 + 70, y: SCREEN_HEIGHT - 60,
      width: 90, height: 40, text: '+ 电脑', fontSize: 14,
      bgColor: '#ff8a00',
      onClick: () => this._addBot(),
    });
    // 踢出电脑玩家确认弹窗状态
    this._kickBotTarget = null; // { openid, nickname }
    this._exitConfirmVisible = false;
    this._matchEndVisible = false;
    this._matchEndRanks = null;

    this._bindNet();
  }

  _bindNet() {
    eventBus.on(MSG.DEAL_CARDS, (data) => {
      const hand = data.hand || [];
      GameGlobal.databus.myHand = hand.slice();
      GameGlobal.databus.myLanes = { head: [], middle: [], tail: [] };
      GameGlobal.databus.selectedCards = [];
      this.playPhase.unlock();
      this.playPhase.enter();
    });
    // 断线重连快照：恢复手牌、三道、结算与阶段子状态
    eventBus.on(MSG.RECONNECT_SNAPSHOT, (snap) => {
      this._applyReconnectSnapshot(snap);
    });
    eventBus.on(MSG.SUBMIT_LANES_OK, () => {
      this.playPhase.lock();
    });
    eventBus.on(MSG.SETTLE_RESULT, (data) => {
      this.settlePhase.setResult(data);
      // 同时更新本地 room.players 中的 score（即时显示）
      if (GameGlobal.databus.room && Array.isArray(data.scores)) {
        const map = {};
        data.scores.forEach((s) => { map[s.openid] = s.score; });
        GameGlobal.databus.room.players.forEach((p) => {
          if (map[p.openid] !== undefined) p.score = map[p.openid];
        });
      }
    });
    eventBus.on(MSG.MATCH_END, (data) => {
      this._matchEndRanks = data.ranks || [];
      this._matchEndVisible = true;
    });
    eventBus.on(MSG.LEAVE_ROOM_OK, () => {
      GameGlobal.databus.clearRoomId && GameGlobal.databus.clearRoomId();
      this._returnToLobby();
    });
    // 业务层重连失败：socket_client 检测到 ROOM_NOT_FOUND 时会清空 databus.room 并触发该事件
    eventBus.on('roomLost', () => {
      if (GameGlobal.databus.scene === SCENES.ROOM) {
        GameGlobal.toast.show('房间已结束');
        this._returnToLobby();
      }
    });
    eventBus.on(MSG.ROOM_STATE, (state) => {
      // 状态变化时若进入 WAITING（下一局开始），重置阶段
      const prev = GameGlobal.databus.room;
      GameGlobal.databus.room = state;
      // 持久化最近房间号
      const me = state.players && state.players.find((p) => p.openid === GameGlobal.databus.user.openid);
      if (me) GameGlobal.databus.persistRoomId(state.id);
      if (prev && prev.phase !== PHASE.WAITING && state.phase === PHASE.WAITING) {
        this.settlePhase.reset();
        this.playPhase.unlock();
        GameGlobal.databus.resetRound();
      }
    });
  }

  // 应用重连快照：根据 phase 还原各子阶段
  _applyReconnectSnapshot(snap) {
    if (!snap) return;
    GameGlobal.databus.applyReconnectSnapshot(snap);
    // 若不在房间场景（例如还在大厅过渡），ROOM_STATE 紧接着到达会切到 ROOM
    // 这里只负责子阶段还原
    if (snap.phase === PHASE.PLAYING) {
      if (snap.submitted) {
        // 已提交 → 锁定，等待其他玩家开牌
        this.playPhase.lock();
      } else {
        // 未提交 → 进入摆牌界面
        this.playPhase.unlock();
        this.playPhase.enter();
      }
    } else if (snap.phase === PHASE.COMPARING) {
      // 比牌阶段 → 直接显示比牌结果
      if (snap.lastSettle) this.settlePhase.setResult(snap.lastSettle);
    } else if (snap.phase === PHASE.MATCH_END) {
      // 整场结束 → 显示总积分排行（来自 lastSettle.scores）
      const room = GameGlobal.databus.room;
      if (room && Array.isArray(room.players)) {
        this._matchEndRanks = room.players
          .map((p) => ({ openid: p.openid, nickname: p.nickname, score: p.score }))
          .sort((a, b) => b.score - a.score);
        this._matchEndVisible = true;
      }
    }
  }

  _returnToLobby() {
    GameGlobal.databus.room = null;
    GameGlobal.databus.resetRound();
    this.settlePhase.reset();
    this.playPhase.unlock();
    this._matchEndVisible = false;
    this._matchEndRanks = null;
    // 主动断开 WebSocket：大厅不需长连接
    if (GameGlobal.socket && typeof GameGlobal.socket.close === 'function') {
      GameGlobal.socket.close();
    }
    GameGlobal.databus.netStatus = 'disconnected';
    GameGlobal.sceneManager.switchTo(SCENES.LOBBY);
  }

  _toggleReady() {
    const room = GameGlobal.databus.room;
    if (!room) return;
    const me = room.players.find((p) => p.openid === GameGlobal.databus.user.openid);
    if (!me) return;
    if (me.ready) GameGlobal.socket.send(MSG.UNREADY, {});
    else GameGlobal.socket.send(MSG.READY, {});
  }

  // 房主点击“+ 电脑”：发送 ROOM_ADD_BOT
  _addBot() {
    const room = GameGlobal.databus.room;
    if (!room) return;
    if (room.hostId !== GameGlobal.databus.user.openid) return;
    if (room.phase !== PHASE.WAITING) return;
    if (room.players.length >= room.rule.maxPlayers) {
      if (GameGlobal.toast) GameGlobal.toast.show('房间人数已满');
      return;
    }
    GameGlobal.socket.send(MSG.ROOM_ADD_BOT, {});
  }

  // 房主点击 bot 座位：展示踢出确认
  _onSeatTouch(seat) {
    const room = GameGlobal.databus.room;
    if (!room) return false;
    if (room.phase !== PHASE.WAITING) return false;
    if (room.hostId !== GameGlobal.databus.user.openid) return false;
    if (!seat.player.isBot) return false;
    this._kickBotTarget = { openid: seat.player.openid, nickname: seat.player.nickname };
    return true;
  }

  _confirmExit() {
    this._exitConfirmVisible = true;
  }

  // 计算每个座位坐标 - 圆环布局，自己始终在底部
  getSeatPositions() {
    const room = GameGlobal.databus.room;
    if (!room) return [];
    const players = room.players;
    const myOpenid = GameGlobal.databus.user.openid;
    const myIdx = players.findIndex((p) => p.openid === myOpenid);
    const n = players.length;
    const playing = room.phase === PHASE.PLAYING;
    const table = this._getTableLayout(room.phase);
    const seatSize = playing
      ? Math.max(36, Math.min(48, Math.floor(Math.min(SCREEN_WIDTH, SCREEN_HEIGHT) * 0.12)))
      : 48;
    const minSideGap = Math.max(32, Math.min(50, SCREEN_WIDTH * 0.085));
    const topY = playing ? Math.max(34, Math.min(58, SCREEN_HEIGHT * 0.14)) : Math.max(44, SCREEN_HEIGHT * 0.12);
    const bottomLimit = playing ? SCREEN_HEIGHT * 0.67 : SCREEN_HEIGHT - 96;
    const radiusX = Math.max(110, Math.min(table.rx * 0.98, SCREEN_WIDTH / 2 - minSideGap));
    const radiusY = Math.max(66, Math.min(table.ry * 0.84, table.cy - topY, bottomLimit - table.cy));
    const seats = [];
    for (let i = 0; i < n; i++) {
      // 自己位于 angle = π/2（屏幕底部）
      const offset = (i - (myIdx >= 0 ? myIdx : 0));
      const angle = Math.PI / 2 + (offset * 2 * Math.PI / n);
      let x = table.cx + radiusX * Math.cos(angle);
      let y = table.cy + radiusY * Math.sin(angle);
      x = Math.max(minSideGap, Math.min(SCREEN_WIDTH - minSideGap, x));
      y = Math.max(topY, Math.min(bottomLimit, y));
      seats.push({ openid: players[i].openid, player: players[i], x, y, size: seatSize });
    }
    return seats;
  }

  _getTableLayout(phase) {
    const playing = phase === PHASE.PLAYING;
    const rx = Math.min(SCREEN_WIDTH * 0.48, SCREEN_WIDTH / 2 - 8);
    const ryBase = playing ? SCREEN_HEIGHT * 0.31 : SCREEN_HEIGHT * 0.24;
    const ry = Math.max(110, Math.min(ryBase, SCREEN_HEIGHT * 0.34));
    const cy = playing ? SCREEN_HEIGHT * 0.39 : SCREEN_HEIGHT * 0.4;
    return { cx: SCREEN_WIDTH / 2, cy, rx, ry };
  }

  onEnter() {}
  onExit() {}

  update() {
    this.settlePhase.update();
  }

  render(ctx) {
    const room = GameGlobal.databus.room;
    // 背景
    ctx.fillStyle = '#0d3b1f';
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    // 牌桌椭圆
    ctx.save();
    ctx.fillStyle = '#1f6e3c';
    ctx.beginPath();
    const table = this._getTableLayout(room && room.phase);
    ctx.ellipse(table.cx, table.cy, table.rx, table.ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = Math.max(3, Math.floor(Math.min(SCREEN_WIDTH, SCREEN_HEIGHT) * 0.01));
    ctx.stroke();
    ctx.restore();
    if (!room) return;

    // 顶部信息
    ctx.save();
    ctx.fillStyle = '#fff';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`房间 ${room.id}`, 12, 12);
    // 当前局序号：已完成 currentRound 局，正在进行的为 currentRound+1（封顶 totalRounds）
    const cur = Math.min(room.currentRound + 1, room.rule.totalRounds);
    ctx.fillText(`第 ${cur}/${room.rule.totalRounds} 局`, 12, 32);
    if (room.rule.withMa) {
      ctx.fillText('马牌：开', 12, 52);
    }
    ctx.restore();
    this.exitBtn.render(ctx);

    // 座位
    const myOpenid = GameGlobal.databus.user.openid;
    const seats = this.getSeatPositions();
    seats.forEach((seat) => {
      PlayerSeat.render(ctx, seat.player, seat.x, seat.y, {
        isHost: seat.openid === room.hostId,
        isMe: seat.openid === myOpenid,
        phase: room.phase,
        size: seat.size,
      });
    });

    // 阶段渲染
    if (room.phase === PHASE.WAITING || room.phase === PHASE.MATCH_END) {
      this._renderReadyButton(ctx);
      this._renderAddBotButton(ctx);
    } else if (room.phase === PHASE.PLAYING) {
      this.playPhase.render(ctx);
    } else if (room.phase === PHASE.COMPARING) {
      this.settlePhase.render(ctx);
    }

    // 踢出电脑玩家确认弹窗
    if (this._kickBotTarget) this._renderKickBotConfirm(ctx);
    // 退出确认弹窗
    if (this._exitConfirmVisible) this._renderExitConfirm(ctx);
    // 整场结束面板
    if (this._matchEndVisible) this._renderMatchEnd(ctx);
  }

  _renderReadyButton(ctx) {
    const room = GameGlobal.databus.room;
    const me = room.players.find((p) => p.openid === GameGlobal.databus.user.openid);
    if (!me) return;
    if (room.phase === PHASE.MATCH_END) {
      // 整场结束阶段不显示准备按钮
      return;
    }
    this.readyBtn.text = me.ready ? '取消准备' : '准备';
    this.readyBtn.bgColor = me.ready ? '#999' : '#5cb85c';
    this.readyBtn.render(ctx);
  }

  // 仅房主、准备阶段、且房间未满时可点
  _renderAddBotButton(ctx) {
    const room = GameGlobal.databus.room;
    if (!room) return;
    if (room.hostId !== GameGlobal.databus.user.openid) return;
    if (room.phase !== PHASE.WAITING) return;
    const full = room.players.length >= room.rule.maxPlayers;
    this.addBotBtn.bgColor = full ? '#bbb' : '#ff8a00';
    this.addBotBtn.render(ctx);
  }

  // 踢出电脑玩家确认弹窗
  _renderKickBotConfirm(ctx) {
    if (!this._kickBotTarget) return;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    const w = 260, h = 140;
    const x = (SCREEN_WIDTH - w) / 2, y = (SCREEN_HEIGHT - h) / 2;
    ctx.fillStyle = '#fff';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#333';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('踢出电脑玩家？', x + w / 2, y + 24);
    ctx.font = '13px sans-serif';
    ctx.fillStyle = '#666';
    ctx.fillText(this._kickBotTarget.nickname || '电脑', x + w / 2, y + 52);
    ctx.restore();
    if (!this._kickYes) {
      this._kickYes = new Button({
        x: x + w / 2 + 10, y: y + h - 50,
        width: 90, height: 34, text: '踢出', bgColor: '#e57373',
        onClick: () => {
          if (this._kickBotTarget) {
            GameGlobal.socket.send(MSG.ROOM_KICK_BOT, { openid: this._kickBotTarget.openid });
          }
          this._kickBotTarget = null;
        },
      });
      this._kickNo = new Button({
        x: x + w / 2 - 100, y: y + h - 50,
        width: 90, height: 34, text: '取消', bgColor: '#999',
        onClick: () => { this._kickBotTarget = null; },
      });
    }
    this._kickYes.render(ctx);
    this._kickNo.render(ctx);
  }

  _renderExitConfirm(ctx) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    const w = 260, h = 140;
    const x = (SCREEN_WIDTH - w) / 2, y = (SCREEN_HEIGHT - h) / 2;
    ctx.fillStyle = '#fff';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#333';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('确认退出房间？', x + w / 2, y + 24);
    ctx.font = '13px sans-serif';
    ctx.fillStyle = '#666';
    ctx.fillText('对局中退出将视为掉线', x + w / 2, y + 52);
    ctx.restore();
    if (!this._exitYes) {
      this._exitYes = new Button({
        x: x + w / 2 + 10, y: y + h - 50,
        width: 90, height: 34, text: '确认', bgColor: '#e57373',
        onClick: () => {
          this._exitConfirmVisible = false;
          GameGlobal.socket.send(MSG.LEAVE_ROOM, {});
        },
      });
      this._exitNo = new Button({
        x: x + w / 2 - 100, y: y + h - 50,
        width: 90, height: 34, text: '取消', bgColor: '#999',
        onClick: () => { this._exitConfirmVisible = false; },
      });
    }
    this._exitYes.render(ctx);
    this._exitNo.render(ctx);
  }

  _renderMatchEnd(ctx) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    const w = Math.min(SCREEN_WIDTH * 0.85, 320);
    const h = SCREEN_HEIGHT * 0.55;
    const x = (SCREEN_WIDTH - w) / 2;
    const y = (SCREEN_HEIGHT - h) / 2;
    ctx.fillStyle = '#fff';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#333';
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('总积分排行', x + w / 2, y + 16);
    const ranks = this._matchEndRanks || [];
    ranks.forEach((r, i) => {
      const ry = y + 60 + i * 32;
      ctx.font = (i === 0 ? 'bold ' : '') + '15px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillStyle = i === 0 ? '#e6a23c' : '#333';
      ctx.fillText(`${i + 1}. ${r.nickname || r.openid.slice(-4)}`, x + 24, ry);
      ctx.textAlign = 'right';
      ctx.fillStyle = r.score >= 0 ? '#388e3c' : '#d32f2f';
      ctx.fillText(`${r.score >= 0 ? '+' : ''}${r.score}`, x + w - 24, ry);
    });
    ctx.restore();
    if (!this._matchExitBtn) {
      this._matchExitBtn = new Button({
        x: x + (w - 120) / 2, y: y + h - 50,
        width: 120, height: 36, text: '返回大厅',
        onClick: () => { GameGlobal.socket.send(MSG.LEAVE_ROOM, {}); },
      });
    }
    this._matchExitBtn.render(ctx);
  }

  // 触摸分发
  onTouchStart(e) {
    const t = e.touches[0] || e.changedTouches[0];
    if (!t) return;
    const x = t.clientX, y = t.clientY;
    // 全局弹窗优先
    if (this._matchEndVisible) {
      if (this._matchExitBtn && this._matchExitBtn.handleTouch(x, y)) return;
      return;
    }
    if (this._kickBotTarget) {
      if (this._kickYes && this._kickYes.handleTouch(x, y)) return;
      if (this._kickNo && this._kickNo.handleTouch(x, y)) return;
      return;
    }
    if (this._exitConfirmVisible) {
      if (this._exitYes && this._exitYes.handleTouch(x, y)) return;
      if (this._exitNo && this._exitNo.handleTouch(x, y)) return;
      return;
    }
    if (this.exitBtn.handleTouch(x, y)) return;
    const room = GameGlobal.databus.room;
    if (!room) return;
    if (room.phase === PHASE.WAITING) {
      // 房主可点 “+ 电脑”按钮与 bot 座位踢出
      if (room.hostId === GameGlobal.databus.user.openid) {
        if (room.players.length < room.rule.maxPlayers && this.addBotBtn.handleTouch(x, y)) return;
        // 点击到 bot 座位：调起踢出弹窗
        const seats = this.getSeatPositions();
        for (const seat of seats) {
          if (!seat.player.isBot) continue;
          const r2 = Math.max(28, seat.size ? seat.size * 0.75 : 36); // 安全点击半径
          if ((x - seat.x) * (x - seat.x) + (y - seat.y) * (y - seat.y) <= r2 * r2) {
            if (this._onSeatTouch(seat)) return;
          }
        }
      }
      if (this.readyBtn.handleTouch(x, y)) return;
    } else if (room.phase === PHASE.PLAYING) {
      if (this.playPhase.handleTouch(x, y)) return;
    } else if (room.phase === PHASE.COMPARING) {
      if (this.settlePhase.handleTouch(x, y)) return;
    }
  }

  onTouchMove(e) {
    const room = GameGlobal.databus.room;
    if (!room || room.phase !== PHASE.PLAYING) return;
    const t = e.touches[0] || e.changedTouches[0];
    if (!t) return;
    this.playPhase.handleTouchMove(t.clientX, t.clientY);
  }

  onTouchEnd() {
    const room = GameGlobal.databus.room;
    if (room && room.phase === PHASE.PLAYING) {
      this.playPhase.handleTouchEnd();
    }
  }
}
