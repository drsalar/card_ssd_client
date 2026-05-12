// 主页 / 大厅场景
// - 大厅仅使用 HTTP：onEnter 调用 POST /api/login 获取 activeRoom
// - 创建房间 / 加入房间 / 重新进入：先建立 WebSocket，等待 LOGIN_OK 后再发送对应消息
import { SCREEN_WIDTH, SCREEN_HEIGHT } from '../render';
import Button from '../ui/Button';
import BgmToggleButton from '../ui/BgmToggleButton';
import Avatar from '../ui/Avatar';
import { MSG, ERR } from '../net/protocol';
import eventBus from '../utils/event_bus';
import { SCENES } from '../databus';
import httpClient from '../net/http_client';
import { createUserInfoAuthButton, pickUserInfo } from '../utils/wx_user';

// 规则配置面板：创建房间仅设马牌 + 局数；人数不再选择（服务端固定上限 6）
class RuleConfigPanel {
  constructor(onConfirm, onCancel) {
    this.visible = false;
    this.onConfirm = onConfirm;
    this.onCancel = onCancel;
    this.withMa = true;
    this.totalRounds = 5;
    this.width = Math.min(SCREEN_WIDTH * 0.85, 320);
    this.height = 250;
    this.x = (SCREEN_WIDTH - this.width) / 2;
    this.y = (SCREEN_HEIGHT - this.height) / 2;
    this._buildButtons();
  }

  _buildButtons() {
    const baseY = this.y;
    // 马牌开关
    this.maBtn = new Button({
      x: this.x + this.width - 80, y: baseY + 60,
      width: 60, height: 28, text: this.withMa ? '开' : '关', fontSize: 14,
      bgColor: this.withMa ? '#4a90e2' : '#999',
      onClick: () => { this.withMa = !this.withMa; this.maBtn.text = this.withMa ? '开' : '关'; this.maBtn.bgColor = this.withMa ? '#4a90e2' : '#999'; },
    });
    // 局数选项
    const rounds = [5, 10, 15, 20];
    this.roundBtns = rounds.map((r, i) => new Button({
      x: this.x + 16 + i * 64, y: baseY + 120,
      width: 56, height: 32, text: `${r}局`, fontSize: 14,
      bgColor: r === this.totalRounds ? '#4a90e2' : '#bbb',
      onClick: () => {
        this.totalRounds = r;
        this.roundBtns.forEach((b, j) => { b.bgColor = rounds[j] === r ? '#4a90e2' : '#bbb'; });
      },
    }));
    // 确认/取消
    this.confirmBtn = new Button({
      x: this.x + this.width / 2 + 10, y: this.y + this.height - 50,
      width: 100, height: 36, text: '创建',
      onClick: () => { this.visible = false; this.onConfirm({ withMa: this.withMa, totalRounds: this.totalRounds }); },
    });
    this.cancelBtn = new Button({
      x: this.x + this.width / 2 - 110, y: this.y + this.height - 50,
      width: 100, height: 36, text: '取消', bgColor: '#999',
      onClick: () => { this.visible = false; if (this.onCancel) this.onCancel(); },
    });
  }

  show() { this.visible = true; }
  hide() { this.visible = false; }

  render(ctx) {
    if (!this.visible) return;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    ctx.fillStyle = '#fff';
    ctx.fillRect(this.x, this.y, this.width, this.height);
    ctx.fillStyle = '#333';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('创建房间', this.x + this.width / 2, this.y + 16);
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('是否带马牌（红桃 5 双倍）', this.x + 16, this.y + 66);
    ctx.fillText('对局局数', this.x + 16, this.y + 100);
    ctx.restore();
    this.maBtn.render(ctx);
    this.roundBtns.forEach((b) => b.render(ctx));
    this.confirmBtn.render(ctx);
    this.cancelBtn.render(ctx);
  }

