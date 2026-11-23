// 선택 장면: 장면 고르기 → 확률 계산 → 판정 → 효과 적용
import { CONFIG } from '../config.js';
import { clamp, fill, POS } from '../core/util.js';
import { CHAMPIONS, champName } from '../../data/champions.js';
import { SCENARIOS } from '../../data/scenarios.js';
import { SCENE_NEEDS } from '../../data/sceneNeeds.js';
import { nextItemCost, inPit } from './world.js';
import {
  userPlayer, enemyOf, byPos, alive, goldDiff, ultReady, flashReady, killPlayer, allPlayers, LANE_OF,
} from './match.js';
import * as geo from './mapgeo.js';

export function phaseOf(t) {
  if (t < CONFIG.match.laningEnd) return 'early';
  if (t < CONFIG.match.midEnd) return 'mid';
  return 'late';
}

export function buildContext(g, extra = {}) {
  const me = userPlayer(g);
  const S = g.sides[me.side], E = enemyOf(g, me.side);
  const gd = me.side === 0 ? goldDiff(g) : -goldDiff(g);
  const bountyP = E.players.filter(p => p.alive && p.streak >= 3).sort((a, b) => b.streak - a.streak)[0] || null;
  const anyInhibDown = s => ['TOP', 'MID', 'BOT'].some(l => !s.inhibs[l].alive);
  return {
    g, me, S, E, t: g.t, phase: phaseOf(g.t),
    opp: byPos(E, me.pos), ejg: byPos(E, 'JGL'),
    goldDiff: gd, aliveMine: alive(S).length, aliveEnemy: alive(E).length,
    enemyDead: E.players.filter(p => !p.alive).length,
    myUlt: ultReady(g, me), myFlash: flashReady(g, me),
    obj: Object.fromEntries(Object.entries(g.obj).map(([k, v]) => [k, !!v.alive])),
    soulPoint: S.dragons.length === 3 || E.dragons.length === 3,
    enemyBaseOpen: anyInhibDown(E) && E.nexusTowers === 0,
    myBaseOpen: anyInhibDown(S) && S.nexusTowers < 2,
    enemyBaron: E.baronUntil > g.t,
    bountyTarget: bountyP,
    ...extra,
  };
}

function vars(ctx) {
  const v = { me: champName(ctx.me.champ), dragon: ctx.g.obj.dragon.type || '원소', deadN: ctx.enemyDead };
  const map = { top: 'TOP', jg: 'JGL', mid: 'MID', adc: 'ADC', sup: 'SUP' };
  for (const [k, pos] of Object.entries(map)) {
    v['e' + k] = champName(byPos(ctx.E, pos).champ);
    v['a' + k] = champName(byPos(ctx.S, pos).champ);
  }
  v.ejg = v.ejg || champName(ctx.ejg.champ);
  v.ajg = champName(byPos(ctx.S, 'JGL').champ);
  v.opp = champName(ctx.opp.champ);
  v.bounty = ctx.bountyTarget ? champName(ctx.bountyTarget.champ) : v.eadc;
  return v;
}

export function eligible(sc, ctx) {
  if (sc.pos !== 'ALL' && sc.pos !== ctx.me.pos) return false;
  if (!sc.phase.includes(ctx.phase)) return false;
  if (sc.cond && !sc.cond(ctx)) return false;
  return true;
}

