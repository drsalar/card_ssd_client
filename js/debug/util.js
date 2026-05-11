// 调试日志公共工具：安全序列化、敏感字段打码、时间格式化
// 设计要点：
//   1. safeStringify 处理循环引用、超长截断；不抛出异常；
//   2. maskSensitive 浅克隆并屏蔽 token 字段值；
//   3. formatTime 输出 HH:mm:ss.sss 便于面板展示。

// 默认敏感字段列表（仅用于 HTTP/WS 日志的请求/响应快照展示）
const SENSITIVE_KEYS = ['token'];

// 屏蔽敏感字段：浅克隆，不修改原对象
export function maskSensitive(value) {
  if (!value || typeof value !== 'object') return value;
  // 数组直接返回（避免破坏顺序与索引）
  if (Array.isArray(value)) return value;
  const out = {};
  Object.keys(value).forEach((k) => {
    if (SENSITIVE_KEYS.indexOf(k) >= 0) {
      out[k] = '***';
    } else {
      out[k] = value[k];
    }
  });
  return out;
}

// 安全字符串化：处理循环引用、限制长度
export function safeStringify(value, maxLen) {
  const limit = typeof maxLen === 'number' && maxLen > 0 ? maxLen : 2000;
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'string') return truncate(value, limit);
  if (t === 'number' || t === 'boolean') return String(value);
  if (t === 'function') return '[Function]';
  // object：使用 replacer 处理循环引用
  let s;
  try {
    const seen = new WeakSet();
    s = JSON.stringify(value, (key, v) => {
      if (typeof v === 'object' && v !== null) {
        if (seen.has(v)) return '[Circular]';
        seen.add(v);
      }
      if (typeof v === 'function') return '[Function]';
      return v;
    });
    if (typeof s !== 'string') s = String(value);
  } catch (e) {
    try { s = String(value); } catch (e2) { s = '[Object]'; }
  }
  return truncate(s, limit);
}

// 截断字符串：超长追加 …
function truncate(s, limit) {
  if (typeof s !== 'string') return s;
  if (s.length <= limit) return s;
  return s.slice(0, limit) + '…';
}

// 拼接多个参数为单行字符串：用于 console hook
export function joinArgs(args, maxLen) {
  if (!args || !args.length) return '';
  const parts = [];
  for (let i = 0; i < args.length; i++) {
    parts.push(safeStringify(args[i], 1000));
  }
  return truncate(parts.join(' '), maxLen || 2000);
}

// 格式化时间为 HH:mm:ss.sss
export function formatTime(ts) {
  const d = new Date(ts);
  const pad = (n, w) => {
    const s = String(n);
    if (w === 3) return s.length >= 3 ? s : ('00' + s).slice(-3);
    return s.length >= 2 ? s : ('0' + s).slice(-2);
  };
  return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + '.' + pad(d.getMilliseconds(), 3);
}