  handleTouch(x, y) {
    if (!this.visible) return false;
    if (this.maBtn.handleTouch(x, y)) return true;
    if (this.roundBtns.some((b) => b.handleTouch(x, y))) return true;
    if (this.confirmBtn.handleTouch(x, y)) return true;
    if (this.cancelBtn.handleTouch(x, y)) return true;
    return true; // 蒙层吞事件
  }
}
// 房间号输入面板
class RoomIdInputPanel {
  constructor(onConfirm, onCancel) {
    this.visible = false;
    this.onConfirm = onConfirm;
    this.onCancel = onCancel;
    this.input = '';
    this.width = Math.min(SCREEN_WIDTH * 0.85, 300);
    this.height = 330;
    this.x = (SCREEN_WIDTH - this.width) / 2;
    this.y = (SCREEN_HEIGHT - this.height) / 2;
    this._buildKeypad();
  }

  _buildKeypad() {
    const keys = ['1','2','3','4','5','6','7','8','9','clr','0','del'];
    const cols = 3, w = 60, h = 34, gap = 8;
    const startX = this.x + (this.width - cols * w - (cols - 1) * gap) / 2;
    const startY = this.y + 92;
    this.keys = keys.map((k, i) => {
      const r = Math.floor(i / cols), c = i % cols;
      return new Button({
        x: startX + c * (w + gap), y: startY + r * (h + gap),
        width: w, height: h, text: k === 'clr' ? '清空' : k === 'del' ? '删除' : k, fontSize: 14,
        bgColor: (k === 'clr' || k === 'del') ? '#bbb' : '#4a90e2',
        onClick: () => {
          if (k === 'clr') this.input = '';
          else if (k === 'del') this.input = this.input.slice(0, -1);
          else if (this.input.length < 4) this.input += k;
        },
      });
    });
    // 键盘底部 = startY + 4*h + 3*gap = 92 + 136 + 24 = 252（相对面板顶部）
    // 确认/取消按钮放到键盘下方，留 16px 间距
    const btnY = this.y + this.height - 50;
    this.confirmBtn = new Button({
      x: this.x + this.width / 2 + 10, y: btnY,
      width: 80, height: 36, text: '确认',
      onClick: () => {
        if (this.input.length !== 4) return;
        this.visible = false;
        this.onConfirm(this.input);
      },
    });
    this.cancelBtn = new Button({
      x: this.x + this.width / 2 - 90, y: btnY,
      width: 80, height: 36, text: '取消', bgColor: '#999',
      onClick: () => { this.visible = false; if (this.onCancel) this.onCancel(); },
    });
  }

  show() { this.visible = true; this.input = ''; }
  hide() { this.visible = false; }

  render(ctx) {
    if (!this.visible) return;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    ctx.fillStyle = '#fff';
    ctx.fillRect(this.x, this.y, this.width, this.height);
    ctx.fillStyle = '#333';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('加入房间', this.x + this.width / 2, this.y + 16);
    // 输入框
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 1;
    ctx.strokeRect(this.x + 30, this.y + 50, this.width - 60, 30);
    ctx.fillStyle = '#222';
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.input || '____', this.x + this.width / 2, this.y + 65);
    ctx.restore();
    this.keys.forEach((b) => b.render(ctx));
    this.confirmBtn.render(ctx);
    this.cancelBtn.render(ctx);
  }

  handleTouch(x, y) {
    if (!this.visible) return false;
    if (this.keys.some((b) => b.handleTouch(x, y))) return true;
    if (this.confirmBtn.handleTouch(x, y)) return true;
    if (this.cancelBtn.handleTouch(x, y)) return true;
    return true;
  }
}

