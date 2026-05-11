# 需求文档：主页 HTTP 化 / 对局 Socket 断线重连增强

## 引言

当前架构下，客户端从启动入口（[main.js](../../../js/main.js)）就立即建立 WebSocket 长连接，并在大厅页同样依赖 Socket 完成「登录 / 查询是否有未完成对局 / 创建房间 / 加入房间」等业务，这带来三个问题：

1. **大厅长连接成本高**：玩家在大厅停留期间持续占用 Socket 资源；服务端进程退出 / 重启时大厅页也会"掉线 Toast"，体验割裂。
2. **重连语义不清**：现有 `_autoLogin` 在重连成功后会自动 `JOIN_ROOM`，但这套逻辑与"重新进入"按钮逻辑混在一起，主页和对局页同一套 Socket 难以隔离行为。
3. **对局中断线提示不明显**：[PlayerSeat.js](../../../js/ui/PlayerSeat.js) 仅在头像上方画一个 `掉线` 文字徽章，玩家不易察觉，特别是"小游戏被切后台 / 被强杀"这种长时间断线，对手看不到清晰的断线视觉提示。

本次需求重新划分大厅与对局的网络分层：

- **大厅页**：仅使用 HTTP；通过 `POST /api/login` 完成登录 + 查询是否有未完成对局；用户点击「创建房间」或「加入房间」后再升级到 WebSocket。
- **对局页**：建立 WebSocket 长连接；保留并完善已有的「断线 → 自动重连 → 重新加入房间 → `RECONNECT_SNAPSHOT` 还原」链路；针对"小游戏切后台 / 被强杀"补充触发点。
- **断线视觉**：当其他玩家在线状态变化（`offline=true`），在其头像区域加上**显著的断线蒙层 / 角标**，让本地玩家一眼可见。

最终目标：

- 大厅不再常驻 Socket，HTTP 一次性查询；进入房间才建立长连接。
- 对局中即使切后台 30 秒以内回来，仍可无缝继续；超过则按既有兜底结算。
- 任何玩家断线，其余玩家在头像位置看到醒目的"📵 离线"标识。

---

## 需求

### 需求 1：服务端新增 HTTP 登录 + 查询活跃房间接口

**用户故事：** 作为一名玩家，我希望进入小游戏后无需建立 Socket 就能知道是否有未完成对局，以便在大厅决定是「重新进入」还是「创建 / 加入房间」。

#### 验收标准

1. WHEN 客户端调用 `POST /api/login`（载荷 `{openid, nickname, avatarUrl}`） THEN 服务端 SHALL 返回 `{token, openid, nickname, activeRoom}`，其中 `activeRoom` 为该 `openid` 当前所在的未结束房间摘要 `{roomId, phase, currentRound, totalRounds, maxPlayers}`。
2. IF 该 `openid` 不在任何房间，或对应房间已 `MATCH_END` 之后被销毁 THEN `activeRoom` SHALL 为 `null`。
3. WHEN 客户端调用 `GET /api/lobby/active-room?openid=xxx` THEN 服务端 SHALL 返回与上一条相同结构的 `activeRoom`（仅用于客户端复查，例如再次回到大厅时刷新按钮）。
4. IF 该 `openid` 所在房间存在但服务端命中销毁条件（最后一名真人离开） THEN 接口 SHALL 在该次查询中即返回 `null`，避免出现"按钮指向不存在的房间"。
5. WHEN HTTP 接口被调用 THEN 服务端 SHALL **不**因为该次 HTTP 调用而修改任何 `Session` 或 `Player` 的网络状态（即 HTTP 是只读的，不改变在线/离线判定）。

### 需求 2：客户端启动阶段去除强制 WebSocket 连接

**用户故事：** 作为一名玩家，我希望刚进入小游戏时不必先看到一个无意义的"网络连接中"状态，大厅交互直接可用。

#### 验收标准

1. WHEN [main.js](../../../js/main.js) 启动 THEN 客户端 SHALL **不**在 `Main` 构造函数里自动调用 `connectSocket()`。
2. WHEN 大厅场景 `LobbyScene.onEnter` 被触发 THEN 客户端 SHALL 通过 `wx.request` 调用 `POST /api/login`，并将返回的 `activeRoom` 写入 `databus.activeRoom`。
3. IF HTTP 登录失败（网络异常 / 4xx / 5xx） THEN 客户端 SHALL 显示 Toast「登录失败，点击重试」，并允许玩家点击页面重新触发 HTTP 登录；本阶段 SHALL **不**尝试任何 Socket 连接。
4. WHEN 大厅页面在显示「重新进入（房间号）」按钮 THEN 该按钮 SHALL 在 `databus.activeRoom` 非空时显示，否则隐藏。
5. WHEN 玩家从对局返回大厅（如点击 `LEAVE_ROOM`）THEN 客户端 SHALL 在断开 Socket 后**重新发起一次 HTTP 登录**以刷新 `activeRoom`，避免按钮显示陈旧。

