// ============================================================
//  경기 엔진 — 5초 틱. DOM 의존 없음 (node에서 실행 가능)
//  매 틱: 팀 계획 → 선수 목표 → 실제 이동 → 도착한 선수들 사이에서만 판정
// ============================================================
import { CONFIG } from '../config.js';
import { RNG } from '../core/rng.js';
import { clamp, avg, POS } from '../core/util.js';
import { CHAMPIONS } from '../../data/champions.js';
import { BUILDS, BUILD_OVERRIDE, SPELL_BY_POS } from '../../data/items.js';
import * as geo from './mapgeo.js';
import { ovr } from './players.js';
import {
  allPlayers, alive, teamGold, goldDiff, enemyOf, byPos, userPlayer, emit, towersStanding, compTraits, SIM,
} from './matchcore.js';
import { respawns, income, shopAndRegen, wards, updateWaves, structures, heraldUnit, spawnObjectives, objectives } from './world.js';
import { combat } from './combat.js';
import { think, channels, movement } from './teamai.js';

export {
  LANE_OF, allPlayers, alive, teamGold, goldDiff, enemyOf, byPos, userPlayer, ultReady, flashReady,
  champPower, playerPower, compTraits, killPlayer, towersStanding, nextLaneStructure, attackableStructures,
} from './matchcore.js';
export { takeObjective, destroyStructure } from './world.js';

// ------------------------------------------------------------
//  생성
// ------------------------------------------------------------
export function createMatch(opts) {
  const { blue, red, seed = Date.now(), meta = null, userPid = null, visual = false, userMods = null } = opts;
  const O = CONFIG.match.objectives;
  const obj = (next, extra = {}) => ({ alive: false, next, prog: null, spawnedAt: null, done: false, ...extra });
  const g = {
    seed, rng: new RNG(seed), t: 0, over: false, winner: null, meta, visual, userPid,
    sides: [], userSide: -1,
    obj: {
      dragon: obj(O.dragonSpawn, { type: null }), grubs: obj(O.grubsSpawn), herald: obj(O.heraldSpawn),
      baron: obj(O.baronSpawn), elder: obj(null),
      atakhan: obj(O.atakhanEnabled ? O.atakhanSpawn : null, { done: !O.atakhanEnabled }),
    },
    dragonOrder: [], riftType: null,
    firstBlood: false, firstTower: false,
    feed: [], newEvents: [], goldHist: [{ t: 0, diff: 0 }],
    lane: { TOP: 0, MID: 0, BOT: 0 },
    waves: { TOP: { s: 0.5, n: [0, 0] }, MID: { s: 0.5, n: [0, 0] }, BOT: { s: 0.5, n: [0, 0] } },   // s: 웨이브 앞 위치(블루 0 → 레드 1), n: [블루, 레드] 미니언 수
    fights: [], nextFightId: 1, nextEvId: 1, heraldUnit: null,
    scenePlan: [], sceneLog: [], choiceScore: 0, history: [],
    recentTitles: new Set(opts.recentSceneTitles || []),   // 최근 경기에서 쓴 장면 제목 (생성 장면이 피함)
    gameNo: opts.gameNo || 1,
    input: opts.keepInput ? { blue, red, seed, meta, userPid, userMods, gameNo: opts.gameNo || 1 } : null,
  };
  g.sides = [mkSide(g, 0, blue, userMods), mkSide(g, 1, red, userMods)];
  g.byId = {};
  for (const p of allPlayers(g)) g.byId[p.pid] = p;
  for (const s of g.sides) for (const p of s.players) if (p.isUser) g.userSide = s.idx;
  for (const s of g.sides) s.holdPatience = g.rng.int(30, 80);
  if (userPid && opts.scenes !== false && g.userSide >= 0) planScenes(g);
  for (const p of allPlayers(g)) { const f = geo.fountain(p.side); p.x = p.px = f[0]; p.y = p.py = f[1]; }
  return g;
}

