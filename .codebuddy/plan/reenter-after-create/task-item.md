# 实施计划

- [x] 1. 服务端：waiting 阶段断线保活
  - 修改 `card_ssd/internal/room/manager.go` 的 `HandleDisconnect`，在 `r.Phase == PhaseWaiting` 分支不再调用 `RemovePlayer`/`DestroyRoom`，改为：将玩家 `Offline=true`、`OfflineSince=now`，调用 `markAllOfflineIfNeeded(r)`，最后 `BroadcastState`，不启动 30s 兜底计时器
  - 调整 `markAllOfflineIfNeeded` 中 `case PhaseWaiting, PhaseMatchEnd:` 的逻辑，使 waiting 阶段也按「无在线真人则记录、有在线真人则清零」统一处理（与 playing/comparing 一致），不再无条件清零
  - _需求：3.1、3.2、3.3、3.7_

- [x] 2. 服务端：保留 waiting 阶段主动 LeaveRoom 与重连分支
  - 复核 `JoinRoom` 中重连分支 `ReconnectPlayer` 在 waiting 房间下能复位 `Offline=false` 并触发 `markAllOfflineIfNeeded` 清零 `AllOfflineSince`
  - 复核 `LeaveRoom` 在 waiting 阶段下原行为不变（`RemovePlayer`/房主转移/无真人则销毁）
  - 必要时仅做最小调整以保证两条路径正确
  - _需求：3.4、3.6、4.2、4.3_

- [x] 3. 服务端：补充 waiting 保活单元测试
  - 在 `card_ssd/internal/room/` 下新增/扩展测试文件，覆盖：(a) waiting 唯一真人断线后房间不销毁且 `AllOfflineSince` 已登记；(b) waiting 断线再 `JoinRoom` 后 `Offline=false`、`AllOfflineSince=0`；(c) waiting 全员真人断线超 24h 后 sweeper 销毁；(d) waiting 主动 `LEAVE_ROOM` 仍走 `RemovePlayer` 销毁路径
  - 确保既有 `sweeper_test.go` 用例全部通过
  - _需求：5.1、5.2_

- [x] 4. 客户端：大厅移除 WS 离线状态文本
  - 修改 `js/scenes/lobby_scene.js` 的 `render`：删除/跳过基于 `databus.netStatus` 的「● 离线 / 连接中... / 已连接」三态渲染（约 410-416 行附近）
  - 仅保留 `_loginFailed=true` 时的「服务异常，点击重试」红色提示；登录成功时不渲染网络状态文本（或灰色「在线」）
  - _需求：1.1、1.2、1.3、6.1_

- [x] 5. 客户端：房间右上角按阶段切换按钮组合
  - 修改 `js/scenes/room_scene.js`，将原单一「返回」按钮改造为按 `roomState.phase` 动态生成按钮组：waiting → 「退出」+「返回」；playing/comparing → 「解散」+「返回」；match_end → 仅「退出」
  - 抽取按钮布局函数确保两按钮等高、间距一致、不挡住胶囊菜单；阶段变化时下一帧 `render` 重新布局，避免重叠/残影
  - 颜色规范：退出=红、返回=灰、解散=橙
  - _需求：2.1、2.2、2.3、2.6、6.3_

- [x] 6. 客户端：实现「退出」按钮逻辑（真离开）
  - 在 `room_scene.js` 中实现 `_doExitRoom()`：弹出二次确认弹窗（waiting 文案「退出房间？将让出座位，无法重新进入」、match_end 文案「确定退出本房间？」），确认后发送 `LEAVE_ROOM`，等服务端回 `LEAVE_ROOM_OK` 后切回大厅，并调用 `clearRoomId` 清掉本地 `lastRoomId`
  - _需求：2.4_

- [x] 7. 客户端：保留并复用「返回」按钮逻辑（保留座位）
  - 复用现有 `_returnToLobby` 流程，但前置二次确认弹窗「返回主页？房间将保留，可稍后从主页"重新进入"」
  - 确认不发送 `LEAVE_ROOM`，仅断开 WS 并切回大厅，本地 `lastRoomId` 保持不变
  - _需求：2.5_

- [x] 8. 客户端：复核「重新进入 waiting 房间」体验
  - 验证大厅 `_httpLogin` 返回 `activeRoom.phase=='waiting'` 时按钮文案为「重新进入（房间号）」，点击走 `_doReenter` → `JOIN_ROOM`
  - 验证收到 `ROOM_STATE` 后房间快照恢复原座位/昵称/头像、`isReady=false`、自身 `Offline=false`
  - 在 `main.js` 的 `wx.onShow` 中增加大厅场景刷新 `activeRoom` 的事件 `lobby:refresh`，由 `lobby_scene.js` 订阅
  - _需求：4.1、4.2、4.3、7.1_

- [x] 9. 文档同步
  - 更新根目录 `README.md` 与 `card_ssd/README.md` 中「24h 保活仅适用于 playing/comparing/match_end」的描述为「waiting 阶段也纳入 24h 保活」
  - 在客户端章节补充「房间右上角按阶段切换按钮组合」与「退出 vs 返回」语义说明
  - 同步修复 `card_ssd/internal/room/loader.go` 中进程重启时 waiting 阶段不再排除在 `AllOfflineSince` 兜底之外
  - _需求：5.3_

- [ ] 10. 端到端联调验证
  - 手动验证场景：(a) 创建房间→点「返回」→大厅出现「重新进入（房间号）」→点击成功重连；(b) waiting 阶段点「退出」→ 大厅 `activeRoom` 为空、无重新进入按钮；(c) playing 阶段右上角无「退出」按钮，只有「解散」+「返回」；(d) match_end 阶段仅「退出」按钮；(e) 大厅页全程不出现「离线/已连接」红绿闪烁
  - 服务端单元测试：`go test ./card_ssd/internal/room/... -count=1`（需在 windows 命令行中手动运行）
  - _需求：1.1、2.1-2.3、3.1、4.1、6.1、6.3_
