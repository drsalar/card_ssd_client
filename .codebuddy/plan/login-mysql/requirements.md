# 需求文档

## 引言

当前项目中，客户端在 `js/main.js` 的 `initUser()` 中将本地随机串（如 `guest_xxxxxxxx`）作为 `openid` 上报，导致同一玩家在不同设备/清缓存后会被识别为不同身份；同时服务端的用户档案、登录 token、房间状态、对局结果均仅保存在 Go 进程内存（`internal/session/manager.go` 的 `tokens / byOpenid`、`internal/room/manager.go` 的 `rooms` 等），进程重启即全部丢失，违背了「24 小时保活」「历史对局可追溯」的产品口径。

本需求采用 **方案 B**：客户端改用 `wx.login` 取临时 `code` 由服务端调微信 `jscode2session` 接口换取真实 `openid`（云托管 `wxContext` 自动注入也作为兜底来源），并将原本仅存内存的关键数据持久化到 MySQL（`10.31.102.121:3306`，账号 `root`，密码读自环境变量 `MYSQL_PWD`），让用户身份、未结束房间和历史结算结果在进程重启 / 多实例部署下保持一致。

## 需求

### 需求 1

**用户故事：** 作为玩家，我希望首次进入小游戏后服务端能拿到我的真实微信 `openid`，以便让我在不同设备、清缓存、卸载重装后仍能被识别为同一用户并恢复我的未完成对局与历史积分。

#### 验收标准

1. WHEN 客户端 `js/main.js` 的 `initUser` 被调用 THEN 客户端 SHALL 通过 `wx.login` 获取临时 `code` 并通过 `wx.cloud.callContainer`（或降级 `wx.request`）调用 `POST /api/login` 上送 `{ code, nickname, avatarUrl }`，不再上送本地随机生成的 `openid`。
2. WHEN 服务端 `apiLogin` 收到 `code` THEN 服务端 SHALL 调用微信 `https://api.weixin.qq.com/sns/jscode2session` 接口（`appid` / `secret` 从环境变量 `WX_APPID` / `WX_SECRET` 读取，未配置时退化为读取请求头 `X-WX-OPENID`，云托管下该头由微信侧自动注入）解析出真实 `openid`，并把 `openid` 写回响应供客户端缓存到本地 `storage`。
3. IF `code2session` 调用失败且请求头未带 `X-WX-OPENID` THEN 服务端 SHALL 返回 `400 { code:400, msg:"登录失败" }`，客户端 `lobby_scene._httpLogin` SHALL Toast「登录失败，点击重试」并保留旧 openid 不上送。
4. WHEN 客户端拿到真实 `openid` 后 THEN 客户端 SHALL 把 `openid` 写入 `wx.setStorageSync('openid', openid)` 并刷新 `databus.user.openid`，后续 `WS LOGIN` 帧、`/api/lobby/active-room` 等请求 SHALL 使用该真实 `openid`。

### 需求 2

**用户故事：** 作为运维 / 服务端开发者，我希望服务端启动时能自动连接 MySQL 并保证依赖的表结构存在，以便后续业务无需关心建库建表。

#### 验收标准

1. WHEN 服务端 `main.go` 启动 THEN 服务端 SHALL 通过新建包 `internal/storage` 调用 `storage.Init()` 建立 MySQL 连接池（DSN 由环境变量拼接：`root:${MYSQL_PWD}@tcp(10.31.102.121:3306)/card_ssd?charset=utf8mb4&parseTime=true&loc=Local`，库名也允许 `MYSQL_DB` 覆盖；未提供 `MYSQL_PWD` 时 SHALL 记录 `WARN` 日志并以「降级为内存模式」运行，不阻塞服务启动）。
2. WHEN `storage.Init()` 成功建立连接 THEN 它 SHALL 在启动时自动执行内置 DDL 迁移脚本，创建以下表（已存在则跳过）：`users`、`auth_tokens`、`rooms`、`room_players`、`match_results`，索引按下文需求 5/6/7 给出。
3. IF MySQL 连接失败或迁移失败 THEN 服务端 SHALL 仅记录 `ERROR` 日志并继续以纯内存模式运行（保持现有行为），便于本地无 MySQL 调试。
4. WHEN 服务端进程退出 THEN `storage.Close()` SHALL 在 `httpServer.Shutdown` 之后被调用以释放连接池。
5. IF `go.mod` 中尚未引入 `github.com/go-sql-driver/mysql` THEN 实现 SHALL 通过 `go get` 引入并提交 `go.mod` / `go.sum` 更新。

