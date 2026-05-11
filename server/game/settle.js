// 比牌结算引擎
// 输入：players[] = { openid, hand: 13张, lanes: {head, middle, tail}, submitted, offline }
// 输出 perPlayer 详细积分明细 + 比牌过程信息
const { evaluate, compare, TYPE } = require('./hand_evaluator');
const { isMaCard } = require('./card');

// 中道特殊加分
const MID_BONUS = {
  [TYPE.FULL]: 1,
  [TYPE.FOUR]: 3,
  [TYPE.STRAIGHT_FLUSH]: 4,
  [TYPE.FIVE]: 9,
};
// 尾道特殊加分
const TAIL_BONUS = {
  [TYPE.FOUR]: 3,
  [TYPE.STRAIGHT_FLUSH]: 4,
  [TYPE.FIVE]: 9,
};
const HEAD_THREE_BONUS = 2; // 冲三

// 主入口：结算一局
// withMa: 是否启用马牌（红桃 5 双倍）
function settle(players, withMa) {
  // 1. 评估每位玩家三道
  const evals = players.map((p) => {
    if (!p.lanes) {
      return null;
    }
    return {
      openid: p.openid,
      head: evaluate(p.lanes.head, true),
      middle: evaluate(p.lanes.middle, false),
      tail: evaluate(p.lanes.tail, false),
      hasMa: withMa && hasMa(p),
    };
  });

  const n = players.length;
  // 每位玩家对每位对手的对比结果（先不计马牌倍率）
  // pair[i][j] = { head:{r, base}, middle:..., tail:..., extra:n, gun:bool, scoreI, scoreJ }
  const pairResults = [];
  // 玩家本局总分（i 视角）
  const baseScores = new Array(n).fill(0);
  const laneScoresPerPlayer = []; // 每个玩家的逐道汇总（含特殊加分）
  for (let i = 0; i < n; i++) laneScoresPerPlayer.push({ head: 0, middle: 0, tail: 0, extra: 0 });

  // 两两比较
  const comparePairs = []; // [{i, j, head, middle, tail, extras, gun}]
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const ei = evals[i], ej = evals[j];
      if (!ei || !ej) continue;
      const result = comparePair(ei, ej);
      // 应用到 baseScores
      baseScores[i] += result.scoreI;
      baseScores[j] += result.scoreJ;
      // 累积到逐道
      laneScoresPerPlayer[i].head += result.head.scoreI;
      laneScoresPerPlayer[i].middle += result.middle.scoreI;
      laneScoresPerPlayer[i].tail += result.tail.scoreI;
      laneScoresPerPlayer[i].extra += result.extra.scoreI;
      laneScoresPerPlayer[j].head += result.head.scoreJ;
      laneScoresPerPlayer[j].middle += result.middle.scoreJ;
      laneScoresPerPlayer[j].tail += result.tail.scoreJ;
      laneScoresPerPlayer[j].extra += result.extra.scoreJ;
      comparePairs.push({ i, j, ...result });
    }
  }

  // 2. 本垒打：某玩家打枪所有对手（n>=2 时，三人及以上才有意义）
  const homeruns = []; // [openid]
  if (n >= 3) {
    for (let i = 0; i < n; i++) {
      const ei = evals[i];
      if (!ei) continue;
      const allGun = comparePairs
        .filter((p) => p.i === i || p.j === i)
        .every((p) => (p.i === i ? p.gunI : p.gunJ));
      if (allGun && comparePairs.filter((p) => p.i === i || p.j === i).length === n - 1) {
        // 整体再 ×2
        homeruns.push(evals[i].openid);
      }
    }
  }

  // 3. 计算最终积分（应用马牌倍率与本垒打倍率）
  const finalScores = baseScores.slice();
  // 本垒打：作用方分数 ×2
  homeruns.forEach((openid) => {
    const idx = players.findIndex((p) => p.openid === openid);
    if (idx >= 0) finalScores[idx] *= 2;
    // 同时其他玩家的分数也要加倍（因为是从他们身上多扣）
    // 严格按规则：本垒打是「在打枪基础上再加倍」，因此对手扣的分也翻倍
    for (let k = 0; k < n; k++) {
      if (k === idx) continue;
      // 对应对手对该 idx 的输分翻倍
      // 此处简化：将对手最终分数也乘 2（仅其与 idx 之间的差额会随之翻倍）
      // 由于我们先累加了 baseScores，再单独 ×2 finalScore[idx] 已使其翻倍；
      // 为对应「输给打枪者的对手」也加倍，需调整：把每个对手与 idx 之间的差额再额外扣一次
    }
  });
  // 严格处理本垒打：重新计算
  const recalc = recomputeWithBonus(comparePairs, n, homeruns, players);
  for (let i = 0; i < n; i++) finalScores[i] = recalc[i];

  // 4. 马牌倍率：拥有红桃 5 的玩家最终分数 ×2
  if (withMa) {
    for (let i = 0; i < n; i++) {
      if (evals[i] && evals[i].hasMa) {
        finalScores[i] *= 2;
      }
    }
  }

  return {
    players: players.map((p, i) => ({
      openid: p.openid,
      lanes: p.lanes,
      handTypes: evals[i] ? {
        head: evals[i].head, middle: evals[i].middle, tail: evals[i].tail,
      } : null,
      hasMa: evals[i] ? evals[i].hasMa : false,
      baseScore: baseScores[i],
      finalScore: finalScores[i],
      laneScores: laneScoresPerPlayer[i],
    })),
    pairs: comparePairs,
    homeruns,
  };
}

