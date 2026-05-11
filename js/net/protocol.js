// 通信协议常量 - 客户端与服务端共享
// 消息格式: { type, data, reqId }
// 错误响应: { type: 'ERROR', code, msg, reqId }

export const MSG = {
  // 连接 / 身份
  LOGIN: 'LOGIN',
  LOGIN_OK: 'LOGIN_OK',

  // 房间
  CREATE_ROOM: 'CREATE_ROOM',
  CREATE_ROOM_OK: 'CREATE_ROOM_OK',
  JOIN_ROOM: 'JOIN_ROOM',
  JOIN_ROOM_OK: 'JOIN_ROOM_OK',
  LEAVE_ROOM: 'LEAVE_ROOM',
  LEAVE_ROOM_OK: 'LEAVE_ROOM_OK',
  ROOM_STATE: 'ROOM_STATE',          // 房间状态广播

  // 准备 / 开局
  READY: 'READY',
  UNREADY: 'UNREADY',

  // 发牌、放牌、开牌
  DEAL_CARDS: 'DEAL_CARDS',          // 服务端 → 玩家私发手牌
  SUBMIT_LANES: 'SUBMIT_LANES',      // 玩家 → 服务端：提交三道
  SUBMIT_LANES_OK: 'SUBMIT_LANES_OK',

  // 比牌结算
  SETTLE_RESULT: 'SETTLE_RESULT',

  // 下一局确认
  ROUND_CONFIRM: 'ROUND_CONFIRM',

  // 整场结束
  MATCH_END: 'MATCH_END',

  // 断线重连：服务端→客户端 单播快照
  RECONNECT_SNAPSHOT: 'RECONNECT_SNAPSHOT',

  // 电脑玩家
  ROOM_ADD_BOT: 'ROOM_ADD_BOT',
  ROOM_ADD_BOT_OK: 'ROOM_ADD_BOT_OK',
  ROOM_KICK_BOT: 'ROOM_KICK_BOT',
  ROOM_KICK_BOT_OK: 'ROOM_KICK_BOT_OK',

  // 错误
  ERROR: 'ERROR',
};

// 错误码
export const ERR = {
  ROOM_NOT_FOUND: 1001,
  ROOM_FULL: 1002,
  ROOM_PLAYING: 1003,
  NOT_IN_ROOM: 1004,
  INVALID_LANES: 1005,
  NOT_LOGGED_IN: 1006,
  ALREADY_IN_ROOM: 1007,
  BAD_REQUEST: 1008,
  NOT_HOST: 1009,
  ROOM_NOT_WAITING: 1010,
};
