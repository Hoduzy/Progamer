// ============================================================
//  교전: 실제로 가까이 있는 선수들만 묶어서 교전 개시 여부를 정하고,
//  1초 단위로 피해를 계산한다. 근처에 없는 선수는 절대 참여하지 않는다.
// ============================================================
import { CONFIG } from '../config.js';
import { clamp } from '../core/util.js';
import * as geo from './mapgeo.js';
import {
  SIM, dt, allPlayers, alive, emit, killPlayer, pdist, distTo, dpsOf, ehpOf, champCls, FRONT, ROLE_KILL, trait, pickKiller, killWeight,
} from './matchcore.js';

const TASK_OBJ = new Set(['objTake', 'objContest', 'objSetup']);
const TASK_AGGRO = new Set(['gank', 'dive', 'pick', 'siege', 'nexus', 'contest']);

function clusters(ps, link) {
  const parent = ps.map((_, i) => i);
  const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
    if (pdist(ps[i], ps[j]) <= link) { const a = find(i), b = find(j); if (a !== b) parent[a] = b; }
  }
  const groups = {};
  ps.forEach((p, i) => { (groups[find(i)] = groups[find(i)] || []).push(p); });
  return Object.values(groups);
}

// 교전 전력 (란체스터식: 피해량 × 버틸 수 있는 체력)
export function strength(g, ps, n) {
  if (!ps.length) return 0;
  let d = 0, h = 0;
  for (const p of ps) { d += dpsOf(g, p, n); h += ehpOf(p) * Math.max(0.05, p.hp); }
  return d * h;
}

function towerSupport(g, center) {
  // 중심이 어느 팀 포탑 사거리 안인지
  const R = SIM().towerRange * 1.4;
  for (const s of g.sides) {
    for (const l of geo.LANES) for (let i = 0; i < 3; i++) if (s.towers[l][i] > 0 && Math.hypot(...geo.towerPos(s.idx, l, i).map((v, k) => v - center[k])) <= R) return s.idx;
    for (let i = 0; i < 2; i++) if (s.nexusTowerHp[i] > 0 && Math.hypot(...geo.nexusTowerPos(s.idx, i).map((v, k) => v - center[k])) <= R) return s.idx;
  }
  return -1;
}

function context(g, A, B, center) {
  const all = A.concat(B);
  const S = SIM();
  const laningOnly = g.t < CONFIG.match.laningEnd && all.every(p => p.task && p.task.kind === 'lane');
  if (laningOnly && A.length === B.length) return { kind: 'trade', base: S.trade.chance };
  // 장로·바론을 치는 중인 팀에게 견제하러 온 팀: 거의 반드시 싸움이 난다 (처치 팀은 둥지에 묶여 있음)
  // 장로는 견제 팀이 모여서(objTakingMin명, 살아 있는 인원이 적으면 전원) 둥지 근처에 왔을 때 — 먼저 온 두세 명이 잘리는 싸움이 아니라 한타로
  const isCont = (p, key) => p.task && p.task.kind === 'objContest' && !p.task.gather && p.task.key === key && distTo(p, geo.OBJ_POS[key]) < 0.16;
  const contester = all.find(p => p.task && p.task.kind === 'objContest' && !p.task.gather && S.engage.objTaking[p.task.key] && g.obj[p.task.key].prog && distTo(p, geo.OBJ_POS[p.task.key]) < 0.16);
  if (contester) {
    const key = contester.task.key, need = (S.engage.objTakingMin || {})[key] || 1;
    const mates = g.sides[contester.side].players.filter(q => q.alive);
    if (mates.filter(q => isCont(q, key)).length >= Math.min(need, mates.length)) return { kind: 'fight', base: S.engage.objTaking[key] };
  }
  if (all.some(p => p.task && TASK_OBJ.has(p.task.kind) && distTo(p, geo.OBJ_POS[p.task.key]) < 0.16)) return { kind: 'fight', base: S.engage.objective };
  if (all.some(p => p.task && (p.task.kind === 'gank' || p.task.kind === 'dive' || p.task.kind === 'pick'))) return { kind: 'fight', base: S.engage.gank };
  if (towerSupport(g, center) >= 0 || all.some(p => p.task && (p.task.kind === 'siege' || p.task.kind === 'defend' || p.task.kind === 'nexus'))) return { kind: 'fight', base: S.engage.structure };
  if (A.length !== B.length) return { kind: 'fight', base: S.engage.numbers };
  return { kind: 'fight', base: g.t >= CONFIG.match.midEnd ? S.engage.late : S.engage.roam };
}
function desire(r) {
  if (r >= 1.3) return 1.25;
  if (r >= 1.0) return 0.9;
  if (r >= 0.8) return 0.45;
  if (r >= SIM().avoidRatio) return 0.2;
  return 0.03;
}

