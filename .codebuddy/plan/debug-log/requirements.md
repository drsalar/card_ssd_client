# 前端调试日志面板 需求文档

## 引言

为方便开发期间在微信小游戏真机/开发者工具中观察对局执行过程、定位卡顿与协议问题，前端引入一个统一的「日志面板」。该面板由画布右上角的浮动开关入口触发，弹出时叠加显示在所有场景之上，集中展示运行期 `console` 日志与网络（HTTP / WebSocket）日志，并提供过滤、清空、复制、暂停、调试发包等操作。该模块仅作为开发调试工具存在，需可一键关闭，且不得影响正常游戏渲染与触摸交互。

## 需求

### 需求 1 — 右上角浮动开关入口

**用户故事：** 作为开发者，我希望在画布右上角看到一个常驻的「LOG」按钮，以便随时唤出/收起日志面板。

#### 验收标准
1. WHEN 应用启动 THEN 系统 SHALL 在画布右上角（不遮挡退出按钮）渲染一个直径约 32px 的半透明圆形按钮，按钮文案为「LOG」。
2. WHEN 用户点击该按钮 THEN 系统 SHALL 切换日志面板的显示状态（关 ↔ 开），并通过按钮高亮（描边或底色）反映当前状态。
3. WHEN 有新日志达到 ERROR 级别且面板处于关闭态 THEN 系统 SHALL 在按钮上叠加一个红色小圆点作为未读提示，点开面板后清除。
4. WHEN 用户在房间场景且界面已有「退出」按钮 THEN 系统 SHALL 保证 LOG 按钮位置不与退出按钮重叠（位于退出按钮左侧 8px 间距处）。
5. IF 全局开关 `GameGlobal.DEBUG_LOG === false` THEN 系统 SHALL 不渲染该按钮也不收集日志，作为线上发布时的关闭手段。

### 需求 2 — 控制台日志拦截与缓存

**用户故事：** 作为开发者，我希望面板能完整展示 `console.log/info/warn/error/debug` 的输出，以便不开微信开发者工具也能查看实时日志。

#### 验收标准
1. WHEN 应用启动 THEN 系统 SHALL 替换 `console.log/info/warn/error/debug` 为带拦截的版本，截获参数后再调用原始实现，确保原 IDE Console 不受影响。
2. WHEN 拦截到一条日志 THEN 系统 SHALL 以 `{ time, level, source: 'console', text }` 格式存入环形缓冲区。
3. WHEN 缓冲区条目数超过上限（默认 500 条） THEN 系统 SHALL 自动丢弃最早的条目，保持总量不超过上限。
4. WHEN 日志参数为对象/数组 THEN 系统 SHALL 通过 `JSON.stringify` 安全序列化（捕获循环引用并降级为 `[Object]`），最长截断 2000 字符并以 `…` 结尾。
5. IF 拦截过程自身抛出异常 THEN 系统 SHALL 静默 catch 并继续调用原始 console，避免污染游戏主流程。

### 需求 3 — HTTP 网络日志

**用户故事：** 作为开发者，我希望看到大厅 HTTP 请求的方法、URL、请求体、响应状态、耗时与响应体，以便排查登录/查询接口问题。

#### 验收标准
1. WHEN [http_client.js](e:\wxgame\card2\js\net\http_client.js) 发起请求 THEN 系统 SHALL 在请求开始时写入一条 `source: 'http'`、`phase: 'req'` 的日志，包含 method、url、data 摘要。
2. WHEN HTTP 请求完成 THEN 系统 SHALL 追加一条 `phase: 'resp'` 的日志，包含 status、duration(ms)、响应 body 摘要（截断 1000 字符）。
3. WHEN HTTP 请求失败（网络错误或非 2xx） THEN 系统 SHALL 以 ERROR 级别写日志并保留错误信息字段。
4. WHEN 请求或响应 body 中包含敏感字段（当前仅约定 `token`） THEN 系统 SHALL 在日志中以 `***` 屏蔽该字段值。

### 需求 4 — WebSocket 网络日志

**用户故事：** 作为开发者，我希望看到 WebSocket 的连接事件与每条收发协议消息，以便排查对局推进/重连问题。

#### 验收标准
1. WHEN [socket_client.js](e:\wxgame\card2\js\net\socket_client.js) 触发 `connect/open/close/error/reconnect` THEN 系统 SHALL 写入一条 `source: 'ws'`、`phase: 'conn'` 的日志，包含事件名与上下文（url、重连次数等）。
2. WHEN 客户端发送 WebSocket 消息 THEN 系统 SHALL 写入 `phase: 'send'` 的日志，包含 type、reqId、payload 摘要。
3. WHEN 客户端收到 WebSocket 消息 THEN 系统 SHALL 写入 `phase: 'recv'` 的日志，包含 type、reqId、data 摘要；payload 序列化超过 2000 字符时自动截断。
4. WHEN 收到 `ERROR` 协议消息或 `RECONNECT_SNAPSHOT` 等关键事件 THEN 系统 SHALL 以 WARN/INFO 级别突出显示。

