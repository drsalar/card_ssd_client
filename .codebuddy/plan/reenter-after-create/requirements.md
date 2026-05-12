# 需求文档

## 引言

当前体验问题：在大厅点击「创建房间」后进入房间场景，再点击右上角「返回」按钮回到大厅时，玩家观察到两个不符合预期的现象：

1. **大厅顶部网络状态显示「● 离线」**：[lobby_scene.js](../../../js/scenes/lobby_scene.js) 渲染时直接读取 `databus.netStatus`，而该字段反映的是 WebSocket 连接状态。点击「返回」会主动断开 WS（[room_scene.js](../../../js/scenes/room_scene.js) 的 `_returnToLobby`），于是大厅立刻显示「离线」。但按 [README.md](../../../README.md) 既定设计「大厅仅 HTTP」，大厅根本不依赖 WS，这条状态对大厅用户毫无意义，反而引起恐慌。
2. **大厅没有「重新进入」按钮**：服务端 [manager.go](../../../card_ssd/internal/room/manager.go) 的 `HandleDisconnect` 在 `PhaseWaiting` 阶段会直接 `RemovePlayer`，房间内已无真人即立即 `DestroyRoom`。结果就是：玩家创建房间还没等到任何人加入，自己点「返回」一出，房间就被销毁，`activeRoom` 必然为 `null`，「重新进入」按钮自然不会显示。这与 [README.md](../../../README.md) 描述的「房间将保留，可稍后从主页『重新进入』继续对局」的承诺不一致。

此外，当前房间右上角只有一个「返回」按钮，语义混杂：在 `match_end` 阶段它是真离开，其它阶段是保留座位回首页。**在 waiting 阶段，已加入他人房间的玩家缺少一个「真正退出（让出座位）」的入口** —— 一旦不想继续等下去，就只能让 24 小时兜底机制把自己踢出去，体验差。而对局开始后（playing/comparing），单方面退出会破坏牌局，应当只允许走「解散」投票或「返回」保留座位等待重连。

本需求将通过以下改动消除上述体验缺陷：

- 客户端 - 大厅：不再渲染底层 WS「离线/已连接」状态指示器，改为基于 HTTP 登录健康度的语义化提示（或直接隐藏），避免误导。
- 客户端 - 房间：右上角按阶段动态展示按钮组合：waiting 阶段显示「退出」+「返回」、playing/comparing 阶段显示「解散」+「返回」（不显示退出）、match_end 阶段仅显示「退出」。
- 服务端：扩展 `HandleDisconnect` 在 `PhaseWaiting` 阶段的策略 —— 不再直接 `RemovePlayer`，而是标记 `Offline=true` 并登记 `AllOfflineSince`，让大厅的 `activeRoom` 能命中、`重新进入` 按钮能显示并可一键回房；房间最终由 24 小时巡检 `StartIdleSweeper` 销毁。

## 需求

### 需求 1：大厅去除 WS 离线提示

**用户故事：** 作为玩家，我希望在大厅时不再看到带有歧义的「离线」红字提示，以便我专注于创建/加入房间，不会误以为后端已经挂掉。

#### 验收标准

1. WHEN 大厅场景 [lobby_scene.js](../../../js/scenes/lobby_scene.js) 的 `render` 被调用 THEN 客户端 SHALL 不再渲染基于 `databus.netStatus` 的「● 离线 / 连接中... / 已连接」三态文本。
2. WHEN 大厅 HTTP 登录请求 `_httpLogin` 失败（`_loginFailed=true`）THEN 大厅 SHALL 在原网络状态文本位置展示「服务异常，点击重试」红色提示，且点击屏幕任意位置 SHALL 触发 `_httpLogin` 重试（保持现有行为）。
3. WHEN 大厅 HTTP 登录成功 THEN 大厅 SHALL 不展示任何网络状态文本（或展示一条无干扰的灰色「在线」字样），不影响主按钮布局。
4. WHEN 房间场景仍然依赖 WS 状态 THEN [room_scene.js](../../../js/scenes/room_scene.js) 中相关的离线/重连提示 SHALL 不受本需求影响（不删除房间内的网络状态指示）。

