# 实施计划

- [ ] 1. 引入 MySQL 驱动并创建 `internal/storage` 基础设施
   - 在 [card_ssd/go.mod](../../../card_ssd/go.mod) 增加 `github.com/go-sql-driver/mysql` 依赖（`go get github.com/go-sql-driver/mysql`）
   - 新建 `card_ssd/internal/storage/storage.go`：暴露包级 `DB *sql.DB`、`Enabled() bool`、`Init() error`、`Close() error`、`logWarn(table, id, err)` 工具
   - `Init` 读取 `MYSQL_PWD` / `MYSQL_DB`（默认 `card_ssd`），拼 DSN 连 `10.31.102.121:3306`，设置 `SetMaxOpenConns(8)` / `SetMaxIdleConns(4)`；未设密码或连接失败一律 WARN 后保持 `DB=nil` 让上层降级
   - 新建 `card_ssd/internal/storage/migrate.go`：内置 5 张表的 DDL（`users / auth_tokens / rooms / room_players / match_results`），`CREATE TABLE IF NOT EXISTS` 顺序执行；启动后异步 `DELETE FROM auth_tokens WHERE expires_at < NOW()`
   - 在 [card_ssd/main.go](../../../card_ssd/main.go) 启动早期调用 `storage.Init()`，并在 `httpServer.Shutdown` 之后 `defer storage.Close()`
   - _需求：2.1、2.2、2.3、2.4、2.5、7.2_

- [ ] 2. 用户与 token 持久化（`users` / `auth_tokens`）
   - 新建 `card_ssd/internal/storage/user_repo.go`：`UpsertUser(openid, nickname, avatar)`（仅当字段非空覆盖）、`GetUser(openid) (nickname, avatar, ok)`
   - 新建 `card_ssd/internal/storage/token_repo.go`：`SaveToken(token, openid, nickname, avatar, expiresAt)`、`LoadToken(token) (info, ok)`（过期视为不存在）
   - 修改 [card_ssd/internal/session/manager.go](../../../card_ssd/internal/session/manager.go) `Issue` / `LookupByToken`：写入与读未命中时回查 DB；DB 命中后补回内存 map
   - _需求：3.1、3.2、4.1、4.2、4.3、7.1、7.2_

- [ ] 3. 接入方案 B 微信登录链路（服务端）
   - 新建 `card_ssd/internal/wxauth/code2session.go`：`Code2Session(code) (openid string, err error)`，HTTP GET `https://api.weixin.qq.com/sns/jscode2session`，从 `WX_APPID` / `WX_SECRET` 读取凭证，3 秒超时，解析 `errcode`
   - 修改 [card_ssd/internal/handler/lobby.go](../../../card_ssd/internal/handler/lobby.go) `apiLogin`：
     - 接收 `{ code, nickname, avatarUrl }`，先 `wxauth.Code2Session(code)`；失败时回退读 `r.Header.Get("X-WX-OPENID")`；都为空返回 `400 登录失败`
     - 解析得 `openid` 后调 `storage.UpsertUser` 并在 `nickname/avatar` 为空时用 `storage.GetUser` 回填，再走原有 `session.Issue` + `lobby.FindActiveRoomByOpenid` 链路；响应体新增 `openid` 字段
   - 修改 [card_ssd/internal/handler/login.go](../../../card_ssd/internal/handler/login.go)（或对应 `HandleLogin`）：WS LOGIN 帧未携带昵称时也走 `storage.GetUser` 回填，与 HTTP 口径一致
   - _需求：1.2、1.3、3.1、3.2、3.3_

- [ ] 4. 客户端改造为 `wx.login` 取真实 openid
   - 修改 [js/main.js](../../../js/main.js) `initUser`：若 `wx.login` 存在则不再生成本地 `guest_xxxx`，把 `code` 暂存到 `databus.user._loginCode`；若不在小游戏环境则保留旧降级逻辑
   - 修改 [js/scenes/lobby_scene.js](../../../js/scenes/lobby_scene.js) `_httpLogin`：请求体由 `{openid,...}` 改为 `{code, nickname, avatarUrl}`；成功后把响应 `openid` 写入 `wx.setStorageSync('openid', openid)` 与 `databus.user.openid`，再触发原有 `activeRoom` 处理；失败 Toast「登录失败，点击重试」
   - 检查 [js/net/socket_client.js](../../../js/net/socket_client.js) 与所有引用 `databus.user.openid` 的发包路径，确保拿到真实 openid 后再发 `LOGIN` / `JOIN_ROOM` / `GET /api/lobby/active-room`
   - _需求：1.1、1.3、1.4_