// 사용자 상태(컨디션/멘탈/피로)는 g.userState 로 전달
export function calcProb(opt, ctx, userState = { condition: 70, mental: 60, fatigue: 30 }) {
  const S = CONFIG.scene;
  const me = ctx.me;
  const parts = [{ label: '기본', v: opt.base }];
  const STAT_KO = { laning: '라인전', teamfight: '한타', mechanics: '피지컬', decision: '판단력', vision: '시야', mental: '멘탈', pool: '챔프폭', stamina: '체력' };
  for (const [k, w] of Object.entries(opt.st || {})) {
    const v = w * (me.st[k] - 60) / 10 * S.statPer10;
    if (Math.abs(v) >= 0.5) parts.push({ label: STAT_KO[k], v });
  }
  const m = (me.mastery - 50) / 10 * S.masteryPer10;
  if (Math.abs(m) >= 0.5) parts.push({ label: '숙련도', v: m });
  const cond = (userState.condition - 70) / 10 * S.condPer10;
  if (Math.abs(cond) >= 0.5) parts.push({ label: '컨디션', v: cond });
  const men = (userState.mental - 60) / 10 * S.mentalPer10;
  if (Math.abs(men) >= 0.5) parts.push({ label: '멘탈', v: men });
  const fat = -Math.max(0, userState.fatigue - 30) / 10 * S.fatiguePer10;
  if (Math.abs(fat) >= 0.5) parts.push({ label: '피로', v: fat });
  const tags = opt.tags || [];
  if (tags.includes('fight')) {
    const gv = clamp(ctx.goldDiff / 1000 * S.goldPerK, -S.goldCap, S.goldCap);
    if (Math.abs(gv) >= 0.5) parts.push({ label: '골드 차이', v: gv });
    const nv = (ctx.aliveMine - ctx.aliveEnemy) * S.perMan;
    if (nv) parts.push({ label: '인원 차이', v: nv });
  }
  if (tags.includes('ult') && !ctx.myUlt) parts.push({ label: '궁극기 없음', v: S.noUlt });
  if (tags.includes('flash') && !ctx.myFlash) parts.push({ label: '점멸 없음', v: S.noFlash });
  if (me.perf) { const pv = clamp(me.perf * 0.6, -6, 6); if (Math.abs(pv) >= 0.5) parts.push({ label: '오늘 폼', v: pv }); }
  const raw = parts.reduce((s, p) => s + p.v, 0);
  const p = clamp(Math.round(raw), S.clampMin, S.clampMax);
  // 표시 범위: 판단력이 낮으면 범위로
  const dec = me.st.decision;
  let lo = p, hi = p;
  if (dec < S.exactDecision) {
    const width = Math.round((S.exactDecision - dec) * S.rangePerPoint);
    const off = Math.round(((ctx.g.t * 7 + opt.base) % 10) / 10 * width) - Math.round(width / 2);
    lo = clamp(p - Math.round(width / 2) + off, S.clampMin, S.clampMax);
    hi = clamp(lo + width, S.clampMin, S.clampMax);
    if (p < lo) lo = p; if (p > hi) hi = p;
  }
  return { p, parts: parts.map(x => ({ label: x.label, v: Math.round(x.v * 10) / 10 })), lo, hi, exact: dec >= S.exactDecision };
}

