// 对局相关 handler：发牌、提交三道、结算、下一局确认
const { MSG, ERR } = require('../protocol');
const session = require('../session');
const roomManager = require('../room_manager');
const { PHASE } = require('../room');
const { Deck } = require('../game/card');
const { validateLanes } = require('../game/lane_validator');
const { settle } = require('../game/settle');
const logger = require('../utils/logger');

// 开始一局：洗牌、发牌、改阶段
function startRound(room) {
  room.phase = PHASE.PLAYING;
  // 重置一局相关数据（保留 score）
  room.players.forEach((p) => {
    p.hand = [];
    p.lanes = null;
    p.submitted = false;
    p.roundConfirmed = false;
  });
  // 发牌
  const hands = Deck.deal(room.players.length);
  for (let i = 0; i < room.players.length; i++) {
    room.players[i].hand = hands[i];
    const s = session.getByOpenid(room.players[i].openid);
    if (s) s.send(MSG.DEAL_CARDS, { hand: hands[i] });
  }
  room.broadcastState();
  logger.info(`房间 ${room.id} 开始第 ${room.currentRound + 1} 局`);
}

// 玩家提交三道
function handleSubmitLanes(s, data, reqId) {
  const room = roomManager.getRoom(s.roomId);
  if (!room) { s.sendError(ERR.NOT_IN_ROOM, '未在房间', reqId); return; }
  if (room.phase !== PHASE.PLAYING) {
    s.sendError(ERR.BAD_REQUEST, '当前不允许开牌', reqId);
    return;
  }
  const p = room.getPlayer(s.openid);
  if (!p) { s.sendError(ERR.NOT_IN_ROOM, '玩家不存在', reqId); return; }
  if (p.submitted) {
    s.sendError(ERR.BAD_REQUEST, '已开牌', reqId);
    return;
  }
  const { head, middle, tail } = data || {};
  // 校验所提交的 13 张牌与发牌一致
  const all = [...(head || []), ...(middle || []), ...(tail || [])];
  if (all.length !== 13 || !sameCardSet(p.hand, all)) {
    s.sendError(ERR.INVALID_LANES, '提交的牌不合法', reqId);
    return;
  }
  // 校验三道大小关系
  const v = validateLanes(head, middle, tail);
  if (!v.ok) {
    s.sendError(ERR.INVALID_LANES, '三道大小不合法', reqId);
    return;
  }
  p.lanes = { head, middle, tail };
  p.submitted = true;
  s.send(MSG.SUBMIT_LANES_OK, { lanes: p.lanes }, { reqId });
  room.broadcastState();
  // 全员开牌 → 结算
  if (room.allSubmitted()) {
    doSettle(room);
  }
}

// 比较两组卡牌是否相同（不考虑顺序）
function sameCardSet(a, b) {
  if (a.length !== b.length) return false;
  const key = (c) => `${c.suit}_${c.rank}`;
  const ka = a.map(key).sort();
  const kb = b.map(key).sort();
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] !== kb[i]) return false;
  }
  return true;
}

// 触发结算
function doSettle(room) {
  room.phase = PHASE.COMPARING;
  const result = settle(room.players, room.rule.withMa);
  // 累加积分
  result.players.forEach((rp) => {
    const p = room.getPlayer(rp.openid);
    if (p) p.score += rp.finalScore;
  });
  room.currentRound += 1;
  // 构造与 SETTLE_RESULT 消息一致的结构，供广播 + 断线重连快照复用
  const settlePayload = {
    round: room.currentRound,
    totalRounds: room.rule.totalRounds,
    players: result.players,
    homeruns: result.homeruns,
    pairs: result.pairs,
    scores: room.players.map((p) => ({ openid: p.openid, score: p.score })),
  };
  room.lastSettle = settlePayload;
  // 广播结果
  room.broadcast(MSG.SETTLE_RESULT, settlePayload);
  room.broadcastState();
  logger.info(`房间 ${room.id} 第 ${room.currentRound} 局结算完成`);
}

// 玩家确认本局结算
function handleRoundConfirm(s, data, reqId) {
  const room = roomManager.getRoom(s.roomId);
  if (!room) { s.sendError(ERR.NOT_IN_ROOM, '未在房间', reqId); return; }
  if (room.phase !== PHASE.COMPARING) {
    s.sendError(ERR.BAD_REQUEST, '当前阶段不允许确认', reqId);
    return;
  }
  const p = room.getPlayer(s.openid);
  if (p) p.roundConfirmed = true;
  room.broadcastState();
  if (room.allRoundConfirmed()) {
    // 进入下一局或对局结束
    if (room.currentRound >= room.rule.totalRounds) {
      room.phase = PHASE.MATCH_END;
      const ranks = room.players
        .map((p) => ({ openid: p.openid, nickname: p.nickname, score: p.score }))
        .sort((a, b) => b.score - a.score);
      room.broadcast(MSG.MATCH_END, { ranks });
      room.broadcastState();
    } else {
      // 回到准备阶段
      room.phase = PHASE.WAITING;
      room.resetRound();
      room.broadcastState();
    }
  }
}

module.exports = {
  startRound,
  handleSubmitLanes,
  handleRoundConfirm,
  doSettle,
};
