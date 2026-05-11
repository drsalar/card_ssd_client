// 主页 / 大厅场景
// - 大厅仅使用 HTTP：onEnter 调用 POST /api/login 获取 activeRoom
// - 创建房间 / 加入房间 / 重新进入：先建立 WebSocket，等待 LOGIN_OK 后再发送对应消息
import { SCREEN_WIDTH, SCREEN_HEIGHT } from '../render';
import Button from '../ui/Button';
import { MSG, ERR } from '../net/protocol';
import eventBus from '../utils/event_bus';
import { SCENES } from '../databus';
import httpClient from '../net/http_client';

// 规则配置面板
class RuleConfigPanel {
  constructor(onConfirm, onCancel) {
    this.visible = false;
    this.onConfirm = onConfirm;
    this.onCancel = onCancel;
    this.withMa = true;
    this.totalRounds = 5;
    this.maxPlayers = 4;
    this.width = Math.min(SCREEN_WIDTH * 0.85, 320);
    this.height = 320;
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
    // 人数选项
    const counts = [2, 3, 4, 5, 6];
    this.countBtns = counts.map((n, i) => new Button({
      x: this.x + 16 + i * 52, y: baseY + 190,
      width: 44, height: 32, text: `${n}人`, fontSize: 14,
      bgColor: n === this.maxPlayers ? '#4a90e2' : '#bbb',
      onClick: () => {
        this.maxPlayers = n;
        this.countBtns.forEach((b, j) => { b.bgColor = counts[j] === n ? '#4a90e2' : '#bbb'; });
      },
    }));
    // 确认/取消
    this.confirmBtn = new Button({
      x: this.x + this.width / 2 + 10, y: this.y + this.height - 50,
      width: 100, height: 36, text: '创建',
      onClick: () => { this.visible = false; this.onConfirm({ withMa: this.withMa, totalRounds: this.totalRounds, maxPlayers: this.maxPlayers }); },
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
    ctx.fillText('是否带马牌（红桃5双倍）', this.x + 16, this.y + 66);
    ctx.fillText('对局局数', this.x + 16, this.y + 100);
    ctx.fillText('最大玩家数', this.x + 16, this.y + 170);
    ctx.restore();
    this.maBtn.render(ctx);
    this.roundBtns.forEach((b) => b.render(ctx));
    this.countBtns.forEach((b) => b.render(ctx));
    this.confirmBtn.render(ctx);
    this.cancelBtn.render(ctx);
  }

  handleTouch(x, y) {
    if (!this.visible) return false;
    if (this.maBtn.handleTouch(x, y)) return true;
    if (this.roundBtns.some((b) => b.handleTouch(x, y))) return true;
    if (this.countBtns.some((b) => b.handleTouch(x, y))) return true;
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
    sock.connect(GameGlobal.SOCKET_URL);
  }

  // 调用 HTTP 登录接口，刷新 activeRoom
  _httpLogin() {
    const user = GameGlobal.databus.user;
    httpClient.post('/api/login', {
      openid: user.openid,
      nickname: user.nickname,
      avatarUrl: user.avatarUrl,
    }).then((res) => {
      // 已经在房间场景里则不刷新（防止 race）
      if (GameGlobal.databus.scene !== SCENES.LOBBY) return;
      const ar = res && res.activeRoom;
      this.activeRoom = (ar && ar.roomId) ? ar : null;
      this._loginFailed = false;
    }).catch((err) => {
      console.warn('HTTP 登录失败', err);
      this._loginFailed = true;
      GameGlobal.toast.show('登录失败，点击重试');
    });
  }

  onEnter() {
    // 进入大厅时调用 HTTP 登录刷新 activeRoom
    this.activeRoom = null;
    this._loginFailed = false;
    this._httpLogin();
  }
  onExit() {}
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
    // 网络状态
    const netStatus = GameGlobal.databus.netStatus;
    const statusMap = {
      disconnected: { text: '离线', color: '#e57373' },
      connecting: { text: '连接中...', color: '#ffd54f' },
      connected: { text: '已连接', color: '#81c784' },
    };
    const st = statusMap[netStatus] || statusMap.disconnected;
    ctx.fillStyle = st.color;
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`● ${st.text}`, SCREEN_WIDTH - 12, 12);
    // 用户信息
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.fillText(GameGlobal.databus.user.nickname, 12, 12);

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
    if (this.activeRoom && this.reenterBtn.handleTouch(x, y)) return;
    if (this.createBtn.handleTouch(x, y)) return;
    if (this.joinBtn.handleTouch(x, y)) return;
  }
  onTouchMove() {}
  onTouchEnd() {}
}
