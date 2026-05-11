// WebSocket 服务端入口
const WebSocket = require('ws');
const session = require('./session');
const router = require('./router');
const roomManager = require('./room_manager');
const logger = require('./utils/logger');

const PORT = process.env.PORT ? Number(process.env.PORT) : 80;

const wss = new WebSocket.Server({ port: PORT });
logger.info(`十三张服务端已启动，监听端口 ${PORT}`);

wss.on('connection', (ws) => {
  const s = session.add(ws);
  logger.info(`新连接 connId=${s.connId}`);

  ws.on('message', (raw) => {
    router.dispatch(s, raw);
  });

  ws.on('close', () => {
    logger.info(`连接关闭 connId=${s.connId} openid=${s.openid}`);
    // 通知房间管理器：玩家断线
    if (s.roomId) {
      roomManager.handleDisconnect(s);
    }
    session.remove(s);
  });

  ws.on('error', (e) => {
    logger.warn(`连接错误 connId=${s.connId}`, e.message);
  });
});

// 进程退出处理
process.on('SIGINT', () => {
  logger.info('收到 SIGINT，关闭服务端');
  wss.close(() => process.exit(0));
});
