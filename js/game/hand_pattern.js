import { rankValue } from './card';
import { compare, evaluate, TYPE } from './hand_evaluator';

export const HAND_PATTERN_DEFS = [
  { key: 'five', label: '五龙', type: TYPE.FIVE },
  { key: 'straightFlush', label: '同花顺', type: TYPE.STRAIGHT_FLUSH },
  { key: 'four', label: '炸弹', type: TYPE.FOUR },
  { key: 'full', label: '葫芦', type: TYPE.FULL },
  { key: 'flush', label: '同花', type: TYPE.FLUSH },
  { key: 'straight', label: '顺子', type: TYPE.STRAIGHT },
  { key: 'three', label: '三条', type: TYPE.THREE, coreSize: 3 },
  { key: 'pair', label: '对子', type: TYPE.PAIR, coreSize: 2 },
];

const TYPE_BY_KEY = HAND_PATTERN_DEFS.reduce((map, def) => {
  map[def.key] = def;
  return map;
}, {});

function pickIndices(total, size, start, current, out) {
  if (current.length === size) {
    out.push(current.slice());
    return;
  }
  for (let i = start; i <= total - (size - current.length); i++) {
    current.push(i);
    pickIndices(total, size, i + 1, current, out);
    current.pop();
  }
}

function buildCards(hand, indices) {
  return indices.map((i) => hand[i]);
}

function sortCoreCombos(a, b) {
  const ar = rankValue(a.cards[0].rank);
  const br = rankValue(b.cards[0].rank);
  if (ar !== br) return br - ar;
  for (let i = 0; i < Math.min(a.indices.length, b.indices.length); i++) {
    if (a.indices[i] !== b.indices[i]) return a.indices[i] - b.indices[i];
  }
  return a.indices.length - b.indices.length;
}

function findFiveCardCombos(hand, type) {
  const indicesList = [];
  pickIndices(hand.length, 5, 0, [], indicesList);
  return indicesList
    .map((indices) => {
      const cards = buildCards(hand, indices);
      return { indices, cards, ev: evaluate(cards) };
    })
    .filter((item) => item.ev.type === type)
    .sort((a, b) => compare(b.ev, a.ev));
}

function findSameRankCoreCombos(hand, size) {
  const groups = {};
  hand.forEach((card, index) => {
    if (!groups[card.rank]) groups[card.rank] = [];
    groups[card.rank].push(index);
  });
  const out = [];
  Object.keys(groups).forEach((rank) => {
    const list = groups[rank];
    if (list.length < size) return;
    const local = [];
    pickIndices(list.length, size, 0, [], local);
    local.forEach((picked) => {
      const indices = picked.map((i) => list[i]);
      out.push({ indices, cards: buildCards(hand, indices) });
    });
  });
  return out.sort(sortCoreCombos);
}

export function findPatternCombos(hand, key) {
  const def = TYPE_BY_KEY[key];
  if (!def || !Array.isArray(hand) || hand.length < 2) return [];
  if (def.coreSize) return findSameRankCoreCombos(hand, def.coreSize);
  if (hand.length < 5) return [];
  return findFiveCardCombos(hand, def.type);
}
