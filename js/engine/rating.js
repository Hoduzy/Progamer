import { CONFIG } from '../config.js';
import { clamp } from '../core/util.js';

// summary(g) 결과로 10명 평점 계산. choice: { pid, score } (선택 장면 누적)
export function computeRatings(sum, choice = null) {
  const R = CONFIG.rating;
  const out = {};
  sum.sides.forEach((s, si) => {
    const win = sum.winner === si;
    const teamK = Math.max(1, s.kills);
    const totalDmg = s.players.reduce((a, p) => a + p.dmg, 0) || 1;
    const mins = Math.max(15, sum.duration / 60);
    for (const p of s.players) {
      const kp = (p.k + p.a) / teamK;
      const dmgShare = p.dmg / totalDmg;
      let r = R.base + (win ? R.win : R.lose);
      const per30 = 30 / mins;
      r += p.k * R.kill * per30 + p.d * R.death * per30 + p.a * R.assist * per30;
      r += (kp - R.kpAvg) * R.kpWeight;
      r += (dmgShare - R.roleDmgAvg[p.pos]) * R.dmgWeight;
      r += (p.vision * per30 - R.visionAvg[p.pos]) * R.visionWeight;
      if (p.pos === 'SUP') r += p.a * R.supportAssistBonus * per30;
      if (choice && choice.pid === p.pid) r += choice.score * R.choiceWeight;
      out[p.pid] = { rating: Math.round(clamp(r, 0, 10) * 10) / 10, kp, dmgShare };
    }
  });
  return out;
}

export function pickPOG(sum, ratings) {
  const w = sum.sides[sum.winner];
  let best = null;
  for (const p of w.players) if (!best || ratings[p.pid].rating > ratings[best.pid].rating) best = p;
  return best ? best.pid : null;
}
