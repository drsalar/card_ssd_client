# 实施计划

- [ ] 1. 项目结构改造与清理
   - 删除原飞机射击代码：`js/npc/`、`js/player/bullet.js`、`js/player/index.js`、`js/runtime/background.js`、`js/runtime/gameinfo.js` 及不再使用的 `images/enemy.png`、`images/bullet.png`、`images/explosion*.png`、`images/hero.png`
   - 在 `js/` 下新建目录：`scenes/`、`net/`、`game/`、`ui/`、`utils/`
   - 在项目根目录新建 `server/` 目录用于服务端代码
   - 更新 `README.md` 反映新的目录结构
   - 重写 `js/databus.js` 为全局单例：保存当前用户信息、当前场景、房间状态、手牌、三道、积分等
   - 重写 `js/main.js` 与 `game.js` 为场景调度入口（首屏 → 主页场景）
   - _需求：1.1, 1.2, 1.3, 1.4, 1.5_

- [ ] 2. 通用 UI 与基础设施
- [ ] 2.1 通用 UI 组件
   - 在 `js/ui/` 新建 `Button.js`（按钮）、`Modal.js`（弹窗，含输入框/开关/单选）、`Toast.js`（轻提示）、`Avatar.js`（头像绘制，支持加载微信头像 URL）
   - 在 `js/utils/` 新建 `event_bus.js`（基于 `tinyemitter` 的全局事件总线）、`assets.js`（图片资源加载器，支持牌图与默认头像）
   - _需求：3.1, 3.2, 3.4, 4.2, 5.1, 5.2_

- [ ] 2.2 卡牌资源与渲染
   - 在 `js/ui/Card.js` 实现单张牌渲染（花色 + 点数，支持选中态/正面/背面）
   - 在 `js/ui/CardGroup.js` 实现牌组排列渲染（手牌区横向排列、道牌区紧凑显示）
   - _需求：6.2, 6.4, 7.1_

- [ ] 3. 网络通信层
- [ ] 3.1 客户端 WebSocket 客户端
   - 在 `js/net/socket_client.js` 实现 WebSocket 封装：`connect(url)`、`send(type, data)`、`on(type, handler)`、统一 JSON 协议 `{ type, data, reqId }`、自动重连（最多 3 次）、连接中提示
   - 在 `js/net/protocol.js` 定义协议常量：`LOGIN`、`CREATE_ROOM`、`JOIN_ROOM`、`LEAVE_ROOM`、`READY`、`UNREADY`、`ROOM_STATE`、`DEAL_CARDS`、`SUBMIT_LANES`、`SETTLE_RESULT`、`ERROR` 等
   - 客户端启动时自动登录：发送 `LOGIN { openid, nickname, avatarUrl }`（用 `wx.getUserProfile` 或 mock 数据）
   - _需求：2.1, 2.2, 2.3, 11.1_

- [ ] 3.2 服务端 WebSocket 服务框架
   - 在 `server/package.json` 声明依赖 `ws`，提供启动脚本 `npm start`
   - 在 `server/index.js` 创建 WebSocket Server，监听 8080 端口，处理 `connection`/`message`/`close`
   - 在 `server/session.js` 维护 `connId → { ws, openid, roomId }` 映射
   - 在 `server/router.js` 按 `type` 分发到对应处理器
   - 在 `server/utils/logger.js` 提供简单日志
   - _需求：2.1, 2.2, 2.3, 2.4_

- [ ] 4. 服务端房间管理
   - 在 `server/room_manager.js` 实现 `createRoom(rule)`（生成唯一 4 位数字房间 ID）、`joinRoom(roomId, player)`、`leaveRoom`、`getRoom`、`destroyRoom`，房间内全员退出立即销毁
   - 在 `server/room.js` 定义 `Room` 类：成员包含 `id`、`rule(withMa, totalRounds, maxPlayers)`、`players[]`、`hostId`、`state(WAITING/PLAYING/SETTLING)`、`currentRound`、`game`
   - 实现房主转移、断线 30 秒判定、广播 `ROOM_STATE` 给同房间所有连接
   - 在 `server/handlers/lobby_handler.js` 处理 `LOGIN`、`CREATE_ROOM`、`JOIN_ROOM`、`LEAVE_ROOM`、`READY`、`UNREADY`
   - _需求：2.4, 2.5, 3.3, 3.5, 4.3, 5.3, 11.2, 11.3, 11.4_