function mkSide(g, idx, src, userMods) {
  const players = src.players.map((pl, i) => mkPlayer(g, pl, src.picks[i], idx, POS[i], userMods));
  return {
    idx, team: src.team, players, comp: compTraits(src.picks),
    kills: 0, towersDestroyed: 0,
    towers: { TOP: [1, 1, 1], MID: [1, 1, 1], BOT: [1, 1, 1] },   // 체력 (0 = 파괴)
    inhibs: { TOP: { alive: true, at: 0, hp: 1 }, MID: { alive: true, at: 0, hp: 1 }, BOT: { alive: true, at: 0, hp: 1 } },
    nexusTowerHp: [1, 1], nexusTowers: 2, nexusHp: 1, nexus: true,
    dragons: [], soul: null, grubs: 0, heralds: 0, barons: 0, elders: 0, atakhan: 0,
    baronUntil: 0, elderUntil: 0, heraldEye: null,
    wards: [], plan: null, planLabel: '', planTime: {}, sideLaners: [], sideLaneOf: {},
    force: null, concede: {}, contestMemo: {}, objStance: {}, siegeBoost: 1, siegeBoostUntil: 0, fightBoost: 0, fightBoostUntil: 0,
    lastWin: null, lastLoss: null,
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
    pid: pl.id, nick: pl.nick, pos, side, champ, st, perf, isUser, ovr: pl.stats ? ovr(pl) : 75,
    mastery: (pl.champs && pl.champs[champ]) || 0,
    level: 1, xp: 0, cs: 0, gold: 500, spent: 0, items: [], build, buildIdx: 0,
    k: 0, d: 0, a: 0, alive: true, respawnAt: 0, hp: 1, mana: 1,
    ultAt: 0, flashAt: 0, tpAt: 0, smiteAt: 0, streak: 0, dmg: 0, taken: 0, vision: 0, wardsPlaced: 0,
    x: 0, y: 0, px: 0, py: 0, spells: SPELL_BY_POS[pos], csFrac: 0,
    task: null, chan: null, fightId: null, flee: false, fleeUntil: 0, avoidUntil: 0, lastFightT: 0,
  };
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
//  틱
// ------------------------------------------------------------
export function step(g) {
  if (g.over) return { over: true, events: [] };
  g.newEvents = [];
  g.t += CONFIG.match.tickSec;
  const all = allPlayers(g);
  for (const p of all) { p.px = p.x; p.py = p.y; p.palive = p.alive; }
  respawns(g);
  spawnObjectives(g);
  income(g);
  think(g);          // 1~2) 팀 계획 → 선수 목표
  channels(g);       // 귀환·텔레포트 완료 (로그 남김)
  movement(g);       // 3) 속도 제한 안에서 실제 이동
  updateWaves(g);
  combat(g);         // 4) 가까이 있는 선수끼리만 교전
  for (const f of g.fights) for (const p of all) if (p.fightId === f.id) p.lastFightT = g.t;
  objectives(g);     //    둥지 안 인원으로 처치 진행
  if (!g.over) structures(g);
  if (!g.over) heraldUnit(g);
  shopAndRegen(g);
  wards(g);
  laneState(g);
  if (g.t % 60 === 0) g.goldHist.push({ t: g.t, diff: goldDiff(g) });
  if (!g.over && g.t >= CONFIG.match.maxTime) forceEnd(g);
  if (g.visual) snapshot(g);
  let sceneDue = false;
  if (!g.over && g.scenePlan.length && g.t >= g.scenePlan[0]) sceneDue = true;
  return { over: g.over, events: g.newEvents, sceneDue };
}

// 라인전 우위: 실제 라인 체력·CS 차이를 천천히 반영
function laneState(g) {
  if (g.t >= CONFIG.match.laningEnd) return;
  for (const l of geo.LANES) {
    const pos = l === 'BOT' ? ['ADC', 'SUP'] : [l];
    const hp = side => avg(pos.map(p => { const q = byPos(g.sides[side], p); return q.alive ? q.hp : 0; }));
    const diff = (hp(0) - hp(1)) * 6;
    g.lane[l] = clamp(g.lane[l] * 0.99 + diff * 0.15 + g.rng.normal(0, 0.4), -30, 30);
  }
}

function snapshot(g) {
  g.history.push({
    t: g.t,
    ps: allPlayers(g).map(p => [p.pid, +p.x.toFixed(4), +p.y.toFixed(4), p.alive ? 1 : 0, +p.hp.toFixed(2), p.task ? p.task.kind : '', p.chan ? p.chan.kind : '']),
    plans: g.sides.map(s => s.planLabel),
    waves: geo.LANES.map(l => +g.waves[l].s.toFixed(3)),
  });
  const keep = SIM().historyTicks;
  if (g.history.length > keep) g.history.splice(0, g.history.length - keep);
}

// 안전장치: 시간 초과 (검사기에서 위반으로 집계)
function forceEnd(g) {
  const s0 = towersStanding(g.sides[0]) * 1000 + teamGold(g.sides[0]);
  const s1 = towersStanding(g.sides[1]) * 1000 + teamGold(g.sides[1]);
  const w = s0 >= s1 ? 0 : 1;
  emit(g, { type: 'timeout', side: w, pos: geo.nexusPos(1 - w), parts: [] });
  g.over = true; g.winner = w; g.timedOut = true;
}

export function runToEnd(g, maxTicks = 2000) {
  let i = 0;
  while (!g.over && i++ < maxTicks) step(g);
  if (!g.over) forceEnd(g);
  return g;
}

// ------------------------------------------------------------
export function laneOpponent(g, p) { return byPos(enemyOf(g, p.side), p.pos); }

export function summary(g) {
  const sides = g.sides.map(s => ({
    teamId: s.team.id, kills: s.kills, gold: Math.round(teamGold(s)), towers: s.towersDestroyed,
    ks: (g.ksBy || [0, 0])[s.idx],   // 서폿이 원딜 킬을 가져간 횟수 (커뮤니티 밈)
    dragons: s.dragons.slice(), soul: s.soul, barons: s.barons, elders: s.elders, grubs: s.grubs, heralds: s.heralds,
    players: s.players.map(p => ({
      pid: p.pid, nick: p.nick, pos: p.pos, champ: p.champ, k: p.k, d: p.d, a: p.a, cs: p.cs,
      gold: Math.round(p.gold), dmg: Math.round(p.dmg * 1000), vision: Math.round(p.vision * 1.6), level: p.level, items: p.items.slice(),
    })),
  }));
  return { winner: g.winner, duration: g.t, sides, goldHist: g.goldHist.slice(), seed: g.seed };
}
