# 需求文档：断线重连 / 重新进入对局

## 引言

当前游戏在网络抖动、用户切后台过久、强制关闭小游戏等场景下，会出现客户端与服务端连接断开的情况。

服务端 `server/room_manager.js` 已经具备「同 openid 重新加入房间视为重连」的能力，并对对局中掉线玩家保留 30 秒的恢复窗口；但客户端缺少**业务层重连**链路：

1. WebSocket 重连成功后只会重发 `LOGIN`，并不会自动回到原房间；
2. 大厅页面没有"重新进入"入口，玩家被动停留在大厅，未完成的对局对玩家不可见；
3. 服务端 `LOGIN_OK` 不会告知"该玩家当前是否仍在某个房间"，客户端无法判断是否需要恢复。

本需求新增以下能力：

- **服务端**：登录时告知客户端是否存在未结束的房间；提供专用的「重连接入」消息或在 `JOIN_ROOM` 中容错。
- **客户端**：登录后若有未完成对局，弹出/在大厅显示「重新进入」按钮；玩家点击后无缝恢复到房间或对局当前阶段（等待/放牌/比牌动画/整场结束）。
- **持久化**：客户端在本地缓存最近所在的 `roomId`，作为兜底辅助手段（服务端为主，本地为辅）。

最终目标：在掉线 30 秒之内，玩家能够通过点击「重新进入」无感地回到对局，已发的手牌、已摆的牌道、当前比牌结果等信息全部恢复。

---

## 需求

### 需求 1：服务端登录响应携带"在房状态"

**用户故事：** 作为一名玩家，我希望小游戏一连上服务器就知道我是不是还在某个房间里，以便决定是回大厅还是直接回到那个房间。

#### 验收标准

1. WHEN 客户端发送 `LOGIN` 消息且服务端校验通过 THEN 服务端 SHALL 在 `LOGIN_OK` 消息的 `data` 中返回 `activeRoom` 字段。
2. IF 该 openid 当前在 `room_manager.rooms` 中存在某个 `Player` 实例 THEN `activeRoom` SHALL 为对象 `{ roomId, phase, currentRound, totalRounds }`。
3. IF 该 openid 当前不在任何房间 THEN `activeRoom` SHALL 为 `null`。
4. WHEN 服务端通过 `session.bindOpenid` 处理同 openid 旧连接 THEN 旧 `Session` SHALL 被关闭、新 `Session` SHALL 继承房间归属（`session.roomId` 在 `LOGIN_OK` 之前由服务端按 `Player.openid` 反查重新挂上）。
5. IF 玩家所在房间已处于 `MATCH_END` 阶段 THEN `activeRoom` SHALL 仍然返回，并由客户端决定是否进入。

### 需求 2：大厅显示「重新进入」入口

**用户故事：** 作为一名玩家，我希望进入小游戏后能直接看到一个「重新进入」按钮，以便点击后回到中断的对局。

#### 验收标准

1. WHEN 客户端收到 `LOGIN_OK` 且 `data.activeRoom` 非空且当前场景为大厅 THEN `LobbyScene` SHALL 在主按钮区上方显示一个「重新进入（房间 xxxx）」按钮。
2. WHEN `activeRoom` 为空 THEN `LobbyScene` SHALL 不显示该按钮。
3. WHEN 玩家点击「重新进入」 THEN 客户端 SHALL 向服务端发送 `JOIN_ROOM` 消息，`data.roomId` 为 `activeRoom.roomId`。
4. WHEN 「重新进入」请求成功（收到 `ROOM_STATE`） THEN 客户端 SHALL 跳转到 `RoomScene`，并按当前 `phase` 自动进入相应子阶段。
5. IF 「重新进入」请求返回 `ROOM_NOT_FOUND` THEN 客户端 SHALL 提示「房间已不存在」并将该按钮隐藏。

### 需求 3：客户端本地持久化最近房间号

**用户故事：** 作为一名玩家，我希望即使服务端临时不可达，下次进入时仍然记得我刚才在哪个房间，以便快速尝试回到那里。

#### 验收标准

1. WHEN 客户端成功加入或创建房间（收到 `ROOM_STATE` 且 `players` 包含自己） THEN 客户端 SHALL 通过 `wx.setStorageSync('lastRoomId', roomId)` 持久化房间号。
2. WHEN 客户端主动调用 `LEAVE_ROOM` 成功 THEN 客户端 SHALL 通过 `wx.removeStorageSync('lastRoomId')` 清除该缓存。
3. WHEN 服务端 `LOGIN_OK.activeRoom` 为空但本地存在 `lastRoomId` THEN 客户端 SHALL **不**自动加入，仅以服务端结果为准。
4. IF 运行环境无 `wx` 全局对象（如本地浏览器调试） THEN 客户端 SHALL 跳过持久化逻辑，不抛错。

### 需求 4：服务端 `JOIN_ROOM` 重连路径返回完整恢复数据

**用户故事：** 作为一名玩家，我希望重连进入房间后立刻看到自己的手牌、已摆好的牌道、当前比牌结果，以便无缝继续对局。

#### 验收标准

1. WHEN 服务端 `room_manager.joinRoom` 命中"已存在玩家"分支（即 `reconnect=true`） THEN 服务端 SHALL 在向该玩家广播 `ROOM_STATE` 之前，**先**向其单独发送一条 `RECONNECT_SNAPSHOT` 消息。
2. `RECONNECT_SNAPSHOT.data` SHALL 包含以下字段（按当前 `phase` 取值，不存在的字段为 `null`）：
   - `phase`：房间当前阶段；
   - `hand`：玩家手牌（仅当 `phase` 为 `playing` 或 `comparing` 时返回，其它阶段为 `null`）；
   - `lanes`：玩家本局已提交的三道（未提交则为 `null`）；
   - `submitted`：是否已提交；
   - `lastSettle`：最近一局的结算结果（仅 `comparing` 或 `match_end` 阶段返回）；
   - `currentRound` / `totalRounds`：进度信息。