// 시나리오가 요구하는 실제 상황 (오브젝트 / 근처 적)
const REQ = new Map();
function reqOf(sc) {
  if (REQ.has(sc)) return REQ.get(sc);
  const objs = new Set();
  if (sc.cond) for (const m of sc.cond.toString().matchAll(/c\.obj\.(\w+)/g)) objs.add(m[1]);
  let fight = false;
  for (const op of sc.opts) for (const e of Object.values(op.eff)) {
    if (!e) continue;
    if (e.obj) objs.add(e.obj);
    if (e.enemyObj) objs.add(e.enemyObj);
    if (e.kill || e.assist || e.death || e.allyKill || e.allyDeath) fight = true;
  }
  const r = { objs: [...objs], fight };
  REQ.set(sc, r);
  return r;
}
// 장면 설명이 기대는 실제 상황 (data/sceneNeeds.js 의 need/desc 에서 사용)
export function situation(g, ctx, loc, near) {
  const me = ctx.me, S = ctx.S, E = ctx.E;
  const spec = k => {
    if (k === 'me') return me;
    if (k === 'opp') return ctx.opp;
    if (k === 'bounty') return ctx.bountyTarget;
    const pos = { top: 'TOP', jg: 'JGL', mid: 'MID', adc: 'ADC', sup: 'SUP' }[k.slice(1)];
    return pos ? byPos(k[0] === 'e' ? E : S, pos) : null;
  };
  const twNear = (side, p, r) => {
    let best = null;
    for (const l of geo.LANES) for (let i = 0; i < 3; i++) {
      const hp = g.sides[side].towers[l][i];
      if (hp > 0 && Math.hypot(p.x - geo.towerPos(side, l, i)[0], p.y - geo.towerPos(side, l, i)[1]) <= r) best = best === null ? hp : Math.min(best, hp);
    }
    return best;
  };
  const region = geo.regionOf(...loc);
  const ownTw = twNear(me.side, me, 0.1);
  const s = {
    g, me, t: g.t, region, where: geo.regionKo(region),
    near: k => { const p = spec(k); return !!p && near.includes(p); },
    hp: k => { const p = spec(k); return p ? p.hp : 1; },
    flash: k => { const p = spec(k); return !!p && flashReady(g, p); },
    ult: k => { const p = spec(k); return !!p && ultReady(g, p); },
    nE: near.filter(p => p.side !== me.side).length,
    nA: near.filter(p => p.side === me.side && p !== me).length,
    aliveMine: ctx.aliveMine, aliveEnemy: ctx.aliveEnemy,
    myDead: S.players.filter(p => !p.alive).length,
    inSide: region === 'topLane' || region === 'botLane',
    inMyBase: geo.inBase(me.side, me.x, me.y), inEnemyBase: geo.inBase(1 - me.side, me.x, me.y),
    enemiesInMyBase: E.players.filter(p => p.alive && geo.inBase(me.side, p.x, p.y)).length,
    ownTowerNear: ownTw !== null, ownTowerHp: ownTw === null ? 1 : ownTw,
    enemyTowerNear: k => { const p = spec(k); return !!p && twNear(1 - me.side, p, 0.08) !== null; },
    prog: k => { const o = g.obj[k]; return o && o.alive && o.prog ? { mine: o.prog.side === me.side, val: o.prog.val, n: o.prog.n } : null; },
    soon: (k, sec) => { const o = g.obj[k]; return !!o && !o.done && (o.alive || (o.next !== null && o.next - g.t <= sec && o.next > g.t)); },
    itemGold: Math.max(0, Math.round(nextItemCost(me) - (me.gold - me.spent))),
  };
  const pct = v => Math.round(v * 100);
  const progAny = ['baron', 'dragon', 'herald', 'grubs', 'elder'].map(k => s.prog(k)).find(Boolean);
  s.vars = {
    where: s.where, opphp: pct(s.hp('opp')), myhp: pct(me.hp), myflash: s.flash('me') ? '있다' : '없다',
    eadchp: pct(s.hp('eadc')), emidhp: pct(s.hp('emid')), etophp: pct(s.hp('etop')), aadchp: pct(s.hp('aadc')), atophp: pct(s.hp('atop')),
    objpct: progAny ? pct(progAny.val) : 0, objn: progAny ? progAny.n : 0, nE: s.nE, nA: s.nA, mydead: s.myDead,
    towerhp: pct(s.ownTowerHp), ebaron: (() => { const r = Math.max(0, E.baronUntil - g.t); return `${Math.floor(r / 60)}분 ${r % 60}초`; })(),
    itemgold: s.itemGold,
  };
  return s;
}

export function nearPlayers(g, loc, R = CONFIG.match.sim.sceneRadius) {
  return allPlayers(g).filter(p => p.alive && Math.hypot(p.x - loc[0], p.y - loc[1]) <= R);
}

