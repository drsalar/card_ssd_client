// 会话管理 - 维护 connId -> Session 映射
const logger = require('./utils/logger');

let nextConnId = 1;

class Session {
  constructor(ws) {
    this.connId = nextConnId++;
    this.ws = ws;
    this.openid = '';
    this.nickname = '';
    this.avatarUrl = '';
    this.roomId = null;
    this.loggedIn = false;
  }

  // 发送消息（自动包裹 JSON）
  send(type, data = {}, extra = {}) {
    if (!this.ws || this.ws.readyState !== 1) return;
    const payload = Object.assign({ type, data }, extra);
    try {
      this.ws.send(JSON.stringify(payload));
    } catch (e) {
      logger.warn('发送失败', e.message);
    }
  }

  // 发送错误
  sendError(code, msg, reqId) {
    this.send('ERROR', {}, { code, msg, reqId });
  }
}

// 全局会话表
const sessions = new Map(); // connId -> Session
// openid -> Session（用于断线重连查找）
const openidIndex = new Map();

function add(ws) {
  const s = new Session(ws);
  sessions.set(s.connId, s);
  return s;
}

function remove(session) {
  if (!session) return;
  sessions.delete(session.connId);
  if (session.openid && openidIndex.get(session.openid) === session) {
    openidIndex.delete(session.openid);
  }
}

// 绑定 openid（登录时调用）
function bindOpenid(session, openid) {
  // 若已有同 openid 旧连接，将其断开，并把房间归属继承到新 Session
  const prev = openidIndex.get(openid);
  if (prev && prev !== session) {
    // 继承旧连接的房间归属（重连时新 Session 仍属于该房间）
    if (prev.roomId) {
      session.roomId = prev.roomId;
      // 清空旧 Session 的 roomId，避免 ws.close 触发 handleDisconnect 误判为掉线
      prev.roomId = null;
    }
    try { prev.ws.close(); } catch (e) {}
    sessions.delete(prev.connId);
    // 取消该 openid 可能存在的 30s 弃局兜底计时器（延迟 require 避免循环依赖）
    try {
      const roomManager = require('./room_manager');
      if (roomManager && typeof roomManager.cancelOfflineTimer === 'function') {
        roomManager.cancelOfflineTimer(openid);
      }
    } catch (e) {
      logger.warn('取消弃局计时器失败', e.message);
    }
  }
  session.openid = openid;
  openidIndex.set(openid, session);
}

function getByOpenid(openid) {
  return openidIndex.get(openid);
}

module.exports = { Session, add, remove, bindOpenid, getByOpenid, sessions };
