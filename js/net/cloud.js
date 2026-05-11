// 云托管能力封装
// - 提供 wx.cloud.init 的幂等初始化
// - 提供 callContainer / connectContainer 的可用性判定
// - 业务层只需关心 path / data，不直接接触 wx.cloud API

let _inited = false;
let _initOk = false;

// 判断当前运行环境是否暴露 wx.cloud
function _hasWxCloud() {
  return typeof wx !== 'undefined' && wx && typeof wx.cloud === 'object' && wx.cloud;
}

// 读取云环境 ID
function getCloudEnv() {
  if (typeof GameGlobal !== 'undefined' && typeof GameGlobal.CLOUD_ENV === 'string' && GameGlobal.CLOUD_ENV) {
    return GameGlobal.CLOUD_ENV;
  }
  return '';
}

// 读取云托管服务名
function getCloudService() {
  if (typeof GameGlobal !== 'undefined' && typeof GameGlobal.CLOUD_SERVICE === 'string' && GameGlobal.CLOUD_SERVICE) {
    return GameGlobal.CLOUD_SERVICE;
  }
  return '';
}

// 幂等初始化云能力：只调用一次 wx.cloud.init
function ensureCloudInit() {
  if (_inited) return _initOk;
  _inited = true;
  if (!_hasWxCloud()) {
    _initOk = false;
    return false;
  }
  const env = getCloudEnv();
  if (!env) {
    _initOk = false;
    return false;
  }
  try {
    if (typeof wx.cloud.init === 'function') {
      wx.cloud.init({ env });
    }
    _initOk = true;
  } catch (e) {
    console.warn('wx.cloud.init 失败', e);
    _initOk = false;
  }
  return _initOk;
}

// 是否可用 callContainer
function isCloudHttpAvailable() {
  if (!_hasWxCloud()) return false;
  if (typeof wx.cloud.callContainer !== 'function') return false;
  return ensureCloudInit();
}

// 是否可用 connectContainer
function isCloudWsAvailable() {
  if (!_hasWxCloud()) return false;
  if (typeof wx.cloud.connectContainer !== 'function') return false;
  return ensureCloudInit();
}

export default {
  ensureCloudInit,
  isCloudHttpAvailable,
  isCloudWsAvailable,
  getCloudEnv,
  getCloudService,
};