export default class LobbyScene {
  constructor() {
    // 主按钮
    const btnW = 200, btnH = 56;
    const cx = SCREEN_WIDTH / 2;
    // 「重新进入」按钮（仅当 activeRoom 非空时显示）
    this.activeRoom = null;
    this.reenterBtn = new Button({
      x: cx - btnW / 2, y: SCREEN_HEIGHT * 0.45 - btnH - 16,
      width: btnW, height: btnH, text: '重新进入', fontSize: 20,
      bgColor: '#e6a23c',
      onClick: () => this._doReenter(),
    });
    this.createBtn = new Button({
      x: cx - btnW / 2, y: SCREEN_HEIGHT * 0.45,
      width: btnW, height: btnH, text: '创建房间', fontSize: 20,
      onClick: () => this.rulePanel.show(),
    });
    this.joinBtn = new Button({
      x: cx - btnW / 2, y: SCREEN_HEIGHT * 0.45 + btnH + 16,
      width: btnW, height: btnH, text: '加入房间', fontSize: 20,
      bgColor: '#5cb85c',
      onClick: () => this.idPanel.show(),
    });
    this.bgmToggleBtn = new BgmToggleButton({ width: 72, height: 28, fontSize: 13 });

    // 自身头像（直径 36px，主页顶部 “头像 + 昵称” 居中显示）
    this.selfAvatar = new Avatar({ size: 36, fallbackText: GameGlobal.databus.user.nickname || '?' });
    if (GameGlobal.databus.user.avatarUrl) {
      this.selfAvatar.setUrl(GameGlobal.databus.user.avatarUrl);
    }
    // 透明的 UserInfoButton（在 onEnter 里创建，onExit 里销毁）
    this._userInfoBtn = null;
    // 最后一次渲染计算出的「头像+昵称」区域，用于同步 UserInfoButton 位置
    this._authRect = { left: 0, top: 0, width: 0, height: 0 };

    // 弹窗
    this.rulePanel = new RuleConfigPanel(
      (rule) => this._doCreateRoom(rule),
      null
    );
    this.idPanel = new RoomIdInputPanel(
      (id) => this._doJoinRoom(id),
      null
    );

    this._bindNet();
  }

  _bindNet() {
    eventBus.on(MSG.CREATE_ROOM_OK, (data) => {
      // 服务端会同时通过 ROOM_STATE 推送，跳转场景由 ROOM_STATE 触发
      GameGlobal.toast.show(`房间已创建：${data.roomId}`);
    });
    // 微信资料异步更新：刷新头像并重新上报到服务端
    eventBus.on('user_info_updated', (user) => {
      if (!user) return;
      this.selfAvatar.fallbackText = user.nickname || '?';
      this.selfAvatar.setUrl(user.avatarUrl || '');
      // 仅在大厅场景下才重新调 /api/login 同步 session
      if (GameGlobal.databus.scene === SCENES.LOBBY) {
        this._httpLogin();
      }
    });
    eventBus.on(MSG.JOIN_ROOM_OK, () => {
      GameGlobal.toast.show('加入成功');
    });
    eventBus.on(MSG.ROOM_STATE, (state) => {
      GameGlobal.databus.room = state;
      // 持久化最近房间号
      const me = state.players && state.players.find((p) => p.openid === GameGlobal.databus.user.openid);
      if (me) {
        GameGlobal.databus.persistRoomId(state.id);
      }
      // 在大厅时收到状态 → 跳转到房间
      if (GameGlobal.databus.scene === SCENES.LOBBY) {
        // 进房间后隐藏重进入按钮
        this.activeRoom = null;
        GameGlobal.sceneManager.switchTo(SCENES.ROOM);
      }
    });
    eventBus.on(MSG.ERROR, (data, msg) => {
      const code = msg && msg.code;
      const text = msg && msg.msg;
      const map = {
        [ERR.ROOM_NOT_FOUND]: '房间已不存在',
        [ERR.ROOM_FULL]: '房间已满',
        [ERR.ROOM_PLAYING]: '对局已开始',
      };
      GameGlobal.toast.show(map[code] || text || '操作失败');
      // 重进入请求返回 ROOM_NOT_FOUND → 隐藏重进入按钮
      if (code === ERR.ROOM_NOT_FOUND) {
        this.activeRoom = null;
      }
    });
    // 小程序回前台触发：仅在大厅时刷新 activeRoom（走只读接口，更轻量）
    eventBus.on('lobby:refresh', () => {
      if (GameGlobal.databus.scene === SCENES.LOBBY) {
        this.refreshActiveRoom();
      }
    });
  }