3. WHEN 玩家收到 `RECONNECT_SNAPSHOT` THEN 客户端 SHALL 还原其本地 `databus` 中的手牌、三道、结算等数据，使 `RoomScene` 的子场景按 `phase` 正确进入：
   - `waiting` → 房间等待页（PlayerSeat + 准备按钮状态）；
   - `playing` 且 `submitted=false` → 进入 `play_phase` 摆牌界面；
   - `playing` 且 `submitted=true` → 进入"等待其他玩家开牌"等待态；
   - `comparing` → 进入 `settle_phase` 比牌界面；
   - `match_end` → 进入整场结束面板。
4. IF `JOIN_ROOM` 不是重连路径（即首次加入） THEN 服务端 SHALL **不**发送 `RECONNECT_SNAPSHOT`，行为与现状一致。

### 需求 5：客户端业务层自动重连

**用户故事：** 作为一名玩家，我希望网络短暂抖动后游戏自己悄悄连回房间，不需要我手动操作。

#### 验收标准

1. WHEN `SocketClient` 触发 `_onOpen` 完成 `LOGIN` 重发，并且本地 `databus.room` 仍存在（即用户在房间页/对局中断线） THEN 客户端 SHALL 在收到 `LOGIN_OK` 后自动发送 `JOIN_ROOM`，`roomId` 取自 `databus.room.id`。
2. WHEN 自动 `JOIN_ROOM` 成功 THEN 客户端 SHALL 不跳转场景，原地由 `RECONNECT_SNAPSHOT` + `ROOM_STATE` 驱动 UI 刷新。
3. WHEN 自动 `JOIN_ROOM` 失败（房间已不存在或弃局超时已过） THEN 客户端 SHALL 清空 `databus.room`、回到大厅，并 `Toast` 提示「房间已结束」。
4. IF 玩家位于大厅页且 `databus.room` 为空（即正常未在房间） THEN `_onOpen` 后的逻辑 SHALL 仅依赖需求 1+2 的「重新进入」入口，不触发自动 JOIN_ROOM。
5. WHEN `SocketClient` 在重连过程中 THEN 客户端 SHALL 在屏幕顶部 / 状态条显示「重连中…」并在恢复后 1 秒内消失。

### 需求 6：玩家在对局阶段被动断线时的服务端兜底

**用户故事：** 作为一名玩家，我希望我掉线 30 秒内回来时还是同一局对局，掉线超过 30 秒服务端再按弃局规则处理。

#### 验收标准

1. WHEN 玩家 `Session` 触发 `close` 且其 `roomId` 不为空 THEN 服务端 SHALL 沿用现有 `room_manager.handleDisconnect` 行为（`waiting` 阶段直接移除，对局阶段仅标记 `offline=true` 并在 30 秒后兜底弃局）。
2. WHEN 同 openid 在 30 秒内重新建立连接并发送 `LOGIN` THEN 服务端 SHALL 通过 `session.bindOpenid` 关闭旧连接、并将新 `Session.roomId` 设置为对应房间 ID（修复当前实现中 `bindOpenid` 不复原 `roomId` 的问题）。
3. WHEN 重连成功 THEN 服务端 SHALL 调用 `room_manager.cancelOfflineTimer` 取消该玩家的弃局兜底计时器，并将 `Player.offline` 置为 `false`、`offlineSince=0`。
4. WHEN 重连完成后 THEN 服务端 SHALL 立即对房间内**所有**玩家广播一次 `ROOM_STATE`，使他人看到该玩家恢复在线。

### 需求 7：协议常量与文档同步

**用户故事：** 作为开发者，我希望新增的消息类型在客户端、Node 服务端、Go 服务端三处协议定义一致，避免不同端口实现产生分歧。

#### 验收标准

1. WHEN 新增 `RECONNECT_SNAPSHOT` 消息类型 THEN 客户端 [protocol.js](e:/wxgame/card2/js/net/protocol.js) `MSG` 对象 SHALL 新增对应字段。
2. WHEN 修改 Node 服务端 THEN [server/protocol.js](e:/wxgame/card2/server/protocol.js) SHALL 同步增加该常量。
3. IF 后续需要 Go 服务端 (`card_ssd/internal/protocol/protocol.go`) 兼容 THEN 该协议常量 SHALL 在文档中标注为"待 Go 服务端实现"，本次需求**不强制**修改 Go 实现。
4. WHEN 功能完成 THEN [README.md](e:/wxgame/card2/README.md) 与 [功能.md](e:/wxgame/card2/功能.md) SHALL 增补"断线重连"使用说明小节。

---

## 边界与非目标

- **不做跨服务端实现**：本次仅落地 Node 服务端 (`server/`) 与客户端，Go 服务端实现作为后续工作。
- **不引入鉴权 token**：仍沿用 `openid` 作为唯一身份，与现状保持一致。
- **不做长时间断线恢复**：超过 30 秒已被 `handleDisconnect` 按弃局处理，重连只能进入下一局或观战，本需求不改变该结算策略。
- **不持久化对局状态到磁盘**：服务端进程重启视为房间消失，客户端会收到 `ROOM_NOT_FOUND` 并清除本地缓存。
