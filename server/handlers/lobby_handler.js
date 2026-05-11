// 大厅相关 handler：登录、创建/加入/离开房间、准备
const { MSG, ERR } = require('../protocol');
const session = require('../session');
const roomManager = require('../room_manager');
const { PHASE } = require('../room');

// 登录
function handleLogin(s, data, reqId) {
  const { openid, nickname, avatarUrl } = data || {};
  if (!openid) {
    s.sendError(ERR.BAD_REQUEST, '缺少 openid', reqId);
    return;
  }
  s.nickname = nickname || ('玩家' + openid.slice(-4));
  s.avatarUrl = avatarUrl || '';
  s.loggedIn = true;
  // 注意：bindOpenid 内部会把旧 Session 的 roomId 继承到新 Session（重连场景）
  session.bindOpenid(s, openid);

  // 反查该 openid 是否仍在某个房间，构建 activeRoom 信息
  let activeRoom = null;
  if (s.roomId) {
    const room = roomManager.getRoom(s.roomId);
    if (room && room.getPlayer(openid)) {
      // 修复 Player 的连接信息，并复位掉线状态
      const p = room.getPlayer(openid);
      p.connId = s.connId;
      p.nickname = s.nickname || p.nickname;
      p.avatarUrl = s.avatarUrl || p.avatarUrl;
      p.offline = false;
      p.offlineSince = 0;
      // 广播一次 ROOM_STATE，让其他人看到该玩家恢复在线
      room.broadcastState();
      activeRoom = {
        roomId: room.id,
        phase: room.phase,
        currentRound: room.currentRound,
        totalRounds: room.rule.totalRounds,
      };
    } else {
      // 旧 roomId 已无效，清除
      s.roomId = null;
    }
  }
  s.send(MSG.LOGIN_OK, { openid, nickname: s.nickname, activeRoom }, { reqId });
}

// 创建房间
function handleCreateRoom(s, data, reqId) {
  if (s.roomId) {
    s.sendError(ERR.ALREADY_IN_ROOM, '已在房间中', reqId);
    return;
  }
  const rule = {
    withMa: !!(data && data.withMa),
    totalRounds: (data && data.totalRounds) || 5,
    maxPlayers: (data && data.maxPlayers) || 4,
  };
  const room = roomManager.createRoom(rule, s.openid);
  const r = roomManager.joinRoom(room.id, s);
  s.send(MSG.CREATE_ROOM_OK, { roomId: room.id }, { reqId });
  // 广播一次状态（仅自己在房间）
  room.broadcastState();
}

// 加入房间
function handleJoinRoom(s, data, reqId) {
  const roomId = data && data.roomId;
  if (!roomId) {
    s.sendError(ERR.BAD_REQUEST, '缺少 roomId', reqId);
    return;
  }
  // 若已在房间且 roomId 与请求一致，视为客户端业务层重连，走重连路径
  if (s.roomId && String(s.roomId) !== String(roomId)) {
    s.sendError(ERR.ALREADY_IN_ROOM, '已在房间中', reqId);
    return;
  }
  const r = roomManager.joinRoom(roomId, s);
  if (r.err) {
    const map = {
      ROOM_NOT_FOUND: [ERR.ROOM_NOT_FOUND, '房间不存在'],
      ROOM_FULL: [ERR.ROOM_FULL, '房间已满'],
      ROOM_PLAYING: [ERR.ROOM_PLAYING, '对局已开始'],
    };
    const e = map[r.err] || [ERR.BAD_REQUEST, '加入失败'];
    s.sendError(e[0], e[1], reqId);
    return;
  }
  s.send(MSG.JOIN_ROOM_OK, { roomId, reconnect: r.reconnect }, { reqId });

  // 重连路径：先单播 RECONNECT_SNAPSHOT 让客户端恢复本地数据，再广播 ROOM_STATE
  if (r.reconnect) {
    const snap = buildReconnectSnapshot(r.room, r.player);
    s.send(MSG.RECONNECT_SNAPSHOT, snap);
  }
  r.room.broadcastState();
}

// 构造重连快照
function buildReconnectSnapshot(room, player) {
  const phase = room.phase;
  const inHand = (phase === PHASE.PLAYING || phase === PHASE.COMPARING);
  const showSettle = (phase === PHASE.COMPARING || phase === PHASE.MATCH_END);
  return {
    phase,
    hand: inHand ? (player.hand || []) : null,
    lanes: player.lanes || null,
    submitted: !!player.submitted,
    lastSettle: showSettle ? (room.lastSettle || null) : null,
    currentRound: room.currentRound,
    totalRounds: room.rule.totalRounds,
  };
}

// 离开房间
function handleLeaveRoom(s, data, reqId) {
  if (!s.roomId) {
    s.sendError(ERR.NOT_IN_ROOM, '未在房间', reqId);
    return;
  }
  roomManager.leaveRoom(s);
  s.send(MSG.LEAVE_ROOM_OK, {}, { reqId });
}

// 准备
function handleReady(s, data, reqId) {
  const room = roomManager.getRoom(s.roomId);
  if (!room) { s.sendError(ERR.NOT_IN_ROOM, '未在房间', reqId); return; }
  if (room.phase !== PHASE.WAITING) {
    s.sendError(ERR.BAD_REQUEST, '当前阶段不允许准备', reqId);
    return;
  }
  const p = room.getPlayer(s.openid);
  if (p) p.ready = true;
  room.broadcastState();
  // 全员准备且 ≥2 人 → 开始本局
  if (room.allReady()) {
    const gameHandler = require('./game_handler');
    gameHandler.startRound(room);
  }
}

// 取消准备
function handleUnready(s, data, reqId) {
  const room = roomManager.getRoom(s.roomId);
  if (!room) { s.sendError(ERR.NOT_IN_ROOM, '未在房间', reqId); return; }
  if (room.phase !== PHASE.WAITING) {
    s.sendError(ERR.BAD_REQUEST, '当前阶段不允许取消准备', reqId);
    return;
  }
  const p = room.getPlayer(s.openid);
  if (p) p.ready = false;
  room.broadcastState();
}

module.exports = {
  handleLogin,
  handleCreateRoom,
  handleJoinRoom,
  handleLeaveRoom,
  handleReady,
  handleUnready,
};