  // 点击重新进入：先建立 WS，再发送 JOIN_ROOM
  _doReenter() {
    if (!this.activeRoom || !this.activeRoom.roomId) return;
    const roomId = this.activeRoom.roomId;
    this._ensureSocketAndSend(() => {
      GameGlobal.socket.send(MSG.JOIN_ROOM, { roomId });
    });
  }

  _doCreateRoom(rule) {
    this._ensureSocketAndSend(() => {
      GameGlobal.socket.send(MSG.CREATE_ROOM, rule);
    });
  }

  _doJoinRoom(roomId) {
    this._ensureSocketAndSend(() => {
      GameGlobal.socket.send(MSG.JOIN_ROOM, { roomId });
    });
  }

  // 确保 WebSocket 已建立并已 LOGIN_OK，然后调用回调
  // - 已连接：直接执行
  // - 未连接：connect → 等待 LOGIN_OK → 执行回调
  // - 已处于 connecting 状态：用户主动点击意味着前一次握手可能已卡死，强制重连
  _ensureSocketAndSend(action) {
    const sock = GameGlobal.socket;
    if (sock && sock.connected) {
      action();
      return;
    }
    // 注册一次性 LOGIN_OK 监听
    const onLoginOk = () => {
      eventBus.off(MSG.LOGIN_OK, onLoginOk);
      action();
    };
    eventBus.on(MSG.LOGIN_OK, onLoginOk);
    GameGlobal.toast.show('连接服务器中...', 1500);
    // 用户主动入房：若已在 connecting 中，传 force=true 让 socket_client 强制重置后再连
    // 不传 URL：socket_client 内部优先走云托管 connectContainer，无云能力时降级到 GameGlobal.SOCKET_URL
    const force = !!(sock && sock.connecting);
    sock.connect(undefined, force);
  }

  // 仅刷新 activeRoom（只读接口，不修改服务端在线状态 / 不重发 wx.login code）
  // 适用场景：从后台切回前台、停留在大厅时定时刷新等
  // 失败时静默：保留上一次 activeRoom 状态，避免误把按钮抹掉
  refreshActiveRoom() {
    const user = GameGlobal.databus.user;
    if (!user || !user.openid) return;
    // 仍在大厅时才更新 UI；否则直接丢弃响应
    httpClient.get('/api/lobby/active-room', { openid: user.openid }).then((res) => {
      if (GameGlobal.databus.scene !== SCENES.LOBBY) return;
      const ar = res && res.activeRoom;
      this.activeRoom = (ar && ar.roomId) ? ar : null;
    }).catch((err) => {
      // 静默处理：仅日志告警，不弹 toast，不清空 activeRoom
      console.warn('刷新 activeRoom 失败', err);
    });
  }

  // 调用 HTTP 登录接口，刷新 activeRoom
  // 方案 B：优先以 wx.login 拿到的 code 发服务端解析真实 openid；
  //        服务端返回的 openid 覆盖到 storage 与 databus 中。
  _httpLogin() {
    const user = GameGlobal.databus.user;
    const code = user._loginCode || '';
    const body = {
      nickname: user.nickname,
      avatarUrl: user.avatarUrl,
    };
    if (code) {
      body.code = code;
    } else if (user.openid) {
      // 兜底：浏览器调试 / 老链路 → 仍然带 openid
      body.openid = user.openid;
    }
    httpClient.post('/api/login', body).then((res) => {
      // 已经在房间场景里则不刷新（防止 race）
      if (GameGlobal.databus.scene !== SCENES.LOBBY) return;
      // 服务端解析出来的真实 openid 覆盖本地（仅 wx.login 链路才会回填）
      if (res && res.openid && res.openid !== user.openid) {
        user.openid = res.openid;
        try { wx.setStorageSync && wx.setStorageSync('openid', res.openid); } catch (e) {}
      }
      // code 仅一次性使用，成功后清除避免重发
      user._loginCode = '';
      const ar = res && res.activeRoom;
      this.activeRoom = (ar && ar.roomId) ? ar : null;
      this._loginFailed = false;
      // 登录成功后：若此设备从未填写过头像昵称，弹出一次引导流程（仅本进程弹一次）
      this._maybePromptFirstTime();
    }).catch((err) => {
      console.warn('HTTP 登录失败', err);
      this._loginFailed = true;
      // code 失败的话也要丢弃，下次进入大厅会重新 wx.login
      user._loginCode = '';
      GameGlobal.toast.show('登录失败，点击重试');
    });
  }

