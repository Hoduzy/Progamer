// ============================================================
//  경기 엔진 — 10초 틱. DOM 의존 없음 (node에서 실행 가능)
// ============================================================
import { CONFIG } from '../config.js';
import { RNG } from '../core/rng.js';
import { clamp, avg, logistic, POS } from '../core/util.js';
import { CHAMPIONS } from '../../data/champions.js';
import { ITEMS, BUILDS, BUILD_OVERRIDE, SPELL_BY_POS } from '../../data/items.js';
import { champMetaPower } from './meta.js';
import * as geo from './mapgeo.js';

export const LANE_OF = { TOP: 'TOP', JGL: null, MID: 'MID', ADC: 'BOT', SUP: 'BOT' };
const ROLE_DMG = { TOP: 1.0, JGL: 0.75, MID: 1.2, ADC: 1.3, SUP: 0.45 };
const ROLE_KILL = { TOP: 1.0, JGL: 0.9, MID: 1.25, ADC: 1.4, SUP: 0.35 };
const ROLE_DEATH = { TOP: 1.0, JGL: 1.0, MID: 1.0, ADC: 1.15, SUP: 1.2 };
const WARD_RATE = { TOP: 0.05, JGL: 0.11, MID: 0.06, ADC: 0.05, SUP: 0.24 };

// ------------------------------------------------------------
//  생성
// ------------------------------------------------------------
export function createMatch(opts) {
  const { blue, red, seed = Date.now(), meta = null, userPid = null, visual = false, userMods = null } = opts;
  const O = CONFIG.match.objectives;
  const g = {
    seed, rng: new RNG(seed), t: 0, over: false, winner: null, meta, visual, userPid,
    sides: [], userSide: -1,
    obj: {
      dragon: { alive: false, next: O.dragonSpawn, type: null },
      grubs: { alive: false, next: O.grubsSpawn, done: false },
      herald: { alive: false, next: O.heraldSpawn, done: false },
      baron: { alive: false, next: O.baronSpawn },
      elder: { alive: false, next: null },
      atakhan: { alive: false, next: O.atakhanEnabled ? O.atakhanSpawn : null, done: !O.atakhanEnabled },
    },
    dragonOrder: [], riftType: null,
    firstBlood: false, firstTower: false,
    feed: [], newEvents: [], goldHist: [{ t: 0, diff: 0 }],
    lane: { TOP: 0, MID: 0, BOT: 0 },
    scenePlan: [], sceneLog: [], choiceScore: 0,
    activity: [null, null], // 팀별 현재 활동 위치 (시각용)
    gameNo: opts.gameNo || 1,
  };
  g.sides = [mkSide(g, 0, blue, userMods), mkSide(g, 1, red, userMods)];
  for (const s of g.sides) for (const p of s.players) if (p.isUser) g.userSide = s.idx;
  if (userPid && opts.scenes !== false && g.userSide >= 0) planScenes(g);
  for (const s of g.sides) for (const p of s.players) placeAtFountain(g, p);
  return g;
}

function mkSide(g, idx, src, userMods) {
  const players = src.players.map((pl, i) => mkPlayer(g, pl, src.picks[i], idx, POS[i], userMods));
  const comp = compTraits(src.picks);
  return {
    idx, team: src.team, players, comp,
    kills: 0, towersDestroyed: 0,
    towers: { TOP: [true, true, true], MID: [true, true, true], BOT: [true, true, true] },
    inhibs: { TOP: { alive: true, at: 0 }, MID: { alive: true, at: 0 }, BOT: { alive: true, at: 0 } },
    nexusTowers: 2, nexus: true,
    dragons: [], soul: null, grubs: 0, heralds: 0, barons: 0, elders: 0, atakhan: 0,
    baronUntil: 0, elderUntil: 0, heraldReady: false,
    wards: [],
    mental: avg(players.map(p => p.st.mental)) + (src.mentalBonus || 0),
    chem: src.chem || 0,
  };
}

function mkPlayer(g, pl, champ, side, pos, userMods) {
  const st = { ...pl.stats };
  const sd = CONFIG.match.perfSdBase + (pl.hidden ? pl.hidden.variance : 5) * 0.35;
  let perf = g.rng.normal(0, sd) + (pl.form || 0) * 0.5;
  const isUser = pl.id === g.userPid;
  if (isUser && userMods) {
    perf += (userMods.condition - 70) * 0.06 - Math.max(0, userMods.fatigue - 40) * 0.05 + (userMods.mental - 60) * 0.03;
  }
  const build = BUILDS[BUILD_OVERRIDE[champ] || (CHAMPIONS[champ] ? CHAMPIONS[champ].cls : 'bruiser')] || BUILDS.bruiser;
  return {
    pid: pl.id, nick: pl.nick, pos, side, champ, st, perf, isUser,
    mastery: (pl.champs && pl.champs[champ]) || 0,
    level: 1, xp: 0, cs: 0, gold: 500, spent: 0, items: [], build, buildIdx: 0,
    k: 0, d: 0, a: 0, alive: true, respawnAt: 0, hp: 1, mana: 1,
    ultAt: 0, flashAt: 0, streak: 0, dmg: 0, taken: 0, vision: 0, wardsPlaced: 0,
    x: 0, y: 0, hold: 0, spells: SPELL_BY_POS[pos], csFrac: 0,
    lastTarget: null,
  };
}

export function compTraits(picks) {
  const keys = ['early', 'late', 'teamfight', 'engage', 'split', 'mobility'];
  const out = {};
  for (const k of keys) out[k] = avg(picks.map(id => (CHAMPIONS[id] ? CHAMPIONS[id].traits[k] : 5)));
  // 스플릿은 가장 강한 스플릿 챔피언 영향이 큼
  out.split = Math.max(...picks.map(id => (CHAMPIONS[id] ? CHAMPIONS[id].traits.split : 5))) * 0.6 + out.split * 0.4;
  out.engage = Math.max(...picks.map(id => (CHAMPIONS[id] ? CHAMPIONS[id].traits.engage : 5))) * 0.5 + out.engage * 0.5;
  return out;
}

function planScenes(g) {
  const S = CONFIG.scene;
  const n = g.rng.int(S.perGameMin, S.perGameMax);
  const start = S.firstAt, end = 1680;
  const seg = (end - start) / n;
  for (let i = 0; i < n; i++) {
    const t = Math.round((start + seg * i + g.rng.float(0.15, 0.85) * seg) / 10) * 10;
    g.scenePlan.push(t);
  }
}

// ------------------------------------------------------------
//  조회 헬퍼
// ------------------------------------------------------------
export const allPlayers = g => g.sides[0].players.concat(g.sides[1].players);
export const alive = s => s.players.filter(p => p.alive);
export const teamGold = s => s.players.reduce((a, p) => a + p.gold, 0);
export const goldDiff = g => teamGold(g.sides[0]) - teamGold(g.sides[1]);
export const enemyOf = (g, sideIdx) => g.sides[1 - sideIdx];
export const byPos = (s, pos) => s.players[POS.indexOf(pos)];
export const userPlayer = g => (g.userSide >= 0 ? g.sides[g.userSide].players.find(p => p.isUser) : null);
export const ultReady = (g, p) => p.level >= 6 && g.t >= p.ultAt;
export const flashReady = (g, p) => g.t >= p.flashAt;
export const towersStanding = s => ['TOP', 'MID', 'BOT'].reduce((a, l) => a + s.towers[l].filter(Boolean).length, 0) + s.nexusTowers;

