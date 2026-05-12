// 微信用户资料（昵称/头像）获取工具
// 背景：
//   - 自微信基础库 2.27.1 起，小游戏端 wx.getUserInfo 返回的 nickName 会被强制改为「微信用户」、
//     avatarUrl 改为灰色默认头像；wx.getUserProfile 在小游戏端已废弃。
//   - 当前唯一可拿到真实昵称/头像的方式是 wx.createUserInfoButton：
//     创建一个 native 按钮叠加到画布上，由用户点击触发授权。
// 设计：
//   - 启动只读 storage 缓存（不再调 getUserInfo）。
//   - 大厅在「头像+昵称」区域上叠加透明的 UserInfoButton，玩家点击后 success 回调拿到真实资料。
//   - 拿到资料 → 写 storage → emit('user_info_updated')。

// 本地缓存 key
const STORAGE_KEY = 'wx_user_info';

// 读取本地缓存（同步）
// 返回 { nickname, avatarUrl } 或 null
export function readCachedUserInfo() {
  try {
    if (typeof wx === 'undefined' || !wx.getStorageSync) return null;
    const v = wx.getStorageSync(STORAGE_KEY);
    if (v && typeof v === 'object' && (v.nickname || v.avatarUrl)) {
      return { nickname: v.nickname || '', avatarUrl: v.avatarUrl || '' };
    }
  } catch (e) { /* 静默 */ }
  return null;
}

// 持久化保存（同步）
export function saveWxUserInfo(info) {
  try {
    if (typeof wx === 'undefined' || !wx.setStorageSync) return;
    if (!info || typeof info !== 'object') return;
    wx.setStorageSync(STORAGE_KEY, {
      nickname: info.nickname || '',
      avatarUrl: info.avatarUrl || '',
    });
  } catch (e) { /* 静默 */ }
}

// 创建一个透明的 wx.createUserInfoButton 叠加层
// - rect: { left, top, width, height }（逻辑像素，与 SCREEN_WIDTH 同坐标系）
// - onSuccess(info): 用户点击并授权成功后回调，info = { nickname, avatarUrl }
// - 返回 button 对象（含 setPosition / show / hide / destroy）；非微信环境返回 null
export function createUserInfoAuthButton(rect, onSuccess) {
  if (typeof wx === 'undefined' || typeof wx.createUserInfoButton !== 'function') {
    return null;
  }
  let btn = null;
  try {
    btn = wx.createUserInfoButton({
      type: 'text',
      text: '',
      style: {
        left: rect.left || 0,
        top: rect.top || 0,
        width: rect.width || 0,
        height: rect.height || 0,
        backgroundColor: '#00000000', // 透明
        color: '#00000000',
        textAlign: 'center',
        fontSize: 14,
        borderRadius: Math.floor((rect.height || 36) / 2),
        lineHeight: rect.height || 36,
      },
      withCredentials: false,
      lang: 'zh_CN',
    });
  } catch (e) {
    return null;
  }
  if (!btn) return null;

  btn.onTap((res) => {
    try {
      const ui = res && res.userInfo;
      if (!ui) return;
      const info = {
        nickname: ui.nickName || '',
        avatarUrl: ui.avatarUrl || '',
      };
      if (!info.nickname && !info.avatarUrl) return;
      saveWxUserInfo(info);
      if (typeof onSuccess === 'function') onSuccess(info);
    } catch (e) { /* 静默 */ }
  });

  // 包装一下 setPosition：仅当位置变化时调用，避免每帧无谓刷新
  const _last = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  const wrap = {
    raw: btn,
    setPosition(left, top, width, height) {
      if (left === _last.left && top === _last.top && width === _last.width && height === _last.height) return;
      _last.left = left; _last.top = top; _last.width = width; _last.height = height;
      try {
        btn.style.left = left;
        btn.style.top = top;
        btn.style.width = width;
        btn.style.height = height;
        btn.style.borderRadius = Math.floor(height / 2);
        btn.style.lineHeight = height;
      } catch (e) { /* 静默 */ }
    },
    show() { try { btn.show && btn.show(); } catch (e) {} },
    hide() { try { btn.hide && btn.hide(); } catch (e) {} },
    destroy() { try { btn.destroy && btn.destroy(); } catch (e) {} },
  };
  return wrap;
}

