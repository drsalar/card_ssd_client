# 实施计划：房主添加电脑玩家（AI Bot）

> 范围：仅围绕"电脑玩家"功能进行编码改造。后端集中在 `card_ssd/internal/`，前端集中在 `js/scenes/`、`js/ui/`、`js/net/`。所有任务都是可执行的代码改动。

- [ ] 1. 扩展数据模型与协议常量
  - 在 [room.go](e:\wxgame\card2\card_ssd\internal\room\room.go) 的 `Player` 结构体中新增 `IsBot bool` 字段，并在 `PlayerState` / `ToState` 中输出 `isBot` 字段
  - 在 [protocol.go](e:\wxgame\card2\card_ssd\internal\protocol\protocol.go) 中新增消息常量 `MsgRoomAddBot = "ROOM_ADD_BOT"`、`MsgRoomKickBot = "ROOM_KICK_BOT"`，并新增对应 OK/错误码（如 `ErrRoomNotWaiting`）
  - 在 [server/protocol.js](e:\wxgame\card2\server\protocol.js) 与 [js/net/protocol.js](e:\wxgame\card2\js\net\protocol.js) 中同步新增对应常量，保持前后端一致
  - _需求：1.1, 1.6, 6.1_

- [ ] 2. 实现 AI 理牌核心算法
  - 新建 [card_ssd/internal/game/ai_bot.go](e:\wxgame\card2\card_ssd\internal\game\ai_bot.go)，对外暴露 `AutoArrange(hand []Card) *Lanes`
  - 内部按"枚举强牌型 → 优先填尾道 → 再填中道 → 余 3 张作头道"策略组牌，并复用现有 `evaluator` 比较牌型
  - 当 `Validate()` 不通过时，回退到"按点数从大到小填尾道→中道→头道"的散牌兜底，同时通过参数返回 `usedFallback bool` 供调用方打 WARN 日志
  - _需求：3.1, 3.2, 7.1, 7.2, 7.3, 7.4, 7.5_

- [ ] 3. 为 AI 理牌算法编写单元测试
  - 新建 [card_ssd/internal/game/ai_bot_test.go](e:\wxgame\card2\card_ssd\internal\game\ai_bot_test.go)
  - 用例 1：构造一手包含同花顺/葫芦的牌，断言 `AutoArrange` 返回的三道通过 `Validate` 且尾道最强
  - 用例 2：构造一手散牌，断言 `usedFallback=true` 且结果合法
  - _需求：3.1, 3.2, 7.5_

- [ ] 4. 在房间层增加电脑玩家管理方法
  - 在 [room.go](e:\wxgame\card2\card_ssd\internal\room\room.go) 中新增 `AddBot() *Player`（生成形如 `bot_{room}_{seq}` 的 openid，昵称"电脑N"）和 `RemoveBot(openid string) bool`
  - 新增 `BotPlayers() []*Player` 与 `HumanCount() int` 工具方法，便于上层调度与"全员退出销毁"判定
  - 新增 `CancelBotTimers()`：清理本房间所有挂在 `Room` 上的 `*time.Timer`（用 `[]*time.Timer` 保存）
  - _需求：1.1, 1.2, 5.1, 5.2_

- [ ] 5. 实现 bot 自动行为调度器
  - 新建 [card_ssd/internal/room/bot_driver.go](e:\wxgame\card2\card_ssd\internal\room\bot_driver.go)，提供：
    - `ScheduleBotReady(room, bot, broadcastFn)`：1 秒内自动 Ready，并触发 `room_state` 广播 / 检查全员准备
    - `ScheduleBotLock(room, bot, lockFn)`：发牌后异步在 goroutine 中调用 `game.AutoArrange`，再通过 `lockFn` 复用现有提交开牌路径
    - `ScheduleBotConfirm(room, bot, confirmFn)`：1 秒内自动确认结算/总结
  - 所有定时器登记到 `room.Timers`，供需求 4 的 `CancelBotTimers` 统一取消
  - _需求：2.1, 2.2, 2.3, 3.3, 3.5, 4.1, 4.2, 5.2_

