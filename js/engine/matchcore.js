// ============================================================
//  경기 엔진 공용 헬퍼: 조회, 파워, 이벤트, 킬, 구조물 순서
//  DOM 의존 없음
// ============================================================
import { CONFIG } from '../config.js';
import { clamp, avg, POS } from '../core/util.js';
import { CHAMPIONS } from '../../data/champions.js';
import { champMetaPower } from './meta.js';
import * as geo from './mapgeo.js';

export const LANE_OF = { TOP: 'TOP', JGL: null, MID: 'MID', ADC: 'BOT', SUP: 'BOT' };
export const ROLE_DMG = { TOP: 1.0, JGL: 0.85, MID: 1.15, ADC: 1.25, SUP: 0.55 };
export const ROLE_KILL = { TOP: 1.0, JGL: 0.9, MID: 1.25, ADC: 1.4, SUP: 0.35 };
// 딜 서폿: 서폿 중 마법사·원딜·암살자형
const DMG_SUP = new Set(['mageBurst', 'mageControl', 'mageBattle', 'adcCrit', 'adcLethal', 'adcOnhit', 'lethality', 'apAssassin']);
// 마무리 일격 가중치 (포지션 × 챔피언 성향, 딜 서폿은 따로)
export function killWeight(p) {
  const K = CONFIG.match.sim.kill;
  const cls = CHAMPIONS[p.champ] ? CHAMPIONS[p.champ].cls : 'bruiser';
  const w = p.pos === 'SUP' ? (DMG_SUP.has(cls) ? K.dmgSup : K.pos.SUP * (K.cls[cls] || 1)) : (K.pos[p.pos] || 0.7) * (K.cls[cls] || 1);
  return w * carryMult(p);
}
// 슈퍼스타(OVR 90+) 캐리 보정: 솔로킬·한타 마무리·스틸의 주인공이 되기 쉽다
export function carryMult(p) {
  const C = CONFIG.stars;
  return p.ovr >= C.starOvr ? C.carry.kill + (p.ovr - C.starOvr) * C.carry.perOvr : 1;
}
export const isStar = p => p.ovr >= CONFIG.stars.starOvr;
// 처치한 선수 고르기: 그 대상에게 준 피해(기여) × 킬 가중치. 기여 기록이 없으면 가중치만
export function pickKiller(g, cands, dmgMap) {
  const K = CONFIG.match.sim.kill;
  const list = cands.filter(c => c && c.alive);
  if (!list.length) return null;
  const tot = list.reduce((a, c) => a + ((dmgMap && dmgMap.get(c)) || 0), 0);
  return g.rng.weighted(list.map(c => {
    const share = tot > 0 ? ((dmgMap.get(c) || 0) / tot) : 1 / list.length;
    return [c, Math.max(1e-4, Math.pow(share, K.dmgExp) * killWeight(c))];
  }));
}
export const TANK = { tank: 1.6, apTank: 1.45, bruiser: 1.3, skirm: 1.1, apFighter: 1.15, enchanter: 0.9, mage: 0.85, adc: 0.8, lethality: 0.9 };
export const FRONT = { tank: 1.8, apTank: 1.6, bruiser: 1.4, skirm: 1.1, apFighter: 1.2 };

export const SIM = () => CONFIG.match.sim;
export const dt = () => CONFIG.match.tickSec;

// ---------- 조회 ----------
export const allPlayers = g => g.all || (g.all = g.sides[0].players.concat(g.sides[1].players));
export const alive = s => s.players.filter(p => p.alive);
export const teamGold = s => s.players.reduce((a, p) => a + p.gold, 0);
export const goldDiff = g => teamGold(g.sides[0]) - teamGold(g.sides[1]);
export const enemyOf = (g, sideIdx) => g.sides[1 - sideIdx];
export const byPos = (s, pos) => s.players[POS.indexOf(pos)];
export const userPlayer = g => (g.userSide >= 0 ? g.sides[g.userSide].players.find(p => p.isUser) : null);
export const ultReady = (g, p) => p.level >= 6 && g.t >= p.ultAt;
export const flashReady = (g, p) => g.t >= p.flashAt;
export const pdist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const distTo = (p, pt) => Math.hypot(p.x - pt[0], p.y - pt[1]);
export const champCls = p => (CHAMPIONS[p.champ] ? CHAMPIONS[p.champ].cls : 'bruiser');
export const trait = (p, k) => (CHAMPIONS[p.champ] ? CHAMPIONS[p.champ].traits[k] : 5);
export const sideLead = (g, idx) => (idx === 0 ? goldDiff(g) : -goldDiff(g));

export function compTraits(picks) {
  const keys = ['early', 'late', 'teamfight', 'engage', 'split', 'mobility'];
  const out = {};
  for (const k of keys) out[k] = avg(picks.map(id => (CHAMPIONS[id] ? CHAMPIONS[id].traits[k] : 5)));
  out.split = Math.max(...picks.map(id => (CHAMPIONS[id] ? CHAMPIONS[id].traits.split : 5))) * 0.6 + out.split * 0.4;
  out.engage = Math.max(...picks.map(id => (CHAMPIONS[id] ? CHAMPIONS[id].traits.engage : 5))) * 0.5 + out.engage * 0.5;
  return out;
}

