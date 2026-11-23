// ============================================================
//  맵 위 물체: 미니언 웨이브, 구조물 피해, 오브젝트 처치 진행, 전령, 수입·상점·와드·부활
//  모든 판정은 "실제로 그 자리에 있는 선수"만 대상으로 한다.
// ============================================================
import { CONFIG } from '../config.js';
import { clamp } from '../core/util.js';
import { ITEMS } from '../../data/items.js';
import * as geo from './mapgeo.js';
import {
  SIM, dt, allPlayers, alive, emit, moveLog, killPlayer, distTo, pdist, playerPower, byPos,
  nextLaneStructure, nexusAttackable, baseOpen, LANE_OF, teamGold,
} from './matchcore.js';

const WARD_RATE = { TOP: 0.02, JGL: 0.05, MID: 0.025, ADC: 0.015, SUP: 0.11 };
const MID_TOWER_LIMIT = 0.06;

// ---------------- 부활·억제기 재생성 ----------------
export function respawns(g) {
  for (const s of g.sides) {
    for (const p of s.players) {
      if (!p.alive && g.t >= p.respawnAt) {
        p.alive = true; p.hp = 1; p.mana = 1; p.flee = false; p.fightId = null; p.chan = null;
        moveLog(g, p, 'respawn', geo.fountain(p.side));
      }
    }
    for (const l of geo.LANES) {
      const ih = s.inhibs[l];
      if (!ih.alive && g.t >= ih.at && s.nexus) { ih.alive = true; ih.hp = 1; emit(g, { type: 'inhibRespawn', side: s.idx, lane: l, pos: geo.inhibPos(s.idx, l), parts: [] }); }
    }
  }
}

// ---------------- 수입 ----------------
export function income(g) {
  const M = CONFIG.match;
  const d = M.tickSec / 60;
  const late = 1 + M.lateGpmBoost * clamp(g.t / 1800, 0, 1.4);
  for (const s of g.sides) {
    for (const p of s.players) {
      if (!p.alive) continue;
      const lane = LANE_OF[p.pos];
      let laneMod = 0;
      if (lane && g.t < M.laningEnd) laneMod = (s.idx === 0 ? g.lane[lane] : -g.lane[lane]) * M.laneGoldEffect;
      const farmSkill = ((p.st.laning + p.st.mechanics) / 2 - 70) * M.farmSkillEffect;
      // 실제로 파밍 중인지: 웨이브 근처 / 정글 캠프 정리 중
      const farming = p.task && (p.task.kind === 'camp' || p.task.kind === 'lane' || p.task.kind === 'side') ? 1 : nearWave(g, p) ? 0.95 : 0.72;
      const mult = clamp(0.92 + farmSkill + laneMod + p.perf * 0.004, 0.6, 1.4) * farming;
      if (g.t > 65) {
        p.gold += M.gpm[p.pos] * d * late * mult;
        p.csFrac += M.csPerMin[p.pos] * d * (0.9 + 0.2 * clamp(g.t / 1800, 0, 1)) * mult;
        const whole = Math.floor(p.csFrac); p.cs += whole; p.csFrac -= whole;
      }
      p.xp += M.xpPerMin[p.pos] * d * (1 + 0.35 * clamp(g.t / 1800, 0, 1.3)) * clamp(mult, 0.75, 1.2);
      while (p.level < 18 && p.xp >= M.xpTable[p.level]) p.level++;
      p.mana = clamp(p.mana + g.rng.float(-0.06, 0.09), 0.1, 1);
    }
  }
}
function nearWave(g, p) {
  for (const l of geo.LANES) { const f = geo.pointOnLane(l, g.waves[l].s); if (distTo(p, f) < 0.1) return true; }
  return false;
}