function roleAvgGold(g, pos) {
  const i = POS.indexOf(pos);
  return (g.sides[0].players[i].gold + g.sides[1].players[i].gold) / 2;
}

function phaseWeight(g) { return clamp(1 - g.t / 1800, 0, 1); } // 1 = 초반, 0 = 30분 이후

export function champPower(g, p) {
  const c = CHAMPIONS[p.champ];
  if (!c) return 0;
  const w = phaseWeight(g);
  const curve = ((c.traits.early - 5) * w + (c.traits.late - 5) * (1 - w)) * 0.8;
  return curve + champMetaPower(g.meta, p.champ) + (p.mastery - 50) * 0.06;
}

export function playerPower(g, p, kind = 'fight') {
  const s = p.st;
  const F = CONFIG.match.fight;
  const raw = kind === 'lane'
    ? 0.5 * s.laning + 0.3 * s.mechanics + 0.2 * s.decision
    : 0.4 * s.teamfight + 0.25 * s.mechanics + 0.25 * s.decision + 0.1 * s.vision;
  const base = 70 + (raw - 70) * CONFIG.match.statScale;
  const gold = (p.gold - roleAvgGold(g, p.pos)) / 1000 * F.goldPerK;
  const lvl = (p.level - avgLevel(g)) * F.levelPer;
  const hpF = kind === 'fight' ? (p.hp - 0.8) * 6 : 0;
  return base + champPower(g, p) + p.perf + gold + lvl + hpF + (p.boost || 0);
}
function avgLevel(g) { return avg(allPlayers(g).map(p => p.level)); }

function buffPower(g, s) {
  const B = CONFIG.match.fight.buff;
  let v = 0;
  if (s.baronUntil > g.t) v += B.baron;
  if (s.elderUntil > g.t) v += B.elder;
  if (s.soul) v += B.soul;
  v += s.dragons.length * B.dragonStack;
  v += s.atakhan * B.atakhan;
  return v;
}

function compPower(g, s) {
  const c = s.comp;
  return ((c.teamfight - 6) + 0.5 * (c.engage - 6)) * CONFIG.match.fight.compWeight;
}

function mentalFactor(g, s) {
  // 멘탈은 지고 있을 때 더 크게 작용
  const behind = (s.idx === 0 ? -goldDiff(g) : goldDiff(g)) > 2000;
  return (s.mental - 65) * (behind ? 0.08 : 0.03) + s.chem * 0.05;
}

// ------------------------------------------------------------
//  이벤트
// ------------------------------------------------------------
function emit(g, ev) {
  ev.t = g.t;
  g.feed.push(ev);
  g.newEvents.push(ev);
  return ev;
}

function deathTime(g, p) {
  const M = CONFIG.match;
  let t = M.deathTimer[clamp(p.level, 1, 18) - 1];
  if (g.t > 900) t *= 1 + Math.min(0.5, (g.t / 60 - 15) * M.deathTimerLateMult);
  return t;
}

export function killPlayer(g, killer, victim, assisters = [], opts = {}) {
  if (!victim.alive) return null;
  const G = CONFIG.match.gold;
  const bounty = victim.streak >= 2 ? Math.min(G.maxBounty, (victim.streak - 1) * G.bountyPerStreak) : 0;
  victim.alive = false; victim.d++; victim.hp = 0;
  victim.respawnAt = g.t + deathTime(g, victim);
  const shutdown = bounty > 0;
  victim.streak = 0;
  const fb = !g.firstBlood;
  g.firstBlood = true;
  let killerSide = 1 - victim.side;
  if (killer) {
    killer.k++; killer.streak++;
    killer.gold += G.kill + bounty + (fb ? G.firstBlood : 0);
    killer.xp += 140 + victim.level * 22;
  } else {
    // 처형 (포탑/미니언)
    for (const p of alive(g.sides[killerSide])) p.gold += 60;
  }
  const as = assisters.filter(a => a && a !== killer && a.alive);
  for (const a of as) { a.a++; a.gold += G.assistPool / Math.max(1, as.length); a.xp += 70; }
  g.sides[killerSide].kills++;
  const ev = emit(g, {
    type: 'kill', killer: killer ? killer.pid : null, victim: victim.pid, side: killerSide,
    assisters: as.map(a => a.pid), shutdown, firstBlood: fb, reason: opts.reason || 'fight',
    lane: opts.lane || null, big: !!opts.big,
  });
  return ev;
}

// ------------------------------------------------------------
//  교전 해결
// ------------------------------------------------------------
// a, b: 참가 선수 배열. opts.scale, opts.bonusA(블루 기준 아님: a팀 보정)
export function resolveFight(g, a, b, opts = {}) {
  const F = CONFIG.match.fight;
  a = a.filter(p => p.alive); b = b.filter(p => p.alive);
  if (!a.length || !b.length) return null;
  const sa = g.sides[a[0].side], sb = g.sides[b[0].side];
  const kind = opts.kind || 'teamfight';
  const pkind = kind === 'lane' ? 'lane' : 'fight';
  let powA = avg(a.map(p => playerPower(g, p, pkind))) + buffPower(g, sa) + mentalFactor(g, sa);
  let powB = avg(b.map(p => playerPower(g, p, pkind))) + buffPower(g, sb) + mentalFactor(g, sb);
  if (kind === 'teamfight' || kind === 'objective') { powA += compPower(g, sa); powB += compPower(g, sb); }
  if (sa.idx === 0) powA += CONFIG.match.blueSideBonus; else powB += CONFIG.match.blueSideBonus;
  const noise = opts.noise ?? F.noise;
  let diff = powA - powB + F.perMan * (a.length - b.length) + (opts.bonusA || 0) + g.rng.normal(0, noise);
  const pA = logistic(diff / (opts.scale || F.scale));
  const aWins = g.rng.next() < pA;
  const W = aWins ? a : b, L = aWins ? b : a;
  const dom = Math.abs(pA - 0.5) * 2;

  // 사상자 수
  let lDeaths, wDeaths;
  if (opts.maxKills) {
    lDeaths = Math.min(L.length, opts.maxKills);
    wDeaths = g.rng.chance(opts.tradeChance || 0) ? Math.min(W.length, 1) : 0;
  } else {
    const nL = L.length, nW = W.length;
    lDeaths = clamp(Math.round(nL * (0.14 + 0.26 * g.rng.next() + 0.25 * dom)), 1, nL);
    wDeaths = clamp(Math.round(nW * (0.32 * (1 - dom) * g.rng.next() + (g.rng.chance(0.25) ? 0.15 : 0))), 0, Math.max(0, nW - 1));
    if (opts.kind === 'skirmish') { lDeaths = Math.min(lDeaths, 2); wDeaths = Math.min(wDeaths, 1); }
  }
  const kills = [];
  const victimsL = pickWeighted(g, L, lDeaths, p => ROLE_DEATH[p.pos] * (1.3 - p.hp * 0.5));
  const victimsW = pickWeighted(g, W, wDeaths, p => ROLE_DEATH[p.pos] * (1.3 - p.hp * 0.5));
  const killCount = {};
  for (const v of victimsL) {
    const killer = pickKiller(g, W, kills);
    const ev = killPlayer(g, killer, v, W, { reason: kind, lane: opts.lane, big: opts.big });
    if (ev) { kills.push(ev); if (killer) killCount[killer.pid] = (killCount[killer.pid] || 0) + 1; }
  }
  for (const v of victimsW) {
    const killer = pickKiller(g, L, kills);
    const ev = killPlayer(g, killer, v, L, { reason: kind, lane: opts.lane, big: opts.big });
    if (ev) kills.push(ev);
  }
  // 멀티킬
  for (const pid in killCount) {
    const n = killCount[pid];
    if (n >= 2) emit(g, { type: 'multi', pid, n, side: W[0].side, big: n >= 3 });
  }
  // 딜량, 궁/점멸, 체력
  const intensity = kind === 'lane' ? 0.5 : kind === 'skirmish' ? 0.8 : 1.4;
  for (const p of a.concat(b)) {
    p.dmg += Math.max(0.2, playerPower(g, p, pkind) / 70) * ROLE_DMG[p.pos] * intensity * g.rng.float(0.6, 1.4) * (1 + p.gold / 12000);
    p.taken += g.rng.float(0.5, 1.5) * intensity;
    if (p.level >= 6 && g.rng.chance(kind === 'lane' ? 0.4 : 0.8)) p.ultAt = g.t + g.rng.int(60, 110) - p.level * 1.5;
    if (g.rng.chance(kind === 'lane' ? 0.45 : 0.3)) p.flashAt = g.t + 300;
    if (p.alive) p.hp = clamp(g.rng.float(0.15, 0.85), 0.05, 1);
  }
  const ace = L.length >= 5 && victimsL.length === L.length && alive(g.sides[L[0].side]).length === 0;
  const res = {
    winner: W[0].side, loser: L[0].side, kills, deadW: victimsW.length, deadL: victimsL.length,
    pWin: aWins ? pA : 1 - pA, ace, nW: W.length, nL: L.length,
  };
  if (ace) emit(g, { type: 'ace', side: W[0].side, big: true });
  return res;
}

