// 牌型识别与比较（与服务端逻辑保持一致）

export const TYPE = {
  HIGH: 1, PAIR: 2, TWO_PAIR: 3, THREE: 4,
  STRAIGHT: 5, FLUSH: 6, FULL: 7, FOUR: 8,
  STRAIGHT_FLUSH: 9, FIVE: 10,
};
export const TYPE_NAME = {
  1: '散牌', 2: '对子', 3: '两对', 4: '三条',
  5: '顺子', 6: '同花', 7: '葫芦', 8: '炸弹',
  9: '同花顺', 10: '五龙',
};

import { rankValue } from './card';

function groupByRank(cards) {
  const map = {};
  cards.forEach((c) => { map[c.rank] = (map[c.rank] || 0) + 1; });
  return map;
}

function isFlush(cards) {
  if (cards.length !== 5) return false;
  const s0 = cards[0].suit.replace('2', '');
  return cards.every((c) => c.suit.replace('2', '') === s0);
}

function checkStraight(cards) {
  if (cards.length !== 5) return { ok: false };
  const ranks = cards.map((c) => c.rank).sort((a, b) => a - b);
  for (let i = 1; i < ranks.length; i++) {
    if (ranks[i] === ranks[i - 1]) return { ok: false };
  }
  if (ranks[4] - ranks[0] === 4) {
    return { ok: true, top: ranks[4] === 1 ? 14 : ranks[4] };
  }
  if (ranks[0] === 1 && ranks[1] === 10 && ranks[4] === 13) {
    return { ok: true, top: 14 };
  }
  if (ranks[0] === 1 && ranks[4] === 5) {
    return { ok: true, top: 5 };
  }
  return { ok: false };
}

function countPairs(groups) {
  let n = 0;
  for (const r in groups) if (groups[r] >= 2) n++;
  return n;
}

// 评估牌型
export function evaluate(cards, isHead) {
  cards = cards.slice();
  if (isHead) return evaluateHead(cards);
  if (cards.length !== 5) return { type: TYPE.HIGH, name: TYPE_NAME[1], ranks: [] };
  const groups = groupByRank(cards);
  const counts = Object.values(groups).sort((a, b) => b - a);
  if (counts[0] === 5) {
    const r = parseInt(Object.keys(groups)[0], 10);
    return { type: TYPE.FIVE, name: TYPE_NAME[10], ranks: [rankValue(r)] };
  }
  const flush = isFlush(cards);
  const straight = checkStraight(cards);
  if (flush && straight.ok) {
    return { type: TYPE.STRAIGHT_FLUSH, name: TYPE_NAME[9], ranks: [straight.top] };
  }
  if (counts[0] === 4) {
    let four = 0, kicker = 0;
    for (const r in groups) {
      if (groups[r] === 4) four = parseInt(r, 10);
      else kicker = parseInt(r, 10);
    }
    return { type: TYPE.FOUR, name: TYPE_NAME[8], ranks: [rankValue(four), rankValue(kicker)] };
  }
  if (counts[0] === 3 && counts[1] === 2) {
    let three = 0, pair = 0;
    for (const r in groups) {
      if (groups[r] === 3) three = parseInt(r, 10);
      else if (groups[r] === 2) pair = parseInt(r, 10);
    }
    return { type: TYPE.FULL, name: TYPE_NAME[7], ranks: [rankValue(three), rankValue(pair)] };
  }
  if (flush) {
    const pairs = countPairs(groups);
    return {
      type: TYPE.FLUSH, name: TYPE_NAME[6],
      ranks: cards.map((c) => rankValue(c.rank)).sort((a, b) => b - a),
      extra: { pairs },
    };
  }
  if (straight.ok) return { type: TYPE.STRAIGHT, name: TYPE_NAME[5], ranks: [straight.top] };
  if (counts[0] === 3) {
    let three = 0; const kickers = [];
    for (const r in groups) {
      if (groups[r] === 3) three = parseInt(r, 10);
      else kickers.push(parseInt(r, 10));
    }
    kickers.sort((a, b) => rankValue(b) - rankValue(a));
    return {
      type: TYPE.THREE, name: TYPE_NAME[4],
      ranks: [rankValue(three), rankValue(kickers[0]), rankValue(kickers[1])],
    };
  }
  if (counts[0] === 2 && counts[1] === 2) {
    const pairs = []; let kicker = 0;
    for (const r in groups) {
      if (groups[r] === 2) pairs.push(parseInt(r, 10));
      else kicker = parseInt(r, 10);
    }
    pairs.sort((a, b) => rankValue(b) - rankValue(a));
    return {
      type: TYPE.TWO_PAIR, name: TYPE_NAME[3],
      ranks: [rankValue(pairs[0]), rankValue(pairs[1]), rankValue(kicker)],
    };
  }
  if (counts[0] === 2) {
    let pair = 0; const kickers = [];
    for (const r in groups) {
      if (groups[r] === 2) pair = parseInt(r, 10);
      else kickers.push(parseInt(r, 10));
    }
    kickers.sort((a, b) => rankValue(b) - rankValue(a));
    return {
      type: TYPE.PAIR, name: TYPE_NAME[2],
      ranks: [rankValue(pair), ...kickers.map(rankValue)],
    };
  }
  return {
    type: TYPE.HIGH, name: TYPE_NAME[1],
    ranks: cards.map((c) => rankValue(c.rank)).sort((a, b) => b - a),
  };
}

function evaluateHead(cards) {
  if (cards.length !== 3) return { type: TYPE.HIGH, name: TYPE_NAME[1], ranks: [] };
  const groups = groupByRank(cards);
  const counts = Object.values(groups).sort((a, b) => b - a);
  if (counts[0] === 3) {
    const r = parseInt(Object.keys(groups)[0], 10);
    return { type: TYPE.THREE, name: TYPE_NAME[4], ranks: [rankValue(r)] };
  }
  if (counts[0] === 2) {
    let pair = 0, kicker = 0;
    for (const r in groups) {
      if (groups[r] === 2) pair = parseInt(r, 10);
      else kicker = parseInt(r, 10);
    }
    return { type: TYPE.PAIR, name: TYPE_NAME[2], ranks: [rankValue(pair), rankValue(kicker)] };
  }
  return {
    type: TYPE.HIGH, name: TYPE_NAME[1],
    ranks: cards.map((c) => rankValue(c.rank)).sort((a, b) => b - a),
  };
}

// 比较两个评估结果
export function compare(a, b) {
  if (a.type !== b.type) return a.type > b.type ? 1 : -1;
  if (a.type === TYPE.FLUSH) {
    const pa = (a.extra && a.extra.pairs) || 0;
    const pb = (b.extra && b.extra.pairs) || 0;
    if (pa !== pb) return pa > pb ? 1 : -1;
  }
  const la = a.ranks || []; const lb = b.ranks || [];
  const len = Math.max(la.length, lb.length);
  for (let i = 0; i < len; i++) {
    const va = la[i] || 0, vb = lb[i] || 0;
    if (va !== vb) return va > vb ? 1 : -1;
  }
  return 0;
}