### 需求 5 — 日志面板视图与交互

**用户故事：** 作为开发者，我希望在面板内能滚动浏览、过滤分类、暂停刷新与清空缓冲区，便于聚焦目标日志。

#### 验收标准
1. WHEN 面板打开 THEN 系统 SHALL 在画布上叠加一个占据屏幕宽度 92%、高度 70% 的暗色半透明面板（顶部留出按钮区，底部留出工具区）。
2. WHEN 面板渲染日志列表 THEN 系统 SHALL 按时间倒序或正序（默认正序，最新在底）展示最近 N 条，每条显示 `HH:mm:ss.sss [level] [source] text`，不同 source/level 使用不同颜色。
3. WHEN 用户点击顶部分类标签（ALL / CONSOLE / HTTP / WS / ERROR） THEN 系统 SHALL 仅渲染匹配条目，并保留滚动位置。
4. WHEN 用户点击「暂停」按钮 THEN 系统 SHALL 停止追加新条目到视图（缓冲区仍写入），再次点击恢复并自动滚到底部。
5. WHEN 用户点击「清空」按钮 THEN 系统 SHALL 清空缓冲区并刷新视图。
6. WHEN 用户在面板上下滑动 THEN 系统 SHALL 平滑滚动列表；松手后若处于底部附近则保持自动跟随新日志，否则停留在当前位置。
7. WHEN 用户点击单条日志 THEN 系统 SHALL 弹出该条日志的完整详情视图（不截断），并提供「复制」按钮调用 `wx.setClipboardData` 写入剪贴板。
8. WHEN 面板打开 THEN 系统 SHALL 拦截面板区域的触摸事件，避免穿透触发底部场景的按钮/手牌操作；面板外区域的触摸不受影响。

### 需求 6 — 调试发包能力

**用户故事：** 作为开发者，我希望能在面板上手工发送一条 WebSocket 协议或观察当前会话信息，便于复现/绕过问题。

#### 验收标准
1. WHEN 面板底部工具区被启用 THEN 系统 SHALL 提供一个「发包」入口（按钮），点击后弹出输入框，输入 `type` 与 JSON 格式 `data` 后调用 `GameGlobal.socket.send(type, data)`。
2. WHEN 输入的 JSON 解析失败 THEN 系统 SHALL 提示「JSON 格式错误」并不发送。
3. WHEN 面板底部「会话信息」按钮被点击 THEN 系统 SHALL 弹出当前 `databus.user / databus.scene / databus.room.id / databus.room.phase / socket.connected` 的摘要快照。
4. IF Socket 未连接时点击「发包」 THEN 系统 SHALL 提示「Socket 未连接」并禁用发送。

### 需求 7 — 性能与稳定性

**用户故事：** 作为开发者，我希望日志面板不影响游戏帧率与触摸操作，且在大日志量下也不卡顿。

#### 验收标准
1. WHEN 面板未打开 THEN 系统 SHALL 不在主循环里执行额外的渲染，仅维护缓冲区；缓冲区写入耗时 < 0.5ms。
2. WHEN 日志缓冲区接近上限 THEN 系统 SHALL 通过「头部丢弃」策略保持上限，单次裁剪不阻塞主循环。
3. WHEN 面板打开 THEN 系统 SHALL 仅渲染当前可见行（虚拟列表），保证 60+ 条日志时仍维持稳定 FPS。
4. IF 日志面板内部代码抛错 THEN 系统 SHALL 通过 `try/catch` 隔离，不影响 `SceneManager.update/render` 与触摸分发。

### 需求 8 — 文档与开关同步

**用户故事：** 作为后续维护者，我希望在 README/功能文档里看到该调试模块的说明与开关方法。

#### 验收标准
1. WHEN 完成开发 THEN 系统 SHALL 在 [README.md](e:\wxgame\card2\README.md) 与 [功能.md](e:\wxgame\card2\功能.md) 中新增「调试日志面板」章节，描述入口、功能与关闭方式（`GameGlobal.DEBUG_LOG = false`）。
2. WHEN 开发者需要在发布版本关闭 THEN 系统 SHALL 在 [main.js](e:\wxgame\card2\js\main.js) 顶部统一读取 `GameGlobal.DEBUG_LOG`，默认值 `true`，便于一行修改即全量关闭。
