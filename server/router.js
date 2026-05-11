// 协议路由分发
const { MSG, ERR } = require('./protocol');
const lobbyHandler = require('./handlers/lobby_handler');
const gameHandler = require('./handlers/game_handler');
const logger = require('./utils/logger');

// type -> handler(session, data, reqId)
const routes = {
  [MSG.LOGIN]: lobbyHandler.handleLogin,
  [MSG.CREATE_ROOM]: lobbyHandler.handleCreateRoom,
  [MSG.JOIN_ROOM]: lobbyHandler.handleJoinRoom,
  [MSG.LEAVE_ROOM]: lobbyHandler.handleLeaveRoom,
  [MSG.READY]: lobbyHandler.handleReady,
  [MSG.UNREADY]: lobbyHandler.handleUnready,
  [MSG.SUBMIT_LANES]: gameHandler.handleSubmitLanes,
  [MSG.ROUND_CONFIRM]: gameHandler.handleRoundConfirm,
};

function dispatch(session, raw) {
  let msg;
  try {
    msg = typeof raw === 'string' ? JSON.parse(raw) : JSON.parse(raw.toString());
  } catch (e) {
    session.sendError(ERR.BAD_REQUEST, '消息格式非法');
    return;
  }
  const { type, data = {}, reqId } = msg;
  // 登录前仅允许 LOGIN
  if (!session.loggedIn && type !== MSG.LOGIN) {
    session.sendError(ERR.NOT_LOGGED_IN, '尚未登录', reqId);
    return;
  }
  const handler = routes[type];
  if (!handler) {
    session.sendError(ERR.BAD_REQUEST, '未知消息: ' + type, reqId);
    return;
  }
  try {
    handler(session, data, reqId);
  } catch (e) {
    logger.error('handler error', type, e);
    session.sendError(500, e.message || '服务器错误', reqId);
  }
}

module.exports = { dispatch };