### 需求 3：仅在进入房间动作时升级到 WebSocket

**用户故事：** 作为一名玩家，我希望只有真正开始对局时才建立长连接，节省网络资源。

#### 验收标准

1. WHEN 玩家在大厅点击「创建房间」并完成规则配置 THEN 客户端 SHALL 先调用 `GameGlobal.socket.connect(url)` 建立 WS、待 `LOGIN_OK` 之后再发送 `CREATE_ROOM`。
2. WHEN 玩家在大厅点击「加入房间」并输入有效房间号 THEN 客户端 SHALL 同样先连接 WS 再发送 `JOIN_ROOM`，`roomId` 取自输入框。
3. WHEN 玩家点击「重新进入（房间号）」 THEN 客户端 SHALL 同样先连接 WS 再发送 `JOIN_ROOM`，`roomId` 取自 `databus.activeRoom.roomId`。
4. IF 在上述任一动作时 WS 已经处于 `connected` 状态（异常情况，例如重新进入大厅但未及时关闭 Socket） THEN 客户端 SHALL 直接复用，跳过重复 connect。
5. WHEN 玩家收到 `LEAVE_ROOM_OK` 或 `MATCH_END` 后玩家选择回到大厅 THEN 客户端 SHALL 调用 `GameGlobal.socket.close()` 主动断开 WebSocket，并将 `databus.netStatus` 置为 `disconnected`。

### 需求 4：对局阶段保留并强化自动重连

**用户故事：** 作为一名玩家，我希望对局过程中网络抖动 / 切后台短暂断网后，游戏自己悄悄连回房间。

#### 验收标准

1. WHEN `SocketClient` 检测到 `_onClose` / `_onError` 且 `databus.scene === SCENES.ROOM` THEN 客户端 SHALL 在最多 5 次范围内每隔 1.5 秒尝试 `connect(url)`，并在屏幕顶部 Toast 显示「重连中…(n/5)」。
2. WHEN 重连成功并收到 `LOGIN_OK` THEN 客户端 SHALL 自动发送 `JOIN_ROOM`，`roomId` 取自 `databus.room.id`，由服务端返回 `RECONNECT_SNAPSHOT` 与 `ROOM_STATE` 还原 UI。
3. WHEN 自动 `JOIN_ROOM` 收到 `ROOM_NOT_FOUND` 错误 THEN 客户端 SHALL 清空 `databus.room` 并切换回大厅，Toast 提示「房间已结束」。
4. WHEN `databus.scene === SCENES.LOBBY` 时 Socket 异常关闭 THEN 客户端 SHALL **不**触发任何自动重连（大厅本就不依赖 Socket）。
5. WHEN 微信小游戏触发 `wx.onHide`（切后台）超过 5 秒 THEN 客户端 SHALL **不**主动断开 Socket，而是由原生层维持；`wx.onShow` 时若发现连接已死，则按上述规则触发重连。
6. WHEN 微信小游戏触发 `wx.onShow` 且 `databus.scene === SCENES.ROOM` 且 `socket.connected === false` THEN 客户端 SHALL 立即执行 `socket.connect(url)` 触发重连流程。

### 需求 5：服务端断线 / 重连状态广播

**用户故事：** 作为同房间的玩家，我希望队友 / 对手一断线，我立刻能在他的头像位置看到醒目的离线标识；他一回来标识就消失。

#### 验收标准