  onEnter() {
    // 进入大厅时调用 HTTP 登录刷新 activeRoom
    this.activeRoom = null;
    this._loginFailed = false;
    // 若 main.js 启动时的 wx.login 还没回 / 已被消费，再尝试取一次 code
    const user = GameGlobal.databus.user;
    if (!user._loginCode && typeof wx !== 'undefined' && typeof wx.login === 'function') {
      try {
        wx.login({
          success: (res) => {
            if (res && res.code) user._loginCode = res.code;
            this._httpLogin();
          },
          fail: () => { this._httpLogin(); },
        });
      } catch (e) { this._httpLogin(); }
    } else {
      this._httpLogin();
    }
    // 不再叠加透明 UserInfoButton：新版本基础库下 wx.getUserInfo 返回的都是「微信用户 + 灰色默认头像」，
    // 原生按钮反而会吸走点击事件。统一由 canvas 层头像区域点击 → pickUserInfo（chooseMedia + showModal）获取。
  }

  // 把新获得的微信资料写回 databus + 刷新头像 + 触发重新上报
  _applyUserInfo(info) {
    if (!info) return;
    const u = GameGlobal.databus.user;
    if (info.nickname) u.nickname = info.nickname;
    if (info.avatarUrl) u.avatarUrl = info.avatarUrl;
    this.selfAvatar.fallbackText = u.nickname || '?';
    this.selfAvatar.setUrl(u.avatarUrl || '');
    try { eventBus.emit('user_info_updated', { ...u }); } catch (e) {}
  }

  // 命中头像+昵称区域：弹 ActionSheet 选「换头像 / 改昵称」
  _handleAvatarTap() {
    if (typeof wx === 'undefined' || typeof wx.showActionSheet !== 'function') {
      // 非微信环境：直接走完整流程
      this._pick('both');
      return;
    }
    wx.showActionSheet({
      itemList: ['换头像', '改昵称'],
      success: (r) => {
        if (r.tapIndex === 0) this._pick('avatar');
        else if (r.tapIndex === 1) this._pick('nickname');
      },
      fail: () => {},
    });
  }

  // 单一入口：调起 pickUserInfo
  _pick(mode, extra = {}) {
    const ok = pickUserInfo((info) => {
      this._applyUserInfo(info);
      GameGlobal.toast.show('资料已更新');
    }, Object.assign({
      mode,
      currentNickname: GameGlobal.databus.user && GameGlobal.databus.user.nickname,
    }, extra));
    if (!ok) {
      GameGlobal.toast.show('当前环境不支持');
    }
  }

  // 登录成功后：首次没填写过头像昵称时弹出引导
  _maybePromptFirstTime() {
    if (this._firstTimePrompted) return;
    const u = GameGlobal.databus.user;
    const hasAvatar = !!(u && u.avatarUrl);
    const nick = (u && u.nickname) || '';
    const isDefaultNick = !nick || /^玩家[0-9a-zA-Z]+$/.test(nick);
    if (hasAvatar && !isDefaultNick) {
      // 已经有自定义头像 + 昵称，不需要引导
      this._firstTimePrompted = true;
      return;
    }
    this._firstTimePrompted = true;
    this._pick('both', { firstTime: true });
  }
  onExit() {
    // 离开大厅（进房间 / 切场景）隐藏按钮，避常驻画面
    if (this._userInfoBtn) this._userInfoBtn.hide();
  }
  update() {}