// 장면 시점: 실제 엔진 상황에 맞는 시나리오가 없으면 10초 뒤 다시 본다
export function buildScene(g, userState) {
  const me = userPlayer(g);
  const retry = () => {
    // 맞는 상황이 올 때까지 10초씩 미룬다. 뒤 장면들도 최소 60초 간격을 유지하며 함께 밀린다 (개수는 유지)
    g.scenePlan[0] = g.t + 10;
    for (let i = 1; i < g.scenePlan.length; i++) if (g.scenePlan[i] < g.scenePlan[i - 1] + 60) g.scenePlan[i] = g.scenePlan[i - 1] + 60;
    return null;
  };
  if (!me || !me.alive || me.chan || me.flee) return retry();
  const ctx = buildContext(g);
  const loc = [me.x, me.y];
  const near = nearPlayers(g, loc);
  const nearE = near.filter(p => p.side !== me.side);
  const used = new Set(g.sceneLog.map(s => s.id));
  const sit = situation(g, ctx, loc, near);
  const fits = sc => {
    if (!eligible(sc, ctx)) return false;
    const N = SCENE_NEEDS[sc.id] || {};
    if (N.remote) return false;
    if (N.need && !N.need(sit)) return false;
    const r = reqOf(sc);
    if (r.fight && !nearE.length && !N.noFight) return false;
    if (r.objs.length && !r.objs.some(k => g.obj[k] && g.obj[k].alive && Math.hypot(me.x - geo.OBJ_POS[k][0], me.y - geo.OBJ_POS[k][1]) <= 0.22)) return false;
    return true;
  };
  let pool = SCENARIOS.filter(sc => fits(sc) && !used.has(sc.id));
  if (!pool.length) pool = SCENARIOS.filter(fits);
  if (!pool.length) return retry();
  g.scenePlan.shift();
  const refOf = (sc) => ({ me, opp: ctx.opp, ejg: ctx.ejg, emid: byPos(ctx.E, 'MID'), eadc: byPos(ctx.E, 'ADC'), esup: byPos(ctx.E, 'SUP'), etop: byPos(ctx.E, 'TOP') }[sc.splash] || ctx.opp);
  // 포지션 장면을 공통보다 조금 더 자주, 대표 상대가 실제로 근처에 있으면 더 자주
  const sc = g.rng.weighted(pool.map(s => [s, (s.pos === 'ALL' ? 0.8 : 1.2) * (s.cond ? 1.6 : 1) * (nearE.includes(refOf(s)) ? 3 : 1)]));
  const v = { ...vars(ctx), ...sit.vars };
  const N = SCENE_NEEDS[sc.id] || {};
  const splashRef = nearE.includes(refOf(sc)) ? refOf(sc) : (nearE[0] || refOf(sc));
  // 참여자: 장면 위치 반경 안의 실제 선수 전원 (나 → 적 → 아군, 가까운 순)
  const dist = p => Math.hypot(p.x - loc[0], p.y - loc[1]);
  const involved = [me, ...nearE.sort((a, b) => dist(a) - dist(b)), ...near.filter(p => p.side === me.side && p !== me).sort((a, b) => dist(a) - dist(b))];
  const cards = {};
  for (const p of involved) cards[p.pid] = { hp: p.hp, ult: ultReady(g, p), flash: flashReady(g, p), level: p.level };
  const options = sc.opts.map((op, i) => {
    const pr = calcProb(op, ctx, userState);
    return { idx: i, label: fill(op.label, v), risk: op.risk, prevS: fill(op.prevS, v), prevF: fill(op.prevF, v), ...pr };
  });
  const safest = options.slice().sort((a, b) => (riskRank(a.risk) - riskRank(b.risk)) || (b.p - a.p))[0].idx;
  return {
    id: sc.id, t: g.t, loc, region: geo.regionOf(...loc), title: fill(sc.title, v), desc: fill(N.desc || sc.desc, v),
    splash: splashRef.champ, involved: involved.map(p => p.pid), cards, options, safest, vars: v,
  };
}
const riskRank = r => ({ low: 0, mid: 1, high: 2 }[r]);

export function rollOutcome(rng, p, risk) {
  const S = CONFIG.scene;
  const r = rng.next() * 100;
  let tier;
  if (r < p) tier = r < p * S.critShare[risk] ? 'crit' : 'succ';
  else tier = r > 100 - (100 - p) * S.fumbleShare[risk] ? 'fumble' : 'fail';
  return { tier, roll: Math.round(r * 10) / 10 };
}

