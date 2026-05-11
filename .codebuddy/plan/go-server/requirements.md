# Go 服务端重写需求文档（card_ssd）

## 引言

将现有的 Node.js（`server/`）十三张多人棋牌服务端使用 Go 语言重写，存放到独立目录 `card_ssd/` 下。新服务端基于 **Gin（HTTP 框架）** 与 **gorilla/websocket（WebSocket 框架）** 构建，实现「主页与普通请求走 HTTP，对局相关实时通信走 WebSocket」的分层通信架构。新服务端必须在协议、规则、行为上与现有 Node.js 版本完全等价，确保现有微信小游戏客户端无需修改即可对接。

设计目标：
- 端口：HTTP 与 WebSocket 复用同一端口（默认 `8080`），路径分流（`/ws`、`/api/...`）。
- 框架：HTTP 用 `gin-gonic/gin`，WebSocket 用 `gorilla/websocket`。
- 状态：所有房间/对局信息保留在服务端进程内存中，所有玩家退出房间后立即销毁。
- 语言/版本：Go 1.21+。
- 包结构清晰、单文件不超过 1000 行、单方法不超过 100 行（遵守用户规则）。

## 需求

### 需求 1：项目结构与构建

**用户故事：** 作为一名后端开发者，我希望 Go 服务端拥有清晰的目录结构与可一键构建运行的能力，以便快速开发和部署。

#### 验收标准

1. WHEN 项目初始化时，THEN 系统 SHALL 在 `card_ssd/` 目录下建立 Go module 工程，包含 `go.mod`、`go.sum`、`main.go`、`README.md`。
2. WHEN 包结构划分时，THEN 系统 SHALL 至少包含以下目录：`internal/protocol`、`internal/server`、`internal/session`、`internal/room`、`internal/handler`、`internal/game`、`internal/logger`。
3. WHEN 用户在 `card_ssd/` 下执行 `go run .` 或 `go build` 时，THEN 系统 SHALL 能够正常编译并启动监听端口（默认 8080，可通过环境变量 `PORT` 覆盖）。
4. WHEN 涉及第三方依赖时，THEN 系统 SHALL 仅引入 `github.com/gin-gonic/gin` 与 `github.com/gorilla/websocket` 两个核心依赖（日志与 JSON 使用标准库）。

### 需求 2：HTTP 接口（普通请求）

**用户故事：** 作为客户端开发者，我希望主页相关的非实时操作通过 HTTP 接口完成，以便降低 WebSocket 通信复杂度并便于调试。

#### 验收标准

1. WHEN 客户端访问 `GET /api/health` 时，THEN 系统 SHALL 返回 `{ ok: true, time: <unix-ms>, rooms: <数量> }`。
2. WHEN 客户端访问 `POST /api/login` 携带 `{ openid, nickname, avatarUrl }` 时，THEN 系统 SHALL 创建/更新身份记录并返回 `{ token, openid, nickname }`，token 用于后续 WS 鉴权。
3. WHEN 客户端访问 `POST /api/room/create` 携带规则参数 `{ withMa, totalRounds, maxPlayers }` 与 token 时，THEN 系统 SHALL 创建房间并返回 `{ roomId }`；token 无效时返回 401。
4. WHEN 客户端访问 `GET /api/room/:id` 时，THEN 系统 SHALL 返回该房间的概要信息（不含手牌）；房间不存在时返回 404。
5. IF 任意 HTTP 接口入参非法 THEN 系统 SHALL 返回 400 与 `{ code, msg }`。
6. WHEN HTTP 服务启动时，THEN 系统 SHALL 启用 CORS（允许任意来源）以便客户端在小游戏与浏览器调试环境中均可访问。

### 需求 3：WebSocket 通信（对局相关）

**用户故事：** 作为客户端开发者，我希望对局期间的所有实时事件（准备、发牌、放牌、比牌、结算、确认）通过 WebSocket 传输，并保持与现有 Node.js 协议完全兼容。

#### 验收标准

1. WHEN 客户端连接 `GET /ws` 时，THEN 系统 SHALL 升级为 WebSocket 连接并为该连接创建 Session。
2. WHEN 升级时携带查询参数 `?token=...` 或后续发送 `LOGIN` 消息时，THEN 系统 SHALL 完成身份绑定，未登录前仅允许 `LOGIN` 消息。
3. WHEN 服务端收到一条 WebSocket 消息时，THEN 系统 SHALL 按照 `{ type, data, reqId }` JSON 格式解析；非法格式回 `ERROR(BAD_REQUEST=1008)`。
4. WHEN 服务端处理消息时，THEN 系统 SHALL 支持以下消息类型（与现有 [protocol.js](../../../server/protocol.js) 完全一致）：`LOGIN`、`CREATE_ROOM`、`JOIN_ROOM`、`LEAVE_ROOM`、`READY`、`UNREADY`、`SUBMIT_LANES`、`ROUND_CONFIRM`。
5. WHEN 服务端推送时，THEN 系统 SHALL 支持以下广播/单播类型：`LOGIN_OK`、`CREATE_ROOM_OK`、`JOIN_ROOM_OK`、`LEAVE_ROOM_OK`、`SUBMIT_LANES_OK`、`ROOM_STATE`、`DEAL_CARDS`、`SETTLE_RESULT`、`MATCH_END`、`ERROR`。
6. WHEN 同一 openid 重复登录时，THEN 系统 SHALL 关闭旧连接，将身份指向新连接（与 Node.js 行为一致）。
7. IF WebSocket 连接因网络异常关闭 THEN 系统 SHALL 触发对应的断线处理流程（参见需求 6）。

