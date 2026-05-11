# 实施计划

- [ ] 1. 协议常量同步
   - 在 [js/net/protocol.js](e:/wxgame/card2/js/net/protocol.js) 与 [server/protocol.js](e:/wxgame/card2/server/protocol.js) 的 `MSG` 中新增 `RECONNECT_SNAPSHOT` 常量
   - 保持两端字面量一致，便于日后 Go 端 (`card_ssd/internal/protocol/protocol.go`) 跟进
   - _需求：7.1、7.2_

- [ ] 2. 服务端 session 修复同 openid 重连
   - 修改 [server/session.js](e:/wxgame/card2/server/session.js) 中 `bindOpenid`：发现旧 Session 时关闭其 ws，并将其 `roomId` 继承到新 Session（用于重连恢复）
   - 旧 Session 不再调用 `handleDisconnect`（避免误触发弃局兜底，现有 ws.close 已经触发；通过判断 `prev.roomId` 是否仍指向有效房间，从 `room_manager.cancelOfflineTimer` 取消计时器）
   - _需求：6.2、6.3、1.4_

- [ ] 3. 服务端 LOGIN_OK 携带在房状态
   - 修改 [server/handlers/lobby_handler.js](e:/wxgame/card2/server/handlers/lobby_handler.js) `handleLogin`：登录成功后通过 `roomManager.rooms` 反查该 openid 所在房间
   - 若存在则将 `s.roomId` 重新挂上，并把 `Player.offline` 复位、调用 `cancelOfflineTimer`，对房间广播一次 `ROOM_STATE`
   - 在 `LOGIN_OK.data` 中追加 `activeRoom: { roomId, phase, currentRound, totalRounds } | null`
   - _需求：1.1、1.2、1.3、1.5、6.3、6.4_

- [ ] 4. 服务端 JOIN_ROOM 重连路径下发快照
   - 修改 [server/handlers/lobby_handler.js](e:/wxgame/card2/server/handlers/lobby_handler.js) `handleJoinRoom` 中 `r.reconnect=true` 分支：
   - 移除现有零散的 `DEAL_CARDS` / `SUBMIT_LANES_OK` 补发，改为单条 `RECONNECT_SNAPSHOT`，含 `phase / hand / lanes / submitted / lastSettle / currentRound / totalRounds`
   - `lastSettle` 从 `room.lastSettle` 取，仅在 `comparing` 与 `match_end` 阶段返回
   - 顺序：先发 `JOIN_ROOM_OK` → 再发 `RECONNECT_SNAPSHOT`（仅自己）→ 再 `room.broadcastState()`
   - _需求：4.1、4.2、4.4_

- [ ] 5. 客户端协议监听与 databus 还原
   - 在 [js/databus.js](e:/wxgame/card2/js/databus.js) 增加 `lastSettle` 字段（如未存在），并补一个 `applyReconnectSnapshot(snap)` 方法，将 `hand / lanes / submitted / lastSettle` 写回 `myHand / myLanes / lastSettle` 等
   - _需求：4.3_

- [ ] 6. 客户端 SocketClient 业务层重连
   - 修改 [js/net/socket_client.js](e:/wxgame/card2/js/net/socket_client.js) `_autoLogin` 之后：注册一次性 `LOGIN_OK` 回调，若 `databus.room` 仍存在 → 自动 `send(JOIN_ROOM, { roomId: databus.room.id })`；否则什么也不做
   - `_tryReconnect` 改为无限尝试或将 `MAX_RETRY` 提升至 5，并在重连过程中通过 `eventBus` 持续广播 `netStatus='reconnecting'`，连接恢复后 1 秒后清除提示
   - 在 `_onMessage` 收到 `ERROR` 且 `code=ROOM_NOT_FOUND` 且 `databus.room` 存在时，清空 `databus.room` 并触发回大厅事件
   - _需求：5.1、5.2、5.3、5.5_

- [ ] 7. 客户端大厅「重新进入」入口
   - 修改 [js/scenes/lobby_scene.js](e:/wxgame/card2/js/scenes/lobby_scene.js)：
   - 监听 `MSG.LOGIN_OK`，若 `data.activeRoom` 非空则记录 `this.activeRoom`，并构造 `reenterBtn`（位于创建/加入按钮上方）
   - 点击后 `send(JOIN_ROOM, { roomId: activeRoom.roomId })`
   - 收到 `ERROR.ROOM_NOT_FOUND` 时隐藏按钮并 Toast 提示「房间已不存在」
   - _需求：2.1、2.2、2.3、2.4、2.5_

- [ ] 8. 客户端 RoomScene 处理 RECONNECT_SNAPSHOT
   - 修改 [js/scenes/room_scene.js](e:/wxgame/card2/js/scenes/room_scene.js) `_bindNet`：监听 `MSG.RECONNECT_SNAPSHOT`，调用 `databus.applyReconnectSnapshot(snap)`
   - 根据 `snap.phase` 设置 `playPhase` 锁定状态：`playing && submitted=true` → `playPhase.lock()`；`comparing` → `settlePhase.setResult(snap.lastSettle)`；`match_end` → `_matchEndVisible=true` 并填 `_matchEndRanks`
   - `MSG.ROOM_STATE` 处理：在大厅且 `databus.room=null` 但收到状态时仍按原逻辑切场景（首次进入时无快照，行为保持）
   - _需求：4.3、5.2_

- [ ] 9. 客户端房间号本地持久化
   - 在收到 `ROOM_STATE` 且 `players` 包含自己时，调用 `wx.setStorageSync('lastRoomId', roomId)`（封装到 [js/databus.js](e:/wxgame/card2/js/databus.js) 的工具方法 `persistRoomId/clearRoomId` 中）
   - 收到 `MSG.LEAVE_ROOM_OK` 或 `_returnToLobby()` 时调用 `clearRoomId`
   - 所有调用前检查 `typeof wx !== 'undefined' && wx.setStorageSync` 以兼容浏览器调试
   - _需求：3.1、3.2、3.3、3.4_

- [ ] 10. 文档与说明同步
   - 在 [README.md](e:/wxgame/card2/README.md) 新增「断线重连」小节：协议、行为、30s 弃局窗口
   - 在 [功能.md](e:/wxgame/card2/功能.md) 中标注重连功能
   - 在需求文档对应位置注明「Go 服务端 (`card_ssd`) 待后续实现 `RECONNECT_SNAPSHOT`」
   - _需求：7.3、7.4_