// ---------------- 상점·회복 ----------------
export function shopAndRegen(g) {
  const S = SIM();
  for (const p of allPlayers(g)) {
    if (!p.alive) continue;
    const f = geo.fountain(p.side);
    if (distTo(p, f) < 0.05) {
      p.hp = 1; p.mana = 1;
      while (p.buildIdx < p.build.length && p.items.length < 6) {
        const id = p.build[p.buildIdx];
        const cost = ITEMS[id] ? ITEMS[id].cost : 3000;
        if (p.gold - p.spent < cost) break;
        p.spent += cost; p.items.push(id); p.buildIdx++;
        if (p.items.length === 3 && g.visual) emit(g, { type: 'item', pid: p.pid, item: id, side: p.side, pos: [p.x, p.y], parts: [p.pid] });
      }
    } else if (!p.fightId) {
      p.hp = Math.min(1, p.hp + S.regenPerSec * dt());
    }
  }
}
export function nextItemCost(p) {
  if (p.buildIdx >= p.build.length || p.items.length >= 6) return Infinity;
  const id = p.build[p.buildIdx];
  return ITEMS[id] ? ITEMS[id].cost : 3000;
}

// ---------------- 와드 ----------------
export function wards(g) {
  for (const s of g.sides) {
    s.wards = s.wards.filter(w => w.until > g.t);
    for (const p of s.players) {
      if (!p.alive || p.chan) continue;
      const r = geo.regionOf(p.x, p.y);
      if (r.endsWith('Base')) continue;
      let rate = WARD_RATE[p.pos];
      if (p.task && (p.task.kind === 'objSetup' || p.task.kind === 'objContest')) rate *= 3;
      if (g.rng.chance(rate)) {
        s.wards.push({ x: p.x, y: p.y, until: g.t + g.rng.int(90, 150), by: p.pid });
        p.wardsPlaced++; p.vision += 1;
      }
      if (g.rng.chance(WARD_RATE[p.pos] * 0.5)) p.vision += 0.6; // 와드 제거·제어 와드
    }
    if (s.wards.length > 10) s.wards.splice(0, s.wards.length - 10);
  }
}

// ---------------- 미니언 웨이브 ----------------
// s: 0 = 블루 넥서스 → 1 = 레드 넥서스. 앞쪽 구조물을 넘지 못한다.
export function waveLimits(g, lane) {
  const B = g.sides[0], R = g.sides[1];
  let lo = 0.06, hi = 0.94;
  for (let i = 0; i < 3; i++) if (B.towers[lane][i] > 0) { lo = Math.max(lo, geo.STRUCT_S[0][lane].towers[i]); break; }
  if (B.towers[lane].every(h => h <= 0) && B.inhibs[lane].alive) lo = Math.max(lo, geo.STRUCT_S[0][lane].inhib);
  for (let i = 0; i < 3; i++) if (R.towers[lane][i] > 0) { hi = Math.min(hi, geo.STRUCT_S[1][lane].towers[i]); break; }
  if (R.towers[lane].every(h => h <= 0) && R.inhibs[lane].alive) hi = Math.min(hi, geo.STRUCT_S[1][lane].inhib);
  return [lo + 0.012, hi - 0.012];
}
export function updateWaves(g) {
  const S = SIM();
  if (g.t < 65) return;
  for (const l of geo.LANES) {
    const w = g.waves[l];
    const front = geo.pointOnLane(l, w.s);
    let pressure = 0, champs = 0;
    for (const p of allPlayers(g)) {
      if (!p.alive || p.fightId || p.chan) continue;
      if (Math.hypot(p.x - front[0], p.y - front[1]) > 0.085) continue;
      champs++;
      const pw = Math.max(0.3, (playerPower(g, p, 'lane') - 55) / 15);
      pressure += p.side === 0 ? pw : -pw;
    }
    if (g.t < CONFIG.match.laningEnd) pressure += g.lane[l] / 25;
    if (!g.sides[1].inhibs[l].alive) pressure += 1.3;
    if (!g.sides[0].inhibs[l].alive) pressure -= 1.3;
    let ds = clamp(pressure * S.wavePush, -S.waveMaxStep, S.waveMaxStep);
    if (!champs && Math.abs(pressure) < 0.5) ds += Math.sign(0.5 - w.s) * Math.min(S.waveRelax, Math.abs(0.5 - w.s));
    const [lo, hi] = waveLimits(g, l);
    w.s = clamp(w.s + ds, lo, hi);
    w.atRed = w.s >= hi - 0.002;   // 블루 미니언이 레드 구조물을 치는 중
    w.atBlue = w.s <= lo + 0.002;
  }
}