### 需求 3

**用户故事：** 作为玩家，我希望我授权过的微信昵称、头像在服务端被记录下来，以便我换设备登录或服务重启后队友看到的仍然是我的最新昵称头像。

#### 验收标准

1. WHEN `apiLogin` 解析出 `openid` THEN 服务端 SHALL `UPSERT` 到 `users` 表（字段：`openid VARCHAR(64) PK`、`nickname VARCHAR(64)`、`avatar_url VARCHAR(512)`、`created_at DATETIME`、`updated_at DATETIME`），仅当 `nickname/avatar_url` 非空时覆盖，避免被空值清空；同时刷新内存中的 `session.TokenInfo` 与房间内 `Player.Nickname/AvatarUrl`。
2. WHEN 客户端发送的 `nickname/avatarUrl` 为空 THEN 服务端 SHALL 从 `users` 表读取已有资料回填到响应 `nickname/avatarUrl` 字段以及 `Session/Player`，让服务重启后再次进入大厅时仍能展示真实昵称。
3. WHEN `WS LOGIN` 帧到达且未携带昵称 THEN `handler.HandleLogin` SHALL 也走 `users` 表读取已有资料，与 HTTP 路径口径一致。

### 需求 4

**用户故事：** 作为玩家，我希望已颁发的登录 token 在服务端重启后仍然有效（在过期前），以便我刚切后台/瞬断的小游戏不需要再次走授权链路。

#### 验收标准

1. WHEN `apiLogin` 颁发 `token` THEN 服务端 SHALL 同步写入 `auth_tokens` 表（字段：`token VARCHAR(64) PK`、`openid VARCHAR(64) INDEX`、`nickname VARCHAR(64)`、`avatar_url VARCHAR(512)`、`expires_at DATETIME` 默认 7 天后、`created_at DATETIME`），并在内存 `tokens` map 中作热点缓存。
2. WHEN `session.LookupByToken` 命中内存即返回；未命中时 SHALL 从 `auth_tokens` 表回查并补回内存（DB 不存在或已过期则返回 `false`）。
3. WHEN 进程启动时 THEN `storage.Init` SHALL 异步执行一次 `DELETE FROM auth_tokens WHERE expires_at < NOW()` 清理过期记录。

### 需求 5

**用户故事：** 作为玩家，我希望即使服务端进程重启，我的未结束房间（含座位、积分、当前轮次、规则）仍然能恢复，以便我从「重新进入」入口可以继续对局。

#### 验收标准

