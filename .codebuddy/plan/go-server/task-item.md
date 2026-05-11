# 实施计划

- [ ] 1. 项目初始化与依赖
   - 在 `card_ssd/` 下创建 Go module（`go mod init card_ssd`），生成 `go.mod`/`go.sum`
   - 引入依赖：`github.com/gin-gonic/gin`、`github.com/gorilla/websocket`
   - 创建目录骨架：`internal/protocol`、`internal/server`、`internal/session`、`internal/room`、`internal/handler`、`internal/game`、`internal/logger`
   - 编写 `card_ssd/main.go`：读取 `PORT` 环境变量、初始化 logger、构建 Gin engine、启动 HTTP+WS、监听 `SIGINT/SIGTERM` 优雅关闭
   - 编写 `card_ssd/README.md`：依赖版本、启动命令（`go run .`）、目录结构、HTTP/WS 协议清单
   - 更新项目根 `README.md` 增加「Go 服务端」段落，说明 `card_ssd/` 与 `server/` 二选一
   - _需求：1.1, 1.2, 1.3, 1.4, 8.3, 10.1, 10.2_

- [ ] 2. 协议常量与日志
- [ ] 2.1 协议定义
   - 在 `internal/protocol/protocol.go` 定义 `MSG`（LOGIN/CREATE_ROOM/JOIN_ROOM/LEAVE_ROOM/READY/UNREADY/SUBMIT_LANES/ROUND_CONFIRM/LOGIN_OK/CREATE_ROOM_OK/JOIN_ROOM_OK/LEAVE_ROOM_OK/SUBMIT_LANES_OK/ROOM_STATE/DEAL_CARDS/SETTLE_RESULT/MATCH_END/ERROR）与 `ERR`（ROOM_NOT_FOUND=1001/ROOM_FULL=1002/ROOM_PLAYING=1003/INVALID_LANES=1005/ALREADY_IN_ROOM=1007/BAD_REQUEST=1008 等）常量，与 [server/protocol.js](../../../server/protocol.js) 完全一致
   - 定义 `Envelope { Type, Data, ReqID }` 结构体（JSON 标签使用 `type`/`data`/`reqId`）
   - _需求：3.3, 3.4, 3.5, 9.1, 9.2_

- [ ] 2.2 日志模块
   - 在 `internal/logger/logger.go` 基于标准库 `log` 封装 `Info/Warn/Error`，输出格式 `[时间][级别] msg`
   - _需求：8.2_

- [ ] 3. 卡牌、牌堆与牌型识别（移植 Node.js）
- [ ] 3.1 卡牌与牌堆
   - 在 `internal/game/card.go` 定义 `Card { Suit string; Rank int }`、`IsMaCard`、`SameSuit`（处理 D2/C2 同花归一化）、`RankValue`（A 作 14）
   - 实现 `BuildDeck(playerCount int) []Card`：4 人 52 张、5 人加 D2 共 65 张、6 人再加 C2 共 78 张
   - 实现 `Shuffle` 与 `Deal(playerCount int) [][]Card`（按每人 13 张）
   - _需求：5.1, 7.5, 9.3_

- [ ] 3.2 牌型识别引擎
   - 在 `internal/game/evaluator.go` 定义 `HandType` 枚举（HIGH=1...FIVE=10）与名称映射
   - 实现 `Evaluate(cards []Card, isHead bool) HandResult`：含五龙/同花顺/炸弹/葫芦/同花/顺子/三条/两对/对子/乌龙；头道仅 3 张支持三条/对子/乌龙
   - 实现 `checkStraight`（A 作 1 用：`A-2-3-4-5` top=5；`10-J-Q-K-A` top=14；含重复点数则 false）
   - 实现 `Compare(a, b HandResult) int`：先比类型，同花特殊比较带对数，再比 ranks 数组
   - _需求：7.1, 7.2, 7.3_

- [ ] 3.3 三道校验与结算引擎
   - 在 `internal/game/validator.go` 实现 `ValidateLanes(head, middle, tail []Card)`：张数 3/5/5、头道 ≤ 中道 ≤ 尾道
   - 在 `internal/game/settle.go` 实现 `Settle(players []*PlayerSettleInput, withMa bool) SettleResult`：
     - 两两比较 `comparePair`：基础 ±1、特殊加分（冲三+2/中道葫芦+1/中道炸弹+3/中道同花顺+4/中道五龙+9/尾道炸弹+3/尾道同花顺+4/尾道五龙+9，由输方支付）、打枪整体×2
     - 本垒打：n≥3 且对所有对手打枪 → 相关 pair 再×2（`recomputeWithBonus`）
     - 马牌：开启 `withMa` 时持有 `H/5` 玩家最终分×2
     - 输出字段与 Node.js 等价：`players[]{openid,lanes,handTypes,hasMa,baseScore,finalScore,laneScores{head,middle,tail,extra}}`、`pairs[]{i,j,head,middle,tail,extra,gunI,gunJ,scoreI,scoreJ}`、`homeruns[]`
   - _需求：5.2, 7.4, 7.6_

- [ ] 4. Session 与连接管理
   - 在 `internal/session/session.go` 定义 `Session { ConnID, Openid, Nickname, AvatarUrl, Token, RoomID, ws, sendCh, mu }`
   - 实现 `Send(msgType string, data any, reqId string)`、`SendError(code int, msg string, reqId string)`、`writePump`/`readPump`（独立 goroutine，写串行化避免并发写）
   - 在 `internal/session/manager.go` 维护 `connID→Session` 与 `openid→Session` 双索引（`sync.Map`），实现 `BindOpenid`（顶号：关闭旧连接）、`GetByOpenid`、`Remove`
   - 提供 `GenToken()`（随机字符串）与 `LookupByToken`，供 HTTP 层鉴权与 WS 升级共用
   - _需求：3.1, 3.2, 3.6, 8.1_

