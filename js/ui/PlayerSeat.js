// 玩家座位渲染（头像、昵称、积分、准备/已开牌/掉线状态）
import Avatar from './Avatar';

export default class PlayerSeat {
  // player: { openid, nickname, avatarUrl, score, ready, offline, submitted }
  // pos: { x, y, anchor }  anchor: 'left'|'right'|'center'
  static avatarCache = {}; // openid -> Avatar 实例

  static getAvatar(player) {
    let av = PlayerSeat.avatarCache[player.openid];
    if (!av) {
      av = new Avatar({ size: 48, fallbackText: player.nickname || '?' });
      PlayerSeat.avatarCache[player.openid] = av;
    }
    av.setUrl(player.avatarUrl || '');
    return av;
  }

  // 渲染单个座位
  // opts: { isHost, isMe, phase }
  static render(ctx, player, x, y, opts = {}) {
    const size = opts.size || 48;
    // 头像
    const av = PlayerSeat.getAvatar(player);
    av.fallbackText = player.nickname || '?';
    av.render(ctx, x - size / 2, y - size / 2, size);

    // 离线视觉：非本地玩家、非 Bot，且 offline=true 时叠加圆形蒙层 + OFF 字样
    // 即使头像图片未加载完，fallback 圆也已绘制，蒙层视觉一致
    if (player.offline && !opts.isMe && !player.isBot) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, size / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fill();
      // OFF 文字徽章（约头像直径 60%）
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.max(12, Math.round(size * 0.42))}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('OFF', x, y);
      ctx.restore();
    }

    // 昵称
    ctx.save();
    ctx.font = `${Math.max(10, Math.round(size * 0.25))}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#fff';
    let name = player.nickname || '玩家';
    if (name.length > 6) name = name.slice(0, 6) + '...';
    if (opts.isHost) name = '👑 ' + name;
    if (opts.isMe) name = '(我) ' + name;
    ctx.fillText(name, x, y + size / 2 + 4);

    // 积分
    ctx.font = `bold ${Math.max(10, Math.round(size * 0.25))}px sans-serif`;
    ctx.fillStyle = player.score >= 0 ? '#ffd54f' : '#e57373';
    ctx.fillText(`${player.score >= 0 ? '+' : ''}${player.score}`, x, y + size / 2 + 20);

    // 状态徽标
    let badge = '';
    let badgeColor = '#888';
    if (player.offline && !opts.isMe && !player.isBot) {
      // 离线视觉已通过头像蒙层呈现，此处不再重复显示“掉线”小徽章
      badge = '';
    } else if (player.submitted) { badge = '已开牌'; badgeColor = '#5cb85c'; }
    else if (player.ready) { badge = '已准备'; badgeColor = '#4a90e2'; }
    if (badge) {
      const w = Math.max(38, Math.round(size * 0.92)), h = Math.max(14, Math.round(size * 0.33));
      ctx.fillStyle = badgeColor;
      ctx.fillRect(x - w / 2, y - size / 2 - h - 2, w, h);
      ctx.fillStyle = '#fff';
      ctx.font = `${Math.max(9, Math.round(size * 0.23))}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(badge, x, y - size / 2 - h / 2 - 2);
    }

    // 电脑玩家角标：头像右上角“BOT”
    if (player.isBot) {
      const bw = Math.max(24, Math.round(size * 0.54)), bh = Math.max(13, Math.round(size * 0.29));
      const bx = x + size / 2 - bw + 4;
      const by = y - size / 2 - 2;
      ctx.fillStyle = '#ff8a00';
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.max(9, Math.round(size * 0.21))}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('BOT', bx + bw / 2, by + bh / 2 + 1);
    }
    ctx.restore();
  }
}