// ---------------- 구조물 피해 ----------------
function structMult(g, A, target) {
  const S = SIM();
  let m = (1 + A.grubs * S.grubsStructBonus) * (A.baronUntil > g.t ? 1 + S.baronStructBonus : 1);
  if (A.siegeBoostUntil > g.t) m *= A.siegeBoost;
  if (target.kind === 'tower') {
    if (g.t < S.fortifyUntil) m *= 0.3;
    else if (target.idx === 0 && g.t < S.plateUntil) m *= 0.65;
  }
  return m;
}
function hpMult(target) {
  const H = SIM().structHp;
  return target.kind === 'tower' ? H.tower[target.idx] : H[target.kind];
}
function getHp(D, t) {
  if (t.kind === 'tower') return D.towers[t.lane][t.idx];
  if (t.kind === 'inhib') return D.inhibs[t.lane].hp;
  if (t.kind === 'nexusTower') return D.nexusTowerHp[t.idx];
  return D.nexusHp;
}
function setHp(D, t, v) {
  if (t.kind === 'tower') D.towers[t.lane][t.idx] = v;
  else if (t.kind === 'inhib') D.inhibs[t.lane].hp = v;
  else if (t.kind === 'nexusTower') D.nexusTowerHp[t.idx] = v;
  else D.nexusHp = v;
}

export function structures(g) {
  const S = SIM();
  const d = dt();
  for (const A of g.sides) {
    const D = g.sides[1 - A.idx];
    const targets = [];
    for (const l of geo.LANES) { const t = nextLaneStructure(g, A.idx, l); if (t) targets.push(t); }
    if (baseOpen(D)) for (let i = 0; i < 2; i++) if (D.nexusTowerHp[i] > 0) targets.push({ kind: 'nexusTower', idx: i, pos: geo.nexusTowerPos(D.idx, i) });
    if (nexusAttackable(g, A.idx) && D.nexus) targets.push({ kind: 'nexus', pos: geo.nexusPos(D.idx) });
    for (const t of targets) {
      const attackers = A.players.filter(p => p.alive && !p.fightId && !p.chan && distTo(p, t.pos) <= S.towerRange);
      // 미니언: 라인 구조물은 웨이브가 그 앞에 있을 때 / 쌍둥이 포탑은 억제기가 깨진 라인의 웨이브가 기지까지 왔을 때
      let minions = false;
      if (t.kind === 'tower' || t.kind === 'inhib') minions = A.idx === 0 ? g.waves[t.lane].atRed : g.waves[t.lane].atBlue;
      else if (t.kind === 'nexusTower') minions = geo.LANES.some(l => !D.inhibs[l].alive && (A.idx === 0 ? g.waves[l].atRed : g.waves[l].atBlue));
      let nexusOk = true;
      if (t.kind === 'nexus') {
        const inside = A.players.filter(p => p.alive && geo.inBase(D.idx, p.x, p.y)).length;
        nexusOk = inside >= S.nexusMinAttackers;
        minions = false;
      }
      if (!nexusOk || (!attackers.length && !minions)) continue;
      const m = structMult(g, A, t);
      let dmg = attackers.length * S.champStructDps * m * d;
      if (minions) dmg += S.minionStructDps * d * (t.kind === 'nexusTower' ? S.superMinionMult : 1) * (A.baronUntil > g.t ? 2 : 1);
      const hp = getHp(D, t) - dmg / hpMult(t);
      setHp(D, t, Math.max(0, hp));
      if (hp <= 0) { destroyStructure(g, A.idx, t, attackers, minions, false); if (g.over) return; continue; }
      // 미니언 없이 포탑 아래: 포탑이 챔피언을 공격
      if ((t.kind === 'tower' || t.kind === 'nexusTower') && !minions && attackers.length) {
        const victim = attackers.reduce((a, b) => (a.hp < b.hp ? a : b));
        victim.hp -= S.towerDps * d / (1 + victim.level * 0.03);
        if (victim.hp <= 0) killPlayer(g, null, victim, [], { reason: 'tower' });
      }
    }
  }
}

