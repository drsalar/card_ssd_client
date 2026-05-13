## 十三张多人棋牌（微信小游戏）

这是一个基于微信小游戏 + Go WebSocket/HTTP 服务的多人「十三张」棋牌游戏示例。

- 客户端：微信小游戏（Canvas 渲染）
- 服务端：Go 1.24 + Gin + gorilla/websocket，对局信息保留在服务端内存中；进行中房间在所有真人离线后保留 24 小时，由每小时巡检销毁
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

1. 进入主页后按缓存状态自动播放 `audio/bgm2.mp3`，连接状态下方可通过 `♫ 开/关` 切换背景音乐，绿色表示开启、红色表示关闭；也可以「创建房间」（设置带马牌、局数 5/10/15/20、最大玩家数 2-6）或「加入房间」（输入 4 位房间号）
2. 进入对局页：自适应横向椭圆牌桌、玩家头像/昵称/积分/状态，发牌后未开牌玩家显示 `出牌中`，自己始终在底部；连接状态下方同样提供 `♫ 开/关`；打牌/比牌阶段牌桌会适当加长，牌桌底部以手牌区顶部为参考并保持固定间隔，不再按整个画面上对齐；放置区会同步围绕当前牌桌中心展示并按玩家数量预留左右安全区，使用更清晰的实底框并与玩家头像保持间距，牌桌、放置区和手牌会按屏幕尺寸自适应缩放，避免遮挡玩家
3. 全员准备后开局：每人 13 张牌 → 手牌默认按点数排序，可切换为黑桃/红桃/梅花/方块顺序的花色排序，牌面点数保持红黑高对比，黑桃、红桃、梅花、方块通过花色符号颜色、细侧边提示线和底部短标签（黑/红/梅/方）区分，手机端小牌也能快速分辨同颜色花色；红桃 5 马牌会以高对比牌底、亮色描边和纹理高亮展示；加色牌沿用对应花色显示，避免牌面颜色不一致；手牌支持点击或滑动经过切换选中状态，手牌下方提供牌型快捷按钮（五龙、同花顺、炸弹、葫芦、同花、顺子、三条、对子，五龙仅 5 人以上显示），可用时高亮，重复点击会轮换选中不同组合 → 点击“放入”或直接点击头道/中道/尾道放置区放入选中手牌，放置区道牌按点数排序展示 → 校验大小（绿/红色提示）→ 开牌；开牌后的“等待其他玩家”提示显示在底部手牌区，避免遮挡玩家积分
4. 全员开牌后进入比牌动画：头道/中道/尾道依次展示（牌桌保持与打牌阶段一致的大小；每道牌按点数排序，`3-6` 人会按玩家位置自动缩小牌面，左右两侧含底部左右座位统一形成左侧上移、右侧下移的固定高度差，避免多人对比区域重叠并方便区分） → 如有打枪则播放胜方到败方的枪击弹道动画和 `audio/bullet.mp3` → 如有本垒打则展示本垒打并播放 `audio/boom.mp3` → 弹出本局统计（以紧凑布局适配 5 人场完整展示，扑克牌左上角裁剪图按点数排序展示每道牌，右侧分列显示牌型、分数、打枪目标；打枪目标使用枪击风格背景且仅显示被打枪昵称，多个昵称用逗号分隔；全垒打玩家整行使用强力结果背景色；特殊加分牌型按分值使用蓝/橙/红区分）
5. 全员确认后下一局；达到总局数后展示总积分排行；全员退出房间则销毁该房间内存数据

## 客户端目录