export function combat(g) {
  detect(g);
  for (const f of g.fights.slice()) fightTick(g, f);
}

function detect(g) {
  const S = SIM();
  const ps = allPlayers(g).filter(p => p.alive && !p.flee && !(p.fightId && g.fights.some(f => f.id === p.fightId)));
  for (const cl of clusters(ps, S.clusterLink)) {
    const A = cl.filter(p => p.side === 0), B = cl.filter(p => p.side === 1);
    if (!A.length || !B.length) continue;
    let minD = 9;
    for (const a of A) for (const b of B) minD = Math.min(minD, pdist(a, b));
    if (minD > S.engageRange) continue;
    const center = [cl.reduce((s, p) => s + p.x, 0) / cl.length, cl.reduce((s, p) => s + p.y, 0) / cl.length];
    // 이미 근처에 진행 중인 교전이 있으면 그 교전에 합류 (fightTick이 반경 안 선수를 모은다)
    if (g.fights.some(f => Math.hypot(f.center[0] - center[0], f.center[1] - center[1]) <= S.fightRadius)) continue;
    const ctx = context(g, A, B, center);
    const n = cl.length;
    const sA = strength(g, A, n), sB = strength(g, B, n);
    const rA = sA / Math.max(1e-9, sB), rB = 1 / Math.max(1e-9, rA);
    const aggroA = A.some(p => p.task && TASK_AGGRO.has(p.task.kind)) ? 1.3 : 1;
    const aggroB = B.some(p => p.task && TASK_AGGRO.has(p.task.kind)) ? 1.3 : 1;
    const dA = clamp(ctx.base * desire(rA) * aggroA, 0, 0.97), dB = clamp(ctx.base * desire(rB) * aggroB, 0, 0.97);
    if (g.rng.chance(1 - (1 - dA) * (1 - dB))) {
      startFight(g, center, ctx.kind, cl);
    } else {
      // 불리한 쪽은 교전을 피해 물러난다
      if (rA < S.avoidRatio) for (const p of A) p.avoidUntil = g.t + 15;
      if (rB < S.avoidRatio) for (const p of B) p.avoidUntil = g.t + 15;
      if (ctx.kind === 'trade') for (const p of cl) p.tradeCd = g.t + 10;
    }
  }
}

function startFight(g, center, kind, cl) {
  const f = {
    id: g.nextFightId++, center, kind, start: g.t, ticks: 0,
    parts: [new Set(), new Set()], killsBy: {}, deaths: [0, 0], maxN: [0, 0],
    obj: Object.keys(geo.OBJ_POS).find(k => g.obj[k] && g.obj[k].alive && Math.hypot(geo.OBJ_POS[k][0] - center[0], geo.OBJ_POS[k][1] - center[1]) < 0.12) || null,
    junglers: [false, false],
    // 교전 집중력: 팀마다 교전 시작 때 한 번 정함 (계획 판단에는 안 보임 → 불리한 팀도 가끔 이김)
    exec: [0, 1].map(() => Math.exp(g.rng.normal(0, SIM().fightSwing))),
  };
  g.fights.push(f);
  return f;
}

function participants(g, f) {
  const R = SIM().fightRadius;
  return allPlayers(g).filter(p => p.alive && !p.flee && (!p.fightId || p.fightId === f.id) && Math.hypot(p.x - f.center[0], p.y - f.center[1]) <= R);
}

