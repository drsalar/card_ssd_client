# 需求文档

## 引言

当前游戏在主页（大厅）和对局（房间/对局/结算）中显示的玩家头像和昵称，仅由本地随机生成的兜底文案（如「玩家xxxx」）和空头像构成，无法体现真实的玩家身份。需要接入微信小游戏官方能力，将本地用户的真实微信头像（`avatarUrl`）和昵称（`nickName`）作为身份信息展示，并把这份信息上报到服务端，使房间内所有玩家在主页与对局过程中都能看到对手真实的微信头像和昵称。

涉及的端：
- 客户端（小游戏）：`js/main.js`（启动初始化）、`js/scenes/lobby_scene.js`（大厅渲染）、`js/scenes/room_scene.js`（房间渲染）、`js/scenes/play_phase.js`（对局渲染）、`js/scenes/settle_phase.js`（结算渲染）、`js/ui/PlayerSeat.js`、`js/ui/Avatar.js`。
- 服务端（Go，`card_ssd/`）：`/api/login` 与 `LOGIN` WS 帧已经接收 `nickname` / `avatarUrl` 并广播在 `ROOM_STATE.players` 中，本次需求**不修改**服务端协议，仅复用现有字段。

兼容范围：
- 微信小游戏环境调用 `wx.getUserInfo` / `wx.getUserProfile`（按基础库可用性自动选择）；非微信环境（开发者工具未授权 / 浏览器联调）保留原「玩家xxxx」+ 空头像 的兜底逻辑。

## 需求

### 需求 1：本地获取微信头像与昵称

**用户故事：** 作为一名玩家，我希望进入游戏后，我的头像和昵称自动取自我的微信资料，以便其他玩家能够辨认我。

#### 验收标准

1. WHEN 客户端启动并执行 `Main.initUser()` THEN 系统 SHALL 先生成/读取本地 `openid`（保持现有逻辑），随后尝试通过微信小游戏接口异步获取微信头像与昵称。
2. WHEN 当前微信基础库支持 `wx.getUserInfo({ withCredentials: false, lang: 'zh_CN' })` 且能直接返回 `userInfo` THEN 系统 SHALL 将返回的 `nickName` 写入 `databus.user.nickname`、`avatarUrl` 写入 `databus.user.avatarUrl`，并持久化到本地 storage（key：`wx_user_info`）。
3. IF `wx.getUserInfo` 不可用或返回失败 THEN 系统 SHALL 回退使用本地兜底（`玩家 + openid 后4位`，头像为空字符串），不阻塞主流程。
4. WHEN 本次启动获取失败但本地 storage 中存在上次成功保存的 `wx_user_info` THEN 系统 SHALL 优先使用 storage 中缓存的昵称与头像，避免显示「玩家xxxx」。
5. WHEN 微信返回的 `avatarUrl` 是 HTTPS 微信 CDN 链接（`thirdwx.qlogo.cn` / `wx.qlogo.cn`）THEN `Avatar` 组件 SHALL 能正常加载并以圆形渲染；若加载失败 SHALL 回退为昵称首字符占位（保持现有 fallback 行为）。

### 需求 2：将微信资料上报至服务端并随房间状态广播

**用户故事：** 作为一名玩家，我希望我的微信头像/昵称能同步给同房间的其他玩家，以便他们在房间和对局中看到我的真实身份。

#### 验收标准

1. WHEN 大厅场景 `LobbyScene._httpLogin()` 调用 `/api/login` THEN 系统 SHALL 在请求体中携带最新的 `databus.user.nickname` 与 `avatarUrl`（复用现有协议字段，不新增字段）。
2. WHEN 客户端建立 WebSocket 后发送 `LOGIN` 帧 THEN 系统 SHALL 在 `LOGIN.data` 中携带最新的 `nickname` 与 `avatarUrl`（与现有 `socket_client.js` 行为一致，复用现有 `MSG.LOGIN`）。
3. IF 用户在大厅展示完成后才异步拿到微信资料 THEN 系统 SHALL 在拿到资料后再次刷新 `databus.user`，并触发一次 `_httpLogin()`，让服务端 session 更新到最新昵称/头像。
4. WHEN 服务端收到带 `nickname`/`avatarUrl` 的登录信息 THEN 系统 SHALL（由现有逻辑）覆盖 `Session.Nickname/AvatarUrl`，并在玩家进入房间或调用 `Room.UpsertPlayer` 时同步到 `Player.Nickname/AvatarUrl`，最终通过 `ROOM_STATE.players[*].nickname/avatarUrl` 广播给同房间所有人（无需修改协议）。

