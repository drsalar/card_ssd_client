// 牌组生成与发牌
// 卡牌格式：{ suit: 'S'|'H'|'D'|'C'|'D2'|'C2', rank: 1..13 }

const SUITS_BASE = ['S', 'H', 'D', 'C']; // 4 套基础花色

// 根据玩家数量生成牌堆
// 4 人及以下：标准 52 张
// 5 人：加一组方块（+13 张，共 65）
// 6 人：再加一组草花（+13 张，共 78）
function buildDeck(playerCount) {
  const cards = [];
  const suits = SUITS_BASE.slice();
  if (playerCount >= 5) suits.push('D2');
  if (playerCount >= 6) suits.push('C2');
  for (const s of suits) {
    for (let r = 1; r <= 13; r++) {
      cards.push({ suit: s, rank: r });
    }
  }
  return cards;
}

// Fisher-Yates 洗牌
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

// 发牌：每人 13 张
function deal(playerCount) {
  const deck = shuffle(buildDeck(playerCount));
  // 总牌数应 >= playerCount * 13
  const hands = [];
  for (let i = 0; i < playerCount; i++) {
    hands.push(deck.slice(i * 13, (i + 1) * 13));
  }
  return hands;
}

// 是否为红桃 5（马牌）
function isMaCard(c) {
  return c.suit === 'H' && c.rank === 5;
}

// 是否同花色（不区分加色组）
// 注意：根据规则，同花以视觉花色为准（D 与 D2 都是方块）
function sameSuit(a, b) {
  const sa = a.suit.replace('2', '');
  const sb = b.suit.replace('2', '');
  return sa === sb;
}

// 比较两张牌点数：A(1) 默认最大
function rankValue(r) {
  return r === 1 ? 14 : r;
}

class Deck {
  static deal(playerCount) { return deal(playerCount); }
}

module.exports = {
  buildDeck,
  shuffle,
  deal,
  isMaCard,
  sameSuit,
  rankValue,
  Deck,
};
