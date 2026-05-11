## 十三张多人棋牌（微信小游戏）

这是一个基于微信小游戏 + Go WebSocket/HTTP 服务的多人「十三张」棋牌游戏示例。

- 客户端：微信小游戏（Canvas 渲染）
- 服务端：Go 1.24 + Gin + gorilla/websocket，对局信息保留在服务端内存中，所有玩家退出房间后销毁
- 通信：大厅走 HTTP，对局走 WebSocket，统一 JSON 信封 `{ type, data, reqId, code, msg }`
- 规则：详见 [RULE.md](./RULE.md)
- 功能：详见 [功能.md](./功能.md)

## 启动方式

### 服务端

```powershell
cd card_ssd
go mod tidy
go run .
```

基于 **Gin + gorilla/websocket** 实现，HTTP（`/api/...`）与 WebSocket（`/ws`）复用同一端口（默认 `:80`），可通过环境变量 `PORT` 覆盖。详见 [card_ssd/README.md](./card_ssd/README.md)。

### 客户端

使用微信开发者工具打开本项目根目录，编译运行。客户端会自动连接 `ws://127.0.0.1/ws`（80 端口），可在 [main.js](./js/main.js) 中调整 `SOCKET_URL`。

> 调试提示：在「项目设置 → 本地设置」中关闭「不校验合法域名」以允许连接本地 WS。

## 玩法概览

1. 进入主页可以「创建房间」（设置带马牌、局数 5/10/15/20、最大玩家数 2-6）或「加入房间」（输入 4 位房间号）
2. 进入对局页：自适应横向椭圆牌桌、玩家头像/昵称/积分/状态，自己始终在底部；打牌阶段放置区会下移并靠近上移后的手牌区，牌桌、放置区和手牌会按屏幕尺寸自适应缩放，避免遮挡其他玩家
3. 全员准备后开局：每人 13 张牌 → 手牌默认按点数排序，可切换为黑桃/红桃/梅花/方块顺序的花色排序，红桃 5 马牌会显示专属标记；加色牌沿用同花色红黑显示，避免牌面颜色不一致；手牌支持点击或滑动经过切换选中状态 → 点击“放入”或直接点击头道/中道/尾道放置区放入选中手牌，放置区道牌按点数排序展示 → 校验大小（绿/红色提示）→ 开牌
4. 全员开牌后进入比牌动画：头道/中道/尾道依次展示（每道牌按点数排序） → 如有打枪则播放胜方到败方的枪击弹道动画 → 如有本垒打则展示本垒打 → 弹出本局统计（以扑克牌左上角裁剪图按点数排序展示每道牌，并显示牌型、分数、打枪/全垒打/马牌标记）
5. 全员确认后下一局；达到总局数后展示总积分排行；全员退出房间则销毁该房间内存数据

## 客户端目录

```
├── audio                 // 音频资源（保留目录）
├── images                // 图片资源
├── js
│   ├── base              // 基础设施：动画、对象池、精灵
│   ├── libs              // 第三方库（tinyemitter）
│   ├── net               // 网络通信层
│   │   ├── socket_client.js  // WebSocket 封装（自动重连 / 协议解析）
│   │   └── protocol.js       // 协议常量
│   ├── game              // 牌型/三道校验（与服务端同源逻辑）
│   │   ├── card.js
│   │   ├── hand_evaluator.js
│   │   └── lane_validator.js
│   ├── ui                // UI 组件
│   │   ├── Button.js
│   │   ├── Modal.js
│   │   ├── Toast.js
│   │   ├── Avatar.js
│   │   ├── Card.js / CardGroup.js
│   │   └── PlayerSeat.js
│   ├── scenes            // 场景
│   │   ├── scene_manager.js  // 场景调度
│   │   ├── lobby_scene.js    // 主页（创建/加入房间）
│   │   ├── room_scene.js     // 对局/房间
│   │   ├── play_phase.js     // 发牌/放牌/开牌阶段
│   │   └── settle_phase.js   // 比牌动画与统计面板
│   ├── utils             // 工具
│   │   ├── event_bus.js
│   │   └── assets.js
│   ├── debug             // 调试日志面板（受 GameGlobal.DEBUG_LOG 控制）
│   │   ├── log_store.js      // 日志缓冲单例（环形 500 条、订阅、过滤、未读计数）
│   │   ├── console_hook.js   // 包装 console.log/info/warn/error/debug
│   │   ├── log_button.js     // 右上角浮动 LOG 入口按钮
│   │   ├── log_panel.js      // 调试日志面板（分类、暂停、清空、详情、发包、会话信息）
│   │   └── util.js           // 安全序列化、时间格式化、敏感字段打码
│   ├── databus.js        // 全局状态
│   ├── main.js           // 入口
│   └── render.js         // Canvas 初始化
├── card_ssd              // Go 服务端，详见 card_ssd/README.md
├── game.js / game.json
├── RULE.md / 功能.md
```

