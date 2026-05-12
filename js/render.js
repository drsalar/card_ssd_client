// 初始化 Canvas，并按设备像素比扩大 backing store，避免真机文字发虚
GameGlobal.canvas = wx.createCanvas();

const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
const pixelRatio = Math.max(1, windowInfo.pixelRatio || 1);
const safeArea = windowInfo.safeArea || {
  top: 0,
  left: 0,
  right: windowInfo.screenWidth,
  bottom: windowInfo.screenHeight,
};

canvas.width = Math.floor(windowInfo.screenWidth * pixelRatio);
canvas.height = Math.floor(windowInfo.screenHeight * pixelRatio);

export const SCREEN_WIDTH = windowInfo.screenWidth;
export const SCREEN_HEIGHT = windowInfo.screenHeight;
export const CANVAS_DPR = pixelRatio;
export const SAFE_TOP = safeArea.top || 0;
export const SAFE_BOTTOM = Math.max(0, windowInfo.screenHeight - (safeArea.bottom || windowInfo.screenHeight));
export const SAFE_LEFT = safeArea.left || 0;
export const SAFE_RIGHT = Math.max(0, windowInfo.screenWidth - (safeArea.right || windowInfo.screenWidth));

let menuButtonRect = null;
try {
  menuButtonRect = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : null;
} catch (e) {}

export const MENU_BUTTON_RECT = menuButtonRect;