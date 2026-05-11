// 全局数据管理 - 十三张多人棋牌
// 单例模式，统一管理客户端运行时状态

let instance;

// 场景枚举
export const SCENES = {
  LOBBY: 'lobby',   // 主页
  ROOM: 'room',     // 对局/房间页
};

// 房间阶段
export const ROOM_PHASE = {
  WAITING: 'waiting',     // 等待准备
  PLAYING: 'playing',     // 已发牌、放牌中
  COMPARING: 'comparing', // 比牌动画中
  SETTLED: 'settled',     // 本局结束、统计中
  MATCH_END: 'match_end', // 整场对局结束
};

export default class DataBus {
  // 用户信息
  user = {
    openid: '',     // 唯一身份标识（无登录则使用本地 mock）
    nickname: '',   // 昵称
    avatarUrl: '',  // 头像
  };

  // 当前场景
  scene = SCENES.LOBBY;

  // 网络连接状态
  netStatus = 'disconnected'; // disconnected | connecting | connected

  // 房间状态（来自服务端 ROOM_STATE 广播）
  room = null; // { id, rule, hostId, phase, currentRound, players: [{openid,nickname,avatarUrl,score,ready,offline,submitted}], maxPlayers }

  // 客户端本地手牌与三道
  myHand = [];        // 当前剩余手牌
  myLanes = {         // 三道（已放置）
    head: [],
    middle: [],
    tail: [],
  };
  selectedCards = []; // 当前选中的手牌索引

  // 排序方式：suit | rank
  sortMode = 'rank';

  // 本局结算结果（来自服务端 SETTLE_RESULT）
  settleResult = null;

  constructor() {
    if (instance) return instance;
    instance = this;
  }

  // 重置全部状态（仅在切换主入口时使用）
  reset() {
    this.scene = SCENES.LOBBY;
    this.room = null;
    this.resetRound();
  }

  // 重置一局相关状态
  resetRound() {
    this.myHand = [];
    this.myLanes = { head: [], middle: [], tail: [] };
    this.selectedCards = [];
    this.sortMode = 'rank';
    this.settleResult = null;
  }

  // 应用断线重连快照，恢复手牌、三道、结算结果等
  applyReconnectSnapshot(snap) {
    if (!snap) return;
    // 手牌：snap.hand 为 null 时清空
    this.myHand = Array.isArray(snap.hand) ? snap.hand.slice() : [];
    // 三道：服务端返回 lanes 时使用，否则清空
    if (snap.lanes && (snap.lanes.head || snap.lanes.middle || snap.lanes.tail)) {
      this.myLanes = {
        head: (snap.lanes.head || []).slice(),
        middle: (snap.lanes.middle || []).slice(),
        tail: (snap.lanes.tail || []).slice(),
      };
    } else {
      this.myLanes = { head: [], middle: [], tail: [] };
    }
    // 选中态归零
    this.selectedCards = [];
    // 结算结果：仅 comparing / match_end 阶段会带回
    this.settleResult = snap.lastSettle || null;
  }

  // 持久化最近房间号到本地（仅微信小游戏环境）
  persistRoomId(roomId) {
    if (!roomId) return;
    if (typeof wx !== 'undefined' && typeof wx.setStorageSync === 'function') {
      try { wx.setStorageSync('lastRoomId', String(roomId)); } catch (e) {}
    }
  }

  // 清除本地房间号缓存
  clearRoomId() {
    if (typeof wx !== 'undefined' && typeof wx.removeStorageSync === 'function') {
      try { wx.removeStorageSync('lastRoomId'); } catch (e) {}
    }
  }
}
