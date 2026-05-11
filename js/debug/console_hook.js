// console 拦截器
// 替换 console.log/info/warn/error/debug，将参数写入 LogStore，再调用原始实现。
// 全程 try/catch 隔离，确保游戏主流程不受影响。

import { getLogStore, LOG_LEVEL } from './log_store';

let installed = false;
let originals = null;

// 安装 hook：幂等
export function installConsoleHook() {
  if (installed) return;
  if (typeof console === 'undefined') return;
  const store = getLogStore();
  // 备份原始函数
  originals = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };
  const wrap = (level, original) => {
    return function () {
      // 先写日志（隔离失败）
      try {
        const args = new Array(arguments.length);
        for (let i = 0; i < arguments.length; i++) args[i] = arguments[i];
        store.writeConsole(level, args);
      } catch (e) { /* 静默 */ }
      // 再调用原始 console，保证开发者工具仍可见
      try {
        if (typeof original === 'function') {
          return original.apply(console, arguments);
        }
      } catch (e) { /* 静默 */ }
    };
  };
  console.log = wrap(LOG_LEVEL.INFO, originals.log);
  console.info = wrap(LOG_LEVEL.INFO, originals.info || originals.log);
  console.warn = wrap(LOG_LEVEL.WARN, originals.warn || originals.log);
  console.error = wrap(LOG_LEVEL.ERROR, originals.error || originals.log);
  console.debug = wrap(LOG_LEVEL.DEBUG, originals.debug || originals.log);
  installed = true;
}

// 卸载（一般无需调用，留作单元测试或动态关闭使用）
export function uninstallConsoleHook() {
  if (!installed || !originals) return;
  console.log = originals.log;
  console.info = originals.info;
  console.warn = originals.warn;
  console.error = originals.error;
  console.debug = originals.debug;
  installed = false;
}
