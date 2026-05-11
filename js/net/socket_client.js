// WebSocket 客户端封装
// - 仅在对局场景（SCENES.ROOM）进行自动重连（最多 5 次）
// - 统一 JSON 协议: { type, data, reqId }
// - 基于 type 的事件订阅
// - 业务层重连：登录成功后若本地仍持有 room，则自动 JOIN_ROOM 恢复
import eventBus from '../utils/event_bus';
import { MSG, ERR } from './protocol';
import { SCENES } from '../databus';
import cloud from './cloud';

const MAX_RETRY = 5;

// 构造易读的云通道日志 URL：cloud://{service}/ws
function _cloudWsUrl() {
  const service = cloud.getCloudService() || 'unknown';
  return 'cloud://' + service + '/ws';
}

// 安全获取 LogStore（未启用调试时返回 null）
function _logStore() {
  try {
    if (typeof GameGlobal !== 'undefined' && GameGlobal.logStore) return GameGlobal.logStore;
  } catch (e) {}
  return null;
}
// 静默写 WS 日志
function _logWs(phase, payload) {
  const s = _logStore();
  if (!s) return;
  try { s.writeWs(phase, payload); } catch (e) {}
}

export default class SocketClient {
  constructor() {
    this.url = '';
    this.socket = null;
    this.connected = false;
    this.connecting = false;
    this.retry = 0;
    this.handlers = {}; // type -> [fn]
    this.pendingQueue = []; // 未连接前缓存待发送消息
    this.reqSeq = 0;
  }

  // 主动关闭连接：使用者在离开房间返回大厅时调用
  // 与 _onClose 区别：不触发重连，直接重置状态
  close() {
    this._userClosed = true;
    this.connecting = false;
    this.connected = false;
    this.retry = 0;
    this.pendingQueue = [];
    if (this.socket) {
      try {
        if (typeof wx !== 'undefined' && wx.connectSocket) {
          this.socket.close && this.socket.close({});
        } else if (typeof this.socket.close === 'function') {
          this.socket.close();
        }
      } catch (e) {}
      this.socket = null;
    }
    GameGlobal.databus && (GameGlobal.databus.netStatus = 'disconnected');
    eventBus.emit('netStatus', 'disconnected');
  }

  // 连接
  // 入参 url 仅用于浏览器/wx.connectSocket 降级链路；云通道分支会忽略它
  connect(url) {
    if (this.connecting || this.connected) return;
    this._userClosed = false;
    this.connecting = true;
    GameGlobal.databus && (GameGlobal.databus.netStatus = 'connecting');
    eventBus.emit('netStatus', 'connecting');

    // 优先使用云托管通道：wx.cloud.connectContainer
    if (cloud.isCloudWsAvailable()) {
      const logUrl = _cloudWsUrl();
      this.url = logUrl;
      this._cloudMode = true;
      _logWs('conn', { event: 'connect', url: logUrl, retry: this.retry });
      let socket;
      try {
        socket = wx.cloud.connectContainer({
          config: { env: cloud.getCloudEnv() },
          service: cloud.getCloudService(),
          path: '/ws',
        });
      } catch (e) {
        console.warn('connectContainer 失败', e);
        this._onError();
        return;
      }
      // connectContainer 返回的是 socketTask
      socket.onOpen && socket.onOpen(() => this._onOpen());
      socket.onMessage && socket.onMessage((res) => this._onMessage(res.data));
      socket.onClose && socket.onClose(() => this._onClose());
      socket.onError && socket.onError(() => this._onError());
      this.socket = socket;
      return;
    }

    // 降级链路：wx.connectSocket / 浏览器 WebSocket
    this.url = url;
    this._cloudMode = false;
    _logWs('conn', { event: 'connect', url, retry: this.retry });

    let socket;
    if (typeof wx !== 'undefined' && wx.connectSocket) {
      socket = wx.connectSocket({ url, fail: () => this._onError() });
      socket.onOpen(() => this._onOpen());
      socket.onMessage((res) => this._onMessage(res.data));
      socket.onClose(() => this._onClose());
      socket.onError(() => this._onError());
    } else if (typeof WebSocket !== 'undefined') {
      socket = new WebSocket(url);
      socket.onopen = () => this._onOpen();
      socket.onmessage = (e) => this._onMessage(e.data);
      socket.onclose = () => this._onClose();
      socket.onerror = () => this._onError();
    } else {
      console.warn('当前环境不支持 WebSocket');
      this.connecting = false;
      return;
    }
    this.socket = socket;
  }

  // 连接成功
  _onOpen() {
    this.connecting = false;
    this.connected = true;
    this.retry = 0;
    GameGlobal.databus && (GameGlobal.databus.netStatus = 'connected');
    eventBus.emit('netStatus', 'connected');
    _logWs('conn', { event: 'open', url: this.url });
    // 自动登录
    this._autoLogin();
    // 处理 pending 队列
    while (this.pendingQueue.length) {
      const msg = this.pendingQueue.shift();
      this._rawSend(msg);
    }
  }