// ---------- 파워 ----------
function phaseWeight(g) { return clamp(1 - g.t / 1800, 0, 1); }
export function champPower(g, p) {
  const c = CHAMPIONS[p.champ];
  if (!c) return 0;
  const w = phaseWeight(g);
  const curve = ((c.traits.early - 5) * w + (c.traits.late - 5) * (1 - w)) * 0.8;
  return curve + champMetaPower(g.meta, p.champ) + (p.mastery - 50) * 0.06;
}
function roleAvgGold(g, pos) { const i = POS.indexOf(pos); return (g.sides[0].players[i].gold + g.sides[1].players[i].gold) / 2; }
function avgLevel(g) { return avg(allPlayers(g).map(p => p.level)); }
// 경기 수준: 10명 평균 (기본 능력치 파워 + 챔피언 숙련도). 양 팀이 모두 강하다고 피해량·킬이 늘지 않게 교전 피해 기준점을 맞춘다
function levelOf(p) {
  const s = p.st;
  return 70 + (0.4 * s.teamfight + 0.25 * s.mechanics + 0.25 * s.decision + 0.1 * s.vision - 70) * CONFIG.match.statScale + (p.mastery - 50) * 0.06;
}
export function matchLevel(g) {
  if (g.matchLvl === undefined) g.matchLvl = avg(allPlayers(g).map(levelOf));
  return g.matchLvl;
}
export function playerPower(g, p, kind = 'fight') {
  const s = p.st, P = CONFIG.match.power;
  const raw = kind === 'lane'
    ? 0.5 * s.laning + 0.3 * s.mechanics + 0.2 * s.decision
    : 0.4 * s.teamfight + 0.25 * s.mechanics + 0.25 * s.decision + 0.1 * s.vision;
  const base = 70 + (raw - 70) * CONFIG.match.statScale;
  // 골드 차이 효과는 softK(천 골드)를 넘으면 줄어든다 (아이템 효율 한계 — 큰 격차도 뒤집힐 여지)
  const gk = (p.gold - roleAvgGold(g, p.pos)) / 1000, ak = Math.abs(gk);
  const gold = Math.sign(gk) * (ak <= P.goldSoftK ? ak : P.goldSoftK + (ak - P.goldSoftK) * P.goldSoftMult) * P.goldPerK;
  const lvl = (p.level - avgLevel(g)) * P.levelPer;
  return base + champPower(g, p) + p.perf + gold + lvl + (p.boost || 0);
}
export function buffMult(g, s) {
  const B = SIM().buffDps;
  let m = 1;
  if (s.baronUntil > g.t) m += B.baron;
  if (s.elderUntil > g.t) m += B.elder;
  if (s.soul) m += B.soul;
  m += s.dragons.length * B.dragon;
  return m;
}
export function compPower(s) { const c = s.comp; return ((c.teamfight - 6) + 0.5 * (c.engage - 6)) * CONFIG.match.power.compWeight; }
export function mentalFactor(g, s) {
  const behind = sideLead(g, s.idx) < -CONFIG.match.power.mentalBehindGap;
  return (s.mental - 65) * (behind ? 0.08 : 0.03) + s.chem * 0.05 + (s.fightBoostUntil > g.t ? s.fightBoost : 0);
}
// 교전용 초당 피해 (체력 1 = 1명)
export function dpsOf(g, p, nInFight) {
  const S = SIM(), side = g.sides[p.side];
  let pw = playerPower(g, p, nInFight <= 2 ? 'lane' : 'fight') + mentalFactor(g, side);
  if (nInFight >= 3) pw += compPower(side);
  if (p.side === 0) pw += CONFIG.match.blueSideBonus;
  // 기지 수비 이점: 자기 기지 안에서 싸우는 수비 팀 (크게 앞선 팀도 억제기·넥서스 앞은 쉽게 못 민다)
  const home = geo.inBase(p.side, p.x, p.y) ? 1 + CONFIG.match.power.baseDefense : 1;
  // 피해 기준점 = 경기 수준 - refLevel (상대적 강약은 그대로, 리그 수준에 따라 킬 수가 부풀지 않게)
  const ref = 70 + matchLevel(g) - CONFIG.match.power.refLevel;
  return S.dps * Math.exp((pw - ref) / S.powScale) * ROLE_DMG[p.pos] * buffMult(g, side) * home;
}
export function ehpOf(p) { return (TANK[champCls(p)] || 1) * (1 + (p.level - 1) * 0.012); }

// ---------- 이벤트 ----------
export function emit(g, ev) {
  ev.t = g.t;
  ev.id = g.nextEvId++;
  g.feed.push(ev);
  g.newEvents.push(ev);
  return ev;
}
export function moveLog(g, p, kind, to, extra = {}) {
  const ev = emit(g, { type: 'move', kind, pid: p.pid, side: p.side, from: [p.x, p.y], to: [to[0], to[1]], pos: [to[0], to[1]], region: geo.regionOf(to[0], to[1]), parts: [p.pid], ...extra });
  p.x = to[0]; p.y = to[1];
  return ev;
}

