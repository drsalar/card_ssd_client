// 资源加载器 - 暂时只是图片缓存的轻封装
const cache = {};

export function loadImage(url) {
  if (cache[url]) return cache[url];
  const img = wx.createImage ? wx.createImage() : new Image();
  img.src = url;
  cache[url] = img;
  return img;
}

export function getImage(url) {
  return cache[url] || null;
}
