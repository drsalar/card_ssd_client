# 需求文档

## 引言

现状：在大厅点击「创建房间」时会弹出 `RuleConfigPanel`（[lobby_scene.js](../../../js/scenes/lobby_scene.js)），强制玩家在 2/3/4/5/6 中预先选定房间最大人数（`maxPlayers`，默认 4）。该值会被一路保存到服务端 `Rule.MaxPlayers`（[room.go](../../../card_ssd/internal/room/room.go)），并影响：

- `IsFull()` 是否拒绝再加入；
- 加入房间时客户端「房间人数已满」（[room_scene.js](../../../js/scenes/room_scene.js) 第 187 行）的判断；
- waiting 阶段「添加电脑玩家」按钮是否可用（[room_scene.js](../../../js/scenes/room_scene.js) 第 643 行）。

但实际开局并不依赖 `MaxPlayers`：

- 服务端 `AllReady()`（[room.go](../../../card_ssd/internal/room/room.go) 第 175 行）的语义已经是「玩家数 ≥ 2 且全员 Ready」即可开局；
- 牌堆构建 `BuildDeck(playerCount int)`（[card.go](../../../card_ssd/internal/game/card.go) 第 25 行）按**实际玩家数**动态生成基础花色 + 加色花色（D2/C2），与 `MaxPlayers` 无关。

也就是说，**`MaxPlayers` 仅是一道「不让超过这个上限再加入」的闸门，与开局规则与发牌规则并无耦合**。让玩家在创建时强行预选人数，反而带来额外操作成本，且与「开局人数=实际就绪人数」的设计割裂。

本需求要把规则简化为：

- 创建房间时**不再选人数**：UI 仅保留「马牌」「局数」两项，房间默认承载至 6 人上限（与服务端历史最大边界一致）；
- 开局门槛**仅以「就绪人数 ≥ 2」为准**，剩余空位允许保持空缺（不强制凑满）；
- 牌堆与「加色花色」**完全按真正参加这一局的玩家数**动态生成，2~6 人各自走对应的发牌规则；
- bot 添加按钮在 2 人到 6 人范围内一直可用，由真人按需决定是否补 bot；
- 服务端 `MaxPlayers` 字段保留为 6 人硬上限的内部限值，不再作为玩家可调规则暴露给客户端。

## 需求

### 需求 1：创建房间面板移除「人数」选项

**用户故事：** 作为玩家，我希望创建房间时只需要决定「马牌」与「局数」两件事，不再被强制提前预估到底会有几个人来玩，以便我能更快开房邀请好友。

#### 验收标准

1. WHEN 大厅 [lobby_scene.js](../../../js/scenes/lobby_scene.js) 的 `RuleConfigPanel.show()` 被调用 THEN 弹窗 SHALL **不再渲染**「2 人 / 3 人 / 4 人 / 5 人 / 6 人」一排人数按钮（即移除 `countBtns` 及对应的标题文字、占位空间）。
2. WHEN 弹窗去除人数按钮后 THEN 弹窗整体高度 SHALL 相应缩小（删除约 70px 占位），主按钮（「确认」/「取消」）位置 SHALL 自动上移并保持上下边距均衡。
3. WHEN 玩家点击「确认」 THEN `onConfirm` 回调 SHALL 不再传入 `maxPlayers` 字段，仅传 `{ withMa, totalRounds }`；调用方 `_doCreateRoom(rule)` SHALL 仅把这两个字段塞入 `CREATE_ROOM` 消息体，不再发送 `maxPlayers`。
4. WHEN 旧版本客户端发来仍带 `maxPlayers` 的 `CREATE_ROOM` 请求 THEN 服务端 [lobby.go](../../../card_ssd/internal/handler/lobby.go) 的 `HandleCreateRoom` SHALL **忽略** 该字段（不报错），统一按下文需求 3 的策略设置 `MaxPlayers=6`，保证向前兼容。

### 需求 2：开局门槛改为「就绪人数 ≥ 2」

**用户故事：** 作为房主或房间成员，我希望只要房间内已就绪玩家达到 2 人就能开局，不必非得凑满预设的 4 人或 6 人，以便玩家少时也能尽快开打。

#### 验收标准