export function resolveScene(g, scene, optIdx, userState) {
  const sc = SCENARIOS.find(s => s.id === scene.id);
  const op = sc.opts[optIdx];
  const opt = scene.options[optIdx];
  const { tier, roll } = rollOutcome(g.rng, opt.p, op.risk);
  const eff = op.eff[tier] || {};
  const ctx = buildContext(g);
  const before = g.feed.length;
  applyEffects(g, ctx, eff, scene);
  const S = CONFIG.scene;
  const delta = (S.ratingDelta[tier === 'succ' ? 'success' : tier]) * S.riskMult[op.risk];
  g.choiceScore += delta;
  const text = fill(op.text[tier], scene.vars);
  const newEvents = g.feed.slice(before);
  const kills = newEvents.filter(e => e.type === 'kill');
  const rec = { id: scene.id, t: g.t, opt: optIdx, tier, p: opt.p, roll, risk: op.risk, delta, text, label: opt.label };
  g.sceneLog.push(rec);
  return { ...rec, kills, events: newEvents, win: g.over && g.winner === g.userSide };
}

// 아군 마무리: 근처 아군 중 포지션 킬 성향으로 (서포터가 킬을 다 가져가지 않도록)
const KILL_W = { TOP: 1.0, JGL: 0.9, MID: 1.25, ADC: 1.4, SUP: 0.35 };
function finisher(g, al) { return g.rng.weighted(al.map(p => [p, KILL_W[p.pos]])); }

// 효과는 장면 위치 근처의 실제 선수에게만 적용한다
function targetPlayer(ctx, spec, pool) {
  if (!pool.length) return null;
  let t = null;
  if (spec === 'opp') t = ctx.opp;
  else if (spec === 'ejg') t = ctx.ejg;
  else if (spec === 'bounty') t = ctx.bountyTarget;
  else if (spec && spec.length === 4 && spec[0] === 'e') {
    const pos = { etop: 'TOP', emid: 'MID', eadc: 'ADC', esup: 'SUP' }[spec];
    if (pos) t = byPos(ctx.E, pos);
  }
  if (t && pool.includes(t)) return t;
  return pool[0];
}

