import { CONFIG } from '../config.js';
import { clamp, POS, STAT_KEYS } from '../core/util.js';
import { CHAMPIONS, champsForPos } from '../../data/champions.js';

let nextId = 1;
export function setNextPlayerId(n) { nextId = n; }
export function getNextPlayerId() { return nextId; }

export function ovr(p) {
  const w = CONFIG.ovrWeights[p.pos];
  let s = 0;
  for (const k of STAT_KEYS) s += (p.stats[k] || 0) * w[k];
  return Math.round(s * 10) / 10;
}

// 목표 OVR 근처로 능력치 생성
export function genStats(rng, pos, target, spread = 6) {
  const stats = {};
  for (const k of STAT_KEYS) stats[k] = clamp(Math.round(rng.normal(target, spread)), 30, 99);
  // 포지션 특성 약간 반영
  if (pos === 'SUP') stats.vision = clamp(stats.vision + 5, 30, 99);
  if (pos === 'JGL') stats.decision = clamp(stats.decision + 3, 30, 99);
  if (pos === 'ADC') stats.mechanics = clamp(stats.mechanics + 3, 30, 99);
  // 목표 OVR에 맞게 보정
  const tmp = { pos, stats };
  const diff = target - ovr(tmp);
  for (const k of STAT_KEYS) stats[k] = clamp(Math.round(stats[k] + diff), 30, 99);
  return stats;
}

export function genChampPool(rng, pos, quality, mains = null) {
  const list = rng.shuffle(champsForPos(pos));
  const champs = {};
  const n = 10 + rng.int(0, 5);
  const primary = list.filter(id => CHAMPIONS[id].pos[0] === pos);
  const ordered = [...(mains || []), ...primary, ...list];
  let i = 0;
  for (const id of ordered) {
    if (champs[id] !== undefined) continue;
    if (i >= n) break;
    const top = i < 3 ? 18 : i < 7 ? 8 : 0;
    champs[id] = clamp(Math.round(rng.normal(quality - 18 + top, 8)), 15, 99);
    i++;
  }
  return champs;
}

export function makePlayer(rng, { nick, pos, age, target, teamId = null, squad = 'main', region = 'LCK', season = 2026 }) {
  const stats = genStats(rng, pos, target);
  const [pmin, pmax] = CONFIG.growth.potentialRange;
  const potBase = target + (age <= 20 ? rng.float(6, 16) : age <= 23 ? rng.float(2, 9) : rng.float(0, 4));
  const hidden = {
    potential: Math.round(clamp(potBase, Math.max(pmin, target + 1), pmax)),
    growth: Math.round(rng.float(...CONFIG.growth.growthRange) * 100) / 100,
    variance: rng.int(...CONFIG.growth.varianceRange),
  };
  const p = {
    id: 'p' + (nextId++), nick, pos, age, teamId, squad, region,
    stats, hidden, form: 0,
    champs: genChampPool(rng, pos, target),
    contract: null,
    season: emptySeason(),
    history: [],
    isUser: false,
    rookieSeason: age <= 19 ? season : season - (age - 18),
    lastRatings: [],
  };
  return p;
}

export function emptySeason() {
  return { games: 0, wins: 0, k: 0, d: 0, a: 0, ratingSum: 0, cs: 0, dmgShare: 0, pogs: 0, champs: {}, lckGames: 0, lckRatingSum: 0 };
}

export function marketValue(p, popularity = 0) {
  const o = ovr(p);
  const S = CONFIG.salary;
  let v = S.base * Math.pow(S.growth, o - 55);
  v *= 1 + clamp(popularity, 0, 100) / 100 * S.popularityMult;
  if (p.age >= 27) v *= 0.85;
  return Math.max(S.minAcademy, Math.round(v / 1e6) * 1e6);
}

export function mastery(p, champ) { return p.champs[champ] || 0; }

export function topChamps(p, n = 5) {
  return Object.entries(p.champs).sort((a, b) => b[1] - a[1]).slice(0, n).map(e => e[0]);
}

export function potentialGrade(pot) {
  if (pot >= 92) return 'S';
  if (pot >= 86) return 'A';
  if (pot >= 80) return 'B';
  if (pot >= 74) return 'C';
  return 'D';
}

// 능력치 1개 성장 (훈련/경기 공용)
export function growStat(p, key, base, fatigue = 0) {
  const G = CONFIG.growth;
  const af = G.ageFactor[p.age] ?? (p.age < 17 ? 1.3 : 0.1);
  const cur = p.stats[key];
  const room = Math.max(0, 1 - Math.pow(cur / p.hidden.potential, 2) * (cur >= p.hidden.potential ? 3 : 1));
  const gain = base * p.hidden.growth * af * (0.25 + room) * (1 - fatigue / 200);
  p.statFrac = p.statFrac || {};
  p.statFrac[key] = (p.statFrac[key] || 0) + gain;
  let up = 0;
  while (p.statFrac[key] >= 1 && p.stats[key] < 99) {
    p.statFrac[key] -= 1; p.stats[key] += 1; up++;
  }
  return up;
}

export function growMastery(p, champ, base) {
  const cur = p.champs[champ] || 0;
  const gain = base * (1 - cur / 110) * (0.7 + p.stats.pool / 200);
  p.champs[champ] = clamp(Math.round((cur + gain) * 10) / 10, 0, 100);
  return gain;
}

export function rosterOvr(players) {
  if (!players.length) return 0;
  return players.reduce((s, p) => s + ovr(p), 0) / players.length;
}

export { POS };