## 服务端目录

服务端目录结构与协议详情请见 [card_ssd/README.md](./card_ssd/README.md)。

## 协议消息一览

| 类型 | 方向 | 说明 |
| --- | --- | --- |
| `LOGIN` | C→S | 登录（携带 openid/昵称/头像）|
| `CREATE_ROOM` / `JOIN_ROOM` / `LEAVE_ROOM` | C→S | 房间操作 |
| `READY` / `UNREADY` | C→S | 准备状态切换 |
| `SUBMIT_LANES` | C→S | 提交三道开牌 |
| `ROUND_CONFIRM` | C→S | 确认本局结算 |
| `ROOM_ADD_BOT` / `ROOM_KICK_BOT` | C→S | 房主添加/踢出电脑玩家 |
| `ROOM_STATE` | S→C | 房间状态广播 |
| `DEAL_CARDS` | S→C | 私发手牌 |
| `SETTLE_RESULT` | S→C | 结算广播 |
| `RECONNECT_SNAPSHOT` | S→C | 断线重连快照 |
| `MATCH_END` | S→C | 整场结束总排行 |
| `ERROR` | S→C | 错误响应 |

## 主页 HTTP 化 / 对局 WebSocket / 断线视觉

从本版本起，大厅与对局的网络分层被重新划分：

- **大厅仅 HTTP**：客户端启动不再连接 WebSocket，进入大厅后调用 `POST /api/login` 一次性获得身份与 `activeRoom` 摘要；返回为空则隐藏“重新进入”按钮。可随时 `GET /api/lobby/active-room?openid=xxx` 复查。HTTP 接口是只读的，不会修改 Session/Player 在线状态。
- **云托管通道**：所有 HTTP 与 WebSocket 默认走微信云托管 `wx.cloud.callContainer` / `wx.cloud.connectContainer`，无需在小游戏后台配置 request/socket 合法域名。云环境通过 `GameGlobal.CLOUD_ENV`（默认 `prod-d1gy3h2lh5a169861`）+ `GameGlobal.CLOUD_SERVICE`（默认 `golang-8gye`）配置；非小游戏环境（如浏览器调试）自动降级到 `wx.request` / `fetch` + `wx.connectSocket` / `WebSocket`，此时 `GameGlobal.HTTP_BASE` / `GameGlobal.SOCKET_URL` 作为兜底地址。
- **对局才升级 WS**：“创建房间 / 加入房间 / 重新进入”三个动作会先 `socket.connect()`（云通道下不再传 URL），等待 `LOGIN_OK` 后再发送 `CREATE_ROOM / JOIN_ROOM`。已连接状态下复用；收到 `LEAVE_ROOM_OK` 或在 `MATCH_END` 后返回大厅时主动 `socket.close()` 断开。
- **对局中才重连**：`socket_client` 仅在 `databus.scene === SCENES.ROOM` 时才进行 5 次 / 1.5 秒间隔的自动重连；重连 `LOGIN_OK` 后自动 `JOIN_ROOM`；若返回 `ROOM_NOT_FOUND` 则清空本地 `databus.room` 并提示“房间已结束”后切回大厅。
- **微信生命周期**：`wx.onShow` 时若处于对局且 socket 已断，立即触发重连；`wx.onHide` 不主动断开，依赖微信原生层保活。市面上“切后台 30 秒以内”可无缝继续。
- **头像离线视觉**：服务端在 `Offline` 状态变更时立即广播 `ROOM_STATE`；客户端在受影响玩家（非本人、非 Bot）的头像上叠加半透明黑色圆形蒙层 + 白色“OFF”字样，使“玩家断线”一眼可见；玩家恢复后蒙层自动移除。

接口示例：

```http
POST /api/login
Content-Type: application/json
{"openid":"xxx","nickname":"玩家一","avatarUrl":""}
→ 200 {"token":"…","openid":"xxx","nickname":"玩家一","activeRoom":{"roomId":"1234","phase":"playing","currentRound":2,"totalRounds":5,"maxPlayers":4}}

GET /api/lobby/active-room?openid=xxx
→ 200 {"activeRoom": null}
```

前端通过全局变量集中配置网络通道：

- 云托管（默认）：`GameGlobal.CLOUD_ENV` + `GameGlobal.CLOUD_SERVICE`
- 直连降级：`GameGlobal.HTTP_BASE` + `GameGlobal.SOCKET_URL`（仅浏览器/无云能力时使用）

## 调试日志面板

开发期内置一个轻量调试日志面板，方便在真机/微信开发者工具外查看运行时日志、定位卡顿与协议问题。

