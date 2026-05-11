// HTTP 客户端封装
// - 基于 wx.request；浏览器降级到 fetch
// - 大厅 HTTP 化：登录、查询活跃房间均通过此客户端
// - 与 WebSocket 同源：默认 baseUrl 取自 GameGlobal.HTTP_BASE，否则 http://127.0.0.1
const DEFAULT_BASE = 'http://127.0.0.1';

function getBaseUrl() {
  if (typeof GameGlobal !== 'undefined' && typeof GameGlobal.HTTP_BASE === 'string' && GameGlobal.HTTP_BASE) {
    return GameGlobal.HTTP_BASE;
  }
  return DEFAULT_BASE;
}

// 拼接 URL（支持 query 对象）
function buildUrl(path, query) {
  const base = getBaseUrl();
  let url = base.replace(/\/$/, '') + (path.startsWith('/') ? path : '/' + path);
  if (query && typeof query === 'object') {
    const parts = [];
    Object.keys(query).forEach((k) => {
      const v = query[k];
      if (v === undefined || v === null) return;
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)));
    });
    if (parts.length) url += (url.indexOf('?') >= 0 ? '&' : '?') + parts.join('&');
  }
  return url;
}

// 通用请求
function request(method, path, opts = {}) {
  const url = buildUrl(path, opts.query);
  return new Promise((resolve, reject) => {
    if (typeof wx !== 'undefined' && typeof wx.request === 'function') {
      wx.request({
        url,
        method,
        data: opts.data,
        header: { 'Content-Type': 'application/json' },
        timeout: opts.timeout || 8000,
        success: (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(res.data);
          } else {
            reject(new Error('HTTP ' + res.statusCode));
          }
        },
        fail: (err) => reject(new Error((err && err.errMsg) || 'request failed')),
      });
      return;
    }
    if (typeof fetch === 'function') {
      fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: opts.data ? JSON.stringify(opts.data) : undefined,
      })
        .then((r) => {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .then(resolve)
        .catch(reject);
      return;
    }
    reject(new Error('环境不支持 HTTP 请求'));
  });
}

export default {
  // POST /path
  post(path, data) {
    return request('POST', path, { data });
  },
  // GET /path?query
  get(path, query) {
    return request('GET', path, { query });
  },
  getBaseUrl,
};
