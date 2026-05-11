// 牌组渲染与命中检测
import Card, { CARD_WIDTH, CARD_HEIGHT } from './Card';

export default class CardGroup {
  // 渲染水平排列的手牌，并可标记选中索引
  // opts: { x, y, width, cardW, cardH, selected: Set<number>, overlap }
  // 返回每张牌的命中区域 [{x,y,w,h,index}]
  static renderHand(ctx, cards, opts = {}) {
    const x0 = opts.x || 0;
    const y0 = opts.y || 0;
    const width = opts.width || (cards.length * CARD_WIDTH);
    const cardW = opts.cardW || CARD_WIDTH;
    const cardH = opts.cardH || CARD_HEIGHT;
    const selected = opts.selected || null;

    // 自动重叠：当总宽超过 width 时压缩间距
    const total = cards.length * cardW;
    let step = cardW;
    if (cards.length > 1) {
      step = Math.min(cardW, (width - cardW) / (cards.length - 1));
      if (step < 12) step = 12;
    }
    const hits = [];
    for (let i = 0; i < cards.length; i++) {
      const cx = x0 + i * step;
      const isSel = selected && (selected instanceof Set ? selected.has(i) : selected.indexOf(i) >= 0);
      Card.render(ctx, cards[i], cx, y0, { width: cardW, height: cardH, selected: isSel });
      hits.push({ x: cx, y: y0 + (isSel ? -10 : 0), w: cardW, h: cardH, index: i });
    }
    return hits;
  }

  // 渲染道牌 - 紧凑横向排列（不可选中）
  static renderLane(ctx, cards, opts = {}) {
    const x0 = opts.x || 0;
    const y0 = opts.y || 0;
    const cardW = opts.cardW || 32;
    const cardH = opts.cardH || 48;
    const step = opts.step || (cardW * 0.55);
    for (let i = 0; i < cards.length; i++) {
      Card.render(ctx, cards[i], x0 + i * step, y0, { width: cardW, height: cardH });
    }
  }

  // 命中检测：返回点击的牌索引或 -1
  // 注意：从右往左遍历以便上层（视觉上后绘制的）优先命中
  static hitTest(hits, x, y) {
    for (let i = hits.length - 1; i >= 0; i--) {
      const r = hits[i];
      // 命中区域取较宽的一段（重叠区只取最右那张）
      const right = (i === hits.length - 1) ? r.x + r.w : hits[i + 1].x;
      if (x >= r.x && x < right && y >= r.y && y <= r.y + r.h) {
        return r.index;
      }
    }
    return -1;
  }
}