function pickWeighted(g, arr, n, wf) {
  const pool = arr.slice();
  const out = [];
  while (out.length < n && pool.length) {
    const items = pool.map(p => [p, Math.max(0.05, wf(p))]);
    const v = g.rng.weighted(items);
    out.push(v);
    pool.splice(pool.indexOf(v), 1);
  }
  return out;
}

function pickKiller(g, side, kills) {
  const al = side.filter(p => p.alive);
  if (!al.length) return null;
  const items = al.map(p => [p, ROLE_KILL[p.pos] * Math.max(0.3, playerPower(g, p) / 60)]);
  return g.rng.weighted(items);
}

// ------------------------------------------------------------
//  구조물
// ------------------------------------------------------------
// 고지(억제기 포탑/억제기)를 칠 수 있는지
export function canHighground(g, attIdx, enemyDead = 0) {
  const A = g.sides[attIdx];
  if (A.baronUntil > g.t || A.elderUntil > g.t) return true;
  if (g.t < CONFIG.match.fight.highgroundMinTime) return enemyDead >= 4;
  return enemyDead >= 2 || g.t >= CONFIG.match.fight.highgroundFreeTime;
}

export function nextStructure(g, attIdx, lane) {
  const d = g.sides[1 - attIdx];
  const tw = d.towers[lane];
  for (let i = 0; i < 3; i++) if (tw[i]) return { kind: 'tower', lane, idx: i };
  if (d.inhibs[lane].alive) return { kind: 'inhib', lane };
  const anyInhibDown = ['TOP', 'MID', 'BOT'].some(l => !d.inhibs[l].alive);
  if (anyInhibDown && d.nexusTowers > 0) return { kind: 'nexusTower' };
  if (anyInhibDown && d.nexusTowers === 0 && d.nexus) return { kind: 'nexus' };
  return null;
}

export function takeStructure(g, attIdx, target, opts = {}) {
  const G = CONFIG.match.gold;
  const A = g.sides[attIdx], D = g.sides[1 - attIdx];
  if (!target) return null;
  let gold = 0, ev;
  if (target.kind === 'tower') {
    D.towers[target.lane][target.idx] = false;
    A.towersDestroyed++;
    gold = target.idx === 0 ? (g.t < 840 ? G.towerOuterEarly : G.towerOuter) : target.idx === 1 ? G.towerInner : G.towerInhib;
    const first = !g.firstTower;
    g.firstTower = true;
    ev = emit(g, { type: 'tower', side: attIdx, lane: target.lane, idx: target.idx, first, big: false });
  } else if (target.kind === 'inhib') {
    D.inhibs[target.lane].alive = false;
    D.inhibs[target.lane].at = g.t + CONFIG.match.objectives.inhibRespawn;
    gold = G.inhib;
    ev = emit(g, { type: 'inhib', side: attIdx, lane: target.lane, big: true });
  } else if (target.kind === 'nexusTower') {
    D.nexusTowers--; A.towersDestroyed++;
    gold = G.nexusTower;
    ev = emit(g, { type: 'nexusTower', side: attIdx, big: false });
  } else if (target.kind === 'nexus') {
    D.nexus = false;
    ev = emit(g, { type: 'nexus', side: attIdx, big: true });
    endGame(g, attIdx);
  }
  const al = alive(A);
  for (const p of (al.length ? al : A.players)) p.gold += gold / Math.max(1, al.length || 5);
  return ev;
}

function endGame(g, winner) {
  g.over = true;
  g.winner = winner;
  g.goldHist.push({ t: g.t, diff: goldDiff(g) });
}