export function applyEffects(g, ctx, eff, scene = null) {
  const me = ctx.me, S = ctx.S, E = ctx.E;
  const myIdx = me.side;
  const loc = scene && scene.loc ? scene.loc : [me.x, me.y];
  const R = CONFIG.match.sim.sceneRadius;
  const d = p => Math.hypot(p.x - loc[0], p.y - loc[1]);
  const nearE = () => alive(E).filter(p => d(p) <= R).sort((a, b) => d(a) - d(b));
  const nearA = () => alive(S).filter(p => p !== me && d(p) <= R).sort((a, b) => d(a) - d(b));
  const t = g.t;
  if (eff.flashUsed) me.flashAt = t + 300;
  if (eff.ultUsed) me.ultAt = t + 80;
  let spare = 0;  // 근처에 대상이 없어 처리하지 못한 킬 → 골드로 환산
  for (let i = 0; i < (eff.kill || 0); i++) {
    const v = targetPlayer(ctx, i === 0 ? eff.target : null, nearE());
    if (v && me.alive) killPlayer(g, me, v, nearA(), { reason: 'choice', big: true });
    else spare++;
  }
  for (let i = 0; i < (eff.assist || 0); i++) {
    const v = targetPlayer(ctx, i === 0 && !eff.kill ? eff.target : null, nearE());
    const al = nearA();
    if (v && al.length && me.alive) { const k = finisher(g, al); killPlayer(g, k, v, [me, ...al.filter(q => q !== k)], { reason: 'choice' }); }
    else if (v && me.alive) killPlayer(g, me, v, [], { reason: 'choice' });
    else spare++;
  }
  for (let i = 0; i < (eff.allyKill || 0); i++) {
    const v = targetPlayer(ctx, null, nearE()); const al = nearA();
    if (v && al.length) { const k = finisher(g, al); killPlayer(g, k, v, al.filter(q => q !== k), { reason: 'choice' }); }
  }
  if (eff.death && me.alive) {
    const pool = nearE();
    const k = targetPlayer(ctx, eff.target && eff.target !== 'bounty' ? eff.target : 'opp', pool);
    if (k) killPlayer(g, k, me, pool.filter(p => p !== k), { reason: 'choice', big: true });
    else me.hp = Math.min(me.hp, 0.25);
  }
  for (let i = 0; i < (eff.allyDeath || 0); i++) {
    const al = nearA(); const ek = nearE();
    if (al.length && ek.length) killPlayer(g, ek[0], al[0], ek.slice(1), { reason: 'choice' });
  }
  if (spare) me.gold += spare * 150;
  if (eff.gold) me.gold = Math.max(0, me.gold + eff.gold);
  if (eff.cs) { me.cs = Math.max(0, me.cs + eff.cs); me.gold = Math.max(0, me.gold + eff.cs * 21); }
  if (eff.teamGold) for (const p of S.players) p.gold = Math.max(0, p.gold + eff.teamGold / 5);
  if (eff.lane && LANE_OF[me.pos]) {
    const l = LANE_OF[me.pos];
    g.lane[l] = clamp(g.lane[l] + (myIdx === 0 ? eff.lane : -eff.lane), -30, 30);
  }
  if (eff.boost) me.boost = (me.boost || 0) + eff.boost;
  if (eff.mental) S.mental += eff.mental;
  // 오브젝트: 즉시 획득이 아니라, 그 팀이 둥지로 가서 실제로 처치하도록 계획을 바꾼다
  const objPlan = (A, B, key) => {
    if (g.obj[key] && g.obj[key].alive) {
      A.force = { kind: 'objTake', key, until: t + 70 };
      B.concede[key] = t + 50;
      A.concede[key] = 0;
    } else for (const p of A.players) p.gold += 60;
  };
  if (eff.obj) objPlan(S, E, eff.obj);
  if (eff.enemyObj) objPlan(E, S, eff.enemyObj);
  // 구조물: 가까운 포탑으로 공성 계획 + 공성 보정 (실제 파괴는 엔진이 그 자리에서)
  if (eff.tower) { S.force = { kind: 'siege', near: loc, until: t + 70 }; S.siegeBoost = 1 + 0.5 * eff.tower; S.siegeBoostUntil = t + 70; }
  if (eff.enemyTower) { E.force = { kind: 'siege', near: loc, until: t + 70 }; E.siegeBoost = 1 + 0.5 * eff.enemyTower; E.siegeBoostUntil = t + 70; }
  if (eff.win) { S.force = { kind: 'nexus', until: t + 100 }; S.fightBoost = 6; S.fightBoostUntil = t + 100; S.siegeBoost = 2.5; S.siegeBoostUntil = t + 100; }
  // 장면 결과로 둥지 안 처치 팀이 모두 쓰러졌으면 처치 진행도 끊긴다
  for (const k of Object.keys(g.obj)) {
    const o = g.obj[k];
    if (o.alive && o.prog && !g.sides[o.prog.side].players.some(p => inPit(p, k))) o.prog = null;
  }
}

// 효과의 대략적 가치 (검증 도구용)
export function effectValue(eff) {
  if (!eff) return 0;
  const OBJ = { dragon: 1.0, baron: 2.6, elder: 3.2, herald: 0.8, grubs: 0.6, atakhan: 1.0 };
  let v = 0;
  v += (eff.kill || 0) * 1.0 + (eff.assist || 0) * 0.6 + (eff.allyKill || 0) * 0.6;
  v -= (eff.death ? 1.1 : 0) + (eff.allyDeath || 0) * 0.7;
  v += (eff.gold || 0) / 300 * 0.35 + (eff.teamGold || 0) / 300 * 0.3 + (eff.cs || 0) * 0.025;
  v += (eff.lane || 0) * 0.06 + (eff.boost || 0) * 0.3 + (eff.mental || 0) * 0.05;
  v += eff.obj ? OBJ[eff.obj] : 0;
  v -= eff.enemyObj ? OBJ[eff.enemyObj] : 0;
  v += (eff.tower || 0) * 0.8 - (eff.enemyTower || 0) * 0.8;
  v -= (eff.flashUsed ? 0.15 : 0) + (eff.ultUsed ? 0.1 : 0);
  v += eff.win ? 8 : 0;
  return v;
}