// 以「头像昵称填写能力」方式让用户手动提供资料（替代 createUserInfoButton 失效的场景）：
//   - 头像：wx.chooseMedia 从相册/相机选一张图片，使用 tempFilePath 作为头像 URL
//   - 昵称：wx.showModal({ editable: true }) 让用户手动输入
// 完成后自动写入本地缓存，并把 { nickname, avatarUrl } 回调给调用方。
// 任一环节取消即静默放弃（不写缓存、不回调）。
//   options.mode: 'both'(默认，先选头像再填昵称) | 'avatar'(仅换头像) | 'nickname'(仅改昵称)
//   options.firstTime: true 时在开始前先用对话框说明用途，用户点「稍后」可完全跳过
//   options.currentNickname: 当前昵称，用于在弹窗内显示
export function pickUserInfo(onSuccess, options = {}) {
  if (typeof wx === 'undefined') {
    if (typeof options.onUnsupported === 'function') options.onUnsupported();
    return false;
  }
  const mode = options.mode || 'both';
  const currentNick = (options.currentNickname || '').toString();
  const pickAvatar = () => new Promise((resolve) => {
    if (typeof wx.chooseMedia === 'function') {
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['compressed'],
        success: (res) => {
          const f = res && res.tempFiles && res.tempFiles[0];
          resolve(f && f.tempFilePath ? f.tempFilePath : '');
        },
        fail: () => resolve(''),
      });
    } else if (typeof wx.chooseImage === 'function') {
      wx.chooseImage({
        count: 1,
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
        success: (res) => {
          const p = res && res.tempFilePaths && res.tempFilePaths[0];
          resolve(p || '');
        },
        fail: () => resolve(''),
      });
    } else {
      resolve('');
    }
  });
  const askNickname = () => new Promise((resolve) => {
    if (typeof wx.showModal !== 'function') { resolve(''); return; }
    wx.showModal({
      title: '请输入昵称',
      content: currentNick && !/^玩家[0-9a-zA-Z]+$/.test(currentNick) ? `当前：${currentNick}` : '',
      editable: true,
      placeholderText: '请输入昵称（最多 12 字）',
      success: (r) => {
        if (!r.confirm) { resolve(''); return; }
        const v = (r.content || '').trim().slice(0, 12);
        resolve(v);
      },
      fail: () => resolve(''),
    });
  });
  const confirmFirstTime = () => new Promise((resolve) => {
    if (!options.firstTime || typeof wx.showModal !== 'function') { resolve(true); return; }
    wx.showModal({
      title: '设置个人资料',
      content: '设置你的头像与昵称，让队友认出你。也可以稍后在主页头像处修改。',
      confirmText: '去设置',
      cancelText: '稍后',
      success: (r) => resolve(!!r.confirm),
      fail: () => resolve(false),
    });
  });

  const commit = (avatarUrl, nickname) => {
    if (!avatarUrl && !nickname) return; // 全部取消，静默
    const prev = readCachedUserInfo() || {};
    const merged = {
      nickname: nickname || prev.nickname || '',
      avatarUrl: avatarUrl || prev.avatarUrl || '',
    };
    saveWxUserInfo(merged);
    if (typeof onSuccess === 'function') onSuccess(merged);
  };

  confirmFirstTime().then((go) => {
    if (!go) return;
    if (mode === 'avatar') {
      pickAvatar().then((avatarUrl) => commit(avatarUrl, ''));
    } else if (mode === 'nickname') {
      askNickname().then((nickname) => commit('', nickname));
    } else {
      pickAvatar().then((avatarUrl) => askNickname().then((nickname) => commit(avatarUrl, nickname)));
    }
  });
  return true;
}