```
├── audio                 // 音频资源（bgm2 / bullet / boom）
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
│   │   ├── hand_pattern.js
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
│   │   ├── wx_user.js       // 微信头像/昵称获取与本地缓存
│   │   └── assets.js
│   ├── runtime           // 运行时能力
│   │   └── music.js         // BGM 开关缓存与打枪/全垒打音效
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
| `ROOM_KICK_PLAYER` | C→S | 房主踢出真人玩家（仅 waiting / match_end 阶段） |
| `ROOM_KICKED` | S→C | 被踢玩家单播通知 |
| `ROOM_STATE` | S→C | 房间状态广播 |
| `DEAL_CARDS` | S→C | 私发手牌 |
| `SETTLE_RESULT` | S→C | 结算广播 |
| `RECONNECT_SNAPSHOT` | S→C | 断线重连快照 |
| `VOTE_DISSOLVE` | C→S | 发起/同意解散对局 |
| `VOTE_DISSOLVE_CANCEL` | C→S | 撤销同意 |
| `VOTE_DISSOLVE_TIMEOUT` | S→C | 投票 60 秒超时 |
| `MATCH_END` | S→C | 整场结束总排行 |
| `ERROR` | S→C | 错误响应 |

## 微信头像 / 昵称显示

主页与对局中玩家的头像与昵称使用微信官方资料（`avatarUrl` / `nickName`）进行展示，服务端不需修改协议，仅复用现有 `nickname` / `avatarUrl` 字段。

- **获取时机**：微信小游戏自基础库 2.27.1 起强制返回「微信用户 + 灰色头像」，wx.getUserProfile 也在小游戏端废弃。本项目在主页顶部「头像+昵称」区域响应画布点击，弹出「换头像 / 改昵称」菜单；头像通过 `wx.chooseMedia` / `wx.chooseImage` 选择，昵称通过可编辑弹窗填写。
- **启动体验**：[main.js](./js/main.js) `initUser()` 仅读本地缓存 `wx_user_info`（[js/utils/wx_user.js](./js/utils/wx_user.js)）填充 `databus.user`，上次设置过资料的玩家下次进入同样看到自己的头像；尚未设置时使用「玩家 + openid 后4位」作为兜底并在头像下提示「点击头像设置头像与昵称」。
- **主页展示**：[lobby_scene.js](./js/scenes/lobby_scene.js) 顶部在昵称左侧增绘 36px 圆形头像（复用 [Avatar](./js/ui/Avatar.js) 的加载与兜底首字符逻辑）；点击头像区域后调用 `pickUserInfo`，更新成功后调 `selfAvatar.setUrl` 重绘，并 `eventBus.emit('user_info_updated')` 进而重新调 `POST /api/login` 同步服务端 session。再次换头像会优先直接唤起头像选择器；若系统返回相册 / 相机授权失败，再通过 `wx.getSetting` 确认状态，并引导打开 `wx.openSetting` 后重试选择。
- **对局展示**：[room_scene.js](./js/scenes/room_scene.js) / [settle_phase.js](./js/scenes/settle_phase.js) 复用 [PlayerSeat](./js/ui/PlayerSeat.js) 渲染所有玩家的头像与昵称；结算面板每行额外增绘 22px 小头像。机器人保留“电脑X”+ BOT 角标。
- **字段流向**：

```text
用户点击头像区域 → 选择头像 / 填写昵称
              → databus.user (nickname/avatarUrl) + storage 缓存
              → POST /api/login 上报 → Session.Nickname/AvatarUrl
              → WS LOGIN 帧上报（_autoLogin 从 databus 实时读取）
              → Player.Nickname/AvatarUrl（进房 / Upsert 同步）
              → ROOM_STATE.players[*].nickname/avatarUrl 广播到同房间
```

- **大厅仅 HTTP**：客户端启动不再连接 WebSocket，进入大厅后调用 `POST /api/login` 一次性获得身份与 `activeRoom` 摘要；返回为空则隐藏“重新进入”按钮。可随时 `GET /api/lobby/active-room?openid=xxx` 复查。HTTP 接口是只读的，不会修改 Session/Player 在线状态。
- **微信登录链路（方案 B）**：`js/main.js → initUser` 在小游戏环境下不再生成本地 `guest_xxxx`，而是异步调 `wx.login` 取临时 `code`；`lobby_scene._httpLogin` 把 `{ code, nickname, avatarUrl }` 提交到 `POST /api/login`，服务端调用 `https://api.weixin.qq.com/sns/jscode2session` 解出真实 openid 后随响应返回。客户端拿到 `res.openid` 并写回 `wx.setStorageSync('openid', ...)` 与 `databus.user.openid`，后续 WS `LOGIN`、`/api/lobby/active-room` 均使用真实 openid。`code` 失败时服务端退化为读取请求头 `X-WX-OPENID`（云托管自动注入）。
- **云托管通道**：所有 HTTP 与 WebSocket 默认走微信云托管 `wx.cloud.callContainer` / `wx.cloud.connectContainer`，无需在小游戏后台配置 request/socket 合法域名。云环境通过 `GameGlobal.CLOUD_ENV`（默认 `prod-d1gy3h2lh5a169861`）+ `GameGlobal.CLOUD_SERVICE`（默认 `golang-8gye`）配置；非小游戏环境（如浏览器调试）自动降级到 `wx.request` / `fetch` + `wx.connectSocket` / `WebSocket`，此时 `GameGlobal.HTTP_BASE` / `GameGlobal.SOCKET_URL` 作为兜底地址。
- **对局才升级 WS**：“创建房间 / 加入房间 / 重新进入”三个动作会先 `socket.connect()`（云通道下不再传 URL），等待 `LOGIN_OK` 后再发送 `CREATE_ROOM / JOIN_ROOM`。已连接状态下复用；收到 `LEAVE_ROOM_OK` 或在 `MATCH_END` 后返回大厅时主动 `socket.close()` 断开。
- **对局中才重连**：`socket_client` 仅在 `databus.scene === SCENES.ROOM` 时才进行 5 次 / 1.5 秒间隔的自动重连；重连 `LOGIN_OK` 后自动 `JOIN_ROOM`；若返回 `ROOM_NOT_FOUND` 则清空本地 `databus.room` 并提示“房间已结束”后切回大厅。
- **微信生命周期**：`wx.onShow` 时按当前场景分别处理 —— 处于对局且 socket 已断则立即触发重连；处于大厅则调用 `LobbyScene.refreshActiveRoom()` 经只读接口 `GET /api/lobby/active-room` 复查后端是否仍有进行中的对局，刷新「重新进入」按钮显示。`wx.onHide` 不主动断开，依赖微信原生层保活，市面上「切后台 30 秒以内」可无缝继续。
- **头像离线视觉**：服务端在 `Offline` 状态变更时立即广播 `ROOM_STATE`；客户端在受影响玩家（非本人、非 Bot）的头像上叠加半透明黑色圆形蒙层 + 白色“OFF”字样，使“玩家断线”一眼可见；玩家恢复后蒙层自动移除。

