# 实施计划

> 关联需求文档：[requirements.md](./requirements.md)
> 代码作用域：服务端 `card_ssd/`、前端 `js/`、文档 `README.md`、`功能.md`

- [ ] 1. 扩展协议常量与房间数据模型
  - 在 [protocol.go](../../../card_ssd/internal/protocol/protocol.go) 中新增消息类型常量：`MsgVoteDissolve = "VOTE_DISSOLVE"`、`MsgVoteDissolveCancel = "VOTE_DISSOLVE_CANCEL"`、`MsgVoteDissolveTimeout = "VOTE_DISSOLVE_TIMEOUT"`
  - 在 [protocol.js](../../../js/net/protocol.js) `MSG` 对象同步新增上述三个常量
  - 在 [room.go](../../../card_ssd/internal/room/room.go) `Player` 结构体新增 `VoteDissolve bool` 字段；在 `Room` 结构体新增 `AllOfflineSince int64`、`LastActiveAt int64`、`voteTimer *time.Timer` 字段
  - 在 `PlayerState` 与 `State` 结构体上新增 `VoteDissolve bool` 字段并写入 `ToState()`
  - _需求：1.3、3.2、3.3、3.12、4.2_

- [ ] 2. 实现“最后真人离线 → 登记 allOfflineSince”联动
  - 在 [manager.go](../../../card_ssd/internal/room/manager.go) 新增辅助函数 `markAllOfflineIfNeeded(r *Room)`：在房间 `Phase != PhaseWaiting` 且无在线真人时记录 `AllOfflineSince = time.Now().UnixMilli()`，否则清空
  - 修改 `HandleDisconnect` 与 30 秒兜底回调：原本“无在线真人即销毁”改为：`waiting` 阶段保留原行为，其它阶段调用 `markAllOfflineIfNeeded` 并跳过销毁
  - 在 `ReconnectPlayer` / `JoinRoom` 重连分支中，将 `AllOfflineSince` 重置为 0
  - _需求：1.1、1.2、1.3、1.8_

- [ ] 3. 新增 24 小时全局巡检任务
  - 在 [manager.go](../../../card_ssd/internal/room/manager.go) 新增 `StartIdleSweeper(ctx context.Context, interval time.Duration, threshold time.Duration)`：使用 `time.NewTicker` 周期遍历 `rooms` 快照，命中 `AllOfflineSince > 0 && now - AllOfflineSince >= threshold` 时调用 `DestroyRoom`，日志写明原因 `"24h all-offline timeout"`
  - 在 [main.go](../../../card_ssd/main.go) 启动入口调用 `StartIdleSweeper(ctx, time.Hour, 24*time.Hour)`，并接管退出信号停止 ticker
  - 编写单元测试 `manager_sweeper_test.go`：注入 `interval=10ms / threshold=20ms`，验证“全员离线 → 巡检 → 销毁”路径
  - _需求：1.4、1.5、1.6、1.9_

- [ ] 4. 房间活跃时间维护与 activeRoom 最新优先
  - 在 [room.go](../../../card_ssd/internal/room/room.go) 添加 `(r *Room) Touch()` 方法：写入 `LastActiveAt = time.Now().UnixMilli()`
  - 在以下入口调用 `Touch()`：`AddPlayer`、`ReconnectPlayer`、`HandleSubmitLanes` 成功分支、`DoSettle`、`advanceAfterAllConfirmed`、`StartRound`
  - 修改 [manager.go](../../../card_ssd/internal/room/manager.go) `FindActiveRoomByOpenid`：候选房间集合按 `LastActiveAt` 降序、`RoomID` 字典序兜底，仅返回最新一条 `RoomSummary`
  - 编写单元测试覆盖“多房间命中时返回最新”
  - _需求：4.1、4.2、4.3、4.4_

- [ ] 5. 服务端实现投票解散核心逻辑
  - 在 `card_ssd/internal/handler/` 新建 [vote.go](../../../card_ssd/internal/handler/vote.go)：实现 `HandleVoteDissolve` 与 `HandleVoteDissolveCancel`
  - 校验房间存在、阶段为 `playing` 或 `comparing`，否则返回 `ErrBadRequest`
  - 设置/清空 `Player.VoteDissolve`，调用 `BroadcastState`；首次投票时启动 60 秒 `time.AfterFunc`，超时回调清空所有 `VoteDissolve` 并广播 `MSG_VOTE_DISSOLVE_TIMEOUT`
  - 抽取私有函数 `checkAllHumansVoted(r *Room) bool`：在 `Players` 中筛 `IsBot=false && Offline=false`，全部 `VoteDissolve=true` 即返回 true
  - 在 [router.go](../../../card_ssd/internal/server/ws.go) 的 ws 消息分发表注册新协议入口（注意：实际分发位置以现有 server/ws 中 dispatch 为准）
  - _需求：3.1、3.2、3.3、3.4、3.10、3.12_

