# 需求文档

## 引言

当前房间已支持房主在等待阶段「添加 / 踢出电脑玩家」（`ROOM_ADD_BOT` / `ROOM_KICK_BOT`），但未提供「踢出真人玩家」的能力。在线下/朋友局场景中，可能出现误入房间、需要换人或某玩家长时间未准备等情况，房主需要主动将其请出房间，以便房间继续正常组局。

本需求在不改动核心对局规则的前提下，扩展现有的「房主踢人」能力，使其覆盖**真人玩家**：
- 仅房主可发起，且仅在房间处于「等待阶段（waiting）/整场结束（match_end）」时允许；
- 被踢玩家会立即从房间移除，并收到通知；
- 仍走现有 WebSocket 协议链路，复用座位点击交互；
- 房主自身不可被踢；电脑玩家继续沿用既有踢出逻辑。

## 需求

### 需求 1：服务端扩展踢人协议以支持真人

**用户故事：** 作为一名房主，我希望能够通过单一的踢人接口同时踢出电脑或真人玩家，以便在等待阶段灵活管理房间成员。

#### 验收标准

1. WHEN 房主在等待阶段 / 整场结束阶段对房间内任意非自身玩家发起踢人请求 THEN 服务端 SHALL 校验房主身份与房间阶段后将该玩家从 `r.Players` 中移除并广播最新 `ROOM_STATE`
2. IF 请求者不是房主 THEN 服务端 SHALL 返回错误码 `ErrNotHost`（1009）且不修改房间状态
3. IF 房间阶段不是 `waiting` 或 `match_end` THEN 服务端 SHALL 返回错误码 `ErrRoomNotWaiting`（1010）且不修改房间状态
4. IF 目标 openid 等于房主自身 openid THEN 服务端 SHALL 返回 `ErrBadRequest`（1008）并提示「房主不可踢出自己」
5. IF 目标玩家不存在于房间 THEN 服务端 SHALL 返回 `ErrBadRequest` 并提示「目标玩家不存在」
6. WHEN 被踢的是真人玩家 THEN 服务端 SHALL 在踢出前向该真人单播一条 `ROOM_KICKED` 通知（包含 `roomId`、`reason`），并在该玩家的 `session.RoomID` 上清空房间绑定
7. WHEN 踢出后房间内仍有真人玩家 THEN 服务端 SHALL 广播新的 `ROOM_STATE`；WHEN 踢出后房间已无真人 THEN 服务端 SHALL 销毁房间（与现有 `LeaveRoom` 行为对齐）
8. WHEN 协议命名 THEN 服务端 SHALL 复用现有 `ROOM_KICK_BOT` 路径并新增一条独立协议 `ROOM_KICK_PLAYER` / `ROOM_KICK_PLAYER_OK`，用于区分操作语义并便于日志审计

### 需求 2：被踢玩家的客户端处理

**用户故事：** 作为一名被房主踢出的玩家，我希望能立即收到提示并被带回大厅，以便清楚自己已离开房间。

#### 验收标准

1. WHEN 客户端收到 `ROOM_KICKED` THEN 客户端 SHALL 弹出 Toast 提示「已被房主请出房间」
2. WHEN 客户端收到 `ROOM_KICKED` THEN 客户端 SHALL 清理 `databus.room` 与房间内 `playPhase`/`settlePhase` 等场景缓存，并切换到大厅场景（`SCENES.LOBBY`）
3. WHEN 切换回大厅 THEN 客户端 SHALL 立即触发一次大厅刷新（与现有「主动离开房间」流程一致），避免显示过期的「重连入房」入口
4. IF 客户端在收到 `ROOM_KICKED` 时 socket 已断开 THEN 客户端 SHALL 在重连成功后通过现有 `lobby/active-room` 查询路径自动确认已不在房间，无需额外处理

### 需求 3：房主端的踢人交互

**用户故事：** 作为一名房主，我希望在等待阶段点击其他真人玩家的座位时弹出确认踢人弹窗，以便快速将其请出。

#### 验收标准

1. WHEN 房主在 `phase=waiting` 或 `phase=match_end` 阶段点击任意非自身座位 THEN 客户端 SHALL 弹出「踢出『xxx』？」确认弹窗（复用当前的 `_renderKickBotConfirm` 弹窗渲染样式）
2. IF 当前用户不是房主 OR 房间阶段不属于「等待 / 整场结束」 THEN 点击座位 SHALL 不触发踢人弹窗
3. IF 点击的目标是房主自己 THEN 客户端 SHALL 不弹出确认弹窗
4. WHEN 房主在确认弹窗点击「确定」并且目标是电脑 THEN 客户端 SHALL 发送 `ROOM_KICK_BOT`（保持现有逻辑不变）
5. WHEN 房主在确认弹窗点击「确定」并且目标是真人 THEN 客户端 SHALL 发送 `ROOM_KICK_PLAYER` 携带 `{ openid }`
6. WHEN 房主在确认弹窗点击「取消」或区域外 THEN 客户端 SHALL 关闭弹窗且不发送任何请求
7. WHEN 房主成功踢出后收到新的 `ROOM_STATE` THEN 客户端 SHALL 自动关闭确认弹窗

### 需求 4：边界与安全

**用户故事：** 作为系统维护者，我希望踢人能力具备完整的边界保护与日志审计，以便排查问题且避免被滥用。

#### 验收标准

1. WHEN 服务端处理 `ROOM_KICK_PLAYER` THEN 服务端 SHALL 通过 `logger.Info` 记录「房间 X 房主 Y 踢出真人玩家 Z(昵称)」一行日志
2. IF 客户端发送 `ROOM_KICK_PLAYER` 但缺少 `openid` 字段 THEN 服务端 SHALL 返回 `ErrBadRequest`
3. IF 房间已被销毁或不存在 THEN 服务端 SHALL 返回 `ErrNotInRoom`（1004）
4. WHEN 被踢真人玩家的 `OfflineTimer` 仍在运行（如该玩家此前掉线） THEN 服务端 SHALL 调用 `CancelOfflineTimer(openid)` 释放计时器，避免无主回调

### 需求 5：与现有特性兼容

**用户故事：** 作为玩家，我希望踢人功能与已有的「投票解散对局」「电脑玩家管理」「断线重连」等流程互不影响。

#### 验收标准

1. WHEN 房间阶段是 `playing`/`comparing` THEN 服务端 SHALL 拒绝 `ROOM_KICK_PLAYER`，对局过程中不允许踢真人，避免破坏整场积分结算
2. WHEN 真人被踢后 THEN 该玩家在房间内已发起的解散投票 SHALL 被自动清除（随其从 `r.Players` 中移除而失效）
3. WHEN 真人被踢导致房间内仍剩 0 个真人 THEN 服务端 SHALL 触发与「最后一名真人离开」一致的房间销毁流程（含 bot 定时器清理、持久层标记销毁）
4. WHEN README 中关于「房主能力」的说明 THEN 文档 SHALL 同步更新为：房主可在等待阶段添加/踢出电脑玩家、踢出真人玩家
