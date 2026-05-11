// 玩家头像组件（支持微信头像 URL 加载，加载失败显示首字母）
export default class Avatar {
  // 静态缓存：url -> Image
  static cache = {};

  constructor(opts = {}) {
    this.x = opts.x || 0;
    this.y = opts.y || 0;
    this.size = opts.size || 48;
    this.url = opts.url || '';
    this.fallbackText = opts.fallbackText || '?';
    this.image = null;
    if (this.url) this._loadImage(this.url);
  }

  // 设置头像 URL
  setUrl(url) {
    if (this.url === url) return;
    this.url = url;
    this.image = null;
    if (url) this._loadImage(url);
  }

  // 加载图片
  _loadImage(url) {
    if (Avatar.cache[url]) {
      this.image = Avatar.cache[url];
      return;
    }
    try {
      const img = wx.createImage ? wx.createImage() : new Image();
      img.onload = () => {
        Avatar.cache[url] = img;
        this.image = img;
      };
      img.onerror = () => { this.image = null; };
      img.src = url;
    } catch (e) {
      this.image = null;
    }
  }

  // 渲染（圆形头像）
  render(ctx, x, y, size) {
    const cx = (x !== undefined ? x : this.x);
    const cy = (y !== undefined ? y : this.y);
    const sz = (size !== undefined ? size : this.size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx + sz / 2, cy + sz / 2, sz / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    if (this.image) {
      try {
        ctx.drawImage(this.image, cx, cy, sz, sz);
      } catch (e) {
        this._drawFallback(ctx, cx, cy, sz);
      }
    } else {
      this._drawFallback(ctx, cx, cy, sz);
    }
    ctx.restore();
    // 圆形描边
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx + sz / 2, cy + sz / 2, sz / 2, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.restore();
  }

  // 绘制兜底（彩色背景 + 首字符）
  _drawFallback(ctx, x, y, sz) {
    ctx.fillStyle = '#7aa6d6';
    ctx.fillRect(x, y, sz, sz);
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.floor(sz * 0.5)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.fallbackText[0] || '?', x + sz / 2, y + sz / 2);
  }
}
