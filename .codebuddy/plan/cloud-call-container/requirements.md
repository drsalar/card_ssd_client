# 需求文档

## 引言

将前端访问后端服务的网络通道，从直连域名（`https://xxx.tcloudbase.com` + `wss://.../ws`）改造为微信云托管的 `wx.cloud.callContainer` / `wx.cloud.connectContainer` 调用方式，统一通过云环境 ID + 服务标识访问后端容器，绕开"request 合法域名/socket 合法域名"白名单限制，简化部署与发布流程，并保持现有业务（大厅 HTTP、对局 WebSocket、断线重连、调试日志）行为不变。

参考调用配置：

```js
wx.cloud.callContainer({
  config: { env: 'prod-d1gy3h2lh5a169861' },
  path: '/api/count',
  header: { 'X-WX-SERVICE': 'golang-8gye' },
  method: 'POST',
  data: { action: 'inc' }
})
```

## 需求

### 需求 1

**用户故事：** 作为开发者，我希望前端通过 `wx.cloud.callContainer` 访问后端 HTTP 接口，以便无需在小游戏后台逐个配置 request 合法域名也能在真机和体验版下正常联调。

#### 验收标准

1. WHEN 前端首次调用 HTTP 接口前 THEN 系统 SHALL 调用一次 `wx.cloud.init({ env })` 完成云能力初始化（仅初始化一次，重复调用做幂等保护）
2. WHEN 业务层调用 `httpClient.post(path, data)` 或 `httpClient.get(path, query)` THEN 系统 SHALL 通过 `wx.cloud.callContainer` 发起请求，`config.env`、`header['X-WX-SERVICE']` 由全局配置读取
3. WHEN 调用 `httpClient.get` 且传入 `query` 对象 THEN 系统 SHALL 将 query 拼接到 `path` 上（保留现有 `path?k=v` 行为）
4. WHEN 响应 `statusCode` 在 `200~299` 之间 THEN 系统 SHALL 以 `res.data` 解析为业务结果并 resolve
5. WHEN `statusCode` 不在 2xx 范围或调用 `fail` THEN 系统 SHALL 以 `Error('HTTP ' + status)` 或带 `errMsg` 的 Error reject
6. WHEN 当前运行环境不支持 `wx.cloud.callContainer`（如 PC 浏览器调试） THEN 系统 SHALL 自动降级为现有的 `wx.request` / `fetch` 链路，避免本地调试不可用

### 需求 2

**用户故事：** 作为开发者，我希望对局 WebSocket 通过 `wx.cloud.connectContainer` 建立连接，以便复用同一套云托管服务标识，无需配置 socket 合法域名。

#### 验收标准

1. WHEN 业务层调用 `socket.connect()` 时 THEN 系统 SHALL 优先使用 `wx.cloud.connectContainer({ config, service, path })` 建立 WebSocket，`service='golang-8gye'`、`path='/ws'`
2. WHEN `connectContainer` 返回的 socketTask 触发 `onOpen / onMessage / onClose / onError` THEN 系统 SHALL 沿用现有事件回调流程（自动登录、pending 队列、重连逻辑均保持不变）
3. WHEN 不存在 `wx.cloud.connectContainer` THEN 系统 SHALL 降级为原 `wx.connectSocket(url)` / 浏览器 `WebSocket(url)`，保证本地调试不被破坏
4. WHEN 进入对局场景且 socket 异常关闭 THEN 系统 SHALL 仍使用云托管通道执行 5 次/1.5 秒间隔的自动重连，重连日志写入 LogStore

### 需求 3

**用户故事：** 作为开发者，我希望云环境 ID 与服务名集中配置，以便切换 dev/prod 环境只改一处。

#### 验收标准

1. WHEN 应用启动时 THEN 系统 SHALL 在 `main.js` 中初始化 `GameGlobal.CLOUD_ENV = 'prod-d1gy3h2lh5a169861'` 与 `GameGlobal.CLOUD_SERVICE = 'golang-8gye'`
2. IF 外部已经预先注入 `GameGlobal.CLOUD_ENV` / `GameGlobal.CLOUD_SERVICE` THEN 系统 SHALL 不覆盖外部值
3. WHEN 不再使用直连域名 THEN 系统 SHALL 将原 `GameGlobal.HTTP_BASE` / `GameGlobal.SOCKET_URL` 仅保留为浏览器降级链路的兜底，不再作为小游戏环境的主路径
4. WHEN `lobby_scene.js` 等业务层调用 `sock.connect(...)` THEN 系统 SHALL 不再传入显式 URL（或传入空串），由 `socket_client` 自身选择云通道或降级 URL

### 需求 4

**用户故事：** 作为开发者，我希望调试日志面板里仍能完整看到云托管请求/响应，以便排查协议问题。

#### 验收标准

1. WHEN 通过 `callContainer` 发起请求 THEN 系统 SHALL 写入 `logStore.writeHttp('req', { method, url, data })`，其中 `url` 由 `service + path[?query]` 拼成易读字符串
2. WHEN 收到响应或 fail THEN 系统 SHALL 写入 `resp` / `error` 日志，含 `status / duration / data`，错误级别标记为 `error`
3. WHEN WebSocket 通过云通道连接/断开/收发消息 THEN 系统 SHALL 复用现有 `_logWs` 写入逻辑，`url` 字段使用 `cloud://service/path` 之类的可读形式

### 需求 5

**用户故事：** 作为开发者，我希望本次改造不破坏既有业务流程，以便回归成本最小。

#### 验收标准

1. WHEN 改造完成后 THEN 系统 SHALL 保证大厅 `POST /api/login`、`GET /api/lobby/active-room` 仍能正常返回并驱动"重新进入"按钮
2. WHEN 改造完成后 THEN 系统 SHALL 保证创建房间 / 加入房间 / 重新进入流程下 WebSocket 仍可正常连接、自动登录、收发协议
3. WHEN 改造完成后 THEN 系统 SHALL 保证断线重连、`RECONNECT_SNAPSHOT` 还原、头像离线蒙层等既有功能行为不变
4. WHEN 改造完成后 THEN 系统 SHALL 同步更新项目 `README.md` 与 [功能.md](./功能.md) 中网络相关章节，说明云托管通道使用方式与配置项
