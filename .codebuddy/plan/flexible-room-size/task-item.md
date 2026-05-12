# 实施计划

- [x] 1. 客户端：移除创建房间面板的「人数」选项
  - 修改 `js/scenes/lobby_scene.js` 中 `RuleConfigPanel`：删除 `this.maxPlayers = 4` 字段、`_buildButtons` 中的 `counts = [2,3,4,5,6]` / `countBtns` 数组、`render` 中的「人数」标题与按钮绘制、`handleTouch` 中对 `countBtns` 的分发
  - 删除人数行后将弹窗 `height` 从 `320` 缩小约 70px（如 `250`），同步上移「确认 / 取消」按钮的 `y`，保证上下边距均衡
  - 修改 `onConfirm` 回调载荷：从 `{ withMa, totalRounds, maxPlayers }` 改为 `{ withMa, totalRounds }`；调用方 `_doCreateRoom(rule)` 中发往 `CREATE_ROOM` 的 payload 也仅含这两个字段
  - _需求：1.1、1.2、1.3_

- [x] 2. 服务端：忽略客户端传入的 `maxPlayers`，统一固定上限 6
  - 修改 `card_ssd/internal/handler/lobby.go` 的 `HandleCreateRoom`：解析 `CreateRoomReq` 后**不再读取** `req.MaxPlayers`，强制以 `MaxPlayers: 6` 装配 `Rule`（`CreateRoomReq` 结构体可保留 `MaxPlayers` 字段以兼容老客户端解析，仅业务上忽略）
  - 复核 `card_ssd/internal/room/room.go` `NewRoom` 的 `[2,6]` 边界保护保留不动，作为内部最终防线
  - 复核 `card_ssd/internal/storage/room_repo.go` 的 `MaxPlayers` 列读写不变，保证历史房间数据兼容
  - _需求：1.4、3.1、3.2、3.3、3.4_

- [x] 3. 服务端：开局门槛保持「就绪人数 ≥ 2」（仅补测试，无需改代码）
  - 复核 `card_ssd/internal/room/room.go` `AllReady()` 现状：已是 `len(Players) >= 2 且全员 Ready`，无需修改
  - 在 `card_ssd/internal/room/` 下新增/扩展用例：覆盖 (a) 1 人 Ready 时 `AllReady=false`；(b) 2/3/5/6 人 Ready 时 `AllReady=true`；(c) 含 Offline 玩家时仅校验非 Offline 是否全 Ready
  - _需求：2.1、2.2、2.3_

- [x] 4. 服务端：发牌按实际人数动态生成牌堆与加色（仅补测试，无需改代码）
  - 复核 `card_ssd/internal/handler/game.go` 的 `StartRound` 现状：已调用 `game.Deal(len(r.Players))`，传入实际玩家数；`game/card.go` `BuildDeck(playerCount)` 已按 4/5/6 档动态加 D2/C2 花色，无需修改
  - 在 `card_ssd/internal/game/` 下新增/扩展用例：覆盖 `BuildDeck(2)/BuildDeck(3)/BuildDeck(4)` 总张数 = 52、`BuildDeck(5)` = 65 含 D2、`BuildDeck(6)` = 78 含 D2 与 C2；`Deal(playerCount)` 每人均 13 张
  - 在 `card_ssd/internal/room/` 或 handler 层新增用例：构造 3 / 5 人就绪房间，触发 `StartRound` 后断言每人 `len(Hand) == 13`
  - _需求：4.1、4.2、4.3_

- [x] 5. 客户端：房间内「人数已满」与 bot 按钮按 6 人上限工作
  - 复核 `js/scenes/room_scene.js` 第 187 行附近 `room.players.length >= room.rule.maxPlayers` 的「房间人数已满」提示：`maxPlayers` 由服务端固定为 6，无需改代码
  - 复核第 643 行附近 waiting 阶段「添加电脑玩家」按钮：仅在 `< maxPlayers(6)` 时可点；`= 6` 时灰显或隐藏
  - 如发现客户端有任何位置写死了 4 人布局或预设 4 人占位，需统一改为按 `room.players.length` 动态布局
  - _需求：2.4、2.5、5.1、5.2、5.3、5.4_

- [x] 6. 客户端：`play_phase.js` 的「五墩展示」改用实际人数
  - 修改 `js/scenes/play_phase.js` 第 176-178 行附近：将 `const showFive = Math.max(maxPlayers || 0, playerCount || 0) >= 5;` 改为 `const showFive = (playerCount || 0) >= 5;`，去除对 `maxPlayers` 的依赖
  - 检查同文件其他地方是否还有以 `maxPlayers` 为依据的视觉判断；若有，统一改为以 `playerCount`（实际玩家数）为准
  - _需求：4.4_

- [x] 7. 文档同步
  - 更新 `card_ssd/README.md` 中 `POST /api/room/create` body 说明：从 `{ withMa, totalRounds, maxPlayers }` 改为 `{ withMa, totalRounds }`，并补充「房间人数上限服务端固定为 6，开局门槛为就绪人数 ≥ 2」
  - 根 `README.md` 中 `maxPlayers` 仅出现在 `/api/login` 返回 `activeRoom` 字段示例，作为真实响应字段保留无需更改；`功能.md` 未提及创建房间字段细节，无需修改
  - _需求：6.3_

- [ ] 8. 端到端联调验证
  - 手动验证场景：(a) 创建房间弹窗仅有「马牌 + 局数」两组开关；(b) 创建后房间默认 6 人位、可继续邀请或加 bot；(c) 2 人就绪即可点击「准备」开局，发牌张数与 4 人时一致；(d) 5 / 6 人就绪开局时手牌出现加色花色（D2 / C2）；(e) 与 reenter-after-create 计划叠加：waiting 阶段 1 真人创建后点「返回」→ 重新进入 → 仍可加 bot 至 ≥2 人开局
  - _需求：7.1、7.2、7.3_
