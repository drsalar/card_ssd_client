// 客户端入口 - 十三张多人棋牌
import { SCREEN_WIDTH, SCREEN_HEIGHT, CANVAS_DPR } from './render'; // 初始化 Canvas
import DataBus, { SCENES } from './databus';
import SceneManager from './scenes/scene_manager';
import SocketClient from './net/socket_client';
import Toast from './ui/Toast';
import Music from './runtime/music';
// 调试日志模块（按 GameGlobal.DEBUG_LOG 开关启用）
import { getLogStore } from './debug/log_store';
import { installConsoleHook } from './debug/console_hook';
import LogPanel from './debug/log_panel';
import LogButton from './debug/log_button';
import { readCachedUserInfo } from './utils/wx_user';

const ctx = canvas.getContext('2d');

// 调试开关：默认开启日志采集；按钮默认隐藏，需要时设为 true
if (typeof GameGlobal.DEBUG_LOG === 'undefined') {
  GameGlobal.DEBUG_LOG = true;
}
if (typeof GameGlobal.DEBUG_LOG_BUTTON === 'undefined') {
  GameGlobal.DEBUG_LOG_BUTTON = false;
}

// 调试模块初始化（必须早于 SocketClient/Toast，以便首批日志被收集）
if (GameGlobal.DEBUG_LOG) {
  try {
    GameGlobal.logStore = getLogStore();
    installConsoleHook();
  } catch (e) { /* 静默 */ }
}

// 全局单例
GameGlobal.databus = new DataBus();
GameGlobal.sceneManager = new SceneManager();
GameGlobal.socket = new SocketClient();
GameGlobal.toast = new Toast();
GameGlobal.music = new Music();
GameGlobal.music.init();

// 调试 UI
if (GameGlobal.DEBUG_LOG) {
  try {
    GameGlobal.logPanel = new LogPanel(GameGlobal.logStore);
    if (GameGlobal.DEBUG_LOG_BUTTON) {
      GameGlobal.logButton = new LogButton(GameGlobal.logPanel, GameGlobal.logStore);
    }
  } catch (e) { /* 静默 */ }
}
// 云托管配置：env + service 集中管理（外部可通过 GameGlobal 预先注入覆盖）
if (typeof GameGlobal.CLOUD_ENV !== 'string' || !GameGlobal.CLOUD_ENV) {
  GameGlobal.CLOUD_ENV = 'prod-d1gy3h2lh5a169861';
}
if (typeof GameGlobal.CLOUD_SERVICE !== 'string' || !GameGlobal.CLOUD_SERVICE) {
  GameGlobal.CLOUD_SERVICE = 'golang-8gye';
}