1. WHEN `room.CreateRoom` / `JoinRoom` / `LeaveRoom` / `RemovePlayer` / `Settle` / `markAllOfflineIfNeeded` / `Touch` 等改写房间或玩家关键字段时 THEN 服务端 SHALL 通过 `storage.SaveRoom(r)` 把房间快照 `UPSERT` 到 `rooms` 表（字段：`room_id VARCHAR(8) PK`、`host_openid VARCHAR(64)`、`phase VARCHAR(16)`、`current_round INT`、`total_rounds INT`、`max_players INT`、`with_ma TINYINT`、`last_active_at BIGINT`、`all_offline_since BIGINT`、`destroyed TINYINT` 默认 0、`updated_at DATETIME`）。
2. WHEN 房间持久化的同时 THEN 同一事务 SHALL 把 `Players` 列表全量重写到 `room_players`（字段：`room_id VARCHAR(8)`、`openid VARCHAR(64)`、`seat INT`、`nickname VARCHAR(64)`、`avatar_url VARCHAR(512)`、`score INT`、`is_bot TINYINT`、`offline TINYINT`、`offline_since BIGINT`、`hand TEXT`、`lanes TEXT`、`submitted TINYINT`、`round_confirmed TINYINT`、`vote_dissolve TINYINT`，主键 `(room_id, openid)`，索引 `KEY(openid)`）；其中 `hand`、`lanes` 用 JSON 字符串存。
3. WHEN `DestroyRoom` 被调用 THEN 服务端 SHALL 把对应 `rooms.destroyed=1` 标记（不删除行，便于追溯），并 `DELETE FROM room_players WHERE room_id=?` 清理。
4. WHEN 服务端 `main.go` 启动且 MySQL 可用 THEN `room.LoadFromStorage()` SHALL 在巡检启动前把 `rooms.destroyed=0` 的所有房间及其 `room_players` 还原到内存 `rooms` map（在线状态统一置 `Offline=true`、`AllOfflineSince` 取库内值或当前时间），由后续 24h 巡检按既有规则销毁过期房间。
5. WHEN `FindActiveRoomByOpenid` 在内存未命中 THEN 实现 SHALL 不强制走 DB（恢复阶段已加载到内存即可），保持现有行为，避免把调用 RT 拉高。

### 需求 6

**用户故事：** 作为玩家，我希望每一局结算结果都被永久记录，以便后续上线「历史对局回顾 / 个人战绩」等扩展功能时数据可查。

#### 验收标准

1. WHEN `handler.DoSettle` 完成一局并设置 `r.LastSettle` THEN 服务端 SHALL 把该局结果写入 `match_results` 表（字段：`id BIGINT AUTO_INCREMENT PK`、`room_id VARCHAR(8)`、`round INT`、`with_ma TINYINT`、`total_rounds INT`、`payload JSON`、`created_at DATETIME`），其中 `payload` 直接 `json.Marshal(r.LastSettle)` 整体落库，`KEY(room_id, round)`、`KEY(created_at)`。
2. WHEN 写入 `match_results` 失败 THEN 服务端 SHALL 仅打 `WARN` 日志，不阻塞后续广播 / 进入下一局。
3. WHEN 整场结束（`PhaseMatchEnd`）THEN 服务端 SHALL 不再额外写「整场汇总」表（本期不做），只保留 per-round 数据，由后续读侧聚合。

### 需求 7

**用户故事：** 作为开发/运维，我希望持久化层的接入是「可降级、可观测、最小入侵」的，以便本地开发与生产部署都不会被 MySQL 单点拖垮。

#### 验收标准

1. WHEN 任何 `storage.Save*` 调用因 DB 错误失败 THEN 实现 SHALL 仅打 `WARN` 日志（包含表名 + 关键 ID），不向上抛出 panic，不阻塞当前请求；调用方 SHALL 直接忽略错误返回。
2. WHEN `storage.Init` 检测到 `MYSQL_PWD` 未配置 THEN 全部 `Save* / Load*` SHALL 直接返回 `nil`（空操作），保持纯内存运行。
3. WHEN 单元测试运行 THEN 现有的 `internal/game/...` 与 `internal/room/sweeper_test.go` 用例 SHALL 不依赖 MySQL，通过空操作兜底。
4. WHEN 房间持久化频率较高（每次 `BroadcastState` 都可能触发）THEN 实现 SHALL 通过「房间维度的 dirty 标记 + 1 秒节流 goroutine」批量落库，避免每秒数十次写库；进程退出 / 房间销毁 / 阶段切换等关键节点 SHALL 立即同步落库。
5. WHEN 文档需要更新 THEN [card_ssd/README.md](./card_ssd/README.md) 与 [README.md](./README.md) SHALL 增加「MySQL 持久化 / 微信登录链路」章节，列出新增表结构、环境变量与降级策略。
