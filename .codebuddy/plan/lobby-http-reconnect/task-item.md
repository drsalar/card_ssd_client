# 实施计划

- [ ] 1. 服务端新增 HTTP 登录与活跃房间查询接口
- [ ] 1.1 在 `card_ssd/internal/handler/lobby.go`（新文件）中实现 `POST /api/login` 与 `GET /api/lobby/active-room` 处理函数
   - `POST /api/login` 接收 `{openid, nickname, avatarUrl}`，仅生成 / 复用 token 并查询 `RoomManager` 中该 openid 所在的未结束房间，返回 `{token, openid, nickname, activeRoom}`；不修改 Session / Player 在线状态
   - `GET /api/lobby/active-room?openid=xxx` 仅返回 `activeRoom` 摘要 `{roomId, phase, currentRound, totalRounds, maxPlayers}`；房间已销毁或处于 `MATCH_END` 后 → 返回 `null`
   - 在 `card_ssd/internal/room/manager.go` 中补充只读查询方法 `FindActiveRoomByOpenid(openid string) *RoomSummary`，确保不触发任何状态变更
   - 在 `card_ssd/internal/server/http.go` `NewEngine` 中注册两条新路由，复用现有 CORS 中间件
   - _需求：1.1、1.2、1.3、1.4、1.5、7.1、7.3_

- [ ] 2. 客户端封装 HTTP 客户端并替换大厅启动逻辑
- [ ] 2.1 新增 `js/net/http_client.js`，封装 `wx.request` 的 `post(path, data)` / `get(path, query)`；`baseUrl` 取自 `GameGlobal.HTTP_BASE` 或与 WS 同源的常量
   - _需求：7.2_
- [ ] 2.2 修改 `js/main.js`：删除 `Main` 构造函数中无条件 `connectSocket()` 调用，改由场景按需触发
   - _需求：2.1_
- [ ] 2.3 修改 `js/scenes/lobby_scene.js` 的 `onEnter`：调用 `httpClient.post('/api/login', ...)`，将返回的 `activeRoom` 写入 `databus.activeRoom`，根据其值显隐「重新进入」按钮；失败时 Toast 「登录失败，点击重试」并支持点击重试，**不**触发任何 Socket 连接
   - _需求：2.2、2.3、2.4_

- [ ] 3. 入房动作触发 WebSocket 升级；离房主动断开 + HTTP 刷新
- [ ] 3.1 在 `js/scenes/lobby_scene.js` 的「创建房间」「加入房间」「重新进入」三个入口前增加 `ensureSocketConnected()` 流程：未连接则 `socket.connect(url)`，等待 `LOGIN_OK` 后再发送 `CREATE_ROOM` / `JOIN_ROOM`；已连接则直接复用
   - _需求：3.1、3.2、3.3、3.4_
- [ ] 3.2 在收到 `LEAVE_ROOM_OK` 或 `MATCH_END` 玩家选择回大厅的处理处（`js/scenes/room_scene.js` / `databus.backToLobby`）调用 `socket.close()` 并将 `databus.netStatus = 'disconnected'`，随后切回大厅时再次触发 HTTP 登录刷新 `activeRoom`
   - _需求：2.5、3.5_

- [ ] 4. 客户端对局阶段重连策略与微信生命周期对接
- [ ] 4.1 调整 `js/net/socket_client.js`：将自动重连守卫条件改为 `databus.scene === SCENES.ROOM`；保持 5 次 / 1.5 秒间隔；重连成功后 `LOGIN_OK` 自动 `JOIN_ROOM`；自动 `JOIN_ROOM` 收到 `ROOM_NOT_FOUND` 时清空 `databus.room` 并切回大厅，Toast 「房间已结束」
   - _需求：4.1、4.2、4.3、4.4_
- [ ] 4.2 在 `js/main.js` 注册 `wx.onShow` 监听：当 `databus.scene === SCENES.ROOM` 且 `socket.connected === false` 时立即调用 `socket.connect(url)`；`wx.onHide` 不主动断开
   - _需求：4.5、4.6_

- [ ] 5. 服务端断线 / 重连状态广播补强
- [ ] 5.1 在 `card_ssd/internal/room/manager.go` 标记 `Player.Offline=true` 后立即调用 `broadcastRoomState(room)`；玩家通过 `JOIN_ROOM` 重连重置 `Offline / OfflineSince` 后同样立即广播一次；超 30 秒兜底处理路径继续保持 `offline=true` 广播
   - 检查 `BindOpenid`：保证关闭旧连接的 underlying socket，但不移除房间内的 `Player` 引用，以便后续 `JOIN_ROOM` 命中重连分支
   - _需求：5.1、5.2、5.3、5.4、5.5_

- [ ] 6. 客户端头像区显著的离线视觉
- [ ] 6.1 改造 `js/ui/PlayerSeat.js`：在 `player.offline === true` 且非本地玩家、非 Bot 时，于头像绘制层之上叠加 `rgba(0,0,0,0.45)` 圆形蒙层 + 中央白色 "OFF" 字样徽章（约头像直径 60%）；`offline === false` 时不渲染该层；保持原"掉线"小徽章可移除或保留为辅助
   - 头像 `image` 未加载时也要在 fallback 圆形之上绘制蒙层，保证视觉一致
   - _需求：6.1、6.2、6.3、6.4、6.5、6.6_

- [ ] 7. 文档同步
- [ ] 7.1 更新 `README.md`、`card_ssd/README.md`、`功能.md`：增补「主页 HTTP 化 / 对局 WebSocket / 断线视觉」小节，说明 `POST /api/login`、`GET /api/lobby/active-room` 两条接口、入房才升级 WS、`wx.onShow` 触发重连、头像 OFF 蒙层等关键行为
   - _需求：7.4_
