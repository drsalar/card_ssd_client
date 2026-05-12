let instance;

const BGM_STORAGE_KEY = 'bgmEnabled';

function createAudioContext() {
  if (typeof wx === 'undefined' || typeof wx.createInnerAudioContext !== 'function') return null;
  return wx.createInnerAudioContext();
}

function safePlay(audio) {
  if (!audio || typeof audio.play !== 'function') return;
  try {
    const ret = audio.play();
    if (ret && typeof ret.catch === 'function') ret.catch(() => {});
  } catch (e) {}
}

function resetAndPlay(audio) {
  if (!audio) return;
  try {
    if (typeof audio.stop === 'function') audio.stop();
    if (typeof audio.seek === 'function') audio.seek(0);
    else audio.currentTime = 0;
  } catch (e) {}
  safePlay(audio);
}

/**
 * 统一的音效管理器
 */
export default class Music {
  constructor() {
    if (instance) return instance;

    this.bgmAudio = createAudioContext();
    this.shootAudio = createAudioContext();
    this.boomAudio = createAudioContext();
    this.bgmEnabled = this._loadBgmEnabled();

    if (this.bgmAudio) {
      this.bgmAudio.loop = true; // 背景音乐循环播放
      this.bgmAudio.autoplay = this.bgmEnabled; // 进入画面后按缓存状态自动播放
      this.bgmAudio.src = 'audio/bgm2.mp3';
    }
    if (this.shootAudio) this.shootAudio.src = 'audio/bullet.mp3';
    if (this.boomAudio) this.boomAudio.src = 'audio/boom.mp3';

    instance = this;
  }

  init() {
    if (this.bgmEnabled) this.playBgm();
  }

  isBgmEnabled() {
    return !!this.bgmEnabled;
  }

  toggleBgm() {
    this.setBgmEnabled(!this.bgmEnabled);
    return this.bgmEnabled;
  }

  setBgmEnabled(enabled) {
    this.bgmEnabled = !!enabled;
    this._saveBgmEnabled();
    if (this.bgmEnabled) this.playBgm();
    else this.pauseBgm();
  }

  playBgm() {
    if (!this.bgmEnabled) return;
    safePlay(this.bgmAudio);
  }

  pauseBgm() {
    if (!this.bgmAudio || typeof this.bgmAudio.pause !== 'function') return;
    try { this.bgmAudio.pause(); } catch (e) {}
  }

  playShoot() {
    resetAndPlay(this.shootAudio);
  }

  playExplosion() {
    resetAndPlay(this.boomAudio);
  }

  _loadBgmEnabled() {
    if (typeof wx === 'undefined' || typeof wx.getStorageSync !== 'function') return true;
    try {
      const val = wx.getStorageSync(BGM_STORAGE_KEY);
      return val === '' || val === undefined ? true : val !== false;
    } catch (e) {
      return true;
    }
  }

  _saveBgmEnabled() {
    if (typeof wx === 'undefined' || typeof wx.setStorageSync !== 'function') return;
    try { wx.setStorageSync(BGM_STORAGE_KEY, this.bgmEnabled); } catch (e) {}
  }
}