### 需求 3：主页（大厅）显示当前用户的微信头像

**用户故事：** 作为一名玩家，我希望在主页顶部能看到自己的微信头像和昵称，以便确认当前账号身份。

#### 验收标准

1. WHEN 进入大厅场景 `LobbyScene.render` THEN 系统 SHALL 在顶部居中区域，于现有「玩家昵称」文字左侧绘制一个圆形头像（直径约 36px），头像与昵称水平居中对齐成一组。
2. WHEN `databus.user.avatarUrl` 为空或加载失败 THEN 系统 SHALL 显示由昵称首字符构成的兜底圆形（复用 `Avatar` 组件已有兜底）。
3. WHEN 用户的微信资料异步更新完成 THEN 大厅 SHALL 在下一帧自动重绘为新的头像与昵称（复用现有按帧渲染逻辑，无需手动刷新）。

### 需求 4：对局中（房间/对局/结算）显示所有玩家的微信头像与昵称

**用户故事：** 作为一名玩家，我希望在房间等待、出牌过程和结算面板中看到每位对手的微信头像与昵称，以便区分对手。

#### 验收标准

1. WHEN 房间场景 `RoomScene` / 对局阶段 `PlayPhase` / 结算阶段 `SettlePhase` 调用 `PlayerSeat.render(ctx, player, ...)` THEN 系统 SHALL 使用 `player.avatarUrl` 渲染圆形头像、`player.nickname` 渲染昵称（保持现有渲染流程，本需求不重构 UI）。
2. WHEN 同房间内某位玩家的 `nickname/avatarUrl` 在 `ROOM_STATE` 中发生更新 THEN 客户端 SHALL 在下一次渲染时按新值显示，且 `Avatar` 组件 SHALL 通过 `setUrl` 检测 URL 变化并重新加载图片（复用现有逻辑）。
3. WHEN 玩家是电脑（`isBot=true`）THEN 系统 SHALL 保持现有「电脑X」昵称与无头像兜底行为，不受本需求影响。
4. WHEN 结算面板 `settle_phase.js` 渲染玩家行 THEN 系统 SHALL 在原昵称位置左侧增绘对应玩家的圆形头像（直径与现有行高匹配），保持原有积分排版不破坏。

### 需求 5：隐私与异常兜底

**用户故事：** 作为一名玩家，我不希望因授权弹窗或获取失败而无法进入游戏。

#### 验收标准

1. IF 微信基础库要求必须使用 `wx.getUserProfile`（需用户主动触发） THEN 系统 SHALL 不强制弹授权框，直接走 `wx.getUserInfo({ withCredentials: false })`；若仍拿不到，则使用兜底昵称/头像，不阻塞游戏流程。
2. WHEN 用户拒绝授权或返回的 `nickName` 为空 THEN 系统 SHALL 沿用「玩家+openid 后4位」作为本地昵称，头像保持空（兜底首字符）。
3. WHEN 任何获取流程抛出异常 THEN 系统 SHALL 通过 `try/catch` 静默捕获并继续执行，不影响主循环与网络登录。

### 需求 6：文档与测试

**用户故事：** 作为一名维护者，我希望能在文档中看到该功能的接入说明，以便后续排查与扩展。

#### 验收标准

1. WHEN 完成本次功能开发 THEN 系统 SHALL 在根目录 `README.md` 与 `card_ssd/README.md` 中补充关于「主页与对局显示微信头像/昵称」的简要说明（包括字段流向：客户端 → `/api/login`/`LOGIN` → `ROOM_STATE`）。
2. WHEN 完成本次功能开发 THEN 系统 SHALL 在根目录 `功能.md` 中追加一条对应的功能项说明（保持与现有列表风格一致）。
3. WHEN 完成本次功能开发 THEN 系统 SHALL 通过手工冒烟：开发者工具内 ① 主页头像/昵称为微信资料；② 创建/加入房间后房间内每位真实玩家头像/昵称正确；③ 对局中（出牌阶段、结算阶段）头像/昵称稳定显示且不闪烁；④ 拒绝授权时回退「玩家xxxx」无报错。