function fightTick(g, f) {
  const S = SIM();
  const ps = participants(g, f);
  const A = ps.filter(p => p.side === 0), B = ps.filter(p => p.side === 1);
  if (!A.length || !B.length) return endFight(g, f);
  for (const p of ps) {
    p.fightId = f.id; p.chan = null;
    f.parts[p.side].add(p.pid);
    if (p.pos === 'JGL') f.junglers[p.side] = true;
  }
  f.maxN[0] = Math.max(f.maxN[0], A.length); f.maxN[1] = Math.max(f.maxN[1], B.length);
  const n = ps.length;
  const trade = f.kind === 'trade';
  // 큰 교전: 첫 교환(탐색전)은 덜 치명적, 이후 본 교전에서 크게 터진다 (팽팽하면 첫 교환 뒤 서로 빠질 수 있음)
  const intensity = trade ? S.trade.intensity : n >= 8 ? (f.ticks === 0 ? S.bigFightOpen : S.bigFightDps) : 1;
  const dps = new Map(ps.map(p => [p, dpsOf(g, p, n) * intensity * (f.exec ? f.exec[p.side] : 1)]));
  const tw = towerSupport(g, f.center);
  // 이 교전에서 각 대상에게 누가 얼마나 피해를 줬는지 (킬 배분용)
  if (!f.dmgOn) f.dmgOn = new Map();
  const dmgOn = v => { let m = f.dmgOn.get(v); if (!m) { m = new Map(); f.dmgOn.set(v, m); } return m; };
  const sides = [A, B];
  for (let sub = 0; sub < dt(); sub++) {
    for (const side of [0, 1]) {
      const att = sides[side].filter(p => p.alive), def = sides[1 - side].filter(p => p.alive);
      if (!att.length || !def.length) break;
      const pickT = () => g.rng.weighted(def.map(d => [d, (FRONT[champCls(d)] || 1) * (1.6 - d.hp) ** 2]));
      const focus = pickT();
      for (const a of att) {
        const tgt = focus.alive && g.rng.chance(S.focus) ? focus : pickT();
        const dmg = dps.get(a) * g.rng.float(0.7, 1.3);
        tgt.hp -= dmg / ehpOf(tgt);
        a.dmg += dmg * 1.4; tgt.taken += dmg;
        const m = dmgOn(tgt); m.set(a, (m.get(a) || 0) + dmg);
      }
      if (tw === 1 - side) {
        // 포탑이 근처 공격자를 때림
        const tgt = g.rng.pick(att);
        tgt.hp -= S.towerDps / ehpOf(tgt);
      }
    }
    for (const p of ps) {
      if (p.alive && p.hp <= 0) {
        const contrib = f.dmgOn.get(p);
        const cands = sides[1 - p.side].filter(q => q.alive && contrib && contrib.has(q));
        const killer = cands.length ? pickKiller(g, cands, contrib) : nearestAlive(sides[1 - p.side], p);
        const as = sides[1 - p.side].filter(q => q.alive && q !== killer);
        killPlayer(g, killer, p, as, { reason: f.kind, fightId: f.id, big: !trade, ks: ksOf(killer, as, contrib) });
        f.deaths[p.side]++;
        if (killer) f.killsBy[killer.pid] = (f.killsBy[killer.pid] || 0) + 1;
      }
    }
  }
  // 궁극기·점멸 소모
  for (const p of ps) {
    if (!p.alive) continue;
    if (p.level >= 6 && g.rng.chance(trade ? 0.25 : 0.7)) p.ultAt = g.t + g.rng.int(60, 110) - p.level * 1.5;
    if (g.rng.chance(trade ? 0.12 : 0.3)) p.flashAt = g.t + 300;
  }
  f.ticks++;
  // 후퇴 판단
  const aliveA = A.filter(p => p.alive), aliveB = B.filter(p => p.alive);
  const strA = strength(g, aliveA, n), strB = strength(g, aliveB, n);
  const fr = n >= 8 ? S.fleeRatioBig : S.fleeRatio;
  const fleeSide = !aliveA.length || !aliveB.length ? -1 : strA < strB * fr ? 0 : strB < strA * fr ? 1 : -1;
  const fleeHp = trade ? S.trade.fleeHp : n >= 8 ? S.fleeHpBig : S.fleeHp;
  for (const p of aliveA.concat(aliveB)) {
    // 큰 교전에서 혼자 남은 선수는 체력이 남아 있을 때 먼저 빠진다 (점멸·이동기로 살아 나가는 마지막 한 명)
    const lastOne = n >= 8 && (p.side === 0 ? aliveA : aliveB).length === 1 && p.hp < S.lastFleeHp;
    if (p.side === fleeSide || p.hp < fleeHp || lastOne || (trade && f.ticks >= 1) || f.ticks >= (n >= 8 ? S.fightMaxTicksBig : S.fightMaxTicks)) flee(g, f, p, sides[1 - p.side], trade, n, lastOne);
  }
  // 큰 교전 첫 교환 뒤 팽팽하면 양 팀이 함께 빠지기도 한다
  if (n >= 8 && f.ticks === 1 && fleeSide < 0 && strA > 0 && strB > 0 && strA / strB > 0.75 && strA / strB < 1.33 && g.rng.chance(S.mutualDisengage)) {
    for (const p of aliveA.concat(aliveB)) if (!p.flee) { p.flee = true; p.fleeUntil = g.t + 10; p.fightId = null; }
  }
  const remA = A.filter(p => p.alive && !p.flee), remB = B.filter(p => p.alive && !p.flee);
  if (!remA.length || !remB.length || f.ticks >= (n >= 8 ? S.fightMaxTicksBig : S.fightMaxTicks)) endFight(g, f);
}