// 重新计算积分以支持本垒打
// 简化处理：对存在于 homeruns 的玩家，其相关 pair 分数全部 ×2
function recomputeWithBonus(comparePairs, n, homeruns, players) {
  const homeIdx = new Set();
  homeruns.forEach((oid) => {
    const i = players.findIndex((p) => p.openid === oid);
    if (i >= 0) homeIdx.add(i);
  });
  const scores = new Array(n).fill(0);
  comparePairs.forEach((p) => {
    let mul = 1;
    if (homeIdx.has(p.i) || homeIdx.has(p.j)) mul = 2;
    scores[p.i] += p.scoreI * mul;
    scores[p.j] += p.scoreJ * mul;
  });
  return scores;
}

// 玩家是否持有红桃 5
function hasMa(player) {
  if (!player.hand && !player.lanes) return false;
  if (player.hand && player.hand.length) {
    return player.hand.some(isMaCard);
  }
  if (player.lanes) {
    return [
      ...(player.lanes.head || []),
      ...(player.lanes.middle || []),
      ...(player.lanes.tail || []),
    ].some(isMaCard);
  }
  return false;
}

// 比较两位玩家的三道
function comparePair(ei, ej) {
  // 各道 1 分
  const headCmp = compare(ei.head, ej.head);
  const midCmp = compare(ei.middle, ej.middle);
  const tailCmp = compare(ei.tail, ej.tail);
  const head = laneScore(headCmp);
  const middle = laneScore(midCmp);
  const tail = laneScore(tailCmp);

  // 特殊加分（输方支付）
  // 冲三：头道三条
  let extraI = 0, extraJ = 0;
  if (ei.head.type === TYPE.THREE && headCmp >= 0) extraI += HEAD_THREE_BONUS;
  if (ej.head.type === TYPE.THREE && headCmp <= 0) extraJ += HEAD_THREE_BONUS;
  // 中道
  const midBonusI = MID_BONUS[ei.middle.type] || 0;
  const midBonusJ = MID_BONUS[ej.middle.type] || 0;
  if (midBonusI && midCmp >= 0) extraI += midBonusI;
  if (midBonusJ && midCmp <= 0) extraJ += midBonusJ;
  // 尾道
  const tailBonusI = TAIL_BONUS[ei.tail.type] || 0;
  const tailBonusJ = TAIL_BONUS[ej.tail.type] || 0;
  if (tailBonusI && tailCmp >= 0) extraI += tailBonusI;
  if (tailBonusJ && tailCmp <= 0) extraJ += tailBonusJ;

  // 打枪：i 三道全胜 j → i 整体加倍
  const gunI = headCmp > 0 && midCmp > 0 && tailCmp > 0;
  const gunJ = headCmp < 0 && midCmp < 0 && tailCmp < 0;

  // 基础得分
  let scoreI = head.scoreI + middle.scoreI + tail.scoreI + extraI - extraJ;
  let scoreJ = head.scoreJ + middle.scoreJ + tail.scoreJ + extraJ - extraI;
  // 打枪整体 ×2
  if (gunI || gunJ) {
    scoreI *= 2;
    scoreJ *= 2;
  }
  return {
    head: { cmp: headCmp, scoreI: head.scoreI, scoreJ: head.scoreJ },
    middle: { cmp: midCmp, scoreI: middle.scoreI, scoreJ: middle.scoreJ },
    tail: { cmp: tailCmp, scoreI: tail.scoreI, scoreJ: tail.scoreJ },
    extra: { scoreI: extraI - extraJ, scoreJ: extraJ - extraI, bonusI: extraI, bonusJ: extraJ },
    gunI, gunJ,
    scoreI, scoreJ,
  };
}

function laneScore(cmp) {
  if (cmp > 0) return { scoreI: 1, scoreJ: -1 };
  if (cmp < 0) return { scoreI: -1, scoreJ: 1 };
  return { scoreI: 0, scoreJ: 0 };
}

module.exports = { settle };