### 需求 4：房间管理与生命周期

**用户故事：** 作为玩家，我希望能创建/加入/离开房间，并在所有人退出后自动销毁房间，以便服务端不残留无效数据。

#### 验收标准

1. WHEN 创建房间时，THEN 系统 SHALL 生成唯一 4 位数字 ID（必要时回退到 5 位），并将房主设为创建者 openid。
2. WHEN 加入房间时，THEN 系统 SHALL 校验：房间存在、未满（≤ maxPlayers）、阶段为 WAITING 或 MATCH_END；不满足时返回对应错误码（`ROOM_NOT_FOUND=1001`/`ROOM_FULL=1002`/`ROOM_PLAYING=1003`）。
3. WHEN 同一 openid 已在房间中再次加入相同房间时，THEN 系统 SHALL 视为重连：恢复在线状态、补发其手牌（`DEAL_CARDS`）以及（若已开牌）其三道（`SUBMIT_LANES_OK`）。
4. WHEN 房主离开房间且房间内仍有玩家时，THEN 系统 SHALL 将房主权限自动转交给最早加入的剩余玩家。
5. WHEN 房间内最后一名玩家离开时，THEN 系统 SHALL 立即从内存中销毁该房间。
6. WHEN 房间状态发生变化（成员、ready、submitted、phase、currentRound、score）时，THEN 系统 SHALL 通过 `ROOM_STATE` 广播给房内所有在线玩家。
7. IF 玩家创建/加入操作时已在其他房间中 THEN 系统 SHALL 返回 `ALREADY_IN_ROOM=1007`。

### 需求 5：对局流程（发牌/开牌/结算/多局）

**用户故事：** 作为玩家，我希望服务端正确控制对局流程：发牌、放牌校验、比牌结算、多局循环、整场结算，以便顺利完成游戏。

#### 验收标准

1. WHEN 房间内 ≥2 人且全员 `READY` 时，THEN 系统 SHALL 切换 phase 为 `playing`，洗牌、按人数生成牌堆（4 人内 52 张，5 人 65 张含一组方块加色 D2，6 人 78 张含 D2/C2），按每人 13 张私发 `DEAL_CARDS`。
2. WHEN 玩家发送 `SUBMIT_LANES` 时，THEN 系统 SHALL 校验：13 张与初始手牌一致、头道 3 张/中道 5 张/尾道 5 张、且头道 ≤ 中道 ≤ 尾道；不通过时回 `ERROR(INVALID_LANES=1005)`。
3. WHEN 全员 `submitted=true` 时，THEN 系统 SHALL 切换 phase 为 `comparing`，调用结算引擎并广播 `SETTLE_RESULT`（含 players、handTypes、laneScores、finalScore、pairs、homeruns、scores 累计）。
4. WHEN 全员 `ROUND_CONFIRM` 时，THEN 系统 SHALL 判断：若 `currentRound >= totalRounds` 则切换 phase 为 `match_end` 并广播 `MATCH_END(ranks)`；否则切回 `waiting` 并清空本局相关数据（保留 `score`）。
5. IF 客户端在非对应阶段发送对局类消息 THEN 系统 SHALL 回 `ERROR(BAD_REQUEST)`。

### 需求 6：断线与异常处理

**用户故事：** 作为玩家，我希望网络抖动或意外退出时不破坏其他玩家的对局体验，以便公平进行。

#### 验收标准

1. WHEN 玩家在 `waiting` 阶段断线时，THEN 系统 SHALL 直接将其从房间移除（与 Node.js 行为一致）；若房间为空则销毁。
2. WHEN 玩家在 `playing`/`comparing` 阶段断线时，THEN 系统 SHALL 将其标记为 `offline=true` 并广播 `ROOM_STATE`。
3. WHEN 断线状态持续 30 秒未恢复时，THEN 系统 SHALL 自动以「头 3/中 5/尾 5」原顺序兜底提交其三道（视为乌龙），若此时所有玩家均已 submitted 则触发结算。
4. IF 玩家在 30 秒内重连同一房间 THEN 系统 SHALL 取消断线计时器并恢复其在线状态、补发手牌信息。
5. WHEN 服务端在处理消息时发生未捕获错误时，THEN 系统 SHALL 记录日志并向触发者回 `ERROR(500)`，不得使整个进程崩溃。

### 需求 7：十三张规则与结算引擎（与 Node.js 等价）

**用户故事：** 作为玩家，我希望 Go 版本的牌型识别与积分结算与现有 Node.js 版本结果完全一致，以便结果可被信赖。

#### 验收标准

