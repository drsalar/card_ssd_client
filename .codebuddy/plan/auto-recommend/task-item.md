# 实施计划

- [ ] 1. 在协议层新增推荐消息常量
   - 在 [card_ssd/internal/protocol/protocol.go](e:/wxgame/card2/card_ssd/internal/protocol/protocol.go) 增加 `MsgRecommendLanes = "RECOMMEND_LANES"` 与 `MsgRecommendLanesOK = "RECOMMEND_LANES_OK"`
   - 紧邻 `MsgSubmitLanes` 常量分组放置，保持枚举有序
   - _需求：2.1_

- [ ] 2. 服务端实现 `HandleRecommendLanes`
   - 在 [card_ssd/internal/handler/game.go](e:/wxgame/card2/card_ssd/internal/handler/game.go) 新增 `HandleRecommendLanes(s, raw, reqID)`
   - 校验：房间存在 / 玩家在房间 / `Phase == PhasePlaying` / `!p.Submitted` / `len(p.Hand)==13`
   - 在 `r.Lock()` 内拷贝手牌副本后立即 `r.Unlock()`，再调用 `game.AutoArrange` 与 `game.ValidateLanes`
   - 通过 `s.Send(protocol.MsgRecommendLanesOK, {...}, reqID)` 返回；不修改房间状态、不广播
   - _需求：3.1、3.2、3.3、3.4、3.5、5.1、5.2_

- [ ] 3. 在 dispatch 路由新消息
   - 在 [card_ssd/internal/server/ws.go](e:/wxgame/card2/card_ssd/internal/server/ws.go) 的 `dispatch` switch 中新增 `case protocol.MsgRecommendLanes` 分支并路由到 `handler.HandleRecommendLanes`
   - _需求：2.4_

- [ ] 4. 调整 `AutoArrange` 返回签名以暴露 `usedFallback`（如已暴露则跳过）
   - 检查 [card_ssd/internal/game/ai_bot.go](e:/wxgame/card2/card_ssd/internal/game/ai_bot.go) 现有 `AutoArrange` 已返回 `(*Lanes, bool)`，handler 直接复用其第二个返回值作为响应中的 `usedFallback`
   - 不引入新的算法函数，保持"Bot 与玩家推荐共用同一入口"
   - _需求：1.1、1.2、1.3_

- [ ] 5. 新增推荐算法一致性单元测试
   - 在 [card_ssd/internal/game/ai_bot_test.go](e:/wxgame/card2/card_ssd/internal/game/ai_bot_test.go) 添加 `TestRecommendSameAsBot`：构造若干固定手牌，断言两次调用 `AutoArrange` 返回的三道完全一致（含牌顺序）
   - 添加 `TestRecommendFallbackValid`：构造完全散牌用例，验证 `usedFallback==true` 且 `ValidateLanes` 通过
   - _需求：1.2、1.3、6.1、6.2、6.3_

- [ ] 6. 前端协议常量同步
   - 在 [js/net/protocol.js](e:/wxgame/card2/js/net/protocol.js) 的 `MSG` 中新增 `RECOMMEND_LANES` 与 `RECOMMEND_LANES_OK`，并补充注释
   - _需求：2.5_

- [ ] 7. 前端添加"推荐放入"按钮 & 点击逻辑
   - 在 [js/scenes/play_phase.js](e:/wxgame/card2/js/scenes/play_phase.js) 的 `_buildButtons` 中新增 `recommendBtn`（与 `openBtn` 同区域，颜色区分）
   - 点击时：禁用按钮 → 通过 `GameGlobal.socket.send(MSG.RECOMMEND_LANES, {})` 发送请求
   - `lock()/unlock()` 同步管理 `recommendBtn.disabled`
   - 在 `render` 中渲染、`handleTouch` 中处理点击
   - _需求：4.1、4.2、4.3_

- [ ] 8. 前端处理 `RECOMMEND_LANES_OK` 与错误响应
   - 在 [js/net/socket_client.js](e:/wxgame/card2/js/net/socket_client.js) 或 play_phase 监听 `RECOMMEND_LANES_OK`：将响应中的 `head/middle/tail` 写回 `GameGlobal.databus.myLanes`，清空 `myHand` 与 `selectedCards`，调用 `_refreshOpenBtn`，恢复 `recommendBtn`
   - 收到 `ERROR` 或超时时：`GameGlobal.toast.show('推荐失败')`，恢复按钮
   - 当 `usedFallback === true` 时：`GameGlobal.toast.show('本手牌较散，已为你做兜底摆法')`
   - _需求：4.4、4.5、4.6_

- [ ] 9. 端到端联调验证
   - Windows 命令：`cd card_ssd && go build ./... && go test ./...`
   - 启动服务端 `go run ./...`，用微信开发者工具打开前端，进入对局后点击"推荐放入"按钮，确认三道被回填且与 Bot 摆法一致；测试已提交后按钮禁用、非理牌阶段返回错误
   - _需求：1.2、3.2、4.2、5.1、6.3_

- [ ] 10. 同步 README 文档
   - 在 [card_ssd/README.md](e:/wxgame/card2/card_ssd/README.md) 协议消息列表新增 `RECOMMEND_LANES` / `RECOMMEND_LANES_OK` 描述，注明"推荐算法与 Bot 完全一致，复用 `AutoArrange`"
   - _需求：7.1、7.2_