// "서폿이 원딜 킬을 뺏어감": 서폿이 마무리했는데 같은 팀 원딜이 더 많이 때렸을 때
function ksOf(killer, mates, contrib) {
  if (!killer || killer.pos !== 'SUP' || !contrib) return false;
  const adc = mates.find(q => q.pos === 'ADC');
  return !!adc && (contrib.get(adc) || 0) > (contrib.get(killer) || 0) * 1.5;
}

function nearestAlive(arr, p) {
  let best = null, bd = 9;
  for (const q of arr) if (q.alive) { const d = pdist(q, p); if (d < bd) { bd = d; best = q; } }
  return best;
}

function flee(g, f, p, enemies, trade, n, lastOne = false) {
  const S = SIM();
  const chasers = enemies.filter(q => q.alive && !q.flee && q.hp > 0.25);
  if (chasers.length && !trade) {
    const mob = clamp((trait(p, 'mobility') - 5) * 0.05, -0.2, 0.25);
    let pc = S.catchBase * (1.25 - p.hp) * (g.t >= p.flashAt ? 0.6 : 1) * (1 + S.catchPerChaser * (chasers.length - 1)) * (1 - mob) * (n <= 5 ? S.catchSmall : 1) * (lastOne ? S.lastEscape : 1);
    if (g.rng.chance(clamp(pc, 0, 0.9))) {
      const contrib = f.dmgOn && f.dmgOn.get(p);
      const k = pickKiller(g, chasers, contrib || null);
      killPlayer(g, k, p, chasers.filter(c => c !== k), { reason: f.kind, fightId: f.id, big: true, ks: ksOf(k, chasers, contrib) });
      f.deaths[p.side]++;
      f.killsBy[k.pid] = (f.killsBy[k.pid] || 0) + 1;
      return;
    }
  }
  if (g.t >= p.flashAt && g.rng.chance(0.4)) p.flashAt = g.t + 300;
  p.flee = true; p.fleeUntil = g.t + (trade ? 6 : 12); p.fightId = null;
}