- [ ] 5. 房间快照持久化（`rooms` / `room_players`）写入侧
   - 新建 `card_ssd/internal/storage/room_repo.go`：`SaveRoomSnapshot(roomDTO, players []playerDTO) error`（事务内 UPSERT `rooms` + `DELETE+INSERT room_players`）、`MarkRoomDestroyed(roomID)`、`LoadAliveRooms() ([]roomDTO, map[roomID][]playerDTO, error)`
   - 在 [card_ssd/internal/room/room.go](../../../card_ssd/internal/room/room.go) / [manager.go](../../../card_ssd/internal/room/manager.go) 增加 `dirty bool` 字段及 `markDirty()`；在 `CreateRoom / JoinRoom / LeaveRoom / RemovePlayer / Settle / markAllOfflineIfNeeded / Touch / DestroyRoom / VoteDissolve / 阶段切换` 等关键改写处调用 `markDirty()`，`DestroyRoom` 立即同步 `MarkRoomDestroyed`
   - 新建 `card_ssd/internal/room/persister.go`：包级 1 秒节流 goroutine 扫描所有 dirty 房间，将 `Room` 转换为 DTO 调 `storage.SaveRoomSnapshot`；进程退出前提供 `FlushAll()` 同步刷盘，由 `main.go` 在 `storage.Close()` 之前调用
   - _需求：5.1、5.2、5.3、7.1、7.4_

- [ ] 6. 启动时房间恢复
   - 在 [card_ssd/internal/room/manager.go](../../../card_ssd/internal/room/manager.go) 增加 `LoadFromStorage()`：调用 `storage.LoadAliveRooms` 把 `destroyed=0` 的房间及 `room_players` 还原到内存 `rooms` map；`hand/lanes` JSON 反序列化；所有玩家 `Offline=true`，`AllOfflineSince` 取库值或当前时间；玩家 `Conn` 留空等待重连
   - 在 [card_ssd/main.go](../../../card_ssd/main.go) `storage.Init` 成功后、巡检 / HTTP 监听启动之前调用 `room.Mgr.LoadFromStorage()`
   - 验证恢复后 `lobby.FindActiveRoomByOpenid` 能命中内存（不强制走 DB）
   - _需求：5.4、5.5_

- [ ] 7. 对局结算结果落库（`match_results`）
   - 新建 `card_ssd/internal/storage/match_repo.go`：`SaveMatchResult(roomID string, round int, withMa bool, totalRounds int, payload json.RawMessage)`，失败仅 WARN
   - 在 [card_ssd/internal/handler/settle.go](../../../card_ssd/internal/handler/settle.go)（或承载 `DoSettle` 的文件）于设置 `r.LastSettle` 之后异步调用，`json.Marshal(r.LastSettle)` 作 payload；不阻塞广播
   - _需求：6.1、6.2、6.3、7.1_

- [ ] 8. 单元测试与回归
   - 新增 `card_ssd/internal/storage/storage_test.go`：当未设 `MYSQL_PWD` 时 `Init` 不报错且 `Enabled()=false`，所有 `Save*/Load*` 返回 nil
   - 在 `card_ssd/internal/room/sweeper_test.go` 等已有测试中验证未连 DB 时全部通过（兜底 nil 路径）
   - PowerShell 执行 `cd card_ssd; go build ./...; go test ./...` 全部通过
   - _需求：7.2、7.3_

- [ ] 9. 文档同步
   - 修改 [card_ssd/README.md](../../../card_ssd/README.md)：新增「MySQL 持久化」章节列 5 张表 DDL 摘要、`MYSQL_PWD/MYSQL_DB/WX_APPID/WX_SECRET` 环境变量、降级策略；新增「微信登录链路（方案 B）」描述 `wx.login → /api/login → code2session`
   - 修改根目录 [README.md](../../../README.md) 与 [功能.md](../../../功能.md) 中「主页 HTTP 化」「断线重连」相关段落，把客户端 `openid` 来源改为「服务端解 code 返回」并补一句进程重启后房间会从 MySQL 恢复
   - _需求：7.5_
