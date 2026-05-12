# 需求文档：长时未结束房间保留 / 返回大厅 / 投票解散 / 最新房间重连

## 引言

本次迭代针对“长对局体验”与“断线/中途撤离体验”做四项联动改造，核心目标是让一桌正在进行中的对局在所有真人都掉线时**不立即解散**，从而支持稍后再回；同时为玩家提供明确的“先回主页再回房间”的入口，以及当多数人不想继续时的“民主提前结束”能力。

本需求涉及前端（小游戏，路径 `js/`）与 Go 服务端（路径 `card_ssd/`）两侧改造。废弃的 Node 服务端 `server/` 不在本次范围。

四项需求关联紧密：
1. **房间 24 小时保活**：进行中的房间即使所有真人都离线，也不立即销毁；服务端每小时巡检一次，命中“全员离线超 24 小时”才解散。
2. **“退出”按钮改“返回”**：玩家可在不离开房间的前提下回到主页；房间状态由服务端继续保留（与第 1 条共同发挥作用）。
3. **投票解散**：所有真人玩家共同发起“解散对局”，无需走完总局数，按当前累计积分直接进入整场结算/排行界面。
4. **最新房间优先重连**：玩家若同时挂在多个未结束房间，大厅“重新进入”按钮只展示最新一个。

## 需求

### 需求 1：进行中房间保留 24 小时

**用户故事：** 作为一名玩家，我希望对局进行到一半即使全员暂时离线，房间也能保留一段时间，以便我们晚些时候回来继续这局牌而不必从头开始。

#### 验收标准

1. WHEN 房间处于 `playing` / `comparing` / `match_end` 任一阶段 AND 房间内所有真人玩家 `offline=true` THEN 系统 SHALL 保留该房间，不立即销毁。
2. WHEN 房间处于 `waiting` 阶段（尚未发出第一轮牌）AND 所有真人玩家离线 THEN 系统 SHALL 沿用现有逻辑立即销毁该房间。
3. WHEN 房间最后一名真人离线时 THEN 系统 SHALL 在房间对象上记录 `allOfflineSince` 时间戳；任意一名真人重新上线时该时间戳被清空。
4. WHEN 服务端启动后 THEN 系统 SHALL 启动一个**每 1 小时触发一次**的全局巡检任务。
5. WHEN 巡检触发 THEN 系统 SHALL 遍历所有未销毁房间，若 `allOfflineSince` 不为空且 `now - allOfflineSince ≥ 24 小时` 则销毁该房间。
6. WHEN 房间因 24 小时巡检被销毁 THEN 系统 SHALL 取消该房间的 bot 定时器、离线兜底定时器，并在日志中输出销毁原因（“24h all-offline timeout”）。
7. WHEN 真人玩家在 24 小时内重新连入并发送 `JOIN_ROOM` THEN 系统 SHALL 走重连分支，下发 `RECONNECT_SNAPSHOT` 恢复阶段、手牌、已提交三道、最近一局结算等信息。
8. IF 当前服务端 30 秒离线兜底中“playing 阶段未提交则按散牌自动结算”的行为 THEN 系统 SHALL 保持不变，仅当 30 秒兜底执行后“房间内已无在线真人”时**不再立即销毁**，而是改为登记 `allOfflineSince` 并交由 24 小时巡检处理。
9. WHEN 巡检任务运行 THEN 系统 SHALL 通过加锁避免与 `JoinRoom`/`HandleDisconnect` 等并发改写状态产生竞态。

### 需求 2：房间内的“退出”按钮改为“返回”

**用户故事：** 作为一名对局中的玩家，我希望按钮的语义清晰——点击后只是回到主页，房间和我的座位仍然保留，以便我能稍后再回到这局。

#### 验收标准

1. WHEN 玩家进入房间页 THEN 系统 SHALL 在原“退出”按钮位置显示文案 `返回` 的按钮，按钮尺寸/位置/字号与原按钮一致。
2. WHEN 玩家点击 `返回` 按钮 THEN 系统 SHALL 弹出确认弹窗，标题文案为 `返回主页？`，副标题文案为 `房间将保留，可稍后从主页“重新进入”继续对局`。
3. WHEN 玩家在确认弹窗中点击“确认” THEN 系统 SHALL **不发送** `LEAVE_ROOM` 消息，**直接断开 WebSocket** 并切换到大厅场景。
4. WHEN 玩家断开后 THEN 服务端 SHALL 走现有 `HandleDisconnect` 流程，将该玩家标记为 `offline=true`（沿用现有 30 秒兜底）。
5. WHEN 玩家从大厅再次进入主页 THEN 系统 SHALL 通过 `POST /api/login` 拿到 `activeRoom` 摘要并显示“重新进入（房间号）”按钮（沿用现有大厅能力）。
6. WHEN 用户处于 `match_end` 阶段且点击“返回大厅”按钮 THEN 系统 SHALL 沿用现有 `LEAVE_ROOM` 真离开流程；本需求**不影响整场结束后的离开按钮**。
7. IF 玩家在 `waiting` 阶段点击“返回” THEN 系统 SHALL 仍然走断连而非 `LEAVE_ROOM`；房间 `waiting` 阶段“无在线真人则销毁”的逻辑由服务端 30 秒兜底保留。
8. IF 玩家位于 BOT 房间（仅自己一个真人），点击返回 THEN 系统 SHALL 仍走断连流程；24 小时窗口内重连可继续；超时由巡检销毁。

### 需求 3：投票解散对局并按当前积分提前结算