1. WHEN 服务端 [room.go](../../../card_ssd/internal/room/room.go) 的 `AllReady()` 被调用 THEN 判定逻辑 SHALL **保持不变**，仍是「`len(Players) >= 2` 且每位非 Offline 玩家 `Ready==true`」（本需求已能命中，新增用例覆盖 2/3/4/5/6 人各档）。
2. WHEN 房间内已有 2 名真人，其中一人未点准备 THEN `AllReady()` SHALL 返回 false；当第二位真人也点击「准备」 THEN `AllReady()` SHALL 返回 true，[lobby.go](../../../card_ssd/internal/handler/lobby.go) `HandleReady` 中 `if allReady { StartRound(r) }` 分支 SHALL 顺序触发 `StartRound`。
3. WHEN waiting 阶段房间内人数 < 2 THEN 即使全员都点击「准备」 `AllReady()` SHALL 仍返回 false（保留现有保护，避免 1 人开局）。
4. WHEN 服务端因加入超过 `MaxPlayers=6` 而拒绝 THEN 客户端 SHALL 收到原有 `ErrRoomFull`/相应错误码并提示「房间人数已满」（保留现有上限校验，仅取消用户可调上限）。
5. WHEN 客户端 [room_scene.js](../../../js/scenes/room_scene.js) 渲染「人数已满」提示（第 187 行附近）THEN SHALL 仍按 `room.players.length >= room.rule.maxPlayers`（值固定为 6）判断；waiting 阶段「添加电脑玩家」按钮（第 643 行附近）SHALL 在 `< 6` 时一直可点，最多可补到 6 人。

### 需求 3：服务端 `MaxPlayers` 改为内部固定上限

**用户故事：** 作为开发者，我希望 `Rule.MaxPlayers` 在协议层不再受客户端影响，简化所有依赖该字段的路径，并保持 6 人硬上限不被破坏。

#### 验收标准

1. WHEN 服务端 [lobby.go](../../../card_ssd/internal/handler/lobby.go) 的 `HandleCreateRoom` 解析到 `CreateRoomReq` THEN SHALL **忽略**消息体中的 `maxPlayers`（无论是否携带），统一以 `MaxPlayers=6` 装配 `Rule`。
2. WHEN [room.go](../../../card_ssd/internal/room/room.go) `NewRoom` 拿到 `Rule` THEN 既有的 `[2,6]` 边界保护 SHALL 保留，确保异常输入也能落到 6 人内的合法值。
3. WHEN [storage/room_repo.go](../../../card_ssd/internal/storage/room_repo.go) 持久化 / 还原房间 THEN `MaxPlayers` 字段 SHALL 仍正确写入与读取（已有列与字段不变，仅业务侧默认值变化），历史房间数据 SHALL 不受影响。
4. WHEN 客户端 `ROOM_STATE` 收到 `rule.maxPlayers` THEN 值 SHALL 始终为 6（新建房间）或保留旧值（历史持久化房间），客户端布局逻辑 SHALL 兼容这两种情况。

### 需求 4：发牌按实际人数动态生成牌堆与加色

**用户故事：** 作为玩家，我希望开局时牌堆与花色（含加色 D2/C2）严格按本局实际参与的玩家数发出，2 人有 2 人的牌堆、5 人有 5 人的牌堆，以便牌力分布与现有规则保持一致。

#### 验收标准

1. WHEN 服务端 [game.go (handler)](../../../card_ssd/internal/handler/game.go) 的 `StartRound(r)` 被触发 THEN 发牌函数 SHALL 以 **房间内 Players 当前数量** 作为 `playerCount` 调用 `BuildDeck` / `Shuffle` / 切片发牌（即真人 + bot 的实际总数，去除 Offline 状态），不再以 `r.Rule.MaxPlayers` 计算。
2. WHEN `BuildDeck(playerCount)`（[card.go](../../../card_ssd/internal/game/card.go)）被调用 THEN SHALL 维持现有「按 playerCount 生成基础 4 花色 + 必要的加色花色」规则（本需求不修改 `BuildDeck` 内部公式，仅保证调用方传值正确）。
3. WHEN 房间内存在 Offline 玩家 THEN `StartRound` SHALL 按现有口径处理（保留其在 Players 列表中的位置但仍参与发牌还是跳过 —— 与既有实现保持一致），新增用例覆盖该路径，不引入新逻辑。
4. WHEN 客户端 [play_phase.js](../../../js/scenes/play_phase.js) 的 `showFive = Math.max(maxPlayers, playerCount) >= 5` 等渲染逻辑被调用 THEN SHALL 改为以 `playerCount`（实际玩家数）为准（`maxPlayers` 不再具备规则意义），保证 UI 显示的「五墩牌位」等元素与本局实际参与人数对齐。