- [ ] 5. 牌型识别与比牌引擎（共享逻辑）
- [ ] 5.1 卡牌与牌型识别
   - 在 `server/game/card.js` 定义 `Card { suit, rank }` 与 `Deck`：根据 `playerCount` 加色（5 人加方块、6 人再加草花的 2~A），`shuffle()`，`deal(playerCount, 13)`
   - 在 `server/game/hand_evaluator.js` 实现 `evaluate(cards, isHead)` 返回 `{ type, rankValues, ... }`，类型枚举：五龙、同花顺、炸弹、葫芦、同花、顺子、三条、两对、对子、乌龙；A 可作 1 用，1-5 顺子小于 10-A 顺子
   - 实现 `compare(a, b)`：先比类型再比点数；同花需支持「带对同花」加色规则
   - 在 `server/game/lane_validator.js` 实现 `validateLanes(head, middle, tail)`：头道 < 中道 ≤ 尾道
   - _需求：8.1, 8.2, 8.3, 8.4_

- [ ] 5.2 比牌结算引擎
   - 在 `server/game/settle.js` 实现 `settle(players)`：两两道比较得到基础分；特殊加分（冲三 +2、中道葫芦/炸弹/同花顺/五龙、尾道炸弹/同花顺/五龙）由输方支付；打枪整体加倍；本垒打再加倍；持有红桃 5 的玩家积分双倍（按需求 8.5）
   - 输出 `{ playerScores, laneCompare:[head/middle/tail], specialBonuses, gunshots, homeruns }` 供前端动画播放
   - 客户端拷贝 `js/game/hand_evaluator.js`、`js/game/lane_validator.js` 用于本地三道校验（绿/红色提示），结算结果以服务端为准
   - _需求：7.5, 7.6, 8.5_

- [ ] 6. 主页场景与房间流程
   - 在 `js/scenes/lobby_scene.js` 实现主页：「创建房间」「加入房间」按钮；创建按钮弹规则配置（马牌开关、局数 5/10/15/20、最大玩家数 2-6）；加入按钮弹 4 位 ID 输入框；调用 socket 后跳转 `room_scene`
   - 创建/加入失败的错误提示（房间不存在/已满/已开局）
   - _需求：3.1, 3.2, 3.3, 3.4, 3.5_

- [ ] 7. 对局场景 - 准备阶段
   - 在 `js/scenes/room_scene.js` 实现牌桌圆环布局（2-6 人位置自适应，自己始终底部），渲染头像/昵称/总积分/准备状态/掉线状态徽标
   - 右上角退出按钮（确认弹窗 → 发送 `LEAVE_ROOM`）
   - 准备阶段按钮：未准备显示「准备」、已准备显示「取消准备」；监听 `ROOM_STATE` 实时刷新
   - 服务端 `lobby_handler` 在所有玩家（≥2）就绪时切换房间到 PLAYING 并触发发牌
   - _需求：4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3_

- [ ] 8. 对局场景 - 发牌、放牌与开牌
   - 服务端在开始时调用 `Deck.deal` 给每位玩家私发 13 张牌（`DEAL_CARDS`，仅发给本人）
   - 客户端在 `room_scene` 中渲染手牌区（默认按花色排序），提供「按花色/按点数」排序按钮
   - 屏幕中央渲染头道/中道/尾道三个空白放置区，每道含「放入」与「取消」按钮
   - 实现选中→放入逻辑：校验张数（3/5/5），第二道放完后剩余牌自动归入第三道
   - 三道齐全后调用 `js/game/hand_evaluator.js` 与 `lane_validator.js` 实时校验（绿色/红色），合法时启用「开牌」按钮
   - 「开牌」发送 `SUBMIT_LANES { head, middle, tail }`，本地锁定 UI
   - _需求：6.1, 6.2, 6.3, 6.4, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

- [ ] 9. 对局场景 - 比牌动画与结算
   - 服务端在所有玩家提交后调用 `settle()` 并广播 `SETTLE_RESULT`
   - 客户端隐藏放置区，按头道→中道→尾道顺序播放动画：每道在玩家头像旁显示道牌、两两比较结果、本道积分增减
   - 三道完成后依次播放打枪、本垒打、特殊加分提示
   - 全部完成后刷新每位玩家头像旁总积分，弹出本局统计面板（每位玩家三道出牌、本局积分、按道基础积分）
   - 在 `js/ui/SettlePanel.js` 实现统计面板与「确认」按钮
   - _需求：9.1, 9.2, 9.3, 9.4, 10.1_

- [ ] 10. 多局循环与对局结束
   - 玩家点击「确认」后客户端发送 `ROUND_CONFIRM`，服务端等所有玩家确认后回到准备状态（`currentRound++`）
   - IF `currentRound` 达到配置局数 THEN 服务端发送 `MATCH_END` 携带总积分排行；客户端在 `js/ui/RankPanel.js` 显示排行榜，提供「退出房间」
   - 全员退出后服务端 `destroyRoom` 销毁内存数据
   - 异常处理：客户端断线重连恢复（依据 openid + roomId）；服务端超时 30 秒判定本局乌龙；房主退出转移给最早玩家
   - 最后整体联调：在 Windows 启动 `cd server && npm install && npm start`，并在微信开发者工具运行客户端进行端到端测试
   - _需求：10.2, 10.3, 10.4, 11.1, 11.2, 11.3, 11.4_
