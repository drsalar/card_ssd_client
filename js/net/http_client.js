// HTTP 客户端封装
// - 优先使用 wx.cloud.callContainer 走云托管通道（无需配置 request 合法域名）
// - 降级链路：wx.request（小游戏环境无云能力）→ fetch（浏览器调试）
// - 调试：所有请求/响应/错误均写入 LogStore（通过 GameGlobal.logStore，未启用时静默）
import cloud from './cloud';

const DEFAULT_BASE = 'http://127.0.0.1';

function getBaseUrl() {
  if (typeof GameGlobal !== 'undefined' && typeof GameGlobal.HTTP_BASE === 'string' && GameGlobal.HTTP_BASE) {
    return GameGlobal.HTTP_BASE;
  }
  return DEFAULT_BASE;
}

// 拼接 query 到 path（保留原有 path?k=v 行为）
function appendQuery(path, query) {
  if (!query || typeof query !== 'object') return path;
  const parts = [];
  Object.keys(query).forEach((k) => {
    const v = query[k];
    if (v === undefined || v === null) return;
    parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)));
  });
  if (!parts.length) return path;
  return path + (path.indexOf('?') >= 0 ? '&' : '?') + parts.join('&');
}

// 拼接降级 URL（wx.request / fetch 用）
function buildDirectUrl(pathWithQuery) {
  const base = getBaseUrl();
  return base.replace(/\/$/, '') + (pathWithQuery.startsWith('/') ? pathWithQuery : '/' + pathWithQuery);
}

// 构造易读的云通道调试 URL：cloud://{service}{path}
function buildCloudUrl(pathWithQuery) {
  const service = cloud.getCloudService() || 'unknown';
  const p = pathWithQuery.startsWith('/') ? pathWithQuery : '/' + pathWithQuery;
  return 'cloud://' + service + p;
}

// 安全获取 LogStore（未启用调试时返回 null）
function _store() {
  try {
    if (typeof GameGlobal !== 'undefined' && GameGlobal.logStore) return GameGlobal.logStore;
  } catch (e) {}
  return null;
}

// 写入请求日志
function _logReq(method, url, data) {
  const store = _store();
  if (!store) return;
  try { store.writeHttp('req', { method, url, data }); } catch (e) {}
}

// 写入响应日志
function _logResp(method, url, status, startedAt, body) {
  const store = _store();
  if (!store) return;
  try {
    store.writeHttp('resp', {
      method, url, status,
      duration: Date.now() - startedAt,
      data: body,
      level: status >= 200 && status < 300 ? 'info' : 'error',
    });
  } catch (e) {}
}

// 写入错误日志
function _logErr(method, url, startedAt, err) {
  const store = _store();
  if (!store) return;
  try {
    store.writeHttp('error', {
      method, url,
      duration: Date.now() - startedAt,
      error: (err && err.message) || String(err),
      level: 'error',
    });
  } catch (e) {}
}

// 走云托管通道
function _callContainer(method, pathWithQuery, data) {
  const url = buildCloudUrl(pathWithQuery);
  const startedAt = Date.now();
  _logReq(method, url, data);
  return new Promise((resolve, reject) => {
    wx.cloud.callContainer({
      config: { env: cloud.getCloudEnv() },
      path: pathWithQuery,
      method,
      header: {
        'X-WX-SERVICE': cloud.getCloudService(),
        'content-type': 'application/json',
      },
      data,
      timeout: 8000,
      success: (res) => {
        const status = res.statusCode || 0;
        _logResp(method, url, status, startedAt, res.data);
        if (status >= 200 && status < 300) {
          resolve(res.data);
        } else {
          reject(new Error('HTTP ' + status));
        }
      },
      fail: (err) => {
        const e = new Error((err && err.errMsg) || 'callContainer failed');
        _logErr(method, url, startedAt, e);
        reject(e);
      },
    });
  });
}

// 走 wx.request（小游戏无云能力降级）
function _wxRequest(method, pathWithQuery, data) {
  const url = buildDirectUrl(pathWithQuery);
  const startedAt = Date.now();
  _logReq(method, url, data);
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method,
      data,
      header: { 'Content-Type': 'application/json' },
      timeout: 8000,
      success: (res) => {
        _logResp(method, url, res.statusCode, startedAt, res.data);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
        } else {
          reject(new Error('HTTP ' + res.statusCode));
        }
      },
      fail: (err) => {
        const e = new Error((err && err.errMsg) || 'request failed');
        _logErr(method, url, startedAt, e);
        reject(e);
      },
    });
  });
}

// 走 fetch（浏览器调试降级）
function _fetch(method, pathWithQuery, data) {
  const url = buildDirectUrl(pathWithQuery);
  const startedAt = Date.now();
  _logReq(method, url, data);
  return new Promise((resolve, reject) => {
    let _status = 0;
    fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: data ? JSON.stringify(data) : undefined,
    })
      .then((r) => {
        _status = r.status;
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then((body) => { _logResp(method, url, _status, startedAt, body); resolve(body); })
      .catch((err) => { _logErr(method, url, startedAt, err); reject(err); });
  });
}

// 通用请求入口：根据环境优先选择云通道
function request(method, path, opts = {}) {
  const pathWithQuery = appendQuery(path, opts.query);
  const data = opts.data;
  if (cloud.isCloudHttpAvailable()) {
    return _callContainer(method, pathWithQuery, data);
  }
  if (typeof wx !== 'undefined' && typeof wx.request === 'function') {
    return _wxRequest(method, pathWithQuery, data);
  }
  if (typeof fetch === 'function') {
    return _fetch(method, pathWithQuery, data);
  }
  const e = new Error('环境不支持 HTTP 请求');
  _logErr(method, buildDirectUrl(pathWithQuery), Date.now(), e);
  return Promise.reject(e);
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
