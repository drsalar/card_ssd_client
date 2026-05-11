// 通用按钮组件 - 基于 Canvas 的简易 UI
export default class Button {
  constructor(opts = {}) {
    this.x = opts.x || 0;
    this.y = opts.y || 0;
    this.width = opts.width || 120;
    this.height = opts.height || 40;
    this.text = opts.text || '';
    this.bgColor = opts.bgColor || '#4a90e2';
    this.disabledColor = opts.disabledColor || '#999';
    this.textColor = opts.textColor || '#fff';
    this.fontSize = opts.fontSize || 16;
    this.radius = opts.radius || 8;
    this.disabled = !!opts.disabled;
    this.visible = opts.visible !== false;
    this.onClick = opts.onClick || null;
  }

  // 判断点是否在按钮区域内
  contains(x, y) {
    return this.visible && !this.disabled
      && x >= this.x && x <= this.x + this.width
      && y >= this.y && y <= this.y + this.height;
  }

  // 触摸结束时检查是否点击
  handleTouch(x, y) {
    if (this.contains(x, y) && this.onClick) {
      this.onClick();
      return true;
    }
    return false;
  }

  // 渲染
  render(ctx) {
    if (!this.visible) return;
    ctx.save();
    const color = this.disabled ? this.disabledColor : this.bgColor;
    this._drawRoundRect(ctx, this.x, this.y, this.width, this.height, this.radius);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.fillStyle = this.textColor;
    ctx.font = `${this.fontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.text, this.x + this.width / 2, this.y + this.height / 2);
    ctx.restore();
  }

  // 绘制圆角矩形路径
  _drawRoundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
}
