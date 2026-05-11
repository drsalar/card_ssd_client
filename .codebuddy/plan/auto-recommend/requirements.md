# 需求文档：推荐放入（Auto Recommend）

## 引言

当前服务端 [ai_bot.go](e:/wxgame/card2/card_ssd/internal/game/ai_bot.go) 中的 `AutoArrange` 已为 Bot 玩家实现了从 13 张手牌中自动选出最佳三道（头 3 / 中 5 / 尾 5）的能力。本需求在此基础上，为**真人玩家**在理牌阶段新增一个"推荐放入"功能：玩家点击该按钮后，系统使用与 Bot 完全一致的选牌算法（即 `AutoArrange`），自动将玩家当前手牌摆放到头/中/尾三道，玩家可在推荐结果上继续微调或直接提交。

该功能旨在：
- 降低新手玩家上手门槛，避免因不熟悉牌型对比而错放被打枪。
- 在 13 水规则下提供"一键参考摆法"，提升对局节奏。
- 复用已有的 Bot 算法，保证 Bot 与玩家推荐之间的一致性，避免重复实现导致行为分裂。

涉及范围：
- 服务端：[card_ssd/internal/game/ai_bot.go](e:/wxgame/card2/card_ssd/internal/game/ai_bot.go)、[protocol.go](e:/wxgame/card2/card_ssd/internal/protocol/protocol.go)、[handler/game.go](e:/wxgame/card2/card_ssd/internal/handler/game.go)、[server/ws.go](e:/wxgame/card2/card_ssd/internal/server/ws.go)。
- 前端（小游戏）：[js/scenes/play_phase.js](e:/wxgame/card2/js/scenes/play_phase.js)、[js/net/protocol.js](e:/wxgame/card2/js/net/protocol.js)、[js/net/socket_client.js](e:/wxgame/card2/js/net/socket_client.js) 及 UI（按钮、Toast）。
- 文档：[card_ssd/README.md](e:/wxgame/card2/card_ssd/README.md)。

边界情况与约束：
- 推荐请求必须在玩家本局尚未提交（SUBMIT_LANES 之前）的"理牌中"状态下才允许。
- 推荐结果不会自动提交，最终是否提交由玩家决定。
- 推荐结果必须保证三道合法（头≤中≤尾），算法走兜底也必须输出合法结果。
- 推荐期间不得改变服务端发的原始 13 张手牌内容（只重新摆放），否则会与提交校验冲突。
- 失败场景（房间不存在、未发牌、已提交等）需返回明确错误码。

## 需求

### 需求 1：复用 Bot 选牌算法

**用户故事：** 作为一名 13 水玩家，我希望"推荐放入"功能给出的牌型摆放方式与电脑 Bot 完全一致，以便我可以信任推荐结果代表当前算法下的较优解。

#### 验收标准

1. WHEN 玩家请求推荐摆牌 THEN 服务端 SHALL 调用与 Bot 相同的入口函数（`game.AutoArrange`），不引入第二套理牌实现。
2. WHEN 输入手牌为同一组 13 张牌 THEN 调用 `AutoArrange` 返回的三道 SHALL 与 Bot 在该手牌下的摆法完全一致（含头/中/尾的牌组合）。
3. IF `AutoArrange` 进入兜底分支 THEN 系统 SHALL 仍然返回一组通过 `ValidateLanes` 校验的合法三道。
4. WHEN 推荐结果产生 THEN 服务端 SHALL 在返回前再次调用 `ValidateLanes` 进行兜底校验，若不合法则返回错误而非错误数据。

### 需求 2：新增"推荐放入"协议消息

**用户故事：** 作为前后端的通信契约，我希望新增独立的请求/响应消息类型，以便客户端能在理牌阶段触发推荐并接收推荐结果。

#### 验收标准

1. WHEN 协议层定义新消息 THEN [protocol.go](e:/wxgame/card2/card_ssd/internal/protocol/protocol.go) SHALL 新增常量 `MsgRecommendLanes = "RECOMMEND_LANES"` 与 `MsgRecommendLanesOK = "RECOMMEND_LANES_OK"`。
2. WHEN 客户端发送 `RECOMMEND_LANES` THEN 请求体 SHALL 不携带牌数据（服务端以会话当前手牌为准），仅由 ReqID 标识请求。
3. WHEN 服务端响应 `RECOMMEND_LANES_OK` THEN 响应体 SHALL 包含 `head`、`middle`、`tail` 三个字段（牌对象数组），以及 `usedFallback`（bool）表示是否走了兜底策略。
4. WHEN [ws.go](e:/wxgame/card2/card_ssd/internal/server/ws.go) 的 `dispatch` 收到 `RECOMMEND_LANES` THEN 它 SHALL 路由到 `handler.HandleRecommendLanes`。
5. WHEN 前端 [protocol.js](e:/wxgame/card2/js/net/protocol.js) 更新 THEN 它 SHALL 同步导出 `MSG_RECOMMEND_LANES`、`MSG_RECOMMEND_LANES_OK` 常量。