- [ ] 5. 房间模型与房间管理器
   - 在 `internal/room/room.go` 定义 `Phase`（waiting/playing/comparing/match_end）、`Player { Openid, Nickname, AvatarUrl, ConnID, Score, Ready, Offline, OfflineSince, Hand, Lanes, Submitted, RoundConfirmed }`、`Room { ID, Rule{WithMa,TotalRounds,MaxPlayers}, HostID, Players, Phase, CurrentRound, LastSettle, mu sync.Mutex }`
   - 实现 `AddPlayer/ReconnectPlayer/RemovePlayer/GetPlayer/IsFull/IsEmpty/AllReady/AllSubmitted/AllRoundConfirmed/ResetRound/ToState/Broadcast/BroadcastState`
   - 在 `internal/room/manager.go` 实现 `CreateRoom(rule, hostOpenid)`（生成唯一 4 位 ID，必要时回退 5 位）、`GetRoom`、`DestroyRoom`、`JoinRoom`（含已满/已开局/重连判定）、`LeaveRoom`（房主转移、空房销毁）、`HandleDisconnect`（waiting 阶段直接移除、playing 阶段 30 秒计时器兜底自动提交三道）
   - _需求：4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 6.1, 6.2, 6.3, 6.4_

- [ ] 6. WebSocket 大厅 Handler（登录/房间/准备）
   - 在 `internal/handler/lobby.go` 实现 `HandleLogin`（绑定 openid、顶号、回 `LOGIN_OK`）、`HandleCreateRoom`（已在房间则回 `ALREADY_IN_ROOM`）、`HandleJoinRoom`（错误码映射 + 重连补发 `DEAL_CARDS` 与 `SUBMIT_LANES_OK`）、`HandleLeaveRoom`、`HandleReady`（全员就绪触发 `StartRound`）、`HandleUnready`
   - 每次房间状态变更后调用 `BroadcastState`
   - _需求：3.4, 4.2, 4.3, 4.6, 4.7_

- [ ] 7. WebSocket 对局 Handler（发牌/开牌/结算/确认）
   - 在 `internal/handler/game.go` 实现 `StartRound(room)`：洗牌、按人数构建牌堆、私发 `DEAL_CARDS`、phase=playing
   - 实现 `HandleSubmitLanes`：校验 13 张与初始手牌一致 + `ValidateLanes` + 回 `SUBMIT_LANES_OK`；全员 submitted 调用 `DoSettle`
   - 实现 `DoSettle(room)`：调用 `game.Settle` → 累加 `Player.Score` → phase=comparing → 广播 `SETTLE_RESULT`
   - 实现 `HandleRoundConfirm`：全员确认后判定 `currentRound++ ≥ totalRounds` → 广播 `MATCH_END(ranks)` 并 phase=match_end；否则 `ResetRound` 回 waiting
   - 阶段非法时回 `ERROR(BAD_REQUEST)`
   - _需求：5.1, 5.2, 5.3, 5.4, 5.5, 7.4_

- [ ] 8. WebSocket Server 与消息路由
   - 在 `internal/server/ws.go` 用 `gorilla/websocket` 实现升级（`/ws`，可选 `?token=` 预鉴权），为每个连接创建 Session、启动 read/write 协程
   - 在 `internal/server/router.go` 实现 `Dispatch(s *Session, env *Envelope)`：未登录仅允许 `LOGIN`；按 `type` 分发到 lobby/game handler；统一 `defer recover()` 捕获 panic 输出日志并回 `ERROR(500)`
   - 连接关闭时调用 `room.HandleDisconnect` 与 `session.Remove`
   - _需求：3.1, 3.2, 3.3, 3.7, 6.5, 8.1, 8.4_

- [ ] 9. HTTP 路由（Gin）
   - 在 `internal/server/http.go` 注册 Gin 路由：`GET /api/health`（返回 ok/time/rooms 数量）、`POST /api/login`（生成 token）、`POST /api/room/create`（token 鉴权 + 创建房间，仅返回 roomId，实际加入仍走 WS `JOIN_ROOM`）、`GET /api/room/:id`（返回房间概要，不含手牌；不存在返回 404）
   - 编写 CORS 中间件（允许任意来源、常用方法/头）
   - 入参非法统一返回 400 `{ code, msg }`；token 非法返回 401
   - 启用 Gin Recovery 中间件
   - _需求：2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 8.4_

- [ ] 10. 联调与文档收尾
   - Windows 环境运行 `cd card_ssd && go mod tidy && go run .`，验证启动监听 8080
   - 用浏览器/Postman 验证 HTTP 路由：`curl http://localhost:8080/api/health`
   - 修改客户端 `js/main.js` 中 `SOCKET_URL` 指向 `ws://localhost:8080/ws`，在微信开发者工具进行端到端联调（创建/加入房间→准备→发牌→放牌→开牌→结算→下一局→对局结束）
   - 完善 `card_ssd/README.md` 与项目根 `README.md`，记录与 Node.js 版本的差异点（如 token 鉴权机制、HTTP 接口列表）
   - _需求：1.3, 9.4, 10.1, 10.2, 10.3_