接口示例：

```http
POST /api/login
Content-Type: application/json
{"code":"<wx.login.code>","nickname":"玩家一","avatarUrl":""}
→ 200 {"token":"…","openid":"<服务端解出的真实 openid>","nickname":"玩家一","avatarUrl":"","activeRoom":{"roomId":"1234","phase":"playing","currentRound":2,"totalRounds":5,"maxPlayers":4}}

GET /api/lobby/active-room?openid=xxx
→ 200 {"activeRoom": null}
```

前端通过全局变量集中配置网络通道：

- 云托管（默认）：`GameGlobal.CLOUD_ENV` + `GameGlobal.CLOUD_SERVICE`
- 直连降级：`GameGlobal.HTTP_BASE` + `GameGlobal.SOCKET_URL`（仅浏览器/无云能力时使用）

## 调试日志面板

开发期内置一个轻量调试日志面板，方便在真机/微信开发者工具外查看运行时日志、定位卡顿与协议问题。

- **入口**：默认隐藏画布右上角浮动 `LOG` 按钮，避免遮挡游戏界面；如需临时查看面板，可在 [main.js](./js/main.js) 中将 `GameGlobal.DEBUG_LOG_BUTTON = true`。按钮开启后会避让微信右上胶囊菜单，点击切换面板显示状态；面板关闭时若有 `ERROR` 级别日志，按钮右上角显示红点。
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

- **服务端充当唯一状态源**：以 `openid` 为身份，30 秒内重连仍可回到原对局；30 秒后服务端按当前阶段做兜底处理（详见下方“数据生命周期”），房间本身在所有真人都离线时不再立即销毁，会保留 24 小时供晚些回来继续。服务端进程重启后，会从 MySQL `rooms / room_players` 表加载 `destroyed=0` 的房间还原到内存（参见 `card_ssd/README.md` MySQL 持久化章节），玩家重连后走原有 `RECONNECT_SNAPSHOT` 恢复手牌 / 三道 / 阶段。
- **登录响应携带在房状态**：`LOGIN_OK.data.activeRoom` 为 `null` 或 `{ roomId, phase, currentRound, totalRounds }`。当玩家同时挂在多个未结束房间时，服务端按 `LastActiveAt` 选最新一条返回，避免误入旧局。
- **进屋恢复快照**：`JOIN_ROOM` 命中重连分支后，服务端会单播一条 `RECONNECT_SNAPSHOT`，携带 `phase / hand / lanes / submitted / lastSettle / currentRound / totalRounds`，客户端据此还原手牌、三道、本局结算与所处子阶段；若服务端检测到房间仍在 `playing` 但所有玩家都已提交，会先兜底触发结算再发送快照。
- **WebSocket 重连**：`socket_client` 在连接断开后自动重试（默认 5 次、间隔 1.5s），重连期间顶部 Toast 提示「重连中…」。连上后自动重发 `LOGIN`；如本地 `databus.room` 仍存在，则在 `LOGIN_OK` 后自动重发 `JOIN_ROOM` 回原房间。
- **本地房间号缓存**：进屋成功后通过 `wx.setStorageSync('lastRoomId', roomId)` 保存；主动 `LEAVE_ROOM` 成功后清除。服务端为主，本地仅作辅助。
- **同 openid 多连接**：服务端 `bindOpenid` 会关闭旧连接，并将原本属于旧 Session 的 `roomId` 继承到新 Session；同时取消该 openid 的弃局兑底计时器、并广播一次 `ROOM_STATE` 让其他玩家看到该玩家恢复在线。

## 数据生命周期