// 진격: 상대 사망 인원/부활 시간에 따라 구조물 파괴
export function push(g, attIdx, enemyDead, opts = {}) {
  const A = g.sides[attIdx], D = g.sides[1 - attIdx];
  const myAlive = alive(A).length;
  if (myAlive < 2) return [];
  const deadEnemies = D.players.filter(p => !p.alive);
  const minRespawn = deadEnemies.length ? Math.min(...deadEnemies.map(p => p.respawnAt - g.t)) : 0;
  const avgRespawn = deadEnemies.length ? avg(deadEnemies.map(p => p.respawnAt - g.t)) : 0;
  let budget = 0;
  if (enemyDead >= 1 && g.rng.chance(CONFIG.match.fight.pushChance1)) budget += 1;
  if (enemyDead >= 3) budget += 1;
  if (enemyDead >= 4 && avgRespawn > 22) budget += 1;
  if (enemyDead >= 5 && avgRespawn > 30) budget += 2;
  if (A.baronUntil > g.t) budget += 1;
  if (A.elderUntil > g.t) budget += 1;
  budget += Math.min(2, ['TOP', 'MID', 'BOT'].filter(l => !D.inhibs[l].alive).length) * (enemyDead >= 2 ? 1 : 0);
  if (g.t < 840) budget = Math.min(budget, 1);
  if (opts.extra) budget += opts.extra;
  const evs = [];
  let lane = opts.lane || g.rng.pick(['TOP', 'MID', 'BOT', 'MID']);
  const hg = canHighground(g, attIdx, enemyDead);
  const okT = t => t && (hg || (t.kind === 'tower' && t.idx < 2));
  for (let i = 0; i < budget; i++) {
    let target = nextStructure(g, attIdx, lane);
    if (!okT(target)) {
      const other = ['TOP', 'MID', 'BOT'].filter(l => okT(nextStructure(g, attIdx, l)));
      if (!other.length) break;
      lane = g.rng.pick(other);
      target = nextStructure(g, attIdx, lane);
    }
    if (target && (target.kind === 'nexusTower' || target.kind === 'nexus')) {
      // 넥서스 진입 조건
      const buffed = A.baronUntil > g.t || A.elderUntil > g.t;
      const inhibsDown = ['TOP', 'MID', 'BOT'].filter(l => !D.inhibs[l].alive).length;
      const canEnd = alive(D).length === 0
        || (enemyDead >= CONFIG.match.fight.endPushDeadMin && avgRespawn > 15 && myAlive >= 3)
        || (enemyDead >= 2 && (buffed || inhibsDown >= 2 || opts.base) && myAlive >= 3 && avgRespawn > 10);
      if (!canEnd) {
        const other = ['TOP', 'MID', 'BOT'].filter(l => l !== lane && D.towers[l].some(Boolean));
        if (!other.length) break;
        lane = g.rng.pick(other);
        target = nextStructure(g, attIdx, lane);
      }
    }
    if (!target) {
      const other = ['TOP', 'MID', 'BOT'].filter(l => nextStructure(g, attIdx, l));
      if (!other.length) break;
      lane = g.rng.pick(other);
      target = nextStructure(g, attIdx, lane);
    }
    const ev = takeStructure(g, attIdx, target);
    if (ev) evs.push(ev);
    if (g.over) break;
  }
  return evs;
}

// ------------------------------------------------------------
//  오브젝트
// ------------------------------------------------------------
function dragonType(g) {
  const T = CONFIG.match.dragonTypes;
  if (g.riftType) return g.riftType;
  const used = g.dragonOrder;
  const avail = T.filter(t => !used.includes(t));
  const t = g.rng.pick(avail);
  return t;
}

export function takeObjective(g, sideIdx, key, opts = {}) {
  const G = CONFIG.match.gold, O = CONFIG.match.objectives;
  const S = g.sides[sideIdx];
  const o = g.obj[key];
  if (!o || !o.alive) return null;
  o.alive = false;
  const al = alive(S);
  const share = (gold) => { for (const p of (al.length ? al : S.players)) p.gold += gold / Math.max(1, al.length || 5); };
  let ev;
  if (key === 'dragon') {
    const type = o.type;
    S.dragons.push(type);
    if (g.dragonOrder.length < 3) {
      g.dragonOrder.push(type);
      if (g.dragonOrder.length === 2) g.riftTypePending = true;
    }
    share(G.dragon);
    let soul = false;
    if (S.dragons.length >= O.soulAt && !S.soul && !g.sides[1 - sideIdx].soul) {
      S.soul = g.riftType || type; soul = true;
      g.obj.elder.next = g.t + O.elderRespawn;
      o.next = null;
    } else {
      o.next = g.t + O.dragonRespawn;
    }
    ev = emit(g, { type: 'dragon', side: sideIdx, dragon: type, soul, stolen: !!opts.stolen, big: soul || !!opts.stolen });
  } else if (key === 'elder') {
    S.elderUntil = g.t + O.elderBuff; S.elders++;
    share(G.elder);
    o.next = g.t + O.elderRespawn;
    ev = emit(g, { type: 'elder', side: sideIdx, stolen: !!opts.stolen, big: true });
  } else if (key === 'baron') {
    S.baronUntil = g.t + O.baronBuff; S.barons++;
    for (const p of al) p.gold += G.baron / 5;
    o.next = g.t + O.baronRespawn;
    ev = emit(g, { type: 'baron', side: sideIdx, stolen: !!opts.stolen, big: true });
  } else if (key === 'grubs') {
    S.grubs += 3; o.done = true; share(G.grubs);
    ev = emit(g, { type: 'grubs', side: sideIdx, big: false });
  } else if (key === 'herald') {
    S.heralds++; S.heraldReady = true; o.done = true; share(G.herald);
    ev = emit(g, { type: 'herald', side: sideIdx, big: false });
  } else if (key === 'atakhan') {
    S.atakhan++; o.done = true; share(G.atakhan);
    ev = emit(g, { type: 'atakhan', side: sideIdx, big: true });
  }
  return ev;
}

function spawnObjectives(g) {
  const O = CONFIG.match.objectives;
  const o = g.obj;
  if (!o.dragon.alive && o.dragon.next !== null && g.t >= o.dragon.next && !g.sides.some(s => s.soul)) {
    if (g.dragonOrder.length >= 2 && !g.riftType) {
      const avail = CONFIG.match.dragonTypes.filter(t => !g.dragonOrder.includes(t));
      g.riftType = g.rng.pick(avail);
    }
    o.dragon.alive = true;
    o.dragon.type = dragonType(g);
    emit(g, { type: 'spawn', obj: 'dragon', dragon: o.dragon.type });
  }
  if (!o.elder.alive && o.elder.next !== null && g.t >= o.elder.next) {
    o.elder.alive = true; emit(g, { type: 'spawn', obj: 'elder' });
  }
  if (!o.grubs.done && !o.grubs.alive && g.t >= o.grubs.next) { o.grubs.alive = true; emit(g, { type: 'spawn', obj: 'grubs' }); }
  if (o.grubs.alive && g.t >= O.grubsDespawn) { o.grubs.alive = false; o.grubs.done = true; }
  if (!o.herald.done && !o.herald.alive && g.t >= o.herald.next) { o.herald.alive = true; emit(g, { type: 'spawn', obj: 'herald' }); }
  if (o.herald.alive && g.t >= O.heraldDespawn) { o.herald.alive = false; o.herald.done = true; }
  if (!o.baron.alive && g.t >= o.baron.next) { o.baron.alive = true; emit(g, { type: 'spawn', obj: 'baron' }); }
  if (!o.atakhan.done && o.atakhan.next !== null && !o.atakhan.alive && g.t >= o.atakhan.next) { o.atakhan.alive = true; emit(g, { type: 'spawn', obj: 'atakhan' }); }
}

// ------------------------------------------------------------
//  틱
// ------------------------------------------------------------
export function step(g) {
  if (g.over) return { over: true, events: [] };
  g.newEvents = [];
  g.t += CONFIG.match.tickSec;
  income(g);
  respawns(g);
  spawnObjectives(g);
  if (g.t >= 90) {
    if (g.t < CONFIG.match.laningEnd) laningPhase(g); else midLatePhase(g);
  }
  if (!g.over) objectivePhase(g);
  buyItems(g);
  if (g.visual) { wards(g); positions(g); }
  if (g.t % 60 === 0) g.goldHist.push({ t: g.t, diff: goldDiff(g) });
  if (!g.over && g.t >= CONFIG.match.maxTime) forceEnd(g);
  let sceneDue = false;
  if (!g.over && g.scenePlan.length && g.t >= g.scenePlan[0]) {
    const up = userPlayer(g);
    if (up && up.alive) { g.scenePlan.shift(); sceneDue = true; }
    else g.scenePlan[0] = g.t + 20;
  }
  return { over: g.over, events: g.newEvents, sceneDue };
}