- **入口**：画布右上角浮动 `LOG` 按钮（房间页位于「退出」按钮左侧 8px）。点击切换面板显示状态；面板关闭时若有 `ERROR` 级别日志，按钮右上角显示红点。
- **日志来源**：
  - `console.log/info/warn/error/debug` 全量拦截；
  - HTTP 请求/响应（method、url、status、duration、body 摘要，自动屏蔽 `token` 字段）；
  - WebSocket 连接事件（`connect/open/close/error/reconnect`）与每条收发消息（type、reqId、payload 摘要）。
- **面板能力**：
  - 顶部分类标签 `ALL / CONSOLE / HTTP / WS / ERROR`；
  - 列表区按 `HH:mm:ss.sss [LEVEL] [SOURCE] text` 显示，按级别/来源着色，贴底自动跟随；上下拖动查看历史；
  - 工具区：`暂停 / 清空 / 发包 / 会话`，「暂停」期间日志仍写入缓冲区但不再贴底；「发包」通过两步 `wx.showModal` 输入 `type` 与 JSON `data`，校验后调用 `socket.send`；「会话」展示当前 `databus.user / scene / room / socket` 摘要；
  - 点击单条日志弹出详情，提供「复制」按钮调用 `wx.setClipboardData`；
  - 面板内触摸不会穿透到底层场景。
- **关闭方式**：在 [main.js](./js/main.js) 中将 `GameGlobal.DEBUG_LOG = false`（位于文件顶部默认 `true`），即可一行关闭按钮、面板与所有 hook，发布版无任何额外开销。

## 断线重连

在网络抖动、切后台、小游戏被杀后重新进入等场景下，存在未完成对局的玩家可以无感恢复到原房间。实现要点：

- **服务端充当唯一状态源**：以 `openid` 为身份，30 秒内重连仍可回到原对局；超过 30 秒未重连则按弃局结算。
- **登录响应携带在房状态**：`LOGIN_OK.data.activeRoom` 为 `null` 或 `{ roomId, phase, currentRound, totalRounds }`。大厅进入后，若 `activeRoom` 非空，则在主按钮上方显示「重新进入（xxxx）」。
- **进屋恢复快照**：`JOIN_ROOM` 命中重连分支后，服务端会单播一条 `RECONNECT_SNAPSHOT`，携带 `phase / hand / lanes / submitted / lastSettle / currentRound / totalRounds`，客户端据此还原手牌、三道、本局结算与所处子阶段；若服务端检测到房间仍在 `playing` 但所有玩家都已提交，会先兜底触发结算再发送快照。
- **WebSocket 重连**：`socket_client` 在连接断开后自动重试（默认 5 次、间隔 1.5s），重连期间顶部 Toast 提示「重连中…」。连上后自动重发 `LOGIN`；如本地 `databus.room` 仍存在，则在 `LOGIN_OK` 后自动重发 `JOIN_ROOM` 回原房间。
- **本地房间号缓存**：进屋成功后通过 `wx.setStorageSync('lastRoomId', roomId)` 保存；主动 `LEAVE_ROOM` 成功后清除。服务端为主，本地仅作辅助。
- **同 openid 多连接**：服务端 `bindOpenid` 会关闭旧连接，并将原本属于旧 Session 的 `roomId` 继承到新 Session；同时取消该 openid 的弃局兑底计时器、并广播一次 `ROOM_STATE` 让其他玩家看到该玩家恢复在线。

## 数据生命周期

- 所有房间与对局信息仅保存在服务端进程内存中
- 房间内最后一名真人玩家离开时，房间立即从内存销毁；剩余 bot 与定时器一并清理
- 玩家断线 30 秒未重连的兜底（按所在阶段）：
  - **准备阶段**：连接断开瞬间即移除该玩家
  - **对局阶段（`playing`）**：自动以散牌（头 3/中 5/尾 5）参与结算
  - **比牌阶段（`comparing`）**：保留座位（结算结果与积分已固定，不再改动），等待重连或整场结束
  - **整场结束（`match_end`）**：移除该玩家，避免永久占座
- 30 秒兜底执行后若房间内已无任何在线真人，立即销毁房间，避免与 bot 持续空转
- 房主退出：房主权限自动转交给最早加入的剩余玩家

## 电脑玩家（AI Bot）

房主可在“准备阶段”为房间添加电脑玩家凑人。特点：

- **仅房主可见**：准备阶段中央底部出现 “+ 电脑” 按钮；点击 bot 座位可弹出踢出确认
- **自动准备**：bot 加入后 1 秒内自动准备、每局结算后也会自动重新准备
- **自动理牌与开牌**：发牌后服务端在 1 秒内调用 AI 理牌算法产出三道并提交；使用同一套校验与结算逻辑
- **自动确认结算**：进入本局统计或总结场面后 1 秒内自动确认，不会阻塞真人玩家
- **资源回收**：房间内所有真人退出后立即销毁房间并停止 bot 定时器

前端为 bot 在头像右上角叠加橙色 “BOT” 角标以供识别。AI 策略代码位于 [card_ssd/internal/game/ai_bot.go](./card_ssd/internal/game/ai_bot.go)。
