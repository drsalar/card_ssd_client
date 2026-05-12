# 实施计划

- [ ] 1. 服务端：协议常量与错误码补齐
   - 在 `card_ssd/internal/protocol/protocol.go` 中新增 `ROOM_KICK_PLAYER`、`ROOM_KICK_PLAYER_OK`、`ROOM_KICKED` 三个消息常量
   - 确认 `ErrNotHost(1009)`、`ErrRoomNotWaiting(1010)`、`ErrBadRequest(1008)`、`ErrNotInRoom(1004)` 已存在；如缺则补齐
   - _需求：1.8、1.2、1.3、1.4、4.2、4.3_

- [ ] 2. 服务端：在 `room/room.go` 实现 `KickPlayer(hostOpenid, targetOpenid) error`
   - 校验请求者必须是 `r.HostID`；阶段必须为 `waiting` 或 `match_end`；目标不可为房主自身；目标必须存在
   - 找到目标真人后单播 `ROOM_KICKED`（包含 `roomId`、`reason="host_kick"`）
   - 调用 `CancelOfflineTimer(targetOpenid)`，从 `r.Players` 移除目标，清空其 `session.RoomID`
   - 房间内仍有真人则广播 `ROOM_STATE`；无真人则走与 `LeaveRoom` 一致的房间销毁分支
   - 记录 `logger.Info`：「房间 X 房主 Y 踢出真人玩家 Z(昵称)」
   - _需求：1.1、1.4、1.5、1.6、1.7、4.1、4.4、5.1、5.2、5.3_

- [ ] 3. 服务端：在 WebSocket 路由层注册 `ROOM_KICK_PLAYER` 处理器
   - 在 `internal/handler/`（参照 `ROOM_KICK_BOT` 现有处理位置）解析 `{ openid }` 参数，缺失则返回 `ErrBadRequest`
   - 通过 `RoomManager` 拿到当前房间，房间不存在返回 `ErrNotInRoom`
   - 调用 `room.KickPlayer`，错误按映射表返回；成功则回 `ROOM_KICK_PLAYER_OK`
   - _需求：1.1、1.2、1.3、4.2、4.3_

- [ ] 4. 客户端：协议常量与 socket 路由
   - 在 `js/net/protocol.js`（或对应常量文件）中追加 `ROOM_KICK_PLAYER`、`ROOM_KICK_PLAYER_OK`、`ROOM_KICKED`
   - 在 `js/net/socket_client.js` 的消息分发处增加对 `ROOM_KICKED` 的全局处理入口（转发给当前场景或全局回调）
   - _需求：2.1、3.5_

- [ ] 5. 客户端：被踢玩家通知处理
   - 收到 `ROOM_KICKED` 时调用 `Toast.show('已被房主请出房间')`
   - 清理 `databus.room`、`databus.playPhase`、`databus.settlePhase` 等房间态缓存
   - 切换到 `SCENES.LOBBY` 并触发一次大厅刷新（复用主动离开房间的清理函数）
   - _需求：2.1、2.2、2.3、2.4_

- [ ] 6. 客户端：房主踢人交互（`js/scenes/room_scene.js`）
   - 修改 `_onSeatTouch`：当本地用户为房主、阶段为 `waiting`/`match_end`、目标非自身时弹确认窗
   - 复用并改造 `_renderKickBotConfirm`（建议改名 `_renderKickConfirm` 或新增 `_kickTarget` 字段记录 `{openid, isBot, nickname}`），标题改为「踢出『{昵称}』？」
   - 「确定」按钮按 `isBot` 分发：bot 走 `ROOM_KICK_BOT`；真人走 `ROOM_KICK_PLAYER` 并携带 `{ openid }`
   - 「取消」/区域外点击关闭弹窗；收到新的 `ROOM_STATE` 时自动关闭弹窗
   - _需求：3.1、3.2、3.3、3.4、3.5、3.6、3.7_

- [ ] 7. 文档同步与联调验证
   - 更新 `README.md`（项目根目录及 `card_ssd/README.md` 若有）中「房主能力」章节：补充「踢出真人玩家」
   - 在本地 / 多端模拟联调：房主踢 bot、房主踢真人、非房主点击座位、playing 阶段尝试踢人、被踢玩家断线场景
   - _需求：5.4、1.1、3.2、5.1、2.4_
