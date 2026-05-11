// 卡牌渲染组件
// 卡牌数据结构: { suit: 'S'|'H'|'D'|'C'|'D2'|'C2', rank: 1..13 }
// 其中 D2/C2 为加色规则下的第二组方块/草花（仅在 5/6 人时使用）

// 花色显示符号与颜色
const SUIT_SYMBOL = {
  S: '♠', H: '♥', D: '♦', C: '♣',
  D2: '♦', C2: '♣',
};
const SUIT_COLOR = {
  S: '#222', H: '#d8344b', D: '#d8344b', C: '#222',
  D2: '#d8344b', C2: '#222',
};
// 点数显示
const RANK_TEXT = {
  1: 'A', 11: 'J', 12: 'Q', 13: 'K',
};

function isMaCard(card) {
  return card && card.suit === 'H' && card.rank === 5;
}

// 默认尺寸
export const CARD_WIDTH = 44;
export const CARD_HEIGHT = 64;

export default class Card {
  // 静态工具：将 {suit, rank} 转为唯一键
  static keyOf(c) { return `${c.suit}_${c.rank}`; }

  // 静态工具：返回点数显示
  static rankText(r) { return RANK_TEXT[r] || String(r); }

  // 渲染单张牌（外部传入 ctx 与坐标）
  static render(ctx, card, x, y, opts = {}) {
    const w = opts.width || CARD_WIDTH;
    const h = opts.height || CARD_HEIGHT;
    const selected = !!opts.selected;
    // 选中时上移一点
    const dy = selected ? -10 : 0;

    ctx.save();
    // 卡背景（圆角）
    Card._roundRect(ctx, x, y + dy, w, h, 4);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = selected ? '#f5a623' : '#888';
    ctx.stroke();

    // 左上 - 点数 + 花色
    const color = SUIT_COLOR[card.suit] || '#222';
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = `bold 14px sans-serif`;
    ctx.fillText(Card.rankText(card.rank), x + 3, y + dy + 3);
    ctx.font = `12px sans-serif`;
    ctx.fillText(SUIT_SYMBOL[card.suit] || '?', x + 3, y + dy + 18);

    // 中央 - 大花色
    ctx.font = `${Math.floor(h * 0.45)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(SUIT_SYMBOL[card.suit] || '?', x + w / 2, y + dy + h / 2 + 4);

    if (isMaCard(card)) {
      const markW = Math.max(16, Math.floor(w * 0.42));
      const markH = Math.max(12, Math.floor(h * 0.18));
      Card._roundRect(ctx, x + w - markW - 2, y + dy + 2, markW, markH, 3);
      ctx.fillStyle = '#ff9800';
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.max(9, Math.floor(markH * 0.75))}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('马', x + w - markW / 2 - 2, y + dy + 2 + markH / 2);
    }

    ctx.restore();
  }

  // 渲染牌背
  static renderBack(ctx, x, y, opts = {}) {
    const w = opts.width || CARD_WIDTH;
    const h = opts.height || CARD_HEIGHT;
    ctx.save();
    Card._roundRect(ctx, x, y, w, h, 4);
    ctx.fillStyle = '#3a5a8c';
    ctx.fill();
    ctx.strokeStyle = '#1a2a44';
    ctx.lineWidth = 1;
    ctx.stroke();
    // 简单纹理
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    for (let i = -h; i < w; i += 6) {
      ctx.beginPath();
      ctx.moveTo(x + i, y);
      ctx.lineTo(x + i + h, y + h);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 渲染左上角裁剪样式（点数 + 花色），用于结算面板紧凑展示
  static renderCorner(ctx, card, x, y, opts = {}) {
    const w = opts.width || 22;
    const h = opts.height || 28;
    ctx.save();
    Card._roundRect(ctx, x, y, w, h, 3);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.strokeStyle = '#bdbdbd';
    ctx.lineWidth = 1;
    ctx.stroke();

    const color = SUIT_COLOR[card.suit] || '#222';
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = `bold ${Math.max(9, Math.floor(h * 0.42))}px sans-serif`;
    ctx.fillText(Card.rankText(card.rank), x + 3, y + 2);
    ctx.font = `${Math.max(9, Math.floor(h * 0.38))}px sans-serif`;
    ctx.fillText(SUIT_SYMBOL[card.suit] || '?', x + 3, y + Math.floor(h * 0.48));

    if (isMaCard(card)) {
      const r = Math.max(4, Math.floor(Math.min(w, h) * 0.18));
      ctx.fillStyle = '#ff9800';
      ctx.beginPath();
      ctx.arc(x + w - r - 2, y + r + 2, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // 圆角矩形路径
  static _roundRect(ctx, x, y, w, h, r) {
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
