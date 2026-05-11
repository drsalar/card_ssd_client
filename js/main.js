// 客户端入口 - 十三张多人棋牌
import './render'; // 初始化 Canvas
import DataBus, { SCENES } from './databus';
import SceneManager from './scenes/scene_manager';
import SocketClient from './net/socket_client';
import Toast from './ui/Toast';

const ctx = canvas.getContext('2d');

// 全局单例
GameGlobal.databus = new DataBus();
GameGlobal.sceneManager = new SceneManager();
GameGlobal.socket = new SocketClient();
GameGlobal.toast = new Toast();

// WebSocket / HTTP 默认地址（同源同端口；可在外部通过 GameGlobal 注入覆盖）
if (typeof GameGlobal.SOCKET_URL !== 'string' || !GameGlobal.SOCKET_URL) {
  GameGlobal.SOCKET_URL = 'ws://127.0.0.1/ws';
}
if (typeof GameGlobal.HTTP_BASE !== 'string' || !GameGlobal.HTTP_BASE) {
  GameGlobal.HTTP_BASE = 'http://127.0.0.1';
}

/**
 * 游戏主函数
 */
export default class Main {
  aniId = 0;

  constructor() {
    // 初始化用户信息（小游戏环境取 openid 失败时使用本地随机 ID）
    this.initUser();

    // 初始化场景
    GameGlobal.sceneManager.init();

    // 绑定全局触摸事件
    wx.onTouchStart && wx.onTouchStart((e) => GameGlobal.sceneManager.onTouchStart(e));
    wx.onTouchMove && wx.onTouchMove((e) => GameGlobal.sceneManager.onTouchMove(e));
    wx.onTouchEnd && wx.onTouchEnd((e) => GameGlobal.sceneManager.onTouchEnd(e));

    // 启动主循环
    this.aniId = requestAnimationFrame(this.loop.bind(this));

    // 不在启动时建立 WebSocket：大厅仅使用 HTTP，进入房间动作时再升级 WS
    this._bindAppLifecycle();
  }

  // 初始化用户信息
  initUser() {
    const databus = GameGlobal.databus;
    // 微信小游戏 openid 需要通过 wx.login + 服务端换取，此处简化：
    // 使用 storage 中的随机 ID 作为身份标识
    let openid = '';
    try {
      openid = wx.getStorageSync && wx.getStorageSync('openid');
    } catch (e) {}
    if (!openid) {
      openid = 'guest_' + Math.random().toString(36).slice(2, 10);
      try { wx.setStorageSync && wx.setStorageSync('openid', openid); } catch (e) {}
    }
    databus.user.openid = openid;
    databus.user.nickname = '玩家' + openid.slice(-4);
    databus.user.avatarUrl = '';
  }

  // 监听微信小游戏前后台切换：进入前台时若处于对局且 socket 已死则触发重连
  _bindAppLifecycle() {
    if (typeof wx === 'undefined') return;
    if (typeof wx.onShow === 'function') {
      wx.onShow(() => {
        const databus = GameGlobal.databus;
        if (!databus) return;
        if (databus.scene !== SCENES.ROOM) return;
        const sock = GameGlobal.socket;
        if (sock && !sock.connected && !sock.connecting) {
          sock.connect(GameGlobal.SOCKET_URL);
        }
      });
    }
    // wx.onHide 不主动断开，依赖原生层维持
  }

  // 主循环
  loop() {
    GameGlobal.sceneManager.update();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    GameGlobal.sceneManager.render(ctx);
    GameGlobal.toast.render(ctx);
    this.aniId = requestAnimationFrame(this.loop.bind(this));
  }
}