export function destroyStructure(g, attIdx, t, attackers, minions, herald) {
  const G = CONFIG.match.gold;
  const A = g.sides[attIdx], D = g.sides[1 - attIdx];
  let gold = 0, ev;
  const base = { side: attIdx, pos: t.pos.slice(), parts: attackers.map(p => p.pid), minions: !!minions, herald: !!herald, region: geo.regionOf(...t.pos) };
  if (t.kind === 'tower') {
    D.towers[t.lane][t.idx] = 0;
    A.towersDestroyed++;
    gold = t.idx === 0 ? (g.t < 840 ? G.towerOuterEarly : G.towerOuter) : t.idx === 1 ? G.towerInner : G.towerInhib;
    const first = !g.firstTower;
    g.firstTower = true;
    const split = attackers.length === 1 && g.t >= CONFIG.match.laningEnd && t.lane !== 'MID';
    ev = emit(g, { type: 'tower', lane: t.lane, idx: t.idx, first, split, splitPid: split ? attackers[0].pid : null, big: false, ...base });
  } else if (t.kind === 'inhib') {
    D.inhibs[t.lane].alive = false; D.inhibs[t.lane].hp = 0;
    D.inhibs[t.lane].at = g.t + CONFIG.match.objectives.inhibRespawn;
    gold = G.inhib;
    ev = emit(g, { type: 'inhib', lane: t.lane, big: true, ...base });
  } else if (t.kind === 'nexusTower') {
    D.nexusTowerHp[t.idx] = 0; D.nexusTowers = D.nexusTowerHp.filter(h => h > 0).length; A.towersDestroyed++;
    gold = G.nexusTower;
    ev = emit(g, { type: 'nexusTower', idx: t.idx, big: false, ...base });
  } else if (t.kind === 'nexus') {
    D.nexus = false; D.nexusHp = 0;
    ev = emit(g, { type: 'nexus', big: true, ...base });
    g.over = true; g.winner = attIdx;
  }
  const al = alive(A);
  for (const p of (al.length ? al : A.players)) p.gold += gold / Math.max(1, al.length || 5);
  return ev;
}

// ---------------- 전령 ----------------
export function heraldUnit(g) {
  const h = g.heraldUnit;
  if (!h) return;
  const S = SIM();
  const A = g.sides[h.side];
  const target = nextLaneStructure(g, h.side, h.lane);
  if (!target) { g.heraldUnit = null; return; }
  const dir = h.side === 0 ? 1 : -1;
  const step = S.heraldSpeed * dt() / geo.laneLength(h.lane);
  const goal = target.s - dir * 0.01;
  h.s = dir > 0 ? Math.min(goal, h.s + step) : Math.max(goal, h.s - step);
  [h.x, h.y] = geo.pointOnLane(h.lane, h.s);
  // 수비 챔피언이 전령을 공격
  const defenders = g.sides[1 - h.side].players.filter(p => p.alive && Math.hypot(p.x - h.x, p.y - h.y) < 0.07);
  h.hp -= defenders.length * 0.12;
  if (h.hp <= 0) { emit(g, { type: 'heraldDown', side: h.side, pos: [h.x, h.y], parts: defenders.map(p => p.pid) }); g.heraldUnit = null; return; }
  if (Math.abs(h.s - goal) < 1e-6) {
    // 포탑 도착: 돌진 피해
    const D = g.sides[1 - h.side];
    const hp = getHp(D, target) - S.heraldStructDmg / hpMult(target);
    setHp(D, target, Math.max(0, hp));
    emit(g, { type: 'heraldCharge', side: h.side, lane: h.lane, idx: target.idx, kind: target.kind, pos: target.pos.slice(), unit: [h.x, h.y], parts: [] });
    if (hp <= 0) {
      const near = A.players.filter(p => p.alive && distTo(p, target.pos) <= S.towerRange * 2);
      destroyStructure(g, h.side, target, near, false, true);
    }
    g.heraldUnit = null;
  }
}
export function summonHerald(g, p, lane) {
  const S = g.sides[p.side];
  S.heraldEye = null;
  const pr = geo.projectOnLane(lane, p.x, p.y);
  g.heraldUnit = { side: p.side, lane, s: pr.s, x: p.x, y: p.y, hp: SIM().heraldHp, holder: p.pid };
  emit(g, { type: 'heraldSummon', side: p.side, lane, pid: p.pid, pos: [p.x, p.y], parts: [p.pid] });
}

