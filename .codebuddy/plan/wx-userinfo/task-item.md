# 实施计划

- [ ] 1. 新增微信用户资料获取工具模块 `js/utils/wx_user.js`
   - 封装 `loadWxUserInfo()`：依次尝试 `wx.getStorageSync('wx_user_info')` 缓存 → `wx.getUserInfo({ withCredentials: false, lang: 'zh_CN' })`
   - 提供 `saveWxUserInfo({ nickname, avatarUrl })` 持久化到本地 storage
   - 所有调用使用 `try/catch` 静默兜底，返回 Promise，不抛异常
   - _需求：1.1、1.2、1.3、1.4、5.1、5.2、5.3_

- [ ] 2. 改造 `js/main.js` 的 `initUser()` 流程
   - 保持现有 openid 生成逻辑不变
   - 启动时先用 storage 缓存（若有）填充 `databus.user.nickname/avatarUrl`，否则用「玩家+openid 后4位」兜底
   - 异步调用 `loadWxUserInfo()`；成功后写回 `databus.user` 并通过 `eventBus.emit('user_info_updated')` 通知场景刷新
   - 拿到新资料后调用 `saveWxUserInfo` 持久化
   - _需求：1.1、1.2、1.3、1.4、2.3_

- [ ] 3. 大厅场景接入用户资料更新事件并显示头像
   - 修改 `js/scenes/lobby_scene.js`：构造一个本地 `Avatar` 实例 `this.selfAvatar`，在 `render` 中绘制于昵称文字左侧，组成水平居中的「头像 + 昵称」组合（直径 36px）
   - 监听 `user_info_updated` 事件：更新 `selfAvatar.setUrl(user.avatarUrl)`，并重新调用 `_httpLogin()` 上报最新资料到服务端
   - `_httpLogin()` 已携带 `nickname/avatarUrl`，确保使用最新值
   - _需求：2.1、2.3、3.1、3.2、3.3_

- [ ] 4. WebSocket 登录帧上报最新资料
   - 检查 `js/net/socket_client.js` 中 `LOGIN` 帧的 `nickname/avatarUrl` 取值，确保每次发送时从 `databus.user` 实时读取（已有逻辑，验证即可）
   - 若 `user_info_updated` 触发时 socket 已连接，则补发一次 `LOGIN`（或直接依赖下次 `_httpLogin()` 同步 session，二选一即可，优先选最简方案）
   - _需求：2.2、2.3_

- [ ] 5. 结算面板补充行内头像渲染
   - 修改 `js/scenes/settle_phase.js` 中渲染玩家行的位置（参考第 483 行左右使用 `nickname` 的逻辑）
   - 在昵称文本左侧增绘对应玩家的 `Avatar`（复用 `PlayerSeat.getAvatar(player)` 缓存避免重复加载），直径与行高匹配
   - 不破坏既有积分排版与列对齐
   - _需求：4.1、4.4_

- [ ] 6. 验证房间/对局阶段头像与昵称显示
   - 阅读 `js/scenes/room_scene.js`、`js/scenes/play_phase.js`，确认其调用 `PlayerSeat.render` 时已传入完整 `player` 对象（含 `avatarUrl/nickname`）
   - 必要时补充：当 `ROOM_STATE` 推送新值时通过 `setUrl` 触发图片重载（`Avatar.setUrl` 已有 URL 变更检测，保持兼容）
   - 电脑玩家保持现有「电脑X」+ 无头像 兜底显示
   - _需求：4.1、4.2、4.3_

- [ ] 7. 更新文档
   - 在根目录 `README.md` 添加「微信头像/昵称显示」功能说明，描述字段流向：客户端 `wx.getUserInfo` → `databus.user` → `/api/login` & `LOGIN` 帧 → `ROOM_STATE.players[*]`
   - 在 `card_ssd/README.md` 的登录接口与 `ROOM_STATE` 段落补充「`nickname/avatarUrl` 由客户端从微信获取后透传」说明
   - 在根目录 `功能.md` 追加一条功能项
   - _需求：6.1、6.2_

- [ ] 8. 手工冒烟测试
   - 微信开发者工具中验证：① 主页头像与昵称为微信真实资料；② 进入房间后所有真实玩家显示真实头像/昵称；③ 出牌阶段与结算阶段头像稳定不闪烁；④ 拒绝授权 / 浏览器联调时回退「玩家xxxx」+ 兜底首字符圆形，无 console 报错
   - 验证服务端日志：`/api/login` 与 `LOGIN` 入参中 `nickname/avatarUrl` 正确，`ROOM_STATE` 广播包含正确字段
   - _需求：6.3_