function forceEnd(g) {
  const s0 = towersStanding(g.sides[0]) * 1000 + teamGold(g.sides[0]);
  const s1 = towersStanding(g.sides[1]) * 1000 + teamGold(g.sides[1]);
  const w = s0 >= s1 ? 0 : 1;
  emit(g, { type: 'nexus', side: w, big: true });
  endGame(g, w);
}

export function runToEnd(g, maxTicks = 1000) {
  let i = 0;
  while (!g.over && i++ < maxTicks) step(g);
  if (!g.over) forceEnd(g);
  return g;
}

function income(g) {
  const M = CONFIG.match;
  const dt = M.tickSec / 60;
  const late = 1 + M.lateGpmBoost * clamp(g.t / 1800, 0, 1.4);
  for (const s of g.sides) {
    for (const p of s.players) {
      if (!p.alive) continue;
      const lane = LANE_OF[p.pos];
      let laneMod = 0;
      if (lane && g.t < M.laningEnd) laneMod = (s.idx === 0 ? g.lane[lane] : -g.lane[lane]) * M.laneGoldEffect;
      const farm = ((p.st.laning + p.st.mechanics) / 2 - 70) * M.farmSkillEffect;
      const mult = clamp(0.92 + farm + laneMod + p.perf * 0.004, 0.6, 1.4);
      if (g.t > 65) {
        p.gold += M.gpm[p.pos] * dt * late * mult;
        p.csFrac += M.csPerMin[p.pos] * dt * (0.9 + 0.2 * clamp(g.t / 1800, 0, 1)) * mult;
        const whole = Math.floor(p.csFrac); p.cs += whole; p.csFrac -= whole;
      }
      p.xp += M.xpPerMin[p.pos] * dt * (1 + 0.35 * clamp(g.t / 1800, 0, 1.3)) * clamp(mult, 0.8, 1.2);
      while (p.level < 18 && p.xp >= M.xpTable[p.level]) p.level++;
      if (p.hp < 1) p.hp = Math.min(1, p.hp + 0.04);
      p.mana = clamp(p.mana + g.rng.float(-0.06, 0.08), 0.1, 1);
    }
  }
}

function respawns(g) {
  for (const s of g.sides) {
    for (const p of s.players) {
      if (!p.alive && g.t >= p.respawnAt) { p.alive = true; p.hp = 1; p.mana = 1; placeAtFountain(g, p); }
    }
    for (const l of ['TOP', 'MID', 'BOT']) {
      const ih = s.inhibs[l];
      if (!ih.alive && g.t >= ih.at && s.nexus) { ih.alive = true; emit(g, { type: 'inhibRespawn', side: s.idx, lane: l }); }
    }
  }
}

function buyItems(g) {
  for (const p of allPlayers(g)) {
    if (p.buildIdx >= p.build.length || p.items.length >= 6) continue;
    const id = p.build[p.buildIdx];
    const cost = ITEMS[id] ? ITEMS[id].cost : 3000;
    if (p.gold - p.spent >= cost + 300) {
      p.spent += cost; p.items.push(id); p.buildIdx++;
      if (p.items.length === 3 && g.visual) emit(g, { type: 'item', pid: p.pid, item: id });
    }
  }
}

// ---------------- 라인전 ----------------
function lanePlayers(s, lane) {
  if (lane === 'BOT') return [byPos(s, 'ADC'), byPos(s, 'SUP')];
  return [byPos(s, lane)];
}

function laningPhase(g) {
  const L = CONFIG.match.lane;
  const [B, R] = g.sides;
  for (const lane of ['TOP', 'MID', 'BOT']) {
    const bl = lanePlayers(B, lane), rl = lanePlayers(R, lane);
    const ba = bl.filter(p => p.alive), ra = rl.filter(p => p.alive);
    if (ba.length && ra.length) {
      const diff = avg(ba.map(p => playerPower(g, p, 'lane'))) - avg(ra.map(p => playerPower(g, p, 'lane')))
        + (ba.length - ra.length) * 6;
      g.lane[lane] = clamp(g.lane[lane] * L.revert + L.drift * diff + g.rng.normal(0, L.noise), -L.clampAbs, L.clampAbs);
    } else if (ba.length) g.lane[lane] = clamp(g.lane[lane] + 1.6, -L.clampAbs, L.clampAbs);
    else if (ra.length) g.lane[lane] = clamp(g.lane[lane] - 1.6, -L.clampAbs, L.clampAbs);

    // 라인 교전
    if (ba.length && ra.length && g.rng.chance(L.soloKillChance[lane] * (1 + Math.abs(g.lane[lane]) / 25))) {
      if (g.rng.chance(0.5)) {
        // 킬 없이 점멸/체력만 소모
        const winnerBlue = g.rng.chance(logistic(g.lane[lane] / 15));
        for (const p of (winnerBlue ? ra : ba)) { if (g.rng.chance(0.6)) p.flashAt = g.t + 300; p.hp = g.rng.float(0.2, 0.5); }
        g.lane[lane] += winnerBlue ? 3 : -3;
        emit(g, { type: 'trade', lane, side: winnerBlue ? 0 : 1 });
      } else {
        const res = resolveFight(g, ba, ra, {
          kind: 'lane', scale: L.fightScale, bonusA: g.lane[lane] * L.laneStateWeight, maxKills: 1, tradeChance: L.tradeChance, lane, big: true,
        });
        if (res) {
          g.lane[lane] += res.winner === 0 ? 4 : -4;
          if (res.kills.length) emit(g, { type: 'soloKill', lane, side: res.winner, kills: res.kills.length, big: true, pids: res.kills.map(k => k.killer) });
        }
      }
    }
    // 포탑 (라인 격차가 크면 조기 파괴)
    const st = g.lane[lane];
    if (Math.abs(st) > 20 && g.t > 480 && g.rng.chance(0.03)) {
      const att = st > 0 ? 0 : 1;
      if (g.sides[1 - att].towers[lane][0]) takeStructure(g, att, { kind: 'tower', lane, idx: 0 });
    }
  }
  // 갱킹
  for (const s of g.sides) {
    const jg = byPos(s, 'JGL');
    if (!jg.alive || g.t < 170) continue;
    if (!g.rng.chance(CONFIG.match.lane.gankChance * (0.7 + jg.st.decision / 150))) continue;
    gank(g, s, jg);
  }
  // 상대가 없을 때 오브젝트 압박 → 포탑
  for (const s of g.sides) {
    if (s.heraldReady && g.rng.chance(0.15)) {
      s.heraldReady = false;
      const lane = g.rng.pick(['TOP', 'MID', 'BOT']);
      const t = nextStructure(g, s.idx, lane);
      if (t && t.kind === 'tower') takeStructure(g, s.idx, t);
    }
  }
}