// ---------------- 오브젝트 ----------------
const OBJ_KEYS = ['elder', 'baron', 'dragon', 'atakhan', 'herald', 'grubs'];
export function spawnObjectives(g) {
  const O = CONFIG.match.objectives;
  const o = g.obj;
  const sp = (k, extra = {}) => { o[k].alive = true; o[k].spawnedAt = g.t; o[k].prog = null; emit(g, { type: 'spawn', obj: k, pos: geo.OBJ_POS[k].slice(), parts: [], ...extra }); };
  if (!o.dragon.alive && o.dragon.next !== null && g.t >= o.dragon.next && !g.sides.some(s => s.soul)) {
    if (g.dragonOrder.length >= 2 && !g.riftType) {
      const avail = CONFIG.match.dragonTypes.filter(t => !g.dragonOrder.includes(t));
      g.riftType = g.rng.pick(avail);
    }
    o.dragon.type = g.riftType || g.rng.pick(CONFIG.match.dragonTypes.filter(t => !g.dragonOrder.includes(t)));
    sp('dragon', { dragon: o.dragon.type });
  }
  if (!o.elder.alive && o.elder.next !== null && g.t >= o.elder.next) sp('elder');
  if (!o.grubs.done && !o.grubs.alive && g.t >= o.grubs.next) sp('grubs');
  if (o.grubs.alive && g.t >= O.grubsDespawn && !o.grubs.prog) { o.grubs.alive = false; o.grubs.done = true; }
  if (!o.herald.done && !o.herald.alive && g.t >= o.herald.next) sp('herald');
  if (o.herald.alive && g.t >= O.heraldDespawn && !o.herald.prog) { o.herald.alive = false; o.herald.done = true; }
  if (!o.baron.alive && g.t >= o.baron.next) sp('baron');
  if (!o.atakhan.done && o.atakhan.next !== null && !o.atakhan.alive && g.t >= o.atakhan.next) sp('atakhan');
}

// 처치 필요 시간(초)
export function objNeed(g, key, side, n) {
  const S = SIM();
  const [mn, mx] = S.objTime[key];
  const avgGold = teamGold(g.sides[side]) / 5;
  const goldF = clamp((avgGold - 2500) / 9000, 0, 1);
  const str = clamp(0.16 * (n - 1) + 0.36 * goldF, 0, 1);
  let need = mx - (mx - mn) * str;
  if (key === 'baron') { if (g.t < CONFIG.match.midEnd) need *= S.baronEarlyMult; if (n < 4) need *= S.baronFewMult; }
  return Math.max(mn, need);
}
export const inPit = (p, key) => p.alive && !p.chan && distTo(p, geo.OBJ_POS[key]) <= geo.PIT_RADIUS;

export function objectives(g) {
  const d = dt();
  for (const k of OBJ_KEYS) {
    const o = g.obj[k];
    if (!o.alive) continue;
    const mem = g.sides.map(s => s.players.filter(p => inPit(p, k)));
    // 진행 중인 처치
    if (o.prog) {
      const X = o.prog.side;
      if (!mem[X].length) { o.prog = null; continue; }
      const busy = mem[X].filter(p => !p.fightId);
      if (!busy.length) continue;              // 둥지 안에서 교전 중이면 멈춤
      o.prog.need = objNeed(g, k, X, busy.length);
      o.prog.val += d / o.prog.need;
      o.prog.n = busy.length;
      if (o.prog.val >= 1 && g.t - o.prog.start >= SIM().objTime[k][0]) completeObjective(g, k, X, mem);
      continue;
    }
    // 시작: 처치하러 온 팀만 (지나가는 선수는 시작하지 않음)
    for (const X of [0, 1]) {
      const takers = mem[X].filter(p => !p.fightId && p.task && p.task.kind === 'objTake' && p.task.key === k);
      if (takers.length) { o.prog = { side: X, val: 0, start: g.t, need: objNeed(g, k, X, takers.length), n: takers.length }; emit(g, { type: 'objStart', obj: k, side: X, pos: geo.OBJ_POS[k].slice(), parts: takers.map(p => p.pid) }); break; }
    }
  }
}