function deathTime(g, p) {
  const M = CONFIG.match;
  let t = M.deathTimer[clamp(p.level, 1, 18) - 1];
  if (g.t > 900) t *= 1 + Math.min(0.5, (g.t / 60 - 15) * M.deathTimerLateMult);
  return t;
}

// 처치: 반드시 위치가 맞는 선수만 넘겨야 한다 (호출부 책임, 검사기가 확인)
export function killPlayer(g, killer, victim, assisters = [], opts = {}) {
  if (!victim.alive) return null;
  const G = CONFIG.match.gold;
  // 현상금 = 연속 처치 + 골드 현상금(같은 포지션 평균보다 많이 번 선수) — 앞선 팀의 스노우볼을 늦춘다
  const streakB = victim.streak >= 2 ? (victim.streak - 1) * G.bountyPerStreak : 0;
  const goldAhead = Math.max(0, victim.gold - roleAvgGold(g, victim.pos) - G.goldBountyFrom);
  const bounty = Math.round(Math.min(G.maxBounty, streakB + goldAhead / 1000 * G.goldBountyPerK));
  victim.alive = false; victim.d++; victim.hp = 0; victim.chan = null; victim.fightId = null; victim.flee = false;
  victim.respawnAt = g.t + deathTime(g, victim);
  const shutdown = bounty > 0;
  victim.streak = 0;
  const fb = !g.firstBlood;
  g.firstBlood = true;
  const killerSide = 1 - victim.side;
  if (killer) {
    killer.k++; killer.streak++;
    killer.gold += G.kill + bounty + (fb ? G.firstBlood : 0);
    killer.xp += 140 + victim.level * 22;
  } else {
    for (const p of alive(g.sides[killerSide])) p.gold += 60;
  }
  const R = SIM().eventRadius;
  const as = assisters.filter(a => a && a !== killer && a.alive && a.side === killerSide && pdist(a, victim) <= R);
  for (const a of as) { a.a++; a.gold += G.assistPool / Math.max(1, as.length); a.xp += 70; }
  g.sides[killerSide].kills++;
  if (opts.ks) { g.ksBy = g.ksBy || [0, 0]; g.ksBy[killerSide]++; }
  return emit(g, {
    type: 'kill', killer: killer ? killer.pid : null, victim: victim.pid, side: killerSide,
    assisters: as.map(a => a.pid), shutdown, firstBlood: fb, reason: opts.reason || 'fight', fightId: opts.fightId || null,
    lane: opts.lane || null, pos: [victim.x, victim.y], region: geo.regionOf(victim.x, victim.y),
    parts: [victim.pid, ...(killer ? [killer.pid] : []), ...as.map(a => a.pid)], big: !!opts.big, ks: !!opts.ks || undefined,
  });
}

// ---------- 구조물 ----------
// 라인 안에서 다음 공격 가능한 구조물 (공격 팀 attIdx 기준)
export function nextLaneStructure(g, attIdx, lane) {
  const D = g.sides[1 - attIdx];
  for (let i = 0; i < 3; i++) if (D.towers[lane][i] > 0) return { kind: 'tower', lane, idx: i, pos: geo.towerPos(D.idx, lane, i), s: geo.STRUCT_S[D.idx][lane].towers[i] };
  if (D.inhibs[lane].alive) return { kind: 'inhib', lane, pos: geo.inhibPos(D.idx, lane), s: geo.STRUCT_S[D.idx][lane].inhib };
  return null;
}
export const inhibsDown = s => geo.LANES.filter(l => !s.inhibs[l].alive);
export const baseOpen = s => inhibsDown(s).length > 0; // 쌍둥이 포탑 공격 가능
export function nexusAttackable(g, attIdx) {
  const D = g.sides[1 - attIdx];
  return D.nexusTowerHp[0] <= 0 && D.nexusTowerHp[1] <= 0 && baseOpen(D);
}
// 공격 팀 기준 현재 칠 수 있는 모든 구조물
export function attackableStructures(g, attIdx) {
  const D = g.sides[1 - attIdx];
  const out = [];
  for (const l of geo.LANES) { const t = nextLaneStructure(g, attIdx, l); if (t) out.push(t); }
  if (baseOpen(D)) for (let i = 0; i < 2; i++) if (D.nexusTowerHp[i] > 0) out.push({ kind: 'nexusTower', idx: i, pos: geo.nexusTowerPos(D.idx, i) });
  if (nexusAttackable(g, attIdx) && D.nexus) out.push({ kind: 'nexus', pos: geo.nexusPos(D.idx) });
  return out;
}
export const towersStanding = s => geo.LANES.reduce((a, l) => a + s.towers[l].filter(h => h > 0).length, 0) + s.nexusTowerHp.filter(h => h > 0).length;