// 直连域名仅作为浏览器/降级链路的兜底，正式小游戏环境走云托管通道
// const url = 'ssd-256473-7-1431447952.sh.run.tcloudbase.com'
const url = 'golang-8gye-256614-7-1431447952.sh.run.tcloudbase.com'
if (typeof GameGlobal.SOCKET_URL !== 'string' || !GameGlobal.SOCKET_URL) {
  GameGlobal.SOCKET_URL = 'wss://'+url+'/ws';
}
if (typeof GameGlobal.HTTP_BASE !== 'string' || !GameGlobal.HTTP_BASE) {
  GameGlobal.HTTP_BASE = 'https://'+url;
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

    // 绑定全局触摸事件（调试 UI 优先消费）
    wx.onTouchStart && wx.onTouchStart((e) => this._dispatchTouchStart(e));
    wx.onTouchMove && wx.onTouchMove((e) => this._dispatchTouchMove(e));
    wx.onTouchEnd && wx.onTouchEnd((e) => this._dispatchTouchEnd(e));

    // 启动主循环
    this.aniId = requestAnimationFrame(this.loop.bind(this));

    // 不在启动时建立 WebSocket：大厅仅使用 HTTP，进入房间动作时再升级 WS
    this._bindAppLifecycle();
  }

  // 触摸分发：调试面板/按钮优先；未消费时再交场景
  _dispatchTouchStart(e) {
    try {
      const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
      if (t && GameGlobal.DEBUG_LOG) {
        // 面板打开时优先吃掉触摸
        if (GameGlobal.logPanel && GameGlobal.logPanel.handleTouchStart(t.clientX, t.clientY)) return;
        // LOG 按钮命中
        if (GameGlobal.DEBUG_LOG_BUTTON && GameGlobal.logButton && GameGlobal.logButton.handleTouch(t.clientX, t.clientY)) return;
      }
    } catch (err) { /* 隔离 */ }
    GameGlobal.sceneManager.onTouchStart(e);
  }
  _dispatchTouchMove(e) {
    try {
      const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
      if (t && GameGlobal.DEBUG_LOG && GameGlobal.logPanel && GameGlobal.logPanel.visible) {
        if (GameGlobal.logPanel.handleTouchMove(t.clientX, t.clientY)) return;
      }
    } catch (err) {}
    GameGlobal.sceneManager.onTouchMove(e);
  }
  _dispatchTouchEnd(e) {
    try {
      const t = (e.changedTouches && e.changedTouches[0]) || (e.touches && e.touches[0]);
      if (t && GameGlobal.DEBUG_LOG && GameGlobal.logPanel && GameGlobal.logPanel.visible) {
        if (GameGlobal.logPanel.handleTouchEnd(t.clientX, t.clientY)) return;
      }
    } catch (err) {}
    GameGlobal.sceneManager.onTouchEnd(e);
  }

  // 初始化用户信息
  initUser() {
    const databus = GameGlobal.databus;
    // 方案 B：在小游戏环境调 wx.login 取临时 code，由 lobby_scene 提交服务端解 code 换真实 openid。
    // 小游戏环境暂时使用本地缓存（或空字符串）作为 openid 占位，等服务端返回真实 openid 后再覆盖。
    let openid = '';
    try {
      openid = wx.getStorageSync && wx.getStorageSync('openid');
    } catch (e) {}
    if (!openid && (typeof wx === 'undefined' || typeof wx.login !== 'function')) {
      // 仅浏览器调试 / 无 wx.login 环境兜底（本地随机串）
      openid = 'guest_' + Math.random().toString(36).slice(2, 10);
      try { wx.setStorageSync && wx.setStorageSync('openid', openid); } catch (e) {}
    }
    databus.user.openid = openid;
    // 默认兜底昵称（未授权时显示，提示用户点击头像授权）
    databus.user.nickname = openid ? ('玩家' + openid.slice(-4)) : '玩家';
    databus.user.avatarUrl = '';
    // 优先使用本地缓存（上次成功授权后保存的微信资料），避免显示「玩家xxxx」
    // 注意：微信小游戏自基础库 2.27.1 起，wx.getUserInfo 返回的昵称会被强制改为「微信用户」、
    // 头像为灰色默认头像；wx.getUserProfile 在小游戏端已废弃。真实的昵称/头像必须通过
    // wx.createUserInfoButton 由用户主动点击触发授权，相关按钮由 LobbyScene 创建并管理。
    const cached = readCachedUserInfo();
    if (cached) {
      if (cached.nickname) databus.user.nickname = cached.nickname;
      if (cached.avatarUrl) databus.user.avatarUrl = cached.avatarUrl;
    }
    // 异步调 wx.login 取 code，缓存到 databus 供 _httpLogin 使用
    if (typeof wx !== 'undefined' && typeof wx.login === 'function') {
      try {
        wx.login({
          success: (res) => {
            if (res && res.code) databus.user._loginCode = res.code;
          },
          fail: () => {},
        });
      } catch (e) { /* 静默 */ }
    }
  }

  // 监听微信小游戏前后台切换：
  // - ROOM 场景：socket 已死时触发重连
  // - LOBBY 场景：发出 lobby:refresh 事件，由大厅场景刷新 activeRoom
  _bindAppLifecycle() {
    if (typeof wx === 'undefined') return;
    if (typeof wx.onShow === 'function') {
      wx.onShow(() => {
        if (GameGlobal.music && typeof GameGlobal.music.playBgm === 'function') {
          GameGlobal.music.playBgm();
        }
        const databus = GameGlobal.databus;
        if (!databus) return;
        // 大厅场景：回前台时刷新 activeRoom，避免长时间在后台后状态过期
        if (databus.scene === SCENES.LOBBY) {
          try {
            const eventBus = require('./utils/event_bus').default;
            eventBus.emit('lobby:refresh');
          } catch (e) { /* 静默 */ }
          return;
        }
        if (databus.scene !== SCENES.ROOM) return;
        const sock = GameGlobal.socket;
        if (sock && !sock.connected && !sock.connecting) {
          // 由 socket_client 内部决策走云通道还是降级 URL
          sock.connect();
        }
      });
    }
    // wx.onHide 不主动断开，依赖原生层维持
  }

  // 主循环
  loop() {
    GameGlobal.sceneManager.update();
    ctx.save();
    if (ctx.setTransform) ctx.setTransform(CANVAS_DPR, 0, 0, CANVAS_DPR, 0, 0);
    else ctx.scale(CANVAS_DPR, CANVAS_DPR);
    ctx.clearRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    GameGlobal.sceneManager.render(ctx);
    GameGlobal.toast.render(ctx);
    // 调试 UI（顶层覆盖）
    if (GameGlobal.DEBUG_LOG) {
      try {
        if (GameGlobal.logPanel) GameGlobal.logPanel.render(ctx);
        if (GameGlobal.DEBUG_LOG_BUTTON && GameGlobal.logButton) GameGlobal.logButton.render(ctx);
      } catch (e) {}
    }
    ctx.restore();
    this.aniId = requestAnimationFrame(this.loop.bind(this));
  }
}
