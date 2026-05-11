// 牌型识别 + 比牌
// 牌型枚举（数字越大牌型越大）
// 注：头道仅可能为 高牌(乌龙)/对子/三条
const TYPE = {
  HIGH: 1,        // 乌龙（散牌）
  PAIR: 2,        // 对子
  TWO_PAIR: 3,    // 两对
  THREE: 4,       // 三条
  STRAIGHT: 5,    // 顺子
  FLUSH: 6,       // 同花
  FULL: 7,        // 葫芦
  FOUR: 8,        // 炸弹
  STRAIGHT_FLUSH: 9, // 同花顺
  FIVE: 10,       // 五龙
};

const TYPE_NAME = {
  1: '乌龙', 2: '对子', 3: '两对', 4: '三条',
  5: '顺子', 6: '同花', 7: '葫芦', 8: '炸弹',
  9: '同花顺', 10: '五龙',
};

const { sameSuit, rankValue } = require('./card');

// 把同 rank 的卡分组（不区分花色）
function groupByRank(cards) {
  const map = {};
  cards.forEach((c) => {
    map[c.rank] = (map[c.rank] || 0) + 1;
  });
  return map;
}

// 是否同花（5 张）
function isFlush(cards) {
  if (cards.length !== 5) return false;
  const s0 = cards[0].suit.replace('2', '');
  return cards.every((c) => c.suit.replace('2', '') === s0);
}

// 是否顺子（A 可作 1 用），返回 { ok, top }
// top: 顺子的最大点数（1-5 顺子 top=5；10-A 顺子 top=14）
function checkStraight(cards) {
  if (cards.length !== 5) return { ok: false };
  // 取去重 rank
  const ranks = cards.map((c) => c.rank).sort((a, b) => a - b);
  for (let i = 1; i < ranks.length; i++) {
    if (ranks[i] === ranks[i - 1]) return { ok: false }; // 有重复无法成顺
  }
  // 普通顺子
  if (ranks[4] - ranks[0] === 4) {
    return { ok: true, top: ranks[4] === 1 ? 14 : (ranks[4] === 13 && ranks[0] === 9 ? 13 : ranks[4]) };
  }
  // 10-J-Q-K-A : ranks 排序后 = [1,10,11,12,13]
  if (ranks[0] === 1 && ranks[1] === 10 && ranks[4] === 13) {
    return { ok: true, top: 14 };
  }
  // 1-2-3-4-5: ranks = [1,2,3,4,5]
  if (ranks[0] === 1 && ranks[4] === 5 && ranks[1] === 2 && ranks[2] === 3 && ranks[3] === 4) {
    return { ok: true, top: 5 };
  }
  return { ok: false };
}

// 评估 5 张牌的牌型
// isHead: 是否是头道（只取 3 张）
// 返回: { type, name, ranks, extra }
//   ranks: 用于比牌的关键点数数组（从大到小）
//   extra: 同花上的对子计数（加色规则用）
function evaluate(cards, isHead) {
  cards = cards.slice();
  if (isHead) {
    return evaluateHead(cards);
  }
  if (cards.length !== 5) {
    return { type: TYPE.HIGH, name: '乌龙', ranks: [] };
  }
  const groups = groupByRank(cards);
  const counts = Object.values(groups).sort((a, b) => b - a);
  // 5 龙
  if (counts[0] === 5) {
    const r = parseInt(Object.keys(groups)[0], 10);
    return { type: TYPE.FIVE, name: TYPE_NAME[10], ranks: [rankValue(r)] };
  }
  const flush = isFlush(cards);
  const straight = checkStraight(cards);
  // 同花顺
  if (flush && straight.ok) {
    return { type: TYPE.STRAIGHT_FLUSH, name: TYPE_NAME[9], ranks: [straight.top] };
  }
  // 炸弹（4 张同点）
  if (counts[0] === 4) {
    let four = 0, kicker = 0;
    for (const r in groups) {
      if (groups[r] === 4) four = parseInt(r, 10);
      else kicker = parseInt(r, 10);
    }
    return {
      type: TYPE.FOUR, name: TYPE_NAME[8],
      ranks: [rankValue(four), rankValue(kicker)],
    };
  }
  // 葫芦（3+2）
  if (counts[0] === 3 && counts[1] === 2) {
    let three = 0, pair = 0;
    for (const r in groups) {
      if (groups[r] === 3) three = parseInt(r, 10);
      else if (groups[r] === 2) pair = parseInt(r, 10);
    }
    return {
      type: TYPE.FULL, name: TYPE_NAME[7],
      ranks: [rankValue(three), rankValue(pair)],
    };
  }
  // 同花
  if (flush) {
    // 加色规则：带对的同花特殊
    const pairs = countPairs(groups);
    return {
      type: TYPE.FLUSH, name: TYPE_NAME[6],
      ranks: cards.map((c) => rankValue(c.rank)).sort((a, b) => b - a),
      extra: { pairs },
    };
  }
  // 顺子
  if (straight.ok) {
    return { type: TYPE.STRAIGHT, name: TYPE_NAME[5], ranks: [straight.top] };
  }
  // 三条（中尾道）
  if (counts[0] === 3) {
    let three = 0;
    const kickers = [];
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
  // 两对
  if (counts[0] === 2 && counts[1] === 2) {
    const pairs = [];
    let kicker = 0;
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
  // 对子
  if (counts[0] === 2) {
    let pair = 0;
    const kickers = [];
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
  // 高牌
  return {
    type: TYPE.HIGH, name: TYPE_NAME[1],
    ranks: cards.map((c) => rankValue(c.rank)).sort((a, b) => b - a),
  };
}

// 头道（3 张）评估
function evaluateHead(cards) {
  if (cards.length !== 3) return { type: TYPE.HIGH, name: '乌龙', ranks: [] };
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
    return {
      type: TYPE.PAIR, name: TYPE_NAME[2],
      ranks: [rankValue(pair), rankValue(kicker)],
    };
  }
  // 乌龙
  return {
    type: TYPE.HIGH, name: TYPE_NAME[1],
    ranks: cards.map((c) => rankValue(c.rank)).sort((a, b) => b - a),
  };
}

// 数对子组数（用于同花带对加色规则）
function countPairs(groups) {
  let n = 0;
  for (const r in groups) {
    if (groups[r] >= 2) n++;
  }
  return n;
}

// 比较两个评估结果
// 返回 1: a > b ; -1: a < b ; 0: 相等
function compare(a, b) {
  if (a.type !== b.type) return a.type > b.type ? 1 : -1;
  // 同花特殊：带对同花 > 普通同花；2 对同花 > 1 对同花
  if (a.type === TYPE.FLUSH) {
    const pa = (a.extra && a.extra.pairs) || 0;
    const pb = (b.extra && b.extra.pairs) || 0;
    if (pa !== pb) return pa > pb ? 1 : -1;
  }
  const la = a.ranks || [];
  const lb = b.ranks || [];
  const len = Math.max(la.length, lb.length);
  for (let i = 0; i < len; i++) {
    const va = la[i] || 0;
    const vb = lb[i] || 0;
    if (va !== vb) return va > vb ? 1 : -1;
  }
  return 0;
}

module.exports = {
  TYPE,
  TYPE_NAME,
  evaluate,
  compare,
};