### 需求 5：bot 增减按钮的可用性同步调整

**用户故事：** 作为房间内的真人，我希望「添加电脑玩家」按钮在没满 6 人之前一直可用，以便我可以灵活补到自己想要的人数再开局。

#### 验收标准

1. WHEN 房间处于 waiting 阶段且 `players.length < 6` THEN [room_scene.js](../../../js/scenes/room_scene.js) 「添加电脑玩家」按钮 SHALL 始终可见可点（不再随用户预选人数变化）。
2. WHEN `players.length == 6` THEN 「添加电脑玩家」按钮 SHALL 灰显或隐藏（与现有满员逻辑一致）。
3. WHEN 服务端 [lobby.go](../../../card_ssd/internal/handler/lobby.go) `HandleAddBot` 被调用 THEN SHALL 保留现有「房间满员则拒绝」「非 waiting 阶段拒绝」保护（仅最大值由 6 决定）。
4. WHEN 真人主动 `RemoveBot` THEN 行为 SHALL 与现有一致，不受本需求影响。

### 需求 6：测试与文档同步

**用户故事：** 作为开发者，我希望本次改动不破坏现有发牌 / 比牌 / 房间生命周期单元测试，并把对外文档（`README.md` / `card_ssd/README.md` / `功能.md`）的描述同步到「人数不再可调」的新规则。

#### 验收标准

1. WHEN 既有 `card_ssd/internal/game/*_test.go` 与 `card_ssd/internal/room/*_test.go` 用例运行 THEN SHALL 全部通过；如有用例显式构造 `Rule{MaxPlayers: 4}`、依赖该值开局，SHALL 做最小调整以适配「不依赖 MaxPlayers 开局」的新行为。
2. WHEN 新增用例覆盖「2/3/5/6 人就绪即可开局 + BuildDeck 按实际人数发牌」 THEN 用例 SHALL 至少校验：(a) 2 人就绪 `AllReady=true` 且 `StartRound` 后两人各 13 张；(b) 3/5 人就绪后牌堆张数 = 13 × 玩家数 且加色花色按现有公式出现；(c) 6 人就绪走原满员开局路径不变。
3. WHEN 根目录 [README.md](../../../README.md)、[card_ssd/README.md](../../../card_ssd/README.md)、[功能.md](../../../功能.md) 提到「创建房间时选人数」「`maxPlayers` 由玩家决定」相关描述 THEN SHALL 同步更新为「人数无需预选，最多 6 人，开局门槛为就绪人数 ≥ 2」并补充「加色花色按实际玩家数动态生成」的说明。

### 需求 7：与已有 reenter / 退出语义不冲突

**用户故事：** 作为玩家，我希望本次「人数不再预选」的改动与之前已规划好的「重新进入 / 退出 vs 返回」（[reenter-after-create/requirements.md](../reenter-after-create/requirements.md)）能正确叠加，以便两个特性合在一起仍然自洽。

#### 验收标准

1. WHEN waiting 阶段 1 个真人创建房间后点「返回」 THEN 服务端 SHALL 按 reenter 计划的需求 3 保活房间，大厅可见「重新进入」；重新进入后房间仍是「无预设人数 + 1 真人」状态，玩家 SHALL 可继续邀请或加 bot 至 ≥2 人开局。
2. WHEN waiting 阶段 1 个真人创建房间后点「退出」 THEN 服务端按现有 LeaveRoom 流程销毁房间，与本需求无交叉影响。
3. WHEN waiting 阶段 2 名真人就绪开局 THEN 服务端走 `StartRound`，房间 `Phase` 变为 `playing`，此时按 reenter 计划的需求 2 客户端右上角 SHALL 仅显示「解散 + 返回」，与本需求无冲突。
