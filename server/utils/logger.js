// 简单日志
const pad = (n) => (n < 10 ? '0' + n : '' + n);
function ts() {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
exports.info = (...args) => console.log(`[INFO ${ts()}]`, ...args);
exports.warn = (...args) => console.warn(`[WARN ${ts()}]`, ...args);
exports.error = (...args) => console.error(`[ERR  ${ts()}]`, ...args);