### 需求 2：房间右上角按钮组合按阶段切换

**用户故事：** 作为房间内的玩家，我希望右上角按钮根据当前对局阶段呈现合理的组合 —— 等待时可以「退出」让出座位或「返回」保留座位，对局中只能走「解散」投票或「返回」等重连，对局结束后直接「退出」 —— 以便我的每个动作都符合当前情境的语义。

#### 验收标准

1. WHEN 房间处于 `waiting` 阶段 THEN 客户端 [room_scene.js](../../../js/scenes/room_scene.js) SHALL 在右上角展示两个相邻按钮：「退出」（红色，真离开让出座位）与「返回」（灰色，保留座位回首页）。**不展示**「解散」按钮（解散仅在已开局时有意义）。
2. WHEN 房间处于 `playing` 或 `comparing` 阶段 THEN 客户端 SHALL 在右上角展示两个相邻按钮：「解散」（橙色，发起/响应解散投票）与「返回」（灰色，保留座位回首页等待重连）。**不展示**「退出」按钮 —— 对局开始后单方让出座位会破坏牌局，玩家若想真离开必须走解散投票或等对局自然结束。
3. WHEN 房间处于 `match_end` 阶段 THEN 客户端 SHALL 仅展示一个「退出」按钮（红色，真离开），不再展示「返回」与「解散」按钮（整场已结算，保留座位无意义）。
4. WHEN 玩家点击「退出」按钮（仅 waiting 与 match_end 阶段可见）THEN 客户端 SHALL 弹出二次确认弹窗：waiting 阶段文案为「退出房间？将让出座位，无法重新进入」，match_end 阶段文案为「确定退出本房间？」。确认后 SHALL 发送 `LEAVE_ROOM` 消息，等服务端回 `LEAVE_ROOM_OK` 后切回大厅，并 `clearRoomId` 清掉本地 lastRoomId。
5. WHEN 玩家点击「返回」按钮（waiting 与 playing/comparing 阶段可见）THEN 客户端 SHALL 弹出二次确认弹窗「返回主页？房间将保留，可稍后从主页"重新进入"」，确认后 SHALL **不发送** `LEAVE_ROOM`，仅断开 WebSocket 并切回大厅，本地 lastRoomId 保持不变。
6. WHEN 「退出 / 返回 / 解散」中任意两个按钮同时展示时 THEN 它们 SHALL 排列在右上角同一行，等高、间距一致，互不重叠且不挡住微信胶囊菜单。

### 需求 3：服务端 waiting 阶段断线保活

**用户故事：** 作为玩家，我希望在 waiting 阶段意外断线（包括点「返回」主动断 WS），房间也不会立即被销毁，以便我可以从大厅「重新进入」按钮继续邀请好友/继续等待开局。

#### 验收标准

