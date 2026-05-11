// 客户端共享的卡牌工具（与服务端保持一致）

// 是否同花色（不区分加色组）
export function sameSuit(a, b) {
  const sa = a.suit.replace('2', '');
  const sb = b.suit.replace('2', '');
  return sa === sb;
}

// 比较点数：A(1) 默认最大
export function rankValue(r) {
  return r === 1 ? 14 : r;
}

// 是否红桃 5（马牌）
export function isMaCard(c) {
  return c.suit === 'H' && c.rank === 5;
}

// 按花色排序
export function sortBySuit(cards) {
  const order = { S: 0, H: 1, C: 2, C2: 2, D: 3, D2: 3 };
  return cards.slice().sort((a, b) => {
    if (order[a.suit] !== order[b.suit]) return order[a.suit] - order[b.suit];
    return rankValue(b.rank) - rankValue(a.rank);
  });
}

// 按点数排序（从大到小，同点数按黑红梅方）
export function sortByRank(cards) {
  const suitOrder = { S: 0, H: 1, C: 2, C2: 2, D: 3, D2: 3 };
  return cards.slice().sort((a, b) => {
    const rankDiff = rankValue(b.rank) - rankValue(a.rank);
    if (rankDiff !== 0) return rankDiff;
    return suitOrder[a.suit] - suitOrder[b.suit];
  });
}