- 所有房间与对局信息仅保存在服务端进程内存中
- 房间内最后一名真人玩家**主动离开**时，房间立即从内存销毁；剩余 bot 与定时器一并清理
- **房间 24 小时保活**：房间处于任何阶段（`waiting/playing/comparing/match_end`）且所有真人玩家都离线时，服务端不再立即销毁，而是登记 `AllOfflineSince` 时间戳；任意一名真人重连即清零
- **每小时巡检**：服务端启动后每 1 小时巡检一次，命中“`AllOfflineSince` 超过 24 小时”的房间将被强制销毁（日志原因 `24h all-offline timeout`）
- 玩家断线 30 秒未重连的兜底（按所在阶段）：
  - **准备阶段（`waiting`）**：仅标记玩家 `Offline=true`，**不启动 30 秒踢出计时器**，仅由上述 24h 巡检接管。玩家可从大厅点击「重新进入」回房间继续等待。
  - **对局阶段（`playing`）**：自动以散牌（头 3/中 5/尾 5）参与结算；房间保留 24 小时
  - **比牌阶段（`comparing`）**：保留座位（结算结果与积分已固定，不再改动），等待重连或整场结束
  - **整场结束（`match_end`）**：移除该玩家，避免永久占座
- 房主退出：房主权限自动转交给最早加入的剩余玩家

## 返回主页 / 退出 / 投票解散对局

- **右上角按钮按阶段切换**：
  - `waiting`：「退出」（红色，让出座位真离开） + 「返回」（灰色，保留座位回首页）
  - `playing` / `comparing`：「解散」（橙色，发起解散投票） + 「返回」（灰色）；**不提供“退出”**，避免单方让座破坏牌局
  - `match_end`：仅「退出」（红色，整场已结算，保留座位无意义）
- **「退出」语义**：二次确认后发送 `LEAVE_ROOM`，服务端 `RemovePlayer` 让出座位；收到 `LEAVE_ROOM_OK` 后客户端清除本地 `lastRoomId` 并返回大厅，后续从主页不会出现「重新进入」按钮。
- **「返回」语义**：二次确认后**不**发送 `LEAVE_ROOM`，仅断开 WebSocket 并返回大厅；服务端仅标记玩家 `Offline=true` 并登记 `AllOfflineSince`，房间会在 24 小时内保留。下次进入主页会看到「重新进入（房间号）」按钮。
- **主页查询 activeRoom**：`POST /api/login` 返回的 `activeRoom` 仅要玩家仍在某未销毁房间的 `Players` 列表内即命中，不限阶段、不限 Online/Offline；小程序回前台（`wx.onShow`）会在大厅场景下再调一次 `_httpLogin` 刷新。
- **房主踢人**：房主在“准备阶段”（`waiting`）与“整场结束”（`match_end`）点击任意非自身座位可调起踢出确认弹窗：点击电脑座位发 `ROOM_KICK_BOT`，点击真人座位发 `ROOM_KICK_PLAYER`；服务端会先向被踢玩家单播 `ROOM_KICKED`，接着从房间中移除并广播新的 `ROOM_STATE`。被踢玩家客户端会 Toast“已被房主请出房间”，清理本地房间状态后返回大厅。
- **投票解散**：`playing/comparing` 阶段，真人玩家可点击右上角「解散」按钮发起投票。所有在线真人都同意时立即触发提前结算（电脑玩家默认同意），按当前累计积分进入整场结束并展示排行榜；`playing` 阶段触发会跳过本局结算，`comparing` 阶段触发则保留本局已发结算结果。投票首次发起后启动 60 秒倒计时，超时未达成则自动作废所有投票并通过 `VOTE_DISSOLVE_TIMEOUT` 提示。

## 电脑玩家（AI Bot）

房主可在“准备阶段”为房间添加电脑玩家凑人。特点：

- **仅房主可见**：准备阶段中央底部出现 “+ 电脑” 按钮；点击 bot 座位可弹出踢出确认（另外点击真人座位也可触发踢出真人玩家，详见上节“房主踢人”）
- **自动准备**：bot 加入后 1 秒内自动准备、每局结算后也会自动重新准备
- **自动理牌与开牌**：发牌后服务端在 1 秒内调用 AI 理牌算法产出三道并提交；使用同一套校验与结算逻辑
- **自动确认结算**：进入本局统计或总结场面后 1 秒内自动确认，不会阻塞真人玩家
- **资源回收**：房间内所有真人主动离开后立即销毁房间并停止 bot/投票定时器；对局中所有真人离线时房间保留 24 小时

前端为 bot 在头像右上角叠加橙色 “BOT” 角标以供识别。AI 策略代码位于 [card_ssd/internal/game/ai_bot.go](./card_ssd/internal/game/ai_bot.go)。