1. WHEN 评估牌型时，THEN 系统 SHALL 支持 10 种牌型（乌龙/对子/两对/三条/顺子/同花/葫芦/炸弹/同花顺/五龙），且枚举顺序与现有 [hand_evaluator.js](../../../server/game/hand_evaluator.js) 一致（`HIGH=1 ... FIVE=10`）。
2. WHEN 判断顺子时，THEN 系统 SHALL 满足：A 默认作 14；`10-J-Q-K-A` 顶 14；`A-2-3-4-5` 顶 5（最低顺）；含重复点数则不成顺。
3. WHEN 比较同花时，THEN 系统 SHALL 应用加色特殊规则：带对的同花 > 普通同花，2 对同花 > 1 对同花，再比点数。
4. WHEN 结算时，THEN 系统 SHALL 实现以下分值规则并与 Node.js 一致：
   - 各道基础胜负 ±1 分
   - 冲三（头道三条）+2、中道葫芦 +1、中道炸弹 +3、中道同花顺 +4、中道五龙 +9、尾道炸弹 +3、尾道同花顺 +4、尾道五龙 +9，特殊加分由输方支付
   - 打枪：单个 i 三道全胜 j → 该 pair 总分 ×2
   - 本垒打：当 n≥3 且 i 对所有对手都打枪 → 与 i 相关的所有 pair 再 ×2
   - 马牌（红桃 5 即 `H/5`）：开启 `withMa` 时，持有该牌玩家最终得分 ×2
5. WHEN 加色规则下牌堆构建时，THEN 系统 SHALL 在 5 人时新增 `D2`、6 人时再新增 `C2`，并在判定同花时将 `D2/C2` 视同 `D/C`（去掉后缀比较）。
6. WHEN 输出结算结果时，THEN 系统 SHALL 提供与 Node.js 相同字段：`players[]`(含 `openid/lanes/handTypes/hasMa/baseScore/finalScore/laneScores{head,middle,tail,extra}`)、`pairs[]`、`homeruns[]`、`scores[]`(累计)。

### 需求 8：日志、并发与稳定性

**用户故事：** 作为运维人员，我希望服务端在并发访问下稳定运行并产生可观察的日志，以便排查问题。

#### 验收标准

1. WHEN 房间被并发访问（同一房间多个 WebSocket 同时收发）时，THEN 系统 SHALL 通过房间级互斥锁（`sync.Mutex`）保证状态一致性，避免数据竞争。
2. WHEN 关键事件发生时（连接、登录、创建/销毁房间、发牌、结算、断线、错误），THEN 系统 SHALL 输出带时间戳与级别（INFO/WARN/ERROR）的日志。
3. WHEN 服务端收到 `SIGINT`/`SIGTERM` 时，THEN 系统 SHALL 优雅关闭：停止接收新连接、关闭所有 WebSocket 后退出。
4. IF 日志/路由发生 panic THEN 系统 SHALL 通过 Gin 的 Recovery 中间件与 WebSocket 处理协程的 `defer recover()` 保护进程。

### 需求 9：协议常量与对客户端兼容性

**用户故事：** 作为客户端开发者，我希望切换到 Go 服务端时不需要修改任何客户端代码。

#### 验收标准

1. WHEN 协议常量定义时，THEN 系统 SHALL 与现有 [server/protocol.js](../../../server/protocol.js) 中的 `MSG.*` 与 `ERR.*` 字符串/数值完全一致。
2. WHEN JSON 字段命名时，THEN 系统 SHALL 全部使用驼峰命名（如 `openid`、`nickname`、`avatarUrl`、`roomId`、`maxPlayers`、`totalRounds`、`withMa`、`currentRound`、`hostId`、`finalScore`、`laneScores`、`handTypes`、`gunI`、`gunJ`、`scoreI`、`scoreJ`、`homeruns` 等）。
3. WHEN 卡牌数据传输时，THEN 系统 SHALL 使用 `{ suit: 'S'|'H'|'D'|'C'|'D2'|'C2', rank: 1..13 }` 结构，与现有客户端 [Card.js](../../../js/ui/Card.js) 完全兼容。
4. IF 客户端连接 Go 服务端 THEN 现有 [main.js](../../../js/main.js) 仅需将 `SOCKET_URL` 指向新服务地址即可正常工作，无需任何代码改动。

### 需求 10：文档与说明

**用户故事：** 作为新加入的开发者，我希望有清晰的 README 说明如何启动 Go 服务端及其与客户端的对接方式。

#### 验收标准

1. WHEN 文档编写时，THEN 系统 SHALL 在 `card_ssd/README.md` 中说明：依赖版本、启动命令（`go run .`）、目录结构、HTTP 路由列表、WebSocket 协议清单、与 Node.js 服务端的差异（如有）。
2. WHEN 项目根 README 更新时，THEN 系统 SHALL 在 [README.md](../../../README.md) 增加「Go 服务端」段落，指出 `card_ssd/` 与 `server/` 二选一启动。
3. WHEN 编码注释时，THEN 系统 SHALL 全部使用中文注释（遵守用户规则）。
