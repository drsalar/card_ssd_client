// 调试日志入口按钮：右上角浮动 LOG 按钮
// 设计要点：
//   1. 房间场景的“退出”按钮位于右上安全区内，本按钮位于其左侧 8px；
//   2. 大厅/其他场景退出按钮不存在时，按钮避让微信右上胶囊菜单；
//   3. 命中区域为按钮矩形；点击切换面板显示状态；
//   4. ERROR 未读数 > 0 且面板关闭 → 右上角红点；面板打开后清零；
//   5. handleTouch 命中时返回 true，由 main.js 触摸入口优先消费，避免穿透。

import { SCREEN_WIDTH, SAFE_TOP, MENU_BUTTON_RECT } from '../render';

const BTN_W = 46;
const BTN_H = 32;
const RIGHT_GAP = 8;        // 与画布右边缘或微信胶囊距离
const TOP_GAP = Math.max(12, SAFE_TOP + 8); // 距顶部安全区
const EXIT_BTN_LEFT_OFFSET = 70; // 与 room_scene 中退出按钮 x = SCREEN_WIDTH - 70 保持一致

export default class LogButton {
  constructor(panel, store) {
    this.panel = panel;
    this.store = store;
    this.h = BTN_H;
    this.w = BTN_W;
  }

  // 计算按钮位置 x：若处于房间场景，则避让退出按钮；否则避让微信胶囊菜单
  _computeRect() {
    const menuLeft = MENU_BUTTON_RECT ? MENU_BUTTON_RECT.left : SCREEN_WIDTH;
    let x = menuLeft - this.w - RIGHT_GAP;
    let y = MENU_BUTTON_RECT ? MENU_BUTTON_RECT.top : TOP_GAP;
    try {
      const databus = GameGlobal.databus;
      if (databus && databus.scene === 'room') {
        // 退出按钮位于 SCREEN_WIDTH - 70，宽 58；LOG 按钮放在退出按钮左侧 8px
        x = Math.min(x, (SCREEN_WIDTH - EXIT_BTN_LEFT_OFFSET) - this.w - RIGHT_GAP);
      }
    } catch (e) {}
    x = Math.max(RIGHT_GAP, x);
    return { x, y, w: this.w, h: this.h };
  }

  // 触摸命中
  handleTouch(tx, ty) {
    const r = this._computeRect();
    if (tx >= r.x && tx <= r.x + r.w && ty >= r.y && ty <= r.y + r.h) {
      this._toggle();
      return true;
    }
    return false;
  }

  // 切换面板
  _toggle() {
    if (!this.panel) return;
    if (this.panel.visible) {
      this.panel.hide();
    } else {
      this.store && this.store.clearUnread();
      this.panel.show();
    }
  }

  // 渲染
  render(ctx) {
    const r = this._computeRect();
    const visible = this.panel && this.panel.visible;
    ctx.save();
    // 底色
    ctx.fillStyle = visible ? 'rgba(255,165,0,0.85)' : 'rgba(0,0,0,0.55)';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    // 描边
    ctx.strokeStyle = visible ? '#ff8a00' : 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    // 文案
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('LOG', r.x + r.w / 2, r.y + r.h / 2);
    // 红点：未读 ERROR > 0 且面板未打开
    if (!visible && this.store && this.store.unreadError > 0) {
      const cx = r.x + r.w - 4;
      const cy = r.y + 4;
      ctx.fillStyle = '#ff3b30';
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();
  }
}
