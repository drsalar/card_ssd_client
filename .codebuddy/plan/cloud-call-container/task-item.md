# 实施计划

- [ ] 1. 在 `main.js` 中集中配置云托管环境
   - 在 `GameGlobal.CLOUD_ENV` / `GameGlobal.CLOUD_SERVICE` 未注入时，分别赋值为 `'prod-d1gy3h2lh5a169861'` 与 `'golang-8gye'`
   - 保留 `GameGlobal.HTTP_BASE` / `GameGlobal.SOCKET_URL` 作为浏览器/降级兜底
   - _需求：3.1、3.2、3.3_

- [ ] 2. 新增 `js/net/cloud.js` 云能力初始化封装
   - 暴露 `ensureCloudInit()`，幂等调用 `wx.cloud.init({ env: GameGlobal.CLOUD_ENV })`
   - 暴露 `isCloudHttpAvailable()` / `isCloudWsAvailable()` 判定 `wx.cloud.callContainer` / `wx.cloud.connectContainer` 是否可用
   - _需求：1.1、2.1、2.3_

- [ ] 3. 改造 `js/net/http_client.js` 走 `callContainer`
   - 优先使用 `wx.cloud.callContainer` 发起请求，`config.env` 与 `header['X-WX-SERVICE']` 从全局读取
   - GET 请求保留 query 拼接逻辑；2xx 解析 `res.data`，非 2xx / fail 抛 `Error`
   - 不可用时降级到原 `wx.request` / `fetch` 链路
   - _需求：1.1、1.2、1.3、1.4、1.5、1.6_

- [ ] 4. 在 http_client 中接入云通道调试日志
   - `req` / `resp` / `error` 日志的 `url` 字段统一使用 `cloud://{service}{path}[?query]` 形式
   - 失败/非 2xx 写入 `error` 级别，保留 duration、status、data 字段
   - _需求：4.1、4.2_

- [ ] 5. 改造 `js/net/socket_client.js` 走 `connectContainer`
   - `connect()` 在云通道可用时调用 `wx.cloud.connectContainer({ config, service, path: '/ws' })`，并复用现有 `onOpen/onMessage/onClose/onError`
   - 云通道不可用时降级到 `wx.connectSocket(url)` / 浏览器 `WebSocket(url)`
   - 保留 pending 队列、自动登录、对局场景 5×1.5s 自动重连逻辑
   - _需求：2.1、2.2、2.3、2.4_

- [ ] 6. 在 socket_client 中调整调试日志 URL 形式
   - 云通道分支下 `_logWs` 的 `url` 字段使用 `cloud://{service}/ws`
   - 重连日志保留 `level: 'warn'` 以及 retry 次数
   - _需求：4.3、2.4_

- [ ] 7. 调整业务层 socket 调用入参
   - `lobby_scene.js`、`main.js` 中的 `sock.connect(...)` 不再依赖 `GameGlobal.SOCKET_URL`，改为 `sock.connect()` 由内部决策
   - 保持其余业务流程不变（创建房间、加入房间、重新进入、wx.onShow 重连）
   - _需求：3.4、5.2、5.3_

- [ ] 8. 真机/工具回归验证关键流程
   - 验证大厅 `POST /api/login`、`GET /api/lobby/active-room` 通过 callContainer 正常返回并驱动"重新进入"按钮
   - 验证创建/加入/重新进入房间下 WebSocket 正常连通、`LOGIN_OK` 后自动 `JOIN_ROOM`
   - 验证断线重连后 `RECONNECT_SNAPSHOT` 还原、头像离线蒙层显示正确
   - _需求：5.1、5.2、5.3_

- [ ] 9. 更新文档说明
   - 在 `README.md` 中补充云托管通道用法、`CLOUD_ENV` / `CLOUD_SERVICE` 配置说明、降级策略
   - 在 `功能.md` 的网络分层章节中替换"直连域名"描述为"云托管 callContainer / connectContainer"
   - _需求：5.4_