  // 自动登录
  _autoLogin() {
    const user = GameGlobal.databus && GameGlobal.databus.user;
    if (!user || !user.openid) return;
    // 注册一次性 LOGIN_OK 监听：若本地仍持有 room（业务层断线），自动重连到原房间
    const onLoginOk = () => {
      eventBus.off(MSG.LOGIN_OK, onLoginOk);
      const room = GameGlobal.databus && GameGlobal.databus.room;
      if (room && room.id) {
        // 业务层自动重连：直接发 JOIN_ROOM（服务端会容错并下发 RECONNECT_SNAPSHOT）
        this.send(MSG.JOIN_ROOM, { roomId: room.id });
      }
    };
    eventBus.on(MSG.LOGIN_OK, onLoginOk);
    this.send(MSG.LOGIN, {
      openid: user.openid,
      nickname: user.nickname,
      avatarUrl: user.avatarUrl,
    });
  }

  // 收到消息
  _onMessage(data) {
    let msg;
    try {
      msg = typeof data === 'string' ? JSON.parse(data) : data;
    } catch (e) {
      console.warn('收到非法消息', data);
      _logWs('recv', { type: '<invalid>', data: String(data).slice(0, 200), level: 'error' });
      return;
    }
    const type = msg.type;
    // 关键消息升级日志级别
    let _lvl = 'info';
    if (type === MSG.ERROR) _lvl = 'error';
    else if (type === MSG.RECONNECT_SNAPSHOT) _lvl = 'warn';
    _logWs('recv', { type, reqId: msg.reqId, data: msg.data, level: _lvl });
    // 业务层断线场景：自动 JOIN_ROOM 失败时清掉本地 room，回大厅
    if (type === MSG.ERROR && msg.code === ERR.ROOM_NOT_FOUND) {
      const databus = GameGlobal.databus;
      if (databus && databus.room) {
        databus.room = null;
        databus.resetRound && databus.resetRound();
        databus.clearRoomId && databus.clearRoomId();
        eventBus.emit('roomLost');
      }
    }
    // 触发该 type 的处理器
    const list = this.handlers[type] || [];
    list.forEach((fn) => {
      try { fn(msg.data || {}, msg); } catch (e) { console.error(e); }
    });
    // 同时通过事件总线广播
    eventBus.emit(type, msg.data || {}, msg);
  }

  // 关闭
  _onClose() {
    this.connecting = false;
    this.connected = false;
    GameGlobal.databus && (GameGlobal.databus.netStatus = 'disconnected');
    eventBus.emit('netStatus', 'disconnected');
    _logWs('conn', { event: 'close', url: this.url, retry: this.retry, level: this._userClosed ? 'info' : 'warn' });
    if (this._userClosed) return; // 主动关闭不重连
    this._tryReconnect();
  }

  // 错误
  _onError() {
    this.connecting = false;
    this.connected = false;
    GameGlobal.databus && (GameGlobal.databus.netStatus = 'disconnected');
    eventBus.emit('netStatus', 'disconnected');
    _logWs('conn', { event: 'error', url: this.url, retry: this.retry, level: 'error' });
    if (this._userClosed) return;
    this._tryReconnect();
  }

  // 重连：仅对局场景中才触发；大厅场景不依赖 Socket
  _tryReconnect() {
    const databus = GameGlobal.databus;
    if (!databus || databus.scene !== SCENES.ROOM) {
      // 大厅不重连，重置重试计数以免干扰后续升级
      this.retry = 0;
      return;
    }
    if (this.retry >= MAX_RETRY) {
      eventBus.emit('netStatus', 'failed');
      if (GameGlobal.toast) GameGlobal.toast.show('网络连接已断开');
      return;
    }
    this.retry++;
    GameGlobal.databus && (GameGlobal.databus.netStatus = 'reconnecting');
    eventBus.emit('netStatus', 'reconnecting');
    _logWs('conn', { event: 'reconnect', url: this.url, retry: this.retry, level: 'warn' });
    if (GameGlobal.toast) GameGlobal.toast.show(`重连中…(${this.retry}/${MAX_RETRY})`, 1200);
    // 云通道分支不依赖 url，传空串即可让 connect() 走云通道；降级链路则继续使用原 url
    const reUrl = this._cloudMode ? '' : this.url;
    setTimeout(() => this.connect(reUrl), 1500);
  }

  // 注册指定 type 的处理器
  on(type, fn) {
    if (!this.handlers[type]) this.handlers[type] = [];
    this.handlers[type].push(fn);
  }

  // 取消订阅
  off(type, fn) {
    if (!this.handlers[type]) return;
    this.handlers[type] = this.handlers[type].filter((f) => f !== fn);
  }

  // 发送消息
  send(type, data = {}) {
    const reqId = ++this.reqSeq;
    const payload = { type, data, reqId };
    _logWs('send', { type, reqId, data });
    if (!this.connected) {
      this.pendingQueue.push(payload);
      return reqId;
    }
    this._rawSend(payload);
    return reqId;
  }

  // 真正发送
  _rawSend(payload) {
    const text = JSON.stringify(payload);
    try {
      if (this.socket.send) {
        // 微信 socketTask（含 connectContainer / connectSocket）: send({ data })
        if (this._cloudMode || (typeof wx !== 'undefined' && wx.connectSocket)) {
          this.socket.send({ data: text });
        } else {
          this.socket.send(text);
        }
      }
    } catch (e) {
      console.warn('发送失败', e);
    }
  }
}
