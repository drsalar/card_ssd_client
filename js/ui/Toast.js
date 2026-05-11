// 通用 Toast 轻提示
import { SCREEN_WIDTH, SCREEN_HEIGHT } from '../render';

export default class Toast {
  constructor() {
    this.queue = []; // 待展示的消息队列
  }

  // 展示一条 Toast
  show(text, duration = 2000) {
    this.queue.push({
      text,
      expireAt: Date.now() + duration,
    });
  }

  // 渲染当前 Toast
  render(ctx) {
    const now = Date.now();
    // 清理过期项
    while (this.queue.length && this.queue[0].expireAt < now) {
      this.queue.shift();
    }
    if (!this.queue.length) return;
    const msg = this.queue[0];
    ctx.save();
    ctx.font = '16px sans-serif';
    const padding = 16;
    const tw = ctx.measureText(msg.text).width + padding * 2;
    const th = 36;
    const x = (SCREEN_WIDTH - tw) / 2;
    const y = SCREEN_HEIGHT * 0.7;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(x, y, tw, th);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(msg.text, x + tw / 2, y + th / 2);
    ctx.restore();
  }
}
