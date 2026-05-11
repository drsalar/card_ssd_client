// 通用模态弹窗组件
// 支持：标题、内容（文本/自定义渲染）、确认/取消按钮、底部按钮组
import { SCREEN_WIDTH, SCREEN_HEIGHT } from '../render';
import Button from './Button';

export default class Modal {
  constructor(opts = {}) {
    this.title = opts.title || '';
    this.width = opts.width || Math.min(SCREEN_WIDTH * 0.85, 320);
    this.height = opts.height || 240;
    this.visible = false;
    this.onConfirm = opts.onConfirm || null;
    this.onCancel = opts.onCancel || null;
    this.confirmText = opts.confirmText || '确认';
    this.cancelText = opts.cancelText || '取消';
    this.showCancel = opts.showCancel !== false;
    // 自定义内容渲染回调 (ctx, x, y, w, h)
    this.renderContent = opts.renderContent || null;
    // 自定义触摸回调 (x, y) => boolean
    this.handleContentTouch = opts.handleContentTouch || null;

    this.x = (SCREEN_WIDTH - this.width) / 2;
    this.y = (SCREEN_HEIGHT - this.height) / 2;

    // 底部按钮
    const btnW = 100, btnH = 36, gap = 20;
    const btnY = this.y + this.height - btnH - 16;
    if (this.showCancel) {
      this.cancelBtn = new Button({
        x: this.x + this.width / 2 - btnW - gap / 2,
        y: btnY,
        width: btnW,
        height: btnH,
        text: this.cancelText,
        bgColor: '#999',
        onClick: () => {
          this.hide();
          if (this.onCancel) this.onCancel();
        },
      });
      this.confirmBtn = new Button({
        x: this.x + this.width / 2 + gap / 2,
        y: btnY,
        width: btnW,
        height: btnH,
        text: this.confirmText,
        onClick: () => {
          if (this.onConfirm) this.onConfirm();
        },
      });
    } else {
      this.confirmBtn = new Button({
        x: this.x + (this.width - btnW) / 2,
        y: btnY,
        width: btnW,
        height: btnH,
        text: this.confirmText,
        onClick: () => {
          if (this.onConfirm) this.onConfirm();
        },
      });
    }
  }

  show() { this.visible = true; }
  hide() { this.visible = false; }

  // 渲染
  render(ctx) {
    if (!this.visible) return;
    ctx.save();
    // 蒙层
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    // 弹窗背景
    ctx.fillStyle = '#fff';
    ctx.fillRect(this.x, this.y, this.width, this.height);
    // 标题
    ctx.fillStyle = '#333';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(this.title, this.x + this.width / 2, this.y + 16);
    // 内容
    if (this.renderContent) {
      this.renderContent(ctx, this.x + 16, this.y + 50, this.width - 32, this.height - 110);
    }
    ctx.restore();
    // 按钮
    if (this.cancelBtn) this.cancelBtn.render(ctx);
    if (this.confirmBtn) this.confirmBtn.render(ctx);
  }

  // 触摸事件
  handleTouch(x, y) {
    if (!this.visible) return false;
    if (this.cancelBtn && this.cancelBtn.handleTouch(x, y)) return true;
    if (this.confirmBtn && this.confirmBtn.handleTouch(x, y)) return true;
    if (this.handleContentTouch) {
      if (this.handleContentTouch(x, y)) return true;
    }
    // 点击蒙层吞掉事件
    return true;
  }
}