function gank(g, s, jg, forcedLane = null) {
  const L = CONFIG.match.lane;
  const E = enemyOf(g, s.idx);
  const lanes = ['TOP', 'MID', 'BOT'];
  const lane = forcedLane || g.rng.weighted(lanes.map(l => {
    const st = s.idx === 0 ? g.lane[l] : -g.lane[l];
    return [l, clamp(1 + st / 12, 0.3, 2.5) * (l === 'BOT' ? 1.15 : 1)];
  }));
  const allies = lanePlayers(s, lane).filter(p => p.alive);
  const defenders = lanePlayers(E, lane).filter(p => p.alive);
  jg.hold = 2; jg.lastTarget = lane;
  if (!defenders.length) return null;
  const ej = byPos(E, 'JGL');
  const counter = ej.alive && g.rng.chance(L.counterJungleChance * (0.6 + ej.st.decision / 120));
  const att = [jg, ...allies];
  const def = counter ? [...defenders, ej] : defenders;
  if (counter) ej.hold = 2;
  const st = s.idx === 0 ? g.lane[lane] : -g.lane[lane];
  // 시야 장악 정도
  const visionAdv = (avg(E.players.map(p => p.st.vision)) - avg(s.players.map(p => p.st.vision))) * 0.08;
  if (!counter && g.rng.chance(clamp(0.38 + visionAdv * 0.1, 0.2, 0.6))) {
    // 상대가 피함
    for (const d of defenders) if (g.rng.chance(0.55)) d.flashAt = g.t + 300;
    if (g.rng.chance(0.3)) s.players.forEach(() => {});
    emit(g, { type: 'gankFail', lane, side: s.idx, pid: jg.pid });
    return null;
  }
  const res = resolveFight(g, att, def, {
    kind: 'lane', scale: L.gankFightScale, bonusA: (counter ? 0 : L.gankBaseAdv) + st * 0.05 - visionAdv,
    maxKills: counter ? 2 : (lane === 'BOT' ? g.rng.int(1, 2) : 1), tradeChance: 0.18, lane, big: true,
  });
  if (res) {
    if (res.winner === s.idx) g.lane[lane] += s.idx === 0 ? 5 : -5;
    else g.lane[lane] += s.idx === 0 ? -3 : 3;
    emit(g, { type: counter ? 'counterGank' : 'gank', lane, side: s.idx, winner: res.winner, kills: res.kills.length, big: res.kills.length > 0, pid: jg.pid });
    // 갱 성공 후 다이브/포탑
    if (res.winner === s.idx && res.deadL >= 1 && g.t > 600 && g.rng.chance(0.25)) {
      const t = nextStructure(g, s.idx, lane);
      if (t && t.kind === 'tower' && t.idx === 0) takeStructure(g, s.idx, t);
    }
  }
  return res;
}

// ---------------- 중후반 ----------------
function midLatePhase(g) {
  const F = CONFIG.match.fight;
  const lateMul = 1 + clamp((g.t - 1500) / 900, 0, 1) * 0.6;
  // 시야 싸움으로 끊기
  for (const s of g.sides) {
    const E = enemyOf(g, s.idx);
    if (!alive(s).length || !alive(E).length) continue;
    const vis = avg(s.players.map(p => p.st.vision + p.st.decision)) - avg(E.players.map(p => p.st.vision + p.st.decision));
    if (g.rng.chance(F.pickChance * clamp(1 + vis / 40, 0.5, 1.6) * lateMul)) pick(g, s, E, 'pick');
  }
  // 멘탈 낮은 팀의 무리수
  for (const s of g.sides) {
    const behind = s.idx === 0 ? -goldDiff(g) : goldDiff(g);
    if (behind < F.throwGoldGap) continue;
    const m = s.mental;
    const p = F.throwBase * clamp(1 + (60 - m) / 20, 0.3, 2.5) * clamp(behind / 5000, 0.5, 2);
    if (g.rng.chance(p)) pick(g, enemyOf(g, s.idx), s, 'throw');
  }
  // 소규모 교전
  if (g.rng.chance(F.skirmishChance)) {
    const a = g.rng.shuffle(alive(g.sides[0])).slice(0, g.rng.int(1, 3));
    const b = g.rng.shuffle(alive(g.sides[1])).slice(0, g.rng.int(1, 3));
    if (a.length && b.length) {
      const res = resolveFight(g, a, b, { kind: 'skirmish', scale: F.scale * 0.9 });
      if (res && res.deadL) {
        emit(g, { type: 'skirmish', winner: res.winner, kills: res.kills.length });
        if (g.rng.chance(0.45)) push(g, res.winner, res.deadL, { extra: 0 });
      }
    }
  }
  // 대규모 한타
  if (g.rng.chance(F.teamfightChance * lateMul)) teamfight(g, null);
  // 스플릿
  for (const s of g.sides) {
    const top = byPos(s, 'TOP');
    const c = CHAMPIONS[top.champ];
    if (!top.alive || !c || c.traits.split < 6) continue;
    if (!g.rng.chance(F.splitChance * (c.traits.split - 4) / 4)) continue;
    split(g, s, top);
  }
  // 공성
  for (const s of g.sides) {
    const E = enemyOf(g, s.idx);
    const lead = (s.idx === 0 ? goldDiff(g) : -goldDiff(g)) / 1000;
    const aliveDiff = alive(s).length - alive(E).length;
    let p = F.siegeBase + Math.max(0, lead) * F.siegePerKGold + Math.max(0, aliveDiff) * 0.05;
    if (s.baronUntil > g.t) p += F.siegeBuff.baron;
    if (s.elderUntil > g.t) p += F.siegeBuff.elder;
    p += s.grubs * F.siegeBuff.grubs;
    if (s.heraldReady) { p += F.siegeBuff.herald; }
    const enemyInhibsDown = ['TOP', 'MID', 'BOT'].filter(l => !E.inhibs[l].alive).length;
    p += enemyInhibsDown * F.siegePerInhib;
    if (alive(s).length < 3) p *= 0.3;
    if (g.rng.chance(p)) {
      const hg = canHighground(g, s.idx, Math.max(0, aliveDiff));
      const lanes = ['TOP', 'MID', 'BOT'].filter(l => { const t = nextStructure(g, s.idx, l); return t && t.kind !== 'nexus' && t.kind !== 'nexusTower' && (hg || (t.kind === 'tower' && t.idx < 2)); });
      const onlyNexusLeft = ['TOP', 'MID', 'BOT'].every(l => { const t = nextStructure(g, s.idx, l); return !t || t.kind === 'nexus' || t.kind === 'nexusTower'; });
      if (!lanes.length && !onlyNexusLeft) {
        // 고지 앞에서 대치: 가끔 한타
        if ((g.lastBaseFight || 0) + 60 <= g.t && g.rng.chance(0.25)) { g.lastBaseFight = g.t; teamfight(g, null, { forceSide: s.idx, defBonus: { side: E.idx, v: 1.5 }, src: 'highground' }); }
        continue;
      }
      if (!lanes.length && D_nexusTowersLeft(E) && alive(s).length >= alive(E).length && g.rng.chance(0.35)) {
        // 슈퍼 미니언과 함께 쌍둥이 포탑 압박
        takeStructure(g, s.idx, { kind: 'nexusTower' });
        continue;
      }
      if (!lanes.length) {
        // 쌍둥이/넥서스는 우세할 때만
        if ((g.lastBaseFight || 0) + 80 <= g.t && (aliveDiff >= 2 || s.baronUntil > g.t || s.elderUntil > g.t || enemyInhibsDown >= 2 || (g.t > 1800 && g.rng.chance(0.3)))) {
          g.lastBaseFight = g.t;
          // 넥서스 앞 결전: 수비 팀은 포탑/분수대 보정
          teamfight(g, null, { forceSide: s.idx, defBonus: { side: E.idx, v: 2 }, src: 'base' });
        }
        continue;
      }
      // 수비 측이 막을지
      const defendP = clamp(CONFIG.match.fight.defendFightChance + (alive(E).length - alive(s).length) * 0.1, 0.05, 0.6);
      if (alive(E).length >= 3 && (g.lastBaseFight || 0) + 40 <= g.t && g.rng.chance(defendP)) { g.lastBaseFight = g.t; teamfight(g, null, { forceSide: s.idx, siege: true, src: 'defend' }); continue; }
      if (s.heraldReady) s.heraldReady = false;
      takeStructure(g, s.idx, nextStructure(g, s.idx, g.rng.pick(lanes)));
    }
  }
}

