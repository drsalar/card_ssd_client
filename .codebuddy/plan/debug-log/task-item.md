# 实施计划

- [ ] 1. 搭建日志核心模块与全局开关
  - 在 [main.js](e:\wxgame\card2\js\main.js) 顶部初始化 `GameGlobal.DEBUG_LOG`（默认 `true`）作为全量开关
  - 新建 `js/debug/log_store.js`：实现 `LogStore` 单例，负责环形缓冲（默认 500 条上限、头部丢弃）、订阅通知、过滤、清空与未读 ERROR 计数
  - 提供 `safeStringify(value, maxLen)` 工具函数（在 `js/debug/util.js` 中），处理循环引用、长度截断与敏感字段（如 `token`）打码
  - _需求：2.2、2.3、2.4、3.4、7.2、8.2_

- [ ] 2. 实现 console 拦截器
  - 在 `js/debug/console_hook.js` 中包装 `console.log/info/warn/error/debug`，截获参数后写入 `LogStore`，再调用原始实现
  - 拦截过程使用 `try/catch` 隔离，确保异常不污染主流程
  - 在 [main.js](e:\wxgame\card2\js\main.js) 启动阶段（`DEBUG_LOG === true` 时）调用一次 `installConsoleHook()`
  - _需求：2.1、2.5、7.4_

- [ ] 3. 接入 HTTP 与 WebSocket 网络日志
  - 修改 [http_client.js](e:\wxgame\card2\js\net\http_client.js)：在请求开始前写 `req` 日志、完成时写 `resp`（含 status / duration）、错误时写 ERROR；对 `token` 字段打码
  - 修改 [socket_client.js](e:\wxgame\card2\js\net\socket_client.js)：在 `connect/open/close/error/reconnect` 事件、`send`、`onMessage` 出入口写日志；`ERROR`/`RECONNECT_SNAPSHOT` 升级为 WARN/INFO
  - 通过 `LogStore.write({source, phase, level, ...})` 统一写入；写入逻辑被 `try/catch` 包裹
  - _需求：3.1、3.2、3.3、3.4、4.1、4.2、4.3、4.4_

- [ ] 4. 实现右上角浮动开关入口
  - 新建 `js/debug/log_button.js`：渲染半透明圆形「LOG」按钮（直径 ~32px），位于画布右上角；与房间场景的「退出」按钮做 8px 间距避让
  - 监听 `LogStore` 未读 ERROR 数变化，关闭态时叠加红点；点击后切换面板显示状态并清零未读
  - 当 `GameGlobal.DEBUG_LOG === false` 时不渲染
  - 在主渲染循环（`SceneManager` 完成绘制后）追加按钮绘制；触摸分发优先于场景按钮
  - _需求：1.1、1.2、1.3、1.4、1.5、7.1、7.4_

- [ ] 5. 实现日志面板视图与列表渲染
  - 新建 `js/debug/log_panel.js`：在画布上叠加 92% 宽 × 70% 高的暗色半透明面板，包含顶部分类标签（ALL/CONSOLE/HTTP/WS/ERROR）、列表区、底部工具栏
  - 列表采用虚拟滚动（仅渲染可见行）；每条按 `HH:mm:ss.sss [level] [source] text` 格式显示，按 source/level 着色
  - 实现切换分类、暂停/恢复、清空缓冲区、平滑滑动与「贴底自动跟随」逻辑
  - 面板范围内的触摸事件被消费，避免穿透到底层场景
  - _需求：5.1、5.2、5.3、5.4、5.5、5.6、5.8、7.3、7.4_

- [ ] 6. 实现单条日志详情与剪贴板复制
  - 在 `log_panel.js` 中新增详情子视图：点击单条日志时弹出含完整文本的覆盖层
  - 提供「复制」按钮，调用 `wx.setClipboardData({ data })`，成功后 Toast 提示
  - 详情视图支持点击空白处或「关闭」返回列表
  - _需求：5.7_

- [ ] 7. 实现调试发包与会话信息工具
  - 在面板底部工具栏新增「发包」按钮：通过 `wx.showModal` + `wx.showActionSheet`/原生文本输入，读取 `type` 与 JSON `data`，校验 JSON 合法性后调用 `GameGlobal.socket.send(type, data)`
  - JSON 解析失败 / Socket 未连接时给出 Toast 提示并阻止发送
  - 新增「会话信息」按钮：弹出 `databus.user / databus.scene / databus.room.id / databus.room.phase / socket.connected` 的快照
  - _需求：6.1、6.2、6.3、6.4_

- [ ] 8. 集成到主流程并验证稳定性
  - 在 [main.js](e:\wxgame\card2\js\main.js) 中按顺序：读取 `DEBUG_LOG` → 安装 console hook → 实例化 `LogStore` → 在 `render()` 末尾绘制 `LogButton` 与 `LogPanel`，在触摸入口最先分发给二者
  - 确保面板未打开时仅维护缓冲区、不增加渲染开销；所有调试模块入口被 `try/catch` 包裹
  - 自测：覆盖大厅 HTTP、对局 WS 收发、ERROR 红点、暂停/清空、虚拟滚动、复制详情、发包与会话信息
  - _需求：1.5、7.1、7.3、7.4_

- [ ] 9. 同步文档
  - 在 [README.md](e:\wxgame\card2\README.md) 与 [功能.md](e:\wxgame\card2\功能.md) 中新增「调试日志面板」章节：入口位置、面板能力、`GameGlobal.DEBUG_LOG` 关闭方式
  - _需求：8.1、8.2_