- [ ] 6. 在 lobby handler 中接入 add/kick bot 协议
  - 修改 [lobby.go](e:\wxgame\card2\card_ssd\internal\handler\lobby.go)，新增 `handleAddBot` 与 `handleKickBot`：
    - 校验：调用方为房主、房间处于 `PhaseWaiting`、未达 `MaxPlayers`，否则返回对应错误码
    - 成功后调用 `room.AddBot()` / `room.RemoveBot()`，广播 `room_state`，并对新增的 bot 调用 `ScheduleBotReady`
  - 在 [ws.go](e:\wxgame\card2\card_ssd\internal\server\ws.go) 的消息路由中注册新增的两个消息类型
  - _需求：1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 8.1_

- [ ] 7. 在 game handler 中接入 bot 自动理牌与确认
  - 修改 [game.go](e:\wxgame\card2\card_ssd\internal\handler\game.go)：
    - 发牌完成（进入 `PhasePlaying`）后，遍历 `room.BotPlayers()` 调用 `ScheduleBotLock`，传入复用的"提交三道并尝试推进结算"内部函数
    - 进入比牌/结算阶段后，遍历 bot 调用 `ScheduleBotConfirm`，复用现有 `RoundConfirm` / 总结确认流程
    - 每局 `ResetRound` 后再次为 bot `ScheduleBotReady`，满足"下一局自动准备"
  - _需求：2.2, 2.3, 3.1, 3.3, 3.4, 4.1, 4.2_

- [ ] 8. 调整房间销毁逻辑以适配 bot
  - 修改 [manager.go](e:\wxgame\card2\card_ssd\internal\room\manager.go) 与 `RemovePlayer` 调用方，使"销毁判定"基于 `HumanCount()==0` 而不是 `IsEmpty()`
  - 销毁前调用 `room.CancelBotTimers()`，确保所有 bot 定时器被取消，且不再发送任何消息
  - _需求：5.1, 5.2, 5.3_

- [ ] 9. 添加 bot 动作专用日志
  - 在 [logger.go](e:\wxgame\card2\card_ssd\internal\logger\logger.go) 中（如有需要）补充 `Warnf`，并在 `bot_driver.go`、`ai_bot.go`、`lobby.go` 关键路径输出 INFO/WARN 日志
  - 日志内容必须包含房间 ID、bot openid、动作名（add/ready/lock/confirm/fallback）
  - _需求：8.1, 8.2_

- [ ] 10. 前端：房间页 UI 与状态接入
  - 修改 [room_scene.js](e:\wxgame\card2\js\scenes\room_scene.js)：房主可见时新增"添加电脑玩家"按钮，房间满或非 waiting 阶段置灰；点击通过 [socket_client.js](e:\wxgame\card2\js\net\socket_client.js) 发送 `ROOM_ADD_BOT`；对 bot 座位长按/点叉触发 `ROOM_KICK_BOT`
  - 修改 [PlayerSeat.js](e:\wxgame\card2\js\ui\PlayerSeat.js) 与 [Avatar.js](e:\wxgame\card2\js\ui\Avatar.js)，当 `player.isBot===true` 时叠加 BOT 角标
  - 在 socket 收到 `ROOM_STATE` 时透传 `isBot` 字段，准备/开牌/结算渲染逻辑保持与真人一致
  - _需求：1.1, 1.5, 6.1, 6.2, 6.3, 6.4_

- [ ] 11. 同步更新 README 文档
  - 在 [card_ssd/README.md](e:\wxgame\card2\card_ssd\README.md) 中新增"电脑玩家"小节：协议示例、调用流程、AI 兜底策略说明
  - 在项目根 [README.md](e:\wxgame\card2\README.md) 中新增"房主添加电脑玩家"功能简介与操作指引
  - _需求：非功能性约束 README 项_