const D_nexusTowersLeft = D => D.nexusTowers > 0;

function pick(g, s, E, kind) {
  const victims = alive(E);
  if (!victims.length) return;
  const victim = g.rng.weighted(victims.map(p => [p, (p.pos === 'SUP' || p.pos === 'JGL' ? 1.3 : 1) * (1.2 - p.st.vision / 200)]));
  const hunters = g.rng.shuffle(alive(s)).slice(0, g.rng.int(1, 3));
  if (!hunters.length) return;
  // 피하거나 역습
  const escape = clamp(0.28 + (victim.st.decision - 75) * 0.006 + (kind === 'throw' ? -0.15 : 0), 0.05, 0.5);
  if (g.rng.chance(escape)) { victim.flashAt = g.t + 300; victim.hp = 0.3; return; }
  const ev = killPlayer(g, g.rng.weighted(hunters.map(h => [h, ROLE_KILL[h.pos]])), victim, hunters, { reason: kind });
  if (ev) {
    emit(g, { type: kind, side: s.idx, victim: victim.pid, big: false });
    if (g.rng.chance(0.4)) push(g, s.idx, 1);
  }
}

function split(g, s, top) {
  const E = enemyOf(g, s.idx);
  const lane = g.rng.pick(['TOP', 'BOT']);
  const answer = alive(E).filter(p => p.pos === 'TOP' || p.pos === 'MID');
  const t = nextStructure(g, s.idx, lane);
  if (!t || t.kind === 'nexus') return;
  if (answer.length && g.rng.chance(0.55)) {
    const res = resolveFight(g, [top], [answer[0]], { kind: 'lane', scale: 7, maxKills: 1, tradeChance: 0.05, lane });
    emit(g, { type: 'splitDuel', side: s.idx, winner: res ? res.winner : null, pid: top.pid });
    if (res && res.winner === s.idx) takeStructure(g, s.idx, t);
  } else {
    takeStructure(g, s.idx, t);
    emit(g, { type: 'split', side: s.idx, pid: top.pid, lane });
  }
}

export function teamfight(g, objKey, opts = {}) {
  const [B, R] = g.sides;
  const pa = alive(B), pb = alive(R);
  if (!pa.length || !pb.length) return null;
  // 스플릿 중인 탑은 빠질 수 있음
  const filt = (arr, s) => arr.filter(p => !(p.pos === 'TOP' && CHAMPIONS[p.champ] && CHAMPIONS[p.champ].traits.split >= 8 && g.rng.chance(0.35)));
  const a = filt(pa, B), b = filt(pb, R);
  const bonusA = opts.defBonus ? (opts.defBonus.side === 0 ? opts.defBonus.v : -opts.defBonus.v) : 0;
  const res = resolveFight(g, a.length ? a : pa, b.length ? b : pb, { kind: objKey ? 'objective' : 'teamfight', big: true, bonusA });
  if (!res) return null;
  g.activity = [objKey || 'fight', objKey || 'fight'];
  emit(g, { type: 'teamfight', winner: res.winner, kills: res.kills.length, deadW: res.deadW, deadL: res.deadL, obj: objKey, src: opts.src || (objKey ? 'obj' : 'random'), big: res.kills.length >= 3 });
  // 승리 팀 후속 행동
  if (objKey && g.obj[objKey] && g.obj[objKey].alive) {
    // 진 팀 정글 스틸 시도
    const ljg = byPos(g.sides[res.loser], 'JGL');
    const stealP = ljg.alive ? 0.06 + (ljg.st.mechanics - 75) * 0.002 : 0;
    if (['dragon', 'baron', 'elder'].includes(objKey) && g.rng.chance(stealP)) {
      takeObjective(g, res.loser, objKey, { stolen: true });
    } else takeObjective(g, res.winner, objKey);
  } else if (!objKey) {
    // 열린 오브젝트 챙기기
    for (const k of ['elder', 'baron', 'dragon', 'atakhan', 'herald', 'grubs']) {
      if (g.obj[k] && g.obj[k].alive && res.deadL >= 2 && g.rng.chance(0.65)) { takeObjective(g, res.winner, k); break; }
    }
  }
  if (res.deadL >= 1 && !g.over) push(g, res.winner, res.deadL, { base: opts.src === 'base' && res.winner === opts.forceSide });
  return res;
}

// 오브젝트 단계: 살아있는 오브젝트를 누가 시도하는지
function objectivePhase(g) {
  const O = CONFIG.match.objectives;
  const keys = ['elder', 'baron', 'dragon', 'atakhan', 'herald', 'grubs'];
  for (const k of keys) {
    const o = g.obj[k];
    if (!o.alive) continue;
    const urgency = k === 'elder' ? 2.2 : k === 'baron' ? (g.t > 1500 ? 1.4 : 0.8) : k === 'dragon' ? 1.2 : 0.9;
    if (!g.rng.chance(O.takeChance * urgency)) continue;
    // 시도 팀 선택: 인원, 골드, 정글 생존
    const score = s => alive(s).length * 2 + (byPos(s, 'JGL').alive ? 2 : 0) + (s.idx === 0 ? goldDiff(g) : -goldDiff(g)) / 2500 + (k === 'dragon' ? botPrio(g, s.idx) : 0);
    const sA = score(g.sides[0]), sB = score(g.sides[1]);
    const att = g.rng.chance(logistic((sA - sB) / 3)) ? 0 : 1;
    const A = g.sides[att], D = g.sides[1 - att];
    if (alive(A).length < 2 || !byPos(A, 'JGL').alive && alive(A).length < 4) continue;
    // 수비 팀이 맞서는지
    const contestP = clamp(CONFIG.match.fight.objFightChance + (alive(D).length - alive(A).length) * 0.12
      + (k === 'elder' || k === 'baron' ? 0.2 : 0) + (k === 'dragon' && A.dragons.length >= 3 ? 0.3 : 0)
      + (g.t < CONFIG.match.laningEnd ? -0.25 : 0), 0.05, 0.95);
    if (alive(D).length >= 2 && g.rng.chance(contestP)) {
      if (g.t < CONFIG.match.laningEnd) {
        // 초반 오브젝트 교전은 소규모
        const a = alive(A).filter(p => ['JGL', 'MID', 'SUP', 'ADC'].includes(p.pos) || k !== 'dragon');
        const b = alive(D).filter(p => ['JGL', 'MID', 'SUP', 'ADC'].includes(p.pos) || k !== 'dragon');
        const res = resolveFight(g, a.slice(0, 4), b.slice(0, 4), { kind: 'skirmish' });
        if (res) {
          emit(g, { type: 'teamfight', winner: res.winner, kills: res.kills.length, obj: k, big: res.kills.length >= 2 });
          takeObjective(g, res.winner, k);
        }
      } else teamfight(g, k);
    } else {
      takeObjective(g, att, k);
      // 수비 팀은 반대편에서 포탑 교환
      if (g.t >= CONFIG.match.laningEnd && g.rng.chance(0.35)) {
        const l = g.rng.pick(['TOP', 'MID', 'BOT']);
        const t = nextStructure(g, D.idx, l);
        if (t && t.kind === 'tower') takeStructure(g, D.idx, t);
      }
    }
    if (g.over) return;
    g.activity[att] = k;
  }
}

