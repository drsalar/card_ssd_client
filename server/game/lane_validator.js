// 三道合法性校验
const evaluator = require('./hand_evaluator');

// 校验三道总张数与「头道 < 中道 ≤ 尾道」
// 返回 { ok, head, middle, tail, errors: { head, middle, tail } }
//   errors: 各道是否合法（boolean，true=合法）
function validateLanes(headCards, middleCards, tailCards) {
  const errors = { head: true, middle: true, tail: true };
  // 张数校验
  if (!headCards || headCards.length !== 3) errors.head = false;
  if (!middleCards || middleCards.length !== 5) errors.middle = false;
  if (!tailCards || tailCards.length !== 5) errors.tail = false;
  if (!errors.head || !errors.middle || !errors.tail) {
    return { ok: false, errors };
  }
  const h = evaluator.evaluate(headCards, true);
  const m = evaluator.evaluate(middleCards, false);
  const t = evaluator.evaluate(tailCards, false);
  // 头道 < 中道
  if (evaluator.compare(h, m) > 0) {
    errors.head = false;
    errors.middle = false;
  }
  // 中道 ≤ 尾道
  if (evaluator.compare(m, t) > 0) {
    errors.middle = false;
    errors.tail = false;
  }
  const ok = errors.head && errors.middle && errors.tail;
  return { ok, errors, head: h, middle: m, tail: t };
}

module.exports = { validateLanes };