1. WHEN 服务端 [manager.go](../../../card_ssd/internal/room/manager.go) 的 `HandleDisconnect` 触发且房间 `Phase==PhaseWaiting` THEN 服务端 SHALL 不再无条件 `RemovePlayer`，而是改为：将断线玩家的 `Player.Offline=true` / `OfflineSince=now`，调用 `markAllOfflineIfNeeded(r)` 登记 `AllOfflineSince`，并 `BroadcastState` 通知房间内其他玩家，**房间不被销毁**。
2. WHEN `HandleDisconnect` 在 `PhaseWaiting` 阶段标记 Offline 后 THEN 服务端 SHALL **不再启动 30 秒兜底计时器**（waiting 阶段没有需要兜底自动提交的牌局），仅由 24h 巡检 `StartIdleSweeper` 按 `AllOfflineSince` 销毁。
3. WHEN `markAllOfflineIfNeeded` 在 `PhaseWaiting` 阶段被调用 THEN 它 SHALL 不再无条件清零 `AllOfflineSince`，而是按「无在线真人则记录、有在线真人则清零」的统一规则处理（与 playing/comparing/match_end 一致）。
4. WHEN 玩家从大厅再次发送 `JOIN_ROOM` 重连到 waiting 房间 THEN 服务端 SHALL 命中 `JoinRoom` 中的「已存在玩家 → 重连」分支，调用 `ReconnectPlayer` 把 `Offline` 复位为 `false`，并通过 `markAllOfflineIfNeeded` 在有在线真人时清零 `AllOfflineSince`。
5. IF waiting 房间内**所有真人**都断线超过 24 小时 THEN `StartIdleSweeper` SHALL 销毁该房间，与对局中房间的销毁规则保持一致。
6. WHEN 用户在 waiting 阶段主动发送 `LEAVE_ROOM`（即点击新增的「退出」按钮）THEN 服务端 SHALL 走原 `LeaveRoom` 流程（真离开、`RemovePlayer`、若房主则转移、若房间内无真人则销毁），本需求不改变此行为。
7. WHEN waiting 房间所有真人都标记为 Offline、但房间内还有 bot THEN 房间 SHALL 同样不被立即销毁（沿用 `AllOfflineSince` 24h 销毁），与现有「主动 LeaveRoom 时只剩 bot 也销毁」的规则解耦。

### 需求 4：从大厅重新进入 waiting 房间的体验

**用户故事：** 作为玩家，我希望从大厅再次进入「重新进入」按钮所指向的 waiting 房间时，房间状态、座位、规则与离开前完全一致，以便邀请流程不被打断。

#### 验收标准

1. WHEN 大厅 `_httpLogin` 返回的 `activeRoom.phase=='waiting'` THEN 大厅按钮文案 SHALL 显示为「重新进入（房间号）」，点击后走现有 `_doReenter` → `JOIN_ROOM` 流程。
2. WHEN 服务端处理重连进入 waiting 房间 THEN 客户端 SHALL 通过 `ROOM_STATE` 收到包含原座位、原昵称、原头像、`isReady=false`（因为还未开局）的房间快照，重连玩家自身的 `Offline` 字段 SHALL 已复位为 `false`。
3. WHEN waiting 房间内还有其他真人在线（例如朋友先加入）THEN 服务端在房主断线 / 重连时 SHALL 各自广播 `ROOM_STATE`，让在线玩家看到该位置头像上的离线 / 在线视觉切换，与对局中保持一致。

### 需求 5：测试与文档同步

**用户故事：** 作为开发者，我希望本次改动不破坏既有的 sweeper / 重连 / 24h 销毁 单元测试与回归测试，以便回归成本最小，并且文档说明保持准确。

#### 验收标准

1. WHEN 单元测试 `card_ssd/internal/room/sweeper_test.go` 运行 THEN 既有用例 SHALL 全部通过，必要时仅做最小调整以适配「waiting 阶段也纳入保活」的新规则。
2. WHEN 新增「waiting 阶段断线保活」相关用例 THEN 用例 SHALL 至少覆盖：
   - waiting 阶段唯一真人断线 → 房间不销毁、`AllOfflineSince` 已登记；
   - waiting 阶段断线再 `JoinRoom` → 房间还在、玩家 `Offline=false`、`AllOfflineSince=0`；
   - waiting 阶段所有真人断线 24h 后 sweeper 销毁该房间；
   - waiting 阶段主动 `LEAVE_ROOM`（对应客户端「退出」按钮）→ `RemovePlayer`，无真人则销毁。
3. WHEN [card_ssd/README.md](../../../card_ssd/README.md) 与 [README.md](../../../README.md) 中提到「24h 保活仅适用于 playing/comparing/match_end」的描述 THEN 文档 SHALL 同步更新为「waiting 阶段也纳入 24h 保活」并补充客户端「退出 vs 返回」双按钮的语义说明。

### 需求 6：视觉与交互过渡

**用户故事：** 作为玩家，我希望大厅页和房间页的视觉、交互过渡保持流畅，不出现"离线/已连接"红绿色短暂闪烁，按钮含义不混淆，以便观感专业。