**用户故事：** 作为一名玩家，当所有真人都不愿意继续打完总局数时，我希望大家投票解散对局，直接按当前累计积分弹出结算画面，避免被迫打完。

#### 验收标准

1. WHEN 房间处于 `playing` / `comparing` 阶段 AND 房间内有 ≥1 名在线真人 THEN 系统 SHALL 在房间页提供“解散对局”入口（建议放在“返回”按钮旁，文案 `解散`，尺寸与“返回”一致）。
2. WHEN 玩家点击“解散” THEN 系统 SHALL 发送新协议消息 `VOTE_DISSOLVE`（`data: {}`）。
3. WHEN 服务端收到 `VOTE_DISSOLVE` THEN 系统 SHALL 将该玩家在房间内的 `voteDissolve=true` 设为已投票，并通过 `ROOM_STATE` 广播每名玩家是否已投票。
4. WHEN 任意真人玩家发起首次投票 THEN 系统 SHALL 启动一次性 60 秒倒计时；超时后所有未投票者视为“拒绝”，本轮投票作废，所有 `voteDissolve` 字段被清空，并广播一条提示。
5. WHEN 房间内**所有真人玩家**均处于 `voteDissolve=true` 状态 THEN 系统 SHALL 立即触发“提前结算”。
6. WHEN 触发提前结算 THEN 系统 SHALL **不再继续本局未结算的发牌**，将房间阶段切换至 `match_end`，按当前 `Player.Score` 排序构造 `MATCH_END.ranks` 并广播。
7. IF 提前结算时房间正处于 `playing` 阶段且本局尚未发出 `SETTLE_RESULT` THEN 系统 SHALL **跳过本局结算**（本局视为不计），直接以累计 `Score` 进入 `MATCH_END`。
8. IF 提前结算时房间正处于 `comparing` 阶段（本局结算已发） THEN 系统 SHALL 视为该局结算有效，并以累计 `Score` 进入 `MATCH_END`。
9. WHEN 进入 `MATCH_END` THEN 系统 SHALL 触发现有“整场结束”UI（排行 + 返回大厅按钮）；电脑玩家默认视为“同意解散”，无需投票。
10. IF 房间为 `match_end` 或 `waiting` 阶段 THEN 系统 SHALL 拒绝 `VOTE_DISSOLVE` 并返回 `ErrBadRequest`。
11. WHEN 任意一名玩家投票后但未全员同意时离开（断线 / 30 秒兜底踢出 / 真离开） THEN 系统 SHALL 重新评估“在场真人是否全员已投同意”，若达标则立即触发提前结算。
12. WHEN 客户端接收到 `ROOM_STATE` 含投票字段 THEN 系统 SHALL 在已投票玩家头像旁显示“已投同意 N/M” 徽章；点击自己头像旁的徽章可撤销投票（同时发送 `VOTE_DISSOLVE_CANCEL`）。

### 需求 4：最新房间优先重连

**用户故事：** 作为一名玩家，如果我恰好同时挂在多个未结束的房间里，大厅的“重新进入”应当只指引我去最新的那一桌，避免误入旧局。

#### 验收标准

1. WHEN 服务端处理 `POST /api/login` 或 `GET /api/lobby/active-room` THEN 系统 SHALL 在所有候选房间中按“最近活跃时间”降序选第一个返回，仅返回一条 `activeRoom` 摘要。
2. WHEN 房间发生“创建 / 玩家加入 / 玩家提交三道 / 进入下一局 / 24 小时巡检命中之前的任意广播”时 THEN 系统 SHALL 更新该房间的 `LastActiveAt` 时间戳。
3. IF 玩家不在任何未销毁房间中 THEN 系统 SHALL 返回 `activeRoom=null`（沿用现有行为）。
4. WHEN 候选房间数 ≥ 2 THEN 系统 SHALL 选择 `LastActiveAt` 最新的那一个；时间戳相同时按 `RoomID` 字典序兜底。
5. WHEN 客户端收到 `activeRoom` 后点击“重新进入” THEN 系统 SHALL 沿用现有重连流程并发送 `JOIN_ROOM { roomId }`。

## 边界情况与非功能要求

- **持久化范围**：本需求**不**引入数据库或文件持久化；进程重启仍会清空所有房间。仅依赖 Go 服务端的内存 + 24 小时窗口。
- **巡检任务**：使用 `time.NewTicker(time.Hour)`，并支持 `context.Context` 在服务退出时停止。巡检不能阻塞 `JoinRoom` 等高频路径；遍历时使用读快照避免长时间持锁。
- **测试要点**：
  - 单元测试覆盖 `allOfflineSince` 设置 / 清除时机；
  - 单元测试覆盖 `FindActiveRoomByOpenid` 在多候选时的“最新优先”行为；
  - 集成测试覆盖“两个真人 → 两人都断 → 巡检触发”→“房间销毁”路径（巡检间隔可在测试中通过参数注入缩短）；
  - 集成测试覆盖“投票解散 → 提前结算 MATCH_END”路径。
- **协议兼容**：新增 `VOTE_DISSOLVE` / `VOTE_DISSOLVE_CANCEL` 消息以及 `ROOM_STATE.players[].voteDissolve` 字段；老客户端忽略新字段不影响现有功能。
- **UI 文案统一**：本次涉及的所有文案均使用中文短词，与现有“准备 / 取消 / 加入 / 创建”风格一致。
- **README 同步**：实现完成后需同步更新 `README.md` 与 `功能.md` 中“断线重连”、“对局页面功能”相关章节。