1. WHEN 玩家 `Session` 触发 `close` 且其 `roomId` 不为空 THEN 服务端 SHALL 沿用 `HandleDisconnect` 现有行为：等待阶段直接踢出；对局阶段标记 `Player.Offline = true` 并启动 30 秒兜底 timer。
2. WHEN 服务端将玩家标记为 `Offline = true` 后 THEN 服务端 SHALL 立即对该房间所有在线玩家广播一次 `ROOM_STATE`（含 `players[i].offline = true`）。
3. WHEN 30 秒内玩家通过 `JOIN_ROOM` 重连 THEN 服务端 SHALL 取消兜底 timer、置 `Offline = false / OfflineSince = 0`，并立即广播一次 `ROOM_STATE`。
4. WHEN 同 `openid` 通过新连接登录 THEN 服务端 `BindOpenid` SHALL 关闭旧连接的 underlying socket、不影响该 `Player` 在房间内的位置（即 `Player` 仍存在于 `Players` 数组中，待后续 `JOIN_ROOM` 触发重连分支）。
5. IF 玩家断线超过 30 秒未回 THEN 服务端 SHALL 按现有兜底逻辑（散牌切分提交并参与结算），并继续广播 `ROOM_STATE` 维持 `offline=true`，直到该玩家被移除或房间销毁。

### 需求 6：客户端在头像处显示醒目的断线标识

**用户故事：** 作为玩家，我希望对手 / 队友一旦断线就能在他的头像上一眼看到清晰的视觉标识，而不仅是头像上方的小徽章。

#### 验收标准

1. WHEN [PlayerSeat.js](../../../js/ui/PlayerSeat.js) 渲染某个 `player.offline === true` 的玩家 THEN 客户端 SHALL 在该头像上叠加一层半透明灰色遮罩（建议 `rgba(0,0,0,0.45)`）以使头像看起来"褪色"。
2. WHEN 同一情境下 THEN 客户端 SHALL 在头像中央叠加一个明显的离线图标（例如绘制一个白色 `📵` 或 "OFF" 文字徽章），尺寸约为头像直径的 60%。
3. WHEN 玩家从离线恢复（`offline === false`） THEN 客户端 SHALL 立即移除上述蒙层与图标，无需玩家手动刷新。
4. WHEN 玩家恰为本地玩家（即"我"自己） THEN 客户端 SHALL **不**对自己的头像添加离线遮罩（自己已经知道自己的网络状态，多余）；但仍保留顶部 Toast「重连中…」提示。
5. WHEN 玩家是 `IsBot=true` THEN 客户端 SHALL 永远不渲染离线遮罩（电脑玩家不会断线）。
6. IF 头像加载尚未完成（`Avatar.image === null`） THEN 离线遮罩 SHALL 画在 fallback 兜底图样之上，仍保持视觉一致。

### 需求 7：路由与配置同步

**用户故事：** 作为开发者，我希望大厅 HTTP 接口与 WebSocket 共用同一个 Gin 引擎、同一个端口，部署时不增加额外维度。

#### 验收标准

1. WHEN 服务端启动 THEN [card_ssd/internal/server/http.go](../../../card_ssd/internal/server/http.go) `NewEngine` SHALL 同时注册：
   - `POST /api/login`（登录 + 返回 `activeRoom`）
   - `GET /api/lobby/active-room`（仅查询 `activeRoom`）
   - `GET /ws`（既有 WebSocket）
2. WHEN 客户端发起 HTTP 请求 THEN 客户端 SHALL 使用与 WebSocket 同源的 base URL（`http://127.0.0.1` 或可通过 `GameGlobal.HTTP_BASE` 注入）。
3. WHEN 客户端发起 HTTP 请求 THEN 服务端 SHALL 接受并允许 `Content-Type: application/json` 与现有 CORS 中间件处理跨域。
4. WHEN 功能完成 THEN [card_ssd/README.md](../../../card_ssd/README.md) 与 [README.md](../../../README.md) 与 [功能.md](../../../功能.md) SHALL 增补"主页 HTTP 化 / 对局 WS / 断线视觉"使用说明小节。

---

## 边界与非目标

- **不做 HTTP 鉴权升级**：HTTP 登录返回的 `token` 仅作辅助，本次 HTTP 接口仍使用 `openid` 作为身份，与现有 Socket 协议保持一致；不引入 JWT / Session Cookie。
- **不增加房间持久化**：服务端进程重启视为所有房间消失，HTTP 查询 `activeRoom` 时一律返回 `null`，客户端再走"创建/加入"流程即可。
- **不修改 Node.js 旧服务端**（`server/` 目录），它已被 Go 实现取代；本次仅对 Go 服务端 + 前端做改动。
- **不动现有结算 / 摆牌 / 比牌等业务协议**，本次仅改"连接生命周期"与"断线视觉"。
- **不引入心跳协议**：依赖 WebSocket 自身保活与微信框架；如后续发现长时间不活动连接被中间件断开，再单独立项。