#### 验收标准

1. WHEN 从房间场景按「返回」回到大厅 THEN 客户端 SHALL 不出现先短暂显示「已连接」再闪到「离线」的过程（因 WS 状态文本已在需求 1 中移除，本条作为视觉验收）。
2. WHEN 大厅再次「重新进入」走 WS 连接握手 THEN 房间场景仍 SHALL 维持原有的「连接中... / 已连接」状态文本与提示。
3. WHEN 房间右上角根据阶段切换按钮组合时 THEN 按钮 SHALL 通过颜色区分（退出=红、返回=灰、解散=橙），同一阶段下两按钮等高、间距一致；阶段切换时 SHALL 在下一帧 `render` 重新布局，避免出现按钮重叠或残影。

### 需求 7：进入主页时查询可继续的对局（覆盖所有"未退出"场景）

**用户故事：** 作为玩家，我希望每次进入主页（冷启动、从房间「返回」回大厅、`onShow` 重回前台）都能立刻看到自己「是否有可继续的对局」，且只要我没主动「退出」过，无论上次是何种阶段、何种离开方式（点「返回」、断网、杀进程、闪退），都能在主页上以「重新进入（房间号）」按钮的形式被找回，以便不会因为意外离开而丢失局。

#### 验收标准

1. WHEN 大厅场景 [lobby_scene.js](../../../js/scenes/lobby_scene.js) 的 `onEnter` 被调用 THEN 客户端 SHALL 调用 `POST /api/login` 拉取 `activeRoom`，并据此渲染「重新进入（房间号）」按钮；`onShow`（小程序回前台）触发时 SHALL 同样刷新一次 `activeRoom`，避免长时间在后台后状态过期。
2. WHEN 服务端 [manager.go](../../../card_ssd/internal/room/manager.go) 的 `FindActiveRoomByOpenid` 被调用 THEN 命中条件 SHALL 严格保持「房间未销毁 + 玩家仍在 `Players` 列表内」，**不限阶段**（waiting / playing / comparing / match_end 全部命中）、**不限在线状态**（Online 与 Offline 均命中），从而覆盖：未退出但本轮还没开局、对局中途断线、已结算未点退出等所有「进入后未主动退出」的情形。
3. WHEN 玩家在 waiting 阶段「点返回 / 断 WS / 杀进程」离开后回到大厅 THEN 由于需求 3 已确保服务端不会立即 `RemovePlayer`，`FindActiveRoomByOpenid` SHALL 仍能命中该 waiting 房间，大厅 SHALL 渲染「重新进入（房间号）」按钮。
4. WHEN 玩家有多个未结束房间命中（例如旧房间未及时销毁）THEN `FindActiveRoomByOpenid` SHALL 按 `LastActiveAt` 取最新一条返回，时间戳相同时按 `RoomID` 字典序兜底（保留现有规则，本需求不改变）。
5. WHEN 玩家点击「重新进入」按钮 THEN 客户端 SHALL 走 `_doReenter` → 建立 WS → 发送 `JOIN_ROOM`，服务端命中 `JoinRoom` 重连分支 `ReconnectPlayer`，并通过 `ROOM_STATE` 把当前阶段（含 playing/comparing 中途、match_end 结算页）完整快照下发，客户端 SHALL 直接渲染对应阶段的房间界面，无需玩家二次操作。
6. WHEN 玩家上一次是通过点击「退出」按钮（需求 2.4 中的 `LEAVE_ROOM`）离开 THEN 服务端 SHALL 已 `RemovePlayer`，`FindActiveRoomByOpenid` SHALL 不再命中该房间，大厅 SHALL **不展示**「重新进入」按钮 —— 即「退出」与「返回」的语义差异在主页查询结果上严格生效。
7. WHEN `POST /api/login` 因网络/服务异常失败 THEN 大厅 SHALL 按需求 1.2 展示「服务异常，点击重试」，且**不**残留上次会话的 `activeRoom` 缓存（`this.activeRoom = null`），避免误导玩家点击进入一个已不存在的房间。