- [ ] 6. 服务端实现“提前结算”阶段切换
  - 在 [vote.go](../../../card_ssd/internal/handler/vote.go) 新增 `triggerEarlyMatchEnd(r *Room)`：将 `r.Phase = PhaseMatchEnd`、停止 `voteTimer`、按当前 `Player.Score` 排序构造 `ranks` 并广播 `MsgMatchEnd` 与 `ROOM_STATE`；`playing` 阶段直接跳过本局结算（不调用 `Settle`），`comparing` 阶段保留已发结算结果
  - 在 `HandleVoteDissolve` 命中“全员同意”时调用 `triggerEarlyMatchEnd`
  - 修改 [manager.go](../../../card_ssd/internal/room/manager.go) `HandleDisconnect` 与 30 秒兜底回调：在玩家被标记 Offline / 被踢出后调用 `checkAllHumansVoted`，命中则触发提前结算（通过 `autoSettleHook` 之外注入新 hook：`SetEarlyEndHook`）
  - _需求：3.5、3.6、3.7、3.8、3.9、3.11_

- [ ] 7. 前端房间页“返回”按钮文案改造
  - 在 [room_scene.js](../../../js/scenes/room_scene.js) 将原 `'退出'` 按钮文案改为 `'返回'`，确认弹窗标题改为 `返回主页？`、副标题改为 `房间将保留，可稍后从主页“重新进入”继续对局`
  - 在确认弹窗的“确认”回调中：`match_end` 阶段保留发送 `LEAVE_ROOM`；其他阶段不发送 `LEAVE_ROOM`，改为调用 `GameGlobal.socket.close()` 并切到 `lobby_scene`
  - 同步更新 [debug-log] 注释中的“位于退出按钮左侧”表述及代码中的 `// 退出` 中文注释
  - _需求：2.1、2.2、2.3、2.4、2.6、2.7、2.8_

- [ ] 8. 前端房间页“解散”按钮与投票徽章
  - 在 [room_scene.js](../../../js/scenes/room_scene.js) 在“返回”按钮左侧新增同尺寸 `'解散'` 按钮，仅在 `phase === playing | comparing` 且当前是真人时显示
  - 点击后弹窗确认 `发起解散对局？所有真人同意后将按当前积分提前结算`，确认后 `socket.send(MSG.VOTE_DISSOLVE, {})`；若已投票则按钮文案变为 `撤销`，点击发送 `VOTE_DISSOLVE_CANCEL`
  - 在 [PlayerSeat.js](../../../js/ui/PlayerSeat.js) 渲染头像旁徽章 `已投同意 N/M`（N 为已投真人数，M 为在线真人总数）；离线/Bot 不计入；监听 `MSG.VOTE_DISSOLVE_TIMEOUT` 显示一条 Toast `投票已超时`
  - _需求：3.1、3.2、3.12_

- [ ] 9. README 与功能文档同步
  - 更新 [README.md](../../../README.md) 与 [功能.md](../../../功能.md)：补充“房间 24 小时保活”、“返回大厅 / 投票解散”、“最新房间优先重连”三段说明
  - 移除/调整原“对局中退出将视为掉线”等已不适用的措辞
  - 在“断线重连”章节追加描述：进行中房间在所有真人离线后保留 24 小时，超时由每小时巡检销毁
  - _需求：1.5、2.2、3.6、4.1（涉及对外可见行为均同步文档）_

- [ ] 10. 关键路径集成自测
  - 启动本地 `card_ssd.exe`，使用前端模拟两真人房间，分别断连后等待巡检销毁（开发期可临时把 interval/threshold 调小验证）
  - 验证投票解散：playing 阶段 → 触发 → MATCH_END 出排行；comparing 阶段 → 触发 → 保留本局结算
  - 验证多房间场景：让同一 openid 先后挂入两个房间，刷新大厅“重新进入”始终指向最新房间
  - _需求：1.5、3.5、4.1_
