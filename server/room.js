// 单个房间数据结构与行为
const { MSG } = require('./protocol');
const session = require('./session');

// 房间阶段
const PHASE = {
  WAITING: 'waiting',     // 等待准备
  PLAYING: 'playing',     // 已发牌、放牌中
  COMPARING: 'comparing', // 比牌动画中（等待 ROUND_CONFIRM）
  MATCH_END: 'match_end', // 整场结束
};

class Player {
  constructor(s) {
    this.openid = s.openid;
    this.nickname = s.nickname;
    this.avatarUrl = s.avatarUrl;
    this.connId = s.connId;
    this.score = 0;            // 累计积分
    this.ready = false;        // 是否已准备
    this.offline = false;      // 是否掉线
    this.offlineSince = 0;     // 掉线时间戳
    this.hand = [];            // 当前手牌（13 张）
    this.lanes = null;         // {head, middle, tail}
    this.submitted = false;    // 是否已开牌
    this.roundConfirmed = false; // 是否确认本局结算
  }
}

class Room {
  constructor(id, rule, hostOpenid) {
    this.id = id;
    this.rule = {
      withMa: !!rule.withMa,
      totalRounds: rule.totalRounds || 5,
      maxPlayers: Math.max(2, Math.min(6, rule.maxPlayers || 4)),
    };
    this.hostId = hostOpenid;
    this.players = []; // Player[]
    this.phase = PHASE.WAITING;
    this.currentRound = 0; // 已完成的局数
    this.lastSettle = null;
    // 自动开局所需 deck 由 game_handler 操作
  }

  // 是否已满
  isFull() { return this.players.length >= this.rule.maxPlayers; }
  isEmpty() { return this.players.length === 0; }

  // 通过 openid 查找玩家
  getPlayer(openid) {
    return this.players.find((p) => p.openid === openid) || null;
  }

  // 加入玩家（来自 session）
  addPlayer(s) {
    const p = new Player(s);
    this.players.push(p);
    return p;
  }

  // 重连场景：将旧玩家替换连接信息
  reconnectPlayer(s) {
    const p = this.getPlayer(s.openid);
    if (!p) return null;
    p.connId = s.connId;
    p.nickname = s.nickname || p.nickname;
    p.avatarUrl = s.avatarUrl || p.avatarUrl;
    p.offline = false;
    p.offlineSince = 0;
    return p;
  }

  // 移除玩家
  removePlayer(openid) {
    const idx = this.players.findIndex((p) => p.openid === openid);
    if (idx < 0) return null;
    const removed = this.players.splice(idx, 1)[0];
    // 如果移除的是房主，转移给最早加入的剩余玩家
    if (this.hostId === openid && this.players.length > 0) {
      this.hostId = this.players[0].openid;
    }
    return removed;
  }

  // 序列化为可发送给客户端的 ROOM_STATE
  toState() {
    return {
      id: this.id,
      rule: this.rule,
      hostId: this.hostId,
      phase: this.phase,
      currentRound: this.currentRound,
      players: this.players.map((p) => ({
        openid: p.openid,
        nickname: p.nickname,
        avatarUrl: p.avatarUrl,
        score: p.score,
        ready: p.ready,
        offline: p.offline,
        submitted: p.submitted,
      })),
    };
  }

  // 广播消息给所有在线玩家
  broadcast(type, data, exceptOpenid) {
    this.players.forEach((p) => {
      if (p.openid === exceptOpenid) return;
      if (p.offline) return;
      const s = session.getByOpenid(p.openid);
      if (s) s.send(type, data);
    });
  }

  // 广播 ROOM_STATE
  broadcastState() {
    const state = this.toState();
    this.broadcast(MSG.ROOM_STATE, state);
  }

  // 重置一局相关数据
  resetRound() {
    this.players.forEach((p) => {
      p.hand = [];
      p.lanes = null;
      p.submitted = false;
      p.ready = false;
      p.roundConfirmed = false;
    });
    this.lastSettle = null;
  }

  // 是否所有在线玩家均已就绪
  allReady() {
    if (this.players.length < 2) return false;
    return this.players.every((p) => p.ready || p.offline);
  }

  // 是否所有在线玩家均已开牌
  allSubmitted() {
    return this.players.every((p) => p.submitted || p.offline);
  }

  // 是否所有玩家均确认本局结算
  allRoundConfirmed() {
    return this.players.every((p) => p.roundConfirmed || p.offline);
  }
}

module.exports = { Room, Player, PHASE };