  render(ctx) {
    // 背景
    const grad = ctx.createLinearGradient(0, 0, 0, SCREEN_HEIGHT);
    grad.addColorStop(0, '#1a3b5e');
    grad.addColorStop(1, '#2a6f97');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    // 标题
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 36px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('十三张', SCREEN_WIDTH / 2, SCREEN_HEIGHT * 0.18);
    ctx.font = '16px sans-serif';
    ctx.fillText('多人在线棋牌', SCREEN_WIDTH / 2, SCREEN_HEIGHT * 0.18 + 50);
    // 顶部信息栏 y 坐标（下移到刘海/状态栏之下）
    const topY = 60;
    // 仅在 HTTP 登录失败时展示「服务异常，点击重试」提示；大厅不依赖 WS，不再渲染 netStatus
    if (this._loginFailed) {
      ctx.fillStyle = '#e57373';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText('服务异常，点击重试', 12, topY);
    }
    this.bgmToggleBtn.setPosition(12, topY + 22);
    this.bgmToggleBtn.render(ctx);
    // 玩家名称（顶部居中，避开刘海与状态栏）
    // 在昵称左侧绘制圆形头像，整体水平居中
    const user = GameGlobal.databus.user;
    const nickname = user.nickname || '';
    const avatarSize = 36;
    const gap = 8;
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const nameW = ctx.measureText(nickname).width;
    const groupW = avatarSize + gap + nameW;
    const groupX = (SCREEN_WIDTH - groupW) / 2;
    const groupCenterY = topY + avatarSize / 2;
    // 头像
    this.selfAvatar.fallbackText = nickname || '?';
    this.selfAvatar.setUrl(user.avatarUrl || '');
    this.selfAvatar.render(ctx, groupX, topY, avatarSize);
    // 昵称
    ctx.fillStyle = '#fff';
    ctx.fillText(nickname, groupX + avatarSize + gap, groupCenterY);
    // 提示文本（未拿到真实微信资料时提示点击授权）
    if (!user.avatarUrl) {
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('点击头像设置头像与昵称', SCREEN_WIDTH / 2, topY + avatarSize + 6);
    }
    // 同步 UserInfoButton 位置到「头像+昵称」起始区域（点击该区域授权）
    this._authRect.left = groupX;
    this._authRect.top = topY;
    this._authRect.width = Math.max(avatarSize, groupW);
    this._authRect.height = avatarSize;
    if (this._userInfoBtn) {
      this._userInfoBtn.setPosition(
        this._authRect.left,
        this._authRect.top,
        this._authRect.width,
        this._authRect.height,
      );
    }

    // 主按钮
    if (this.activeRoom) {
      this.reenterBtn.text = `重新进入（${this.activeRoom.roomId}）`;
      this.reenterBtn.render(ctx);
    }
    this.createBtn.render(ctx);
    this.joinBtn.render(ctx);

    // 弹窗
    this.rulePanel.render(ctx);
    this.idPanel.render(ctx);
  }

  onTouchStart(e) {
    const t = e.touches[0] || e.changedTouches[0];
    if (!t) return;
    const x = t.clientX, y = t.clientY;
    // 登录失败状态下点击屏幕重试
    if (this._loginFailed) {
      this._httpLogin();
      return;
    }
    // 优先弹窗
    if (this.rulePanel.visible) { this.rulePanel.handleTouch(x, y); return; }
    if (this.idPanel.visible) { this.idPanel.handleTouch(x, y); return; }
    if (this.bgmToggleBtn.handleTouch(x, y)) return;
    // 头像+昵称区域命中 → 触发头像昵称填写能力（兜底，因新版本基础库下 UserInfoButton 已无法拿到真实资料）
    const r = this._authRect;
    if (r && r.width > 0 && r.height > 0 &&
        x >= r.left && x <= r.left + r.width &&
        y >= r.top && y <= r.top + r.height) {
      this._handleAvatarTap();
      return;
    }
    if (this.activeRoom && this.reenterBtn.handleTouch(x, y)) return;
    if (this.createBtn.handleTouch(x, y)) return;
    if (this.joinBtn.handleTouch(x, y)) return;
  }
  onTouchMove() {}
  onTouchEnd() {}
}
