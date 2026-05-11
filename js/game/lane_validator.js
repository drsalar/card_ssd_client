// 客户端三道校验（与服务端保持一致）
import { evaluate, compare } from './hand_evaluator';

// 校验三道：返回 { ok, errors:{head,middle,tail}, head, middle, tail }
export function validateLanes(headCards, middleCards, tailCards) {
  const errors = { head: true, middle: true, tail: true };
  if (!headCards || headCards.length !== 3) errors.head = false;
  if (!middleCards || middleCards.length !== 5) errors.middle = false;
  if (!tailCards || tailCards.length !== 5) errors.tail = false;
  if (!errors.head || !errors.middle || !errors.tail) {
    return { ok: false, errors };
  }
  const h = evaluate(headCards, true);
  const m = evaluate(middleCards, false);
  const t = evaluate(tailCards, false);
  if (compare(h, m) > 0) {
    errors.head = false;
    errors.middle = false;
  }
  if (compare(m, t) > 0) {
    errors.middle = false;
    errors.tail = false;
  }
  const ok = errors.head && errors.middle && errors.tail;
  return { ok, errors, head: h, middle: m, tail: t };
}