function botPrio(g, idx) { const v = g.lane.BOT / 10; return idx === 0 ? v : -v; }

// ---------------- 시각 (미니맵) ----------------
function wards(g) {
  for (const s of g.sides) {
    s.wards = s.wards.filter(w => w.until > g.t);
    for (const p of s.players) {
      if (!p.alive) continue;
      if (g.rng.chance(WARD_RATE[p.pos])) {
        const anchor = g.rng.pick([geo.OBJ_POS.dragon, geo.OBJ_POS.baron, [0.5, 0.5], [p.x, p.y], [0.38, 0.38], [0.62, 0.62]]);
        s.wards.push({ x: clamp(anchor[0] + g.rng.float(-0.1, 0.1), 0.03, 0.97), y: clamp(anchor[1] + g.rng.float(-0.1, 0.1), 0.03, 0.97), until: g.t + g.rng.int(90, 150) });
        p.wardsPlaced++; p.vision += 1;
      }
      if (g.rng.chance(WARD_RATE[p.pos] * 0.4)) p.vision += 0.6;
    }
    if (s.wards.length > 9) s.wards.splice(0, s.wards.length - 9);
  }
}

export function placeAtFountain(g, p) { const f = geo.fountain(p.side); p.x = f[0]; p.y = f[1]; }

function jitter(g, v, a = 0.025) { return clamp(v + g.rng.float(-a, a), 0.02, 0.98); }

function positions(g) {
  const lateGroup = g.t >= CONFIG.match.laningEnd;
  const recent = g.newEvents;
  // 교전 위치
  let fightLoc = null;
  for (const ev of recent) {
    if (ev.type === 'teamfight' && ev.obj) fightLoc = geo.OBJ_POS[ev.obj];
    else if (ev.type === 'teamfight') fightLoc = fightLoc || [jitter(g, 0.5, 0.15), jitter(g, 0.5, 0.15)];
  }
  for (const s of g.sides) {
    const E = enemyOf(g, s.idx);
    // 팀 그룹 위치 (중후반)
    let group;
    const objAlive = ['baron', 'elder', 'dragon'].find(k => g.obj[k].alive);
    if (fightLoc) group = fightLoc;
    else if (objAlive && g.rng.chance(0.7)) group = geo.OBJ_POS[objAlive];
    else {
      const lead = (s.idx === 0 ? goldDiff(g) : -goldDiff(g));
      const sPos = s.idx === 0 ? 0.45 + clamp(lead / 30000, -0.15, 0.2) : 0.55 - clamp(lead / 30000, -0.15, 0.2);
      group = geo.pointOnLane('MID', sPos);
    }
    for (const p of s.players) {
      if (!p.alive) { placeAtFountain(g, p); continue; }
      let tx, ty;
      const lane = LANE_OF[p.pos];
      const involved = recent.find(ev => ev.type === 'kill' && (ev.killer === p.pid || ev.victim === p.pid || (ev.assisters || []).includes(p.pid)));
      if (involved && involved.lane) {
        const front = 0.5 + g.lane[involved.lane] * 0.006;
        [tx, ty] = geo.pointOnLane(involved.lane, front);
      } else if (fightLoc && involved) {
        [tx, ty] = fightLoc;
      } else if (!lateGroup) {
        if (p.pos === 'JGL') {
          if (p.hold > 0 && p.lastTarget) { p.hold--; [tx, ty] = geo.pointOnLane(p.lastTarget, 0.5 + g.lane[p.lastTarget] * 0.006 + (s.idx === 0 ? -0.04 : 0.04)); }
          else {
            const objK = ['dragon', 'grubs', 'herald'].find(k => g.obj[k].alive);
            if (objK && g.rng.chance(0.3)) [tx, ty] = geo.OBJ_POS[objK];
            else [tx, ty] = geo.campPos(s.idx, Math.floor(g.t / 40 + s.idx * 3) % geo.CAMP_COUNT);
          }
        } else {
          const front = 0.5 + g.lane[lane] * 0.006;
          const off = s.idx === 0 ? -0.025 : 0.025;
          [tx, ty] = geo.pointOnLane(lane, front + off + (p.pos === 'SUP' ? off * 0.6 : 0));
        }
      } else {
        const c = CHAMPIONS[p.champ];
        if (p.pos === 'TOP' && c && c.traits.split >= 7 && !fightLoc) {
          const sl = s.idx === 0 ? 'BOT' : 'TOP';
          [tx, ty] = geo.pointOnLane(sl, s.idx === 0 ? 0.62 : 0.38);
        } else {
          tx = group[0]; ty = group[1];
        }
      }
      p.x = jitter(g, tx, fightLoc ? 0.035 : 0.02); p.y = jitter(g, ty, fightLoc ? 0.035 : 0.02);
    }
  }
  g.fightLoc = fightLoc;
}

// ------------------------------------------------------------
//  선택 장면 / 외부 효과 적용용 헬퍼
// ------------------------------------------------------------
export function laneOpponent(g, p) {
  const E = enemyOf(g, p.side);
  return byPos(E, p.pos);
}

export function summary(g) {
  const sides = g.sides.map(s => ({
    teamId: s.team.id, kills: s.kills, gold: Math.round(teamGold(s)), towers: s.towersDestroyed,
    dragons: s.dragons.slice(), soul: s.soul, barons: s.barons, elders: s.elders, grubs: s.grubs, heralds: s.heralds,
    players: s.players.map(p => ({
      pid: p.pid, nick: p.nick, pos: p.pos, champ: p.champ, k: p.k, d: p.d, a: p.a, cs: p.cs,
      gold: Math.round(p.gold), dmg: Math.round(p.dmg * 1000), vision: Math.round(p.vision * 1.6), level: p.level, items: p.items.slice(),
    })),
  }));
  return { winner: g.winner, duration: g.t, sides, goldHist: g.goldHist.slice(), seed: g.seed };
}