function completeObjective(g, k, X, mem) {
  const o = g.obj[k];
  const S = SIM();
  let side = X, stolen = false, parts = mem[X].map(p => p.pid);
  if (['dragon', 'baron', 'elder'].includes(k)) {
    const ej = byPos(g.sides[1 - X], 'JGL');
    if (ej.alive && !ej.chan && distTo(ej, geo.OBJ_POS[k]) <= geo.PIT_RADIUS + 0.02 && g.t >= (ej.smiteAt || 0)) {
      const p = S.stealBase + (ej.st.mechanics - 75) * S.stealPerMech;
      if (g.rng.chance(clamp(p, 0.02, 0.35))) { side = 1 - X; stolen = true; parts = [ej.pid, ...mem[1 - X].filter(q => q !== ej).map(q => q.pid)]; }
    }
  }
  const start = o.prog.start, progSide = X;
  o.prog = null;
  takeObjective(g, side, k, { stolen, parts, progSide, start });
}

export function takeObjective(g, sideIdx, key, opts = {}) {
  const G = CONFIG.match.gold, O = CONFIG.match.objectives;
  const S = g.sides[sideIdx];
  const o = g.obj[key];
  if (!o || !o.alive) return null;
  o.alive = false;
  const al = alive(S);
  const share = gold => { for (const p of (al.length ? al : S.players)) p.gold += gold / Math.max(1, al.length || 5); };
  const base = { side: sideIdx, stolen: !!opts.stolen, pos: geo.OBJ_POS[key].slice(), parts: opts.parts || [], progSide: opts.progSide, start: opts.start, spawnedAt: o.spawnedAt, obj: key };
  let ev;
  if (key === 'dragon') {
    const type = o.type;
    S.dragons.push(type);
    if (g.dragonOrder.length < 3) g.dragonOrder.push(type);
    share(G.dragon);
    let soul = false;
    if (S.dragons.length >= O.soulAt && !S.soul && !g.sides[1 - sideIdx].soul) {
      S.soul = g.riftType || type; soul = true;
      g.obj.elder.next = g.t + O.elderRespawn;
      o.next = null;
    } else o.next = g.t + O.dragonRespawn;
    ev = emit(g, { type: 'dragon', dragon: type, soul, big: soul || !!opts.stolen, ...base });
  } else if (key === 'elder') {
    S.elderUntil = g.t + O.elderBuff; S.elders++;
    share(G.elder);
    o.next = g.t + O.elderRespawn;
    ev = emit(g, { type: 'elder', big: true, ...base });
  } else if (key === 'baron') {
    S.baronUntil = g.t + O.baronBuff; S.barons++;
    for (const p of al) p.gold += G.baron / 5;
    o.next = g.t + O.baronRespawn;
    ev = emit(g, { type: 'baron', big: true, ...base });
  } else if (key === 'grubs') {
    S.grubs += 3; o.done = true; share(G.grubs);
    ev = emit(g, { type: 'grubs', big: false, ...base });
  } else if (key === 'herald') {
    S.heralds++; o.done = true; share(G.herald);
    S.heraldEye = { until: g.t + SIM().heraldHoldSec };
    ev = emit(g, { type: 'herald', big: false, ...base });
  } else if (key === 'atakhan') {
    S.atakhan++; o.done = true; share(G.atakhan);
    ev = emit(g, { type: 'atakhan', big: true, ...base });
  }
  for (const pid of base.parts) { const p = g.byId[pid]; if (p && p.pos === 'JGL') p.smiteAt = g.t + 90; }
  return ev;
}
