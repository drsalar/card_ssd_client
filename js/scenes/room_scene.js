// 对局/房间场景 - 圆环牌桌、座位、准备/退出按钮、阶段调度
import { SCREEN_WIDTH, SCREEN_HEIGHT, SAFE_TOP, SAFE_BOTTOM, SAFE_LEFT, MENU_BUTTON_RECT } from '../render';
import Button from '../ui/Button';
import BgmToggleButton from '../ui/BgmToggleButton';
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

const TABLE_HAND_GAP = 34;

export default class RoomScene {
  constructor() {
    this.playPhase = new PlayPhase(this);
    this.settlePhase = new SettlePhase(this);

    // 右上角按钮组（按阶段动态显示）：
    // - waiting:        退出（红） + 返回（灰）
    // - playing/comparing: 解散（橙） + 返回（灰）
    // - match_end:      仅退出（红）
    // 「退出」发送 LEAVE_ROOM 让出座位；「返回」仅断开 WS 保留座位。
    this.quitBtn = new Button({
      x: SCREEN_WIDTH - 70, y: Math.max(12, SAFE_TOP + 8), width: 58, height: 32, text: '退出', fontSize: 14,
      bgColor: '#e57373',
      onClick: () => this._confirmQuit(),
    });
    this.backBtn = new Button({
      x: SCREEN_WIDTH - 132, y: Math.max(12, SAFE_TOP + 8), width: 58, height: 32, text: '返回', fontSize: 14,
      bgColor: '#909090',
      onClick: () => this._confirmBack(),
    });
    // 发起解散对局按钮（playing/comparing 阶段对真人可见）
    this.dissolveBtn = new Button({
      x: SCREEN_WIDTH - 132, y: Math.max(12, SAFE_TOP + 8), width: 58, height: 32, text: '解散', fontSize: 14,
      bgColor: '#ff8a00',
      onClick: () => this._toggleDissolveVote(),
    });
    // 准备 / 取消准备 按钮（中央底部）
    this.readyBtn = new Button({
      x: SCREEN_WIDTH / 2 - 70, y: SCREEN_HEIGHT - SAFE_BOTTOM - 70,
      width: 140, height: 46, text: '准备', fontSize: 22,
      bgColor: '#5cb85c',
      onClick: () => this._toggleReady(),
    });
    // 添加电脑玩家按钮（仅房主可见）
    this.addBotBtn = new Button({
      x: SCREEN_WIDTH / 2 + 82, y: SCREEN_HEIGHT - SAFE_BOTTOM - 70,
      width: 102, height: 46, text: '+ 电脑', fontSize: 16,
      bgColor: '#ff8a00',
      onClick: () => this._addBot(),
    });
    this.bgmToggleBtn = new BgmToggleButton({ width: 72, height: 28, fontSize: 13 });
    // 踢出（电脑/真人）玩家确认弹窗状态
    // { openid, nickname, isBot }；isBot=true 时复用 ROOM_KICK_BOT，否则发 ROOM_KICK_PLAYER
    this._kickTarget = null;
    this._quitConfirmVisible = false;  // 「退出」二次确认（发 LEAVE_ROOM）
    this._backConfirmVisible = false;  // 「返回」二次确认（仅断开 WS）
    this._matchEndVisible = false;
    this._matchEndRanks = null;
    this._dissolveConfirmVisible = false;
    this._earlyEnd = false;

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
      this._earlyEnd = !!data.earlyEnd;
    });
    // 投票解散超时：服务端广播提示
    eventBus.on(MSG.VOTE_DISSOLVE_TIMEOUT, () => {
      if (GameGlobal.toast) GameGlobal.toast.show('解散投票已超时');
    });
    eventBus.on(MSG.LEAVE_ROOM_OK, () => {
      GameGlobal.databus.clearRoomId && GameGlobal.databus.clearRoomId();
      this._returnToLobby();
    });
    // 被房主踢出：弹 Toast、清房间态、切回大厅
    eventBus.on(MSG.ROOM_KICKED, () => {
      if (GameGlobal.toast) GameGlobal.toast.show('已被房主请出房间');
      GameGlobal.databus.clearRoomId && GameGlobal.databus.clearRoomId();
      this._returnToLobby();
    });
    // 房主成功踢出真人后服务端会广播新的 ROOM_STATE，自动关闭确认弹窗
    eventBus.on(MSG.ROOM_KICK_PLAYER_OK, () => {
      this._kickTarget = null;
    });
    eventBus.on(MSG.ROOM_KICK_BOT_OK, () => {
      this._kickTarget = null;
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

  // 房主点击其他玩家座位：展示踢出确认
  // - 仅房主可触发；阶段需为 waiting 或 match_end；目标不可为自己
  // - 电脑：发 ROOM_KICK_BOT；真人：发 ROOM_KICK_PLAYER
  _onSeatTouch(seat) {
    const room = GameGlobal.databus.room;
    if (!room) return false;
    if (room.phase !== PHASE.WAITING && room.phase !== PHASE.MATCH_END) return false;
    if (room.hostId !== GameGlobal.databus.user.openid) return false;
    if (seat.player.openid === GameGlobal.databus.user.openid) return false;
    this._kickTarget = {
      openid: seat.player.openid,
      nickname: seat.player.nickname,
      isBot: !!seat.player.isBot,
    };
    return true;
  }

  _confirmQuit() {
    this._quitConfirmVisible = true;
  }

  _confirmBack() {
    this._backConfirmVisible = true;
  }

  // 点击“解散”按钮：如未投 → 弹窗确认 → 发送 VOTE_DISSOLVE；如已投 → 直接发送 VOTE_DISSOLVE_CANCEL
  _toggleDissolveVote() {
    const room = GameGlobal.databus.room;
    if (!room) return;
    if (room.phase !== PHASE.PLAYING && room.phase !== PHASE.COMPARING) return;
    const me = room.players && room.players.find((p) => p.openid === GameGlobal.databus.user.openid);
    if (!me) return;
    if (me.voteDissolve) {
      GameGlobal.socket.send(MSG.VOTE_DISSOLVE_CANCEL, {});
      return;
    }
    this._dissolveConfirmVisible = true;
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
      ? Math.max(40, Math.min(52, Math.floor(Math.min(SCREEN_WIDTH, SCREEN_HEIGHT) * 0.13)))
      : Math.max(54, Math.min(60, Math.floor(Math.min(SCREEN_WIDTH, SCREEN_HEIGHT) * 0.14)));
    const minSideGap = Math.max(46, Math.min(64, SCREEN_WIDTH * 0.12));
    const topInfoBottom = Math.max(SAFE_TOP + 138, 134);
    const topY = playing ? Math.max(SAFE_TOP + 54, Math.min(66, SCREEN_HEIGHT * 0.14)) : topInfoBottom;
    const bottomLimit = playing ? SCREEN_HEIGHT * 0.70 : SCREEN_HEIGHT - SAFE_BOTTOM - 150;
    const radiusX = Math.max(100, Math.min(table.rx * 0.9, SCREEN_WIDTH / 2 - minSideGap));
    const radiusY = Math.max(70, Math.min(table.ry * 0.76, table.cy - topY, bottomLimit - table.cy));
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

  _getTableLayout(phase, handYOverride) {
    const playTable = phase === PHASE.PLAYING || phase === PHASE.COMPARING;
    const rx = Math.min(SCREEN_WIDTH * 0.48, SCREEN_WIDTH / 2 - 10);
    const ryBase = playTable ? SCREEN_HEIGHT * 0.35 : SCREEN_HEIGHT * 0.23;
    let ry = Math.max(108, Math.min(ryBase, SCREEN_HEIGHT * 0.36));
    let cy = Math.max(SAFE_TOP + 220, SCREEN_HEIGHT * 0.42);
    if (playTable) {
      const handY = handYOverride !== undefined
        ? handYOverride
        : this.playPhase && this.playPhase._getLayout
          ? this.playPhase._getLayout().handY
          : SCREEN_HEIGHT - SAFE_BOTTOM - 120;
      const tableBottom = handY - TABLE_HAND_GAP;
      const minTop = Math.max(SAFE_TOP + 52, 74);
      const maxRy = Math.max(72, Math.floor((tableBottom - minTop) / 2));
      ry = Math.min(ry, maxRy);
      cy = tableBottom - ry;
    }
    return { cx: SCREEN_WIDTH / 2, cy, rx, ry };
  }

  // 右上角按钮组按阶段动态布局：
  //   waiting:        退出 + 返回
  //   playing/comparing: 解散 + 返回
  //   match_end:      仅退出
  // 优先放在微信胶囊菜单下方，两按钮同高同间距。
  _layoutTopRightButtons(phase) {
    const margin = 12;
    const gap = 6;
    let leftBtn = null;
    let rightBtn = null;
    if (phase === PHASE.MATCH_END) {
      rightBtn = this.quitBtn;
    } else if (phase === PHASE.PLAYING || phase === PHASE.COMPARING) {
      leftBtn = this.dissolveBtn;
      rightBtn = this.backBtn;
    } else {
      // waiting (默认)
      leftBtn = this.quitBtn;
      rightBtn = this.backBtn;
    }
    const groupWidth = leftBtn
      ? leftBtn.width + gap + rightBtn.width
      : rightBtn.width;
    const menuRight = MENU_BUTTON_RECT ? MENU_BUTTON_RECT.right : SCREEN_WIDTH - margin;
    const minY = Math.max(12, SAFE_TOP + 8);
    const y = MENU_BUTTON_RECT ? MENU_BUTTON_RECT.bottom + 12 : minY;
    let x = Math.min(SCREEN_WIDTH - groupWidth - margin, menuRight - groupWidth);
    x = Math.max(margin, x);
    if (leftBtn) {
      leftBtn.x = x;
      leftBtn.y = y;
      rightBtn.x = x + leftBtn.width + gap;
    } else {
      rightBtn.x = x;
    }
    rightBtn.y = y;
    return { leftBtn, rightBtn };
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
    const topY = Math.max(14, SAFE_TOP + 10);
    const leftX = Math.max(14, SAFE_LEFT + 14);
    const phase = room && room.phase;
    const dissolvable = phase === PHASE.PLAYING || phase === PHASE.COMPARING;
    const me2 = dissolvable && room.players
      ? room.players.find((p) => p.openid === GameGlobal.databus.user.openid)
      : null;
    const showDissolve = !!(me2 && !me2.isBot);
    // 布局右上角按钮组（按阶段；playing/comparing 如果本人不应看见解散，退退为 waiting 布局）
    const layoutPhase = (dissolvable && !showDissolve) ? PHASE.WAITING : phase;
    this._layoutTopRightButtons(layoutPhase);
    ctx.save();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = 'bold 17px sans-serif';
    ctx.fillText(`房间 ${room.id}`, leftX, topY);
    // 当前局序号：已完成 currentRound 局，正在进行的为 currentRound+1（封顶 totalRounds）
    const cur = Math.min(room.currentRound + 1, room.rule.totalRounds);
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText(`第 ${cur}/${room.rule.totalRounds} 局`, leftX, topY + 24);
    if (room.rule.withMa) {
      ctx.fillText('马牌：开', leftX, topY + 48);
    }
    const netStatus = GameGlobal.databus.netStatus;
    const statusMap = {
      disconnected: { text: '离线', color: '#e57373' },
      connecting: { text: '连接中...', color: '#ffd54f' },
      connected: { text: '已连接', color: '#81c784' },
    };
    const st = statusMap[netStatus] || statusMap.disconnected;
    ctx.fillStyle = st.color;
    ctx.font = '12px sans-serif';
    ctx.fillText(`● ${st.text}`, leftX, topY + 72);
    ctx.restore();
    this.bgmToggleBtn.setPosition(leftX, topY + 94);
    this.bgmToggleBtn.render(ctx);
    // 右上角按钮组按阶段渲染
    if (phase === PHASE.MATCH_END) {
      this.quitBtn.render(ctx);
    } else if (showDissolve) {
      this.dissolveBtn.text = me2.voteDissolve ? '撤销' : '解散';
      this.dissolveBtn.bgColor = me2.voteDissolve ? '#999' : '#ff8a00';
      this.dissolveBtn.render(ctx);
      this.backBtn.render(ctx);
    } else if (phase === PHASE.WAITING) {
      this.quitBtn.render(ctx);
      this.backBtn.render(ctx);
    } else {
      // playing/comparing 但本人不是真人（理论上不会出现）→ 仅显示返回
      this.backBtn.render(ctx);
    }
    // 解散投票进度提示
    if (dissolvable) {
      // 顶部“已同意 N/M”总览：N=已投同意真人数 M=在线真人总数
      const onlineHumans = room.players.filter((p) => !p.isBot && !p.offline);
      const voted = onlineHumans.filter((p) => p.voteDissolve);
      if (voted.length > 0) {
        ctx.save();
        ctx.fillStyle = '#ffeb3b';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        const tipX = this.backBtn.x + this.backBtn.width;
        const tipY = this.backBtn.y + this.backBtn.height + 4;
        ctx.fillText(`解散投票 ${voted.length}/${onlineHumans.length}`, tipX, tipY);
        ctx.restore();
      }
    }

    // 座位
    const myOpenid = GameGlobal.databus.user.openid;
    const seats = this.getSeatPositions();
    seats.forEach((seat) => {
      PlayerSeat.render(ctx, seat.player, seat.x, seat.y, {
        isHost: seat.openid === room.hostId,
        isMe: seat.openid === myOpenid,
        phase: room.phase,
        size: seat.size,
        hideScore: room.phase === PHASE.COMPARING,
        hideBadge: room.phase === PHASE.COMPARING,
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
    if (this._kickTarget) this._renderKickBotConfirm(ctx);
    // 「退出」二次确认弹窗（waiting / match_end 阶段发 LEAVE_ROOM）
    if (this._quitConfirmVisible) this._renderQuitConfirm(ctx);
    // 「返回」二次确认弹窗（仅断开 WS 保留座位）
    if (this._backConfirmVisible) this._renderBackConfirm(ctx);
    // 解散投票确认弹窗
    if (this._dissolveConfirmVisible) this._renderDissolveConfirm(ctx);
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
    this.readyBtn.x = SCREEN_WIDTH / 2 - 76;
    this.readyBtn.y = SCREEN_HEIGHT - SAFE_BOTTOM - 72;
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
    this.addBotBtn.x = Math.min(SCREEN_WIDTH - this.addBotBtn.width - 14, this.readyBtn.x + this.readyBtn.width + 12);
    this.addBotBtn.y = this.readyBtn.y;
    this.addBotBtn.bgColor = full ? '#bbb' : '#ff8a00';
    this.addBotBtn.render(ctx);
  }

  // 踢出（电脑/真人）玩家确认弹窗
  _renderKickBotConfirm(ctx) {
    if (!this._kickTarget) return;
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
    const title = this._kickTarget.isBot ? '踢出电脑玩家？' : '踢出该玩家？';
    ctx.fillText(title, x + w / 2, y + 24);
    ctx.font = '13px sans-serif';
    ctx.fillStyle = '#666';
    const nick = this._kickTarget.nickname || (this._kickTarget.isBot ? '电脑' : '玩家');
    ctx.fillText(nick, x + w / 2, y + 52);
    ctx.restore();
    if (!this._kickYes) {
      this._kickYes = new Button({
        x: x + w / 2 + 10, y: y + h - 50,
        width: 90, height: 34, text: '踢出', bgColor: '#e57373',
        onClick: () => {
          const t = this._kickTarget;
          if (t) {
            const msgType = t.isBot ? MSG.ROOM_KICK_BOT : MSG.ROOM_KICK_PLAYER;
            GameGlobal.socket.send(msgType, { openid: t.openid });
          }
          this._kickTarget = null;
        },
      });
      this._kickNo = new Button({
        x: x + w / 2 - 100, y: y + h - 50,
        width: 90, height: 34, text: '取消', bgColor: '#999',
        onClick: () => { this._kickTarget = null; },
      });
    }
    this._kickYes.render(ctx);
    this._kickNo.render(ctx);
  }

  // 「退出」二次确认弹窗：waiting/match_end 阶段可见，确认后发 LEAVE_ROOM 让出座位
  _renderQuitConfirm(ctx) {
    const room = GameGlobal.databus.room;
    const isMatchEnd = room && room.phase === PHASE.MATCH_END;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    const w = 280, h = 156;
    const x = (SCREEN_WIDTH - w) / 2, y = (SCREEN_HEIGHT - h) / 2;
    ctx.fillStyle = '#fff';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#333';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(isMatchEnd ? '确定退出本房间？' : '退出房间？', x + w / 2, y + 22);
    ctx.font = '13px sans-serif';
    ctx.fillStyle = '#666';
    if (isMatchEnd) {
      ctx.fillText('本场已结算，退出后不可返回', x + w / 2, y + 62);
    } else {
      ctx.fillText('将让出座位，无法重新进入', x + w / 2, y + 52);
      ctx.fillText('（若只是暂离请选「返回」）', x + w / 2, y + 72);
    }
    ctx.restore();
    if (!this._quitYes) {
      this._quitYes = new Button({
        x: x + w / 2 + 10, y: y + h - 50,
        width: 90, height: 34, text: '退出', bgColor: '#e57373',
        onClick: () => {
          this._quitConfirmVisible = false;
          // 发送 LEAVE_ROOM；服务端回 LEAVE_ROOM_OK 后走 _returnToLobby + clearRoomId
          if (GameGlobal.socket && typeof GameGlobal.socket.send === 'function') {
            GameGlobal.socket.send(MSG.LEAVE_ROOM, {});
          } else {
            // socket 已断→兌底本地清理
            GameGlobal.databus.clearRoomId && GameGlobal.databus.clearRoomId();
            this._returnToLobby();
          }
        },
      });
      this._quitNo = new Button({
        x: x + w / 2 - 100, y: y + h - 50,
        width: 90, height: 34, text: '取消', bgColor: '#999',
        onClick: () => { this._quitConfirmVisible = false; },
      });
    }
    this._quitYes.render(ctx);
    this._quitNo.render(ctx);
  }

  // 「返回」二次确认弹窗：仅断开 WS 保留座位回首页（不发 LEAVE_ROOM）
  _renderBackConfirm(ctx) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    const w = 280, h = 156;
    const x = (SCREEN_WIDTH - w) / 2, y = (SCREEN_HEIGHT - h) / 2;
    ctx.fillStyle = '#fff';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#333';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('返回主页？', x + w / 2, y + 22);
    ctx.font = '13px sans-serif';
    ctx.fillStyle = '#666';
    ctx.fillText('房间将保留，可稍后从主页', x + w / 2, y + 52);
    ctx.fillText('“重新进入”继续对局', x + w / 2, y + 72);
    ctx.restore();
    if (!this._backYes) {
      this._backYes = new Button({
        x: x + w / 2 + 10, y: y + h - 50,
        width: 90, height: 34, text: '返回', bgColor: '#909090',
        onClick: () => {
          this._backConfirmVisible = false;
          this._returnToLobby();
        },
      });
      this._backNo = new Button({
        x: x + w / 2 - 100, y: y + h - 50,
        width: 90, height: 34, text: '取消', bgColor: '#999',
        onClick: () => { this._backConfirmVisible = false; },
      });
    }
    this._backYes.render(ctx);
    this._backNo.render(ctx);
  }

  // 解散投票确认弹窗
  _renderDissolveConfirm(ctx) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    const w = 300, h = 170;
    const x = (SCREEN_WIDTH - w) / 2, y = (SCREEN_HEIGHT - h) / 2;
    ctx.fillStyle = '#fff';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#333';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('发起解散对局？', x + w / 2, y + 22);
    ctx.font = '13px sans-serif';
    ctx.fillStyle = '#666';
    ctx.fillText('所有真人同意后将按当前积分', x + w / 2, y + 56);
    ctx.fillText('提前结算（电脑默认同意）', x + w / 2, y + 76);
    ctx.restore();
    if (!this._dissolveYes) {
      this._dissolveYes = new Button({
        x: x + w / 2 + 10, y: y + h - 50,
        width: 100, height: 34, text: '同意解散', bgColor: '#ff8a00',
        onClick: () => {
          this._dissolveConfirmVisible = false;
          GameGlobal.socket.send(MSG.VOTE_DISSOLVE, {});
        },
      });
      this._dissolveNo = new Button({
        x: x + w / 2 - 110, y: y + h - 50,
        width: 100, height: 34, text: '取消', bgColor: '#999',
        onClick: () => { this._dissolveConfirmVisible = false; },
      });
    }
    this._dissolveYes.render(ctx);
    this._dissolveNo.render(ctx);
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
    if (this._kickTarget) {
      if (this._kickYes && this._kickYes.handleTouch(x, y)) return;
      if (this._kickNo && this._kickNo.handleTouch(x, y)) return;
      // 区域外点击关闭弹窗
      this._kickTarget = null;
      return;
    }
    if (this._exitConfirmVisible) {
      // 兼容旧字段：如果还有代码路径设了 _exitConfirmVisible，走返回确认
      this._exitConfirmVisible = false;
      this._backConfirmVisible = true;
      return;
    }
    if (this._quitConfirmVisible) {
      if (this._quitYes && this._quitYes.handleTouch(x, y)) return;
      if (this._quitNo && this._quitNo.handleTouch(x, y)) return;
      return;
    }
    if (this._backConfirmVisible) {
      if (this._backYes && this._backYes.handleTouch(x, y)) return;
      if (this._backNo && this._backNo.handleTouch(x, y)) return;
      return;
    }
    if (this._dissolveConfirmVisible) {
      if (this._dissolveYes && this._dissolveYes.handleTouch(x, y)) return;
      if (this._dissolveNo && this._dissolveNo.handleTouch(x, y)) return;
      return;
    }
    // 右上角按钮组按阶段分发
    const phaseT = GameGlobal.databus.room && GameGlobal.databus.room.phase;
    if (phaseT === PHASE.MATCH_END) {
      if (this.quitBtn.handleTouch(x, y)) return;
    } else if (phaseT === PHASE.PLAYING || phaseT === PHASE.COMPARING) {
      const meSelf = GameGlobal.databus.room.players
        && GameGlobal.databus.room.players.find((p) => p.openid === GameGlobal.databus.user.openid);
      if (meSelf && !meSelf.isBot && this.dissolveBtn.handleTouch(x, y)) return;
      if (this.backBtn.handleTouch(x, y)) return;
    } else {
      // waiting（默认）
      if (this.quitBtn.handleTouch(x, y)) return;
      if (this.backBtn.handleTouch(x, y)) return;
    }
    if (this.bgmToggleBtn.handleTouch(x, y)) return;
    const room = GameGlobal.databus.room;
    if (!room) return;
    if (room.phase === PHASE.WAITING || room.phase === PHASE.MATCH_END) {
      // 房主可点 “+ 电脑”按钮（仅 waiting 阶段渲染）与任意非自身座位踢出
      if (room.hostId === GameGlobal.databus.user.openid) {
        if (
          room.phase === PHASE.WAITING
          && room.players.length < room.rule.maxPlayers
          && this.addBotBtn.handleTouch(x, y)
        ) return;
        // 点击到非自身座位：调起踢出弹窗（电脑或真人）
        const seats = this.getSeatPositions();
        for (const seat of seats) {
          if (seat.player.openid === GameGlobal.databus.user.openid) continue;
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
    if (!room) return;
    const t = e.touches[0] || e.changedTouches[0];
    if (!t) return;
    if (room.phase === PHASE.PLAYING) {
      this.playPhase.handleTouchMove(t.clientX, t.clientY);
    } else if (room.phase === PHASE.COMPARING) {
      this.settlePhase.handleTouchMove(t.clientX, t.clientY);
    }
  }

  onTouchEnd() {
    const room = GameGlobal.databus.room;
    if (room && room.phase === PHASE.PLAYING) {
      this.playPhase.handleTouchEnd();
    } else if (room && room.phase === PHASE.COMPARING) {
      this.settlePhase.handleTouchEnd();
    }
  }
}
