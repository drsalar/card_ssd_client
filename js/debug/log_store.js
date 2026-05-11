// 日志缓冲区单例
// 职责：
//   1. 维护环形日志缓冲（默认 500 条上限，超限头部丢弃）
//   2. 暴露写入、订阅、过滤、清空 API；
//   3. 维护 ERROR 未读计数，提供给入口按钮显示红点；
//   4. 写入逻辑被 try/catch 隔离，绝不影响业务主流程。

import { safeStringify, maskSensitive, joinArgs } from './util';

const DEFAULT_MAX = 500;
// 日志级别枚举
export const LOG_LEVEL = {
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
};
// 日志来源枚举
export const LOG_SOURCE = {
  CONSOLE: 'console',
  HTTP: 'http',
  WS: 'ws',
};

let instance = null;

class LogStore {
  constructor() {
    this.max = DEFAULT_MAX;
    this.buffer = [];        // 日志条目数组
    this.seq = 0;            // 自增 ID，便于稳定 key
    this.listeners = [];     // 订阅函数列表
    this.unreadError = 0;    // 关闭面板时新增的 ERROR 数
  }

  // 设置上限
  setMax(n) {
    if (typeof n === 'number' && n > 10) this.max = n;
  }

  // 写入一条日志：item = { source, level, text, ...扩展字段 }
  write(item) {
    try {
      const entry = Object.assign({}, item, {
        id: ++this.seq,
        time: Date.now(),
        level: (item && item.level) || LOG_LEVEL.INFO,
        source: (item && item.source) || LOG_SOURCE.CONSOLE,
        text: typeof item.text === 'string' ? item.text : safeStringify(item.text, 2000),
      });
      this.buffer.push(entry);
      // 头部丢弃：保持上限
      if (this.buffer.length > this.max) {
        const drop = this.buffer.length - this.max;
        this.buffer.splice(0, drop);
      }
      if (entry.level === LOG_LEVEL.ERROR) this.unreadError++;
      // 通知订阅者
      for (let i = 0; i < this.listeners.length; i++) {
        try { this.listeners[i](entry); } catch (e) { /* ignore */ }
      }
    } catch (e) {
      // 静默：日志系统自身不抛错
    }
  }

  // 便捷写入：console 拦截入口
  writeConsole(level, args) {
    this.write({
      source: LOG_SOURCE.CONSOLE,
      level: level,
      text: joinArgs(args, 2000),
    });
  }

  // 便捷写入：HTTP 请求/响应
  writeHttp(phase, payload) {
    // payload: { method, url, status, duration, data, error, level }
    const safe = maskSensitive(payload && payload.data);
    const desc = phase === 'req'
      ? `${payload.method || 'GET'} ${payload.url || ''} ` + safeStringify(safe, 800)
      : phase === 'resp'
        ? `${payload.method || 'GET'} ${payload.url || ''} -> ${payload.status} (${payload.duration}ms) ` + safeStringify(safe, 800)
        : `${payload.method || 'GET'} ${payload.url || ''} ERROR ` + safeStringify(payload.error, 400);
    this.write({
      source: LOG_SOURCE.HTTP,
      phase: phase,
      level: payload && payload.level ? payload.level : (phase === 'error' ? LOG_LEVEL.ERROR : LOG_LEVEL.INFO),
      text: desc,
      meta: payload,
    });
  }

  // 便捷写入：WS 收发与连接事件
  writeWs(phase, payload) {
    // payload: { event, type, reqId, data, level }
    let desc = '';
    if (phase === 'conn') {
      desc = `[${payload.event || 'event'}] ` + safeStringify({ url: payload.url, retry: payload.retry }, 400);
    } else if (phase === 'send') {
      desc = `→ ${payload.type || ''} #${payload.reqId || 0} ` + safeStringify(maskSensitive(payload.data), 1200);
    } else if (phase === 'recv') {
      desc = `← ${payload.type || ''} #${payload.reqId || 0} ` + safeStringify(payload.data, 1200);
    } else {
      desc = safeStringify(payload, 1200);
    }
    this.write({
      source: LOG_SOURCE.WS,
      phase: phase,
      level: payload && payload.level ? payload.level : LOG_LEVEL.INFO,
      text: desc,
      meta: payload,
    });
  }

  // 订阅：返回取消函数
  subscribe(fn) {
    if (typeof fn !== 'function') return () => {};
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((f) => f !== fn);
    };
  }

  // 获取过滤后的快照
  query(filter) {
    if (!filter || filter === 'ALL') return this.buffer.slice();
    const f = String(filter).toUpperCase();
    return this.buffer.filter((e) => {
      if (f === 'ERROR') return e.level === LOG_LEVEL.ERROR;
      if (f === 'CONSOLE') return e.source === LOG_SOURCE.CONSOLE;
      if (f === 'HTTP') return e.source === LOG_SOURCE.HTTP;
      if (f === 'WS') return e.source === LOG_SOURCE.WS;
      return true;
    });
  }

  // 清空缓冲
  clear() {
    this.buffer = [];
    this.unreadError = 0;
    for (let i = 0; i < this.listeners.length; i++) {
      try { this.listeners[i](null, 'cleared'); } catch (e) { /* ignore */ }
    }
  }

  // 重置 ERROR 未读
  clearUnread() {
    this.unreadError = 0;
  }
}

// 获取单例
export function getLogStore() {
  if (!instance) instance = new LogStore();
  return instance;
}

export default getLogStore;