// 큰 오브젝트 앞에서 크게 진 팀(2명 이상 더 죽음)은 실제로 빠진다: 후퇴 1회로 세고, 다시 들어오기 전 대기.
// 후퇴가 최대 횟수에 닿으면 이번 등장은 교환·포기로 바꾼다 (지는 싸움을 계속 다시 거는 것 방지)
function lostAtObjective(g, f) {
  const k = f.obj;
  if (!k || !['dragon', 'baron', 'elder'].includes(k) || !g.obj[k] || !g.obj[k].alive) return;
  const H = SIM().stance;
  for (const s of g.sides) {
    const p = s.plan, st = s.objStance && s.objStance[k];
    if (!p || p.key !== k || !['objTake', 'objContest', 'objSetup'].includes(p.kind) || !st) continue;
    if (f.deaths[s.idx] - f.deaths[1 - s.idx] < 2) continue;
    st.retreats++;
    if (st.retreats >= H.maxRetreats) st.stance = st.adv < 0 ? 'trade' : 'concede';
    s.objCooldown = s.objCooldown || {};
    for (const key of ['dragon', 'baron', 'elder']) s.objCooldown[key] = Math.max(s.objCooldown[key] || 0, g.t + H.reenterSec);   // 정비 후 다시 (다른 큰 오브젝트로 바로 옮겨 가지 않음)
    s.objAnyUntil = g.t + H.reenterSec;
    p.until = g.t;   // 다음 계획 갱신에서 물러난다
    p.lost = true;
  }
}

function endFight(g, f) {
  g.fights = g.fights.filter(x => x !== f);
  for (const p of allPlayers(g)) if (p.fightId === f.id) p.fightId = null;
  const nA = f.parts[0].size, nB = f.parts[1].size;
  if (!nA || !nB) return;
  const kills = f.deaths[0] + f.deaths[1];
  lostAtObjective(g, f);
  const lo = Math.min(nA, nB), hi = Math.max(nA, nB);
  let label;
  if (lo >= 4) label = 'teamfight';
  else if (f.kind === 'trade' && !kills) label = 'trade';
  else if (hi === 1) label = kills ? 'soloKill' : 'duel';
  else if (lo === 1 || hi <= 2) {
    const early = g.t < CONFIG.match.laningEnd;
    label = early && f.junglers[0] && f.junglers[1] ? 'counterGank' : early && (f.junglers[0] || f.junglers[1]) ? 'gank' : 'pick';
  } else label = 'skirmish';
  const winner = f.deaths[0] === f.deaths[1] ? -1 : f.deaths[0] < f.deaths[1] ? 0 : 1;
  const ace = winner >= 0 && alive(g.sides[1 - winner]).length === 0;
  const region = geo.regionOf(...f.center);
  const lane = geo.regionLane(region);
  const ev = emit(g, {
    type: label, fightId: f.id, pos: f.center.slice(), region, lane, obj: f.obj, start: f.start,
    parts: [...f.parts[0], ...f.parts[1]], partsBySide: [[...f.parts[0]], [...f.parts[1]]], maxN: f.maxN.slice(),
    deaths: f.deaths.slice(), kills, winner, side: winner, ace, big: label === 'teamfight' && kills >= 3,
    ganker: label === 'gank' ? [...f.parts[0], ...f.parts[1]].find(pid => g.byId[pid].pos === 'JGL') : null,
  });
  for (const pid in f.killsBy) {
    const c = f.killsBy[pid];
    if (c >= 2) emit(g, { type: 'multi', pid, n: c, side: g.byId[pid].side, pos: f.center.slice(), region, parts: [pid], fightId: f.id, fightLabel: label, big: c >= 3 });
  }
  if (ace && kills >= 3) emit(g, { type: 'ace', side: winner, pos: f.center.slice(), region, parts: ev.parts, fightId: f.id, fightLabel: label, big: true });
  if (winner >= 0) g.sides[winner].lastWin = { t: g.t, kills: f.deaths[1 - winner], pos: f.center.slice(), label };
  if (winner >= 0) g.sides[1 - winner].lastLoss = { t: g.t, deaths: f.deaths[1 - winner], pos: f.center.slice() };
  return ev;
}
