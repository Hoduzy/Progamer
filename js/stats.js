// ============================================================
//  능력치·OVR 기준 — 모든 선수(내 선수·AI·1군·2군·신인·해외·FA)가 이 파일만 쓴다
//   - OVR = 능력치 8개 × 포지션별 가중치(CONFIG.ovrWeights) 합. 계산은 ovrOf 하나뿐
//   - 능력치 생성 = 목표 OVR 근처로 만들고 가중치로 맞춤 (genStats 하나뿐)
//   - 목표 OVR: 1군(티어·슈퍼스타 분포) / 2군(academyTarget) / 내 선수 시작(userStartTarget)
// ============================================================
import { CONFIG } from './config.js';
import { clamp, STAT_KEYS } from './core/util.js';

export { STAT_KEYS };
export const statClamp = v => clamp(Math.round(v), CONFIG.statRange[0], CONFIG.statRange[1]);

// OVR: 포지션 가중치 합 (소수 첫째 자리)
// 반올림 없는 OVR (소수 능력치 경험치까지 반영해야 하는 예상 계산용)
export function ovrExact(pos, stats) {
  const w = CONFIG.ovrWeights[pos];
  let s = 0;
  for (const k of STAT_KEYS) s += (stats[k] || 0) * w[k];
  return s;
}
export function ovrOf(pos, stats) { return Math.round(ovrExact(pos, stats) * 10) / 10; }
export const ovr = p => ovrOf(p.pos, p.stats);

// 능력치 생성: 목표 OVR 근처
//  spread: 능력치끼리 흩어진 정도 / spikes: 튀는 능력치 수(슈퍼스타형) / bonus: { 능력치: +n } 플레이스타일처럼 정해진 강점
//  강점·튀는 능력치는 그대로 두고 나머지로 OVR을 맞춘다
export function genStats(rng, pos, target, { spread = 4.5, spikes = 0, bonus = null } = {}) {
  const [lo, hi] = CONFIG.statRange;
  const stats = {};
  for (const k of STAT_KEYS) stats[k] = statClamp(rng.normal(target, spread));
  // 포지션 특성 약간
  const P = CONFIG.posStatLean[pos] || {};
  for (const [k, v] of Object.entries(P)) stats[k] = statClamp(stats[k] + v);
  const w = CONFIG.ovrWeights[pos];
  const fixed = [];
  if (bonus) for (const [k, v] of Object.entries(bonus)) { stats[k] = statClamp(target + v + rng.normal(0, 1)); fixed.push(k); }
  if (spikes > 0) {
    const C = CONFIG.stars;
    const pool = STAT_KEYS.filter(k => w[k] >= 0.13 && !fixed.includes(k));
    for (let i = 0; i < spikes && pool.length; i++) {
      const k = pool.splice(rng.int(0, pool.length - 1), 1)[0];
      stats[k] = clamp(Math.round(target + rng.float(...C.spike)), lo, C.spikeMax);
      fixed.push(k);
    }
  }
  // 목표 OVR에 맞게 (정해진 강점·튀는 능력치 말고 나머지로)
  const rest = STAT_KEYS.filter(k => !fixed.includes(k));
  const rw = rest.reduce((a, k) => a + w[k], 0) || 1;
  for (let it = 0; it < 3; it++) {
    const diff = target - ovrOf(pos, stats);
    for (const k of rest) stats[k] = statClamp(stats[k] + diff / rw);
  }
  // 반올림 오차 정리: 목표 OVR ~ +0.4 안으로
  for (let it = 0; it < 40; it++) {
    const d = target - ovrOf(pos, stats);
    if (d > 0) { const c = rest.filter(k => stats[k] < hi); if (!c.length) break; stats[rng.pick(c)]++; }
    else if (d < -0.4) { const c = rest.filter(k => stats[k] > lo); if (!c.length) break; stats[rng.pick(c)]--; }
    else break;
  }
  return stats;
}

// 플레이스타일 강점 (능력치 1~2개, 시작 OVR 기준보다 +5~10)
export const styleBonus = style => (CONFIG.playstyles[style] || {});
// 강점 때문에 OVR이 오르는 몫의 일부는 OVR로 인정 (나머지 능력치가 너무 깎이지 않게)
export function styleAllowance(pos, style) {
  const w = CONFIG.ovrWeights[pos], b = styleBonus(style);
  const cost = Object.entries(b).reduce((a, [k, v]) => a + w[k] * v, 0);
  return Math.min(CONFIG.userStart.styleAllowMax, cost * CONFIG.userStart.styleAllow);
}

// 내 선수 시작 목표 OVR (난이도)
export function userStartTarget(rng, difficulty = 'normal', pos = 'MID', style = null) {
  const U = CONFIG.userStart;
  const base = U.ovr[difficulty] ?? U.ovr.normal;
  return base + rng.float(-U.jitter, U.jitter) + (style ? styleAllowance(pos, style) : 0);
}

// 2군(LCK CL) 목표 OVR: 평균 mean, 범위 range, 팀 티어 보정 (에이스는 따로 aceTarget)
export function academyTarget(rng, tier) {
  const A = CONFIG.academy;
  // 에이스(72~74)가 전체 평균을 올리는 만큼 일반 선수 중심을 낮춰 전체 평균이 A.mean이 되게
  const aceN = (A.aces.n[0] + A.aces.n[1]) / 2, aceAvg = (A.aces.r[0] + A.aces.r[1]) / 2;
  const center = (A.mean * A.slots - aceN * aceAvg) / (A.slots - aceN);
  return clamp(center + (A.tierShift[tier] || 0) + rng.normal(0, A.sd), A.range[0], A.aceFrom - 1);
}
export const aceTarget = rng => rng.int(...CONFIG.academy.aces.r);
