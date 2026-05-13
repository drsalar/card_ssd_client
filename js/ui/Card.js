// 卡牌渲染组件
// 卡牌数据结构: { suit: 'S'|'H'|'D'|'C'|'D2'|'C2', rank: 1..13 }
// 其中 D2/C2 为加色规则下的第二组方块/草花（仅在 5/6 人时使用）

// 花色显示符号与颜色
const SUIT_STYLE = {
  S: { symbol: '♠', label: '黑', color: '#151922', accent: '#3f4758', labelBg: '#1f2937' },
  H: { symbol: '♥', label: '红', color: '#d81b42', accent: '#ff5f7d', labelBg: '#d81b42' },
  D: { symbol: '♦', label: '方', color: '#e65a00', accent: '#f2a01f', labelBg: '#f59e0b' },
  C: { symbol: '♣', label: '梅', color: '#087a3a', accent: '#2fb35f', labelBg: '#16a34a' },
  D2: { symbol: '♦', label: '方', color: '#e65a00', accent: '#f2a01f', labelBg: '#f59e0b' },
  C2: { symbol: '♣', label: '梅', color: '#087a3a', accent: '#2fb35f', labelBg: '#16a34a' },
};
const DEFAULT_SUIT_STYLE = { symbol: '?', label: '?', color: '#222', accent: '#888', labelBg: '#6b7280' };
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
    const ma = isMaCard(card);
    const suitStyle = Card._suitStyle(card && card.suit);
    // 选中时上移一点
    const dy = selected ? -10 : 0;

    ctx.save();
    // 卡背景（圆角）
    Card._fillCardBackground(ctx, x, y + dy, w, h, 4, ma);
    Card._drawSuitAccent(ctx, x, y + dy, w, h, 4, suitStyle, ma);
    Card._roundRect(ctx, x, y + dy, w, h, 4);
    ctx.lineWidth = ma ? 2 : 1;
    ctx.strokeStyle = selected ? '#f5a623' : (ma ? '#00acc1' : '#888');
    ctx.stroke();
    if (ma) Card._strokeMaHighlight(ctx, x, y + dy, w, h, 4);

    // 左上 - 点数 + 花色（字号随卡牌高度自适应，保证小牌/大牌都清晰）
    ctx.fillStyle = Card._rankColor(card && card.suit);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const rankFont = Math.max(11, Math.floor(h * 0.30));
    const suitFont = Math.max(10, Math.floor(h * 0.26));
    ctx.font = `bold ${rankFont}px sans-serif`;
    ctx.fillText(Card.rankText(card.rank), x + 3, y + dy + 2);
    ctx.font = `${suitFont}px sans-serif`;
    ctx.fillStyle = suitStyle.color;
    ctx.fillText(suitStyle.symbol, x + 3, y + dy + 2 + rankFont + 1);

    // 中央 - 大花色
    ctx.globalAlpha = 0.88;
    ctx.fillStyle = suitStyle.color;
    ctx.font = `${Math.floor(h * 0.45)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(suitStyle.symbol, x + w / 2, y + dy + h / 2 + 4);
    ctx.globalAlpha = 1;

    // 底部花色标签：手机端小牌也能区分同色花色
    Card._drawSuitLabel(ctx, x, y + dy, w, h, suitStyle);

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
    const ma = isMaCard(card);
    const suitStyle = Card._suitStyle(card && card.suit);
    ctx.save();
    Card._fillCardBackground(ctx, x, y, w, h, 3, ma);
    Card._drawSuitAccent(ctx, x, y, w, h, 3, suitStyle, ma);
    Card._roundRect(ctx, x, y, w, h, 3);
    ctx.strokeStyle = ma ? '#00acc1' : '#bdbdbd';
    ctx.lineWidth = ma ? 2 : 1;
    ctx.stroke();
    if (ma) Card._strokeMaHighlight(ctx, x, y, w, h, 3);

    ctx.fillStyle = Card._rankColor(card && card.suit);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = `bold ${Math.max(11, Math.floor(h * 0.42))}px sans-serif`;
    ctx.fillText(Card.rankText(card.rank), x + 3, y + 2);
    ctx.font = `bold ${Math.max(10, Math.floor(h * 0.38))}px sans-serif`;
    ctx.fillStyle = suitStyle.color;
    ctx.fillText(suitStyle.symbol, x + 3, y + Math.floor(h * 0.48));
    Card._drawSuitLabel(ctx, x, y, w, h, suitStyle, { compact: true });

    ctx.restore();
  }

  static _suitStyle(suit) {
    return SUIT_STYLE[suit] || DEFAULT_SUIT_STYLE;
  }

  static _rankColor(suit) {
    const normalSuit = String(suit || '').replace('2', '');
    return normalSuit === 'H' || normalSuit === 'D' ? '#c9182b' : '#111827';
  }

  static _drawSuitAccent(ctx, x, y, w, h, r, style, ma) {
    ctx.save();
    Card._roundRect(ctx, x, y, w, h, r);
    ctx.clip();
    ctx.fillStyle = style.accent;
    ctx.globalAlpha = ma ? 0.22 : 0.16;
    ctx.fillRect(x + 1, y + 1, Math.max(2, Math.floor(w * 0.045)), h - 2);
    ctx.restore();
  }

  static _drawSuitLabel(ctx, x, y, w, h, style, opts = {}) {
    const compact = !!opts.compact;
    const boxW = Math.max(compact ? 12 : 16, Math.floor(w * (compact ? 0.48 : 0.42)));
    const boxH = Math.max(compact ? 9 : 12, Math.floor(h * (compact ? 0.28 : 0.20)));
    const boxX = x + w - boxW - 3;
    const boxY = y + h - boxH - 3;

    ctx.save();
    Card._roundRect(ctx, boxX, boxY, boxW, boxH, Math.max(2, Math.floor(boxH * 0.28)));
    ctx.fillStyle = style.labelBg;
    ctx.globalAlpha = 0.96;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.max(compact ? 8 : 10, Math.floor(boxH * 0.78))}px sans-serif`;
    ctx.fillText(style.label, boxX + boxW / 2, boxY + boxH / 2 + 0.5);
    ctx.restore();
  }

  static _fillCardBackground(ctx, x, y, w, h, r, ma) {
    Card._roundRect(ctx, x, y, w, h, r);
    ctx.fillStyle = ma ? '#d7fff4' : '#fff';
    ctx.fill();
    if (ma) {
      ctx.save();
      Card._roundRect(ctx, x, y, w, h, r);
      ctx.clip();
      ctx.strokeStyle = 'rgba(0,188,212,0.42)';
      ctx.lineWidth = Math.max(2, Math.floor(w * 0.08));
      for (let sx = x - h; sx < x + w; sx += Math.max(8, Math.floor(w * 0.38))) {
        ctx.beginPath();
        ctx.moveTo(sx, y + h);
        ctx.lineTo(sx + h, y);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,235,59,0.22)';
      ctx.fillRect(x, y, w, Math.max(3, Math.floor(h * 0.16)));
      ctx.restore();
      Card._roundRect(ctx, x, y, w, h, r);
    }
  }

  static _strokeMaHighlight(ctx, x, y, w, h, r) {
    ctx.save();
    Card._roundRect(ctx, x + 1, y + 1, w - 2, h - 2, Math.max(2, r - 1));
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 1;
    ctx.stroke();
    Card._roundRect(ctx, x + 3, y + 3, w - 6, h - 6, Math.max(2, r - 2));
    ctx.strokeStyle = 'rgba(255,235,59,0.95)';
    ctx.lineWidth = 1;
    ctx.stroke();
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
