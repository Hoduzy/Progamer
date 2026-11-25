import { CONFIG } from '../config.js';
import { clamp, POS, STAT_KEYS } from '../core/util.js';
import { CHAMPIONS, champsForPos } from '../../data/champions.js';
import { STAR_NICK } from '../../data/community/words.js';
import { ovr, genStats } from '../stats.js';

let nextId = 1;
export function setNextPlayerId(n) { nextId = n; }
export function getNextPlayerId() { return nextId; }

// OVR·능력치 생성은 js/stats.js 하나로 (모든 선수 공통 기준). 여기서는 다시 내보내기만
export { ovr, genStats } from '../stats.js';

// 잠재력 등급 → 최대 OVR 범위에서 하나
export function rollPotential(rng, grade) {
  const [a, b] = CONFIG.stars.potGrade[grade];
  return rng.int(a, b);
}
export function rollGrade(rng, odds = CONFIG.stars.rookieOdds) {
  return rng.weighted(Object.entries(odds));
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

export function makePlayer(rng, { nick, pos, age, target, teamId = null, squad = 'main', region = 'LCK', season = 2026, grade = null, spikes = null, exact = false, bonus = null, spread = null }) {
  const C = CONFIG.stars;
  // 어린 선수는 잠재력 등급을 먼저 뽑고 데뷔 능력치를 등급에 맞춰 보정
  if (!grade && age <= 20) {
    grade = rollGrade(rng);
    if (!exact) target += C.rookieBoost[grade] || 0;   // exact: 목표 OVR을 그대로 (시작 로스터 분포)
  }
  if (spikes === null) spikes = rng.chance(C.spikeChance) ? rng.int(1, 2) : 0;
  const stats = genStats(rng, pos, target, { spread: spread ?? (spikes ? 5 : 4.5), spikes, bonus });
  const [pmin, pmax] = CONFIG.growth.potentialRange;
  let potential;
  if (grade) potential = Math.max(rollPotential(rng, grade), Math.round(target) + 1);
  else {
    const potBase = target + (age <= 23 ? rng.float(2, 9) : rng.float(0, 4));
    potential = Math.round(clamp(potBase, Math.max(pmin, target + 1), pmax));
  }
  const hidden = {
    potential: Math.min(pmax, potential),
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
  const G = CONFIG.stars.potGrade;
  for (const g of ['S', 'A', 'B', 'C']) if (pot >= G[g][0]) return g;
  return 'D';
}

// 능력치 1개 성장 (훈련/경기 공용)
export function growStat(p, key, base, fatigue = 0) {
  const G = CONFIG.growth;
  const af = G.ageFactor[p.age] ?? (p.age < 17 ? 1.3 : 0.1);
  const cur = p.stats[key];
  const room = cur >= p.hidden.potential ? -0.12 : Math.max(0, 1 - Math.pow(cur / p.hidden.potential, 2));
  const gain = base * p.hidden.growth * af * (0.15 + room) * (1 - fatigue / 200);
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

// 슈퍼스타 별명: OVR 90+가 되면 가장 튀는 능력치에 맞는 별명이 붙는다 (한 번 붙으면 유지). 새로 붙은 선수 목록을 돌려준다
export function assignStarAliases(state, rng) {
  const out = [];
  const used = new Set(Object.values(state.players).map(p => p.alias).filter(Boolean));
  for (const p of Object.values(state.players)) {
    if (p.alias || p.squad === 'retired' || !p.teamId || ovr(p) < CONFIG.stars.starOvr) continue;
    const top = STAT_KEYS.slice().sort((a, b) => p.stats[b] - p.stats[a])[0];
    const pool = [...(STAR_NICK[top] || []), ...STAR_NICK.any].filter(n => !used.has(n));
    if (!pool.length) continue;
    p.alias = rng.pick(pool);
    used.add(p.alias);
    out.push(p);
  }
  return out;
}

export { POS };