### 需求 3：服务端推荐处理函数

**用户故事：** 作为服务端开发者，我希望有一个专职 handler 处理推荐请求，以便保持职责清晰、易于测试。

#### 验收标准

1. WHEN 在 [handler/game.go](e:/wxgame/card2/card_ssd/internal/handler/game.go) 实现 `HandleRecommendLanes(s, data, reqID)` THEN 它 SHALL 检查会话已登录、已加入房间、房间处于"理牌阶段"、该玩家本局尚未提交。
2. IF 玩家不在房间中 OR 未发牌 OR 已提交 THEN 服务端 SHALL 返回 `ERROR` 消息且错误码语义清晰（如未在房间、阶段不匹配、已提交）。
3. WHEN 校验通过 THEN handler SHALL 取该玩家会话的当前 13 张手牌（与服务端发牌存储一致），调用 `game.AutoArrange(hand)` 获得 `Lanes`。
4. WHEN 拿到 `Lanes` THEN handler SHALL 调用 `ValidateLanes` 二次校验；不合法时 SHALL 返回 `ERROR`，合法时 SHALL 通过 `s.Send` 发送 `RECOMMEND_LANES_OK` 响应。
5. WHEN 推荐响应发送 THEN 服务端 SHALL 不修改房间状态（不计入提交、不广播给其他玩家）。

### 需求 4：前端推荐按钮与回填

**用户故事：** 作为玩家，我希望在理牌界面看到一个明显的"推荐放入"按钮，点击后能将自动摆好的牌呈现在三道中，以便我决定是否调整或直接提交。

#### 验收标准

1. WHEN 进入理牌阶段（[play_phase.js](e:/wxgame/card2/js/scenes/play_phase.js)）THEN 界面 SHALL 在合理位置（如"提交"按钮旁）展示一个"推荐放入"按钮。
2. IF 玩家本局已经提交 THEN "推荐放入"按钮 SHALL 被禁用或隐藏。
3. WHEN 玩家点击"推荐放入" THEN 客户端 SHALL 通过 `socket_client` 发送 `RECOMMEND_LANES`，并在等待响应期间临时禁用该按钮以防重复点击。
4. WHEN 收到 `RECOMMEND_LANES_OK` THEN 客户端 SHALL 用响应中的 head / middle / tail 覆盖当前 UI 中三道的卡牌摆放，未提交状态保持不变。
5. WHEN 收到 `ERROR` 响应 OR 请求超时 THEN 客户端 SHALL 通过 Toast 给出"推荐失败"提示并恢复按钮可点击状态。
6. WHEN `usedFallback=true` THEN 客户端 SHALL 给出轻量提示（如 Toast："本手牌较散，已为你做兜底摆法"），但仍正常回填。

### 需求 5：状态机与并发安全

**用户故事：** 作为系统维护者，我希望推荐功能不会破坏现有发牌/提交/结算流程，且能处理玩家在不当时机点击的情况。

#### 验收标准

1. WHEN 玩家在"非理牌阶段"（未发牌、已结算、回合确认中）发送 `RECOMMEND_LANES` THEN 服务端 SHALL 返回错误且不调用 `AutoArrange`。
2. WHEN 房间正在执行 Bot 自动摆牌或其他写状态操作时收到推荐请求 THEN 服务端 SHALL 在加锁路径下读取手牌副本，避免并发读写 race。
3. IF 同一玩家在短时间内多次连发 `RECOMMEND_LANES` THEN 服务端 SHALL 各次独立计算并响应（无强制限流，但每次均完整校验阶段），客户端通过按钮禁用避免风暴。

### 需求 6：可测试性与回归

**用户故事：** 作为开发者，我希望该功能附带必要的单元测试，以便保证算法一致性并防止未来回归。

#### 验收标准

1. WHEN 在 [ai_bot_test.go](e:/wxgame/card2/card_ssd/internal/game/ai_bot_test.go) 旁新增/扩展测试 THEN 测试 SHALL 验证"推荐入口"返回的三道与 `AutoArrange` 完全一致（同一手牌等价）。
2. WHEN 测试覆盖兜底场景 THEN SHALL 至少包含 1 个完全散牌用例，确认 `usedFallback=true` 时仍能产出 `ValidateLanes.OK` 的三道。
3. WHEN `go test ./...` 执行 THEN 全部测试 SHALL 通过，无新增编译/lint 报错。

### 需求 7：文档同步

**用户故事：** 作为接手项目的开发者，我希望 README 同步描述新协议与功能，以便快速理解。

#### 验收标准

1. WHEN 该功能开发完成 THEN [card_ssd/README.md](e:/wxgame/card2/card_ssd/README.md) SHALL 在协议消息列表与功能说明里新增 `RECOMMEND_LANES` / `RECOMMEND_LANES_OK` 的描述。
2. WHEN 文档更新 THEN SHALL 注明"推荐算法与 Bot 完全一致，复用 `AutoArrange`"，便于后续维护者追溯。

