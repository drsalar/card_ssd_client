// 房间管理
const { Room, PHASE } = require('./room');
const { MSG } = require('./protocol');
const session = require('./session');
const logger = require('./utils/logger');

// 全部房间 - id(string) -> Room
const rooms = new Map();
// 掉线玩家定时器 - openid -> timer
const offlineTimers = new Map();

const OFFLINE_TIMEOUT = 30 * 1000;

// 生成唯一 4 位房间 ID
function genRoomId() {
  for (let i = 0; i < 1000; i++) {
    const id = String(Math.floor(1000 + Math.random() * 9000));
    if (!rooms.has(id)) return id;
  }
  // 兜底：5 位
  return String(Math.floor(10000 + Math.random() * 90000));
}

// 创建房间
function createRoom(rule, hostOpenid) {
  const id = genRoomId();
  const room = new Room(id, rule, hostOpenid);
  rooms.set(id, room);
  logger.info(`创建房间 ${id} 房主=${hostOpenid}`);
  return room;
}

// 获取房间
function getRoom(id) {
  return rooms.get(String(id)) || null;
}

// 销毁房间
function destroyRoom(id) {
  if (rooms.has(id)) {
    rooms.delete(id);
    logger.info(`销毁房间 ${id}`);
  }
}

// 玩家加入房间
function joinRoom(roomId, s) {
  const room = getRoom(roomId);
  if (!room) return { err: 'ROOM_NOT_FOUND' };
  // 已存在玩家 → 视为重连
  if (room.getPlayer(s.openid)) {
    const p = room.reconnectPlayer(s);
    cancelOfflineTimer(s.openid);
    s.roomId = room.id;
    return { room, player: p, reconnect: true };
  }
  if (room.isFull()) return { err: 'ROOM_FULL' };
  if (room.phase !== PHASE.WAITING && room.phase !== PHASE.MATCH_END) {
    return { err: 'ROOM_PLAYING' };
  }
  const p = room.addPlayer(s);
  s.roomId = room.id;
  return { room, player: p, reconnect: false };
}

// 玩家离开房间（主动）
function leaveRoom(s) {
  if (!s.roomId) return null;
  const room = getRoom(s.roomId);
  s.roomId = null;
  if (!room) return null;
  room.removePlayer(s.openid);
  cancelOfflineTimer(s.openid);
  if (room.isEmpty()) {
    destroyRoom(room.id);
    return { room, destroyed: true };
  }
  // 房间内还有人，广播状态
  room.broadcastState();
  return { room, destroyed: false };
}

// 取消掉线计时器
function cancelOfflineTimer(openid) {
  const t = offlineTimers.get(openid);
  if (t) {
    clearTimeout(t);
    offlineTimers.delete(openid);
  }
}

// 处理断线
// 等待阶段：直接移除；游戏阶段：标记掉线，30s 后判定弃局
function handleDisconnect(s) {
  if (!s.roomId) return;
  const room = getRoom(s.roomId);
  if (!room) return;
  const p = room.getPlayer(s.openid);
  if (!p) return;

  if (room.phase === PHASE.WAITING) {
    // 准备阶段直接移除
    room.removePlayer(s.openid);
    if (room.isEmpty()) {
      destroyRoom(room.id);
      return;
    }
    room.broadcastState();
    return;
  }

  // 对局中标记掉线
  p.offline = true;
  p.offlineSince = Date.now();
  room.broadcastState();

  // 30 秒后未回 → 视为本局弃局
  cancelOfflineTimer(s.openid);
  const timer = setTimeout(() => {
    offlineTimers.delete(s.openid);
    const r = getRoom(room.id);
    if (!r) return;
    const pp = r.getPlayer(s.openid);
    if (!pp || !pp.offline) return;
    // 自动提交一个空 lanes（按乌龙处理）
    if (!pp.submitted && pp.hand && pp.hand.length === 13) {
      pp.lanes = autoSplitLanes(pp.hand);
      pp.submitted = true;
    }
    // 如果所有人都已 submit，则触发结算
    const gameHandler = require('./handlers/game_handler');
    if (r.phase === PHASE.PLAYING && r.allSubmitted()) {
      gameHandler.doSettle(r);
    } else {
      r.broadcastState();
    }
  }, OFFLINE_TIMEOUT);
  offlineTimers.set(s.openid, timer);
}

// 简单地把手牌切成 3/5/5（按原顺序，不保证最优 - 仅用作弃局兜底）
function autoSplitLanes(cards) {
  return {
    head: cards.slice(0, 3),
    middle: cards.slice(3, 8),
    tail: cards.slice(8, 13),
  };
}

module.exports = {
  rooms,
  createRoom,
  getRoom,
  destroyRoom,
  joinRoom,
  leaveRoom,
  handleDisconnect,
  cancelOfflineTimer,
};
