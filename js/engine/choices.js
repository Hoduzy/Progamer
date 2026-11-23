// 선택 장면: 장면 고르기 → 확률 계산 → 판정 → 효과 적용
import { CONFIG } from '../config.js';
import { clamp, fill, POS } from '../core/util.js';
import { CHAMPIONS, champName } from '../../data/champions.js';
import { SCENARIOS } from '../../data/scenarios.js';
import {
  userPlayer, enemyOf, byPos, alive, goldDiff, ultReady, flashReady, killPlayer, takeObjective,
  takeStructure, nextStructure, push, LANE_OF,
} from './match.js';

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

export function buildScene(g, userState) {
  const me = userPlayer(g);
  if (!me || !me.alive) return null;
  const ctx = buildContext(g);
  const used = new Set(g.sceneLog.map(s => s.id));
  let pool = SCENARIOS.filter(sc => eligible(sc, ctx) && !used.has(sc.id));
  if (!pool.length) pool = SCENARIOS.filter(sc => eligible(sc, ctx));
  if (!pool.length) return null;
  // 포지션 장면을 공통보다 조금 더 자주
  const sc = g.rng.weighted(pool.map(s => [s, (s.pos === 'ALL' ? 0.8 : 1.2) * (s.cond ? 1.6 : 1)]));
  const v = vars(ctx);
  const splashRef = { me: me, opp: ctx.opp, ejg: ctx.ejg, emid: byPos(ctx.E, 'MID'), eadc: byPos(ctx.E, 'ADC'), esup: byPos(ctx.E, 'SUP'), etop: byPos(ctx.E, 'TOP') }[sc.splash] || ctx.opp;
  const involved = [me, splashRef === me ? ctx.opp : splashRef].filter(Boolean);
  const options = sc.opts.map((op, i) => {
    const pr = calcProb(op, ctx, userState);
    return { idx: i, label: fill(op.label, v), risk: op.risk, prevS: fill(op.prevS, v), prevF: fill(op.prevF, v), ...pr };
  });
  // 가장 안전한 선택지 (시간 초과 시)
  const safest = options.slice().sort((a, b) => (riskRank(a.risk) - riskRank(b.risk)) || (b.p - a.p))[0].idx;
  return {
    id: sc.id, t: g.t, title: fill(sc.title, v), desc: fill(sc.desc, v),
    splash: splashRef.champ, involved: involved.map(p => p.pid), options, safest, vars: v,
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
  applyEffects(g, ctx, eff);
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

function targetPlayer(ctx, spec) {
  const E = ctx.E;
  let t = null;
  if (spec === 'opp') t = ctx.opp;
  else if (spec === 'ejg') t = ctx.ejg;
  else if (spec === 'bounty') t = ctx.bountyTarget;
  else if (spec && spec.length === 4 && spec[0] === 'e') {
    const pos = { etop: 'TOP', emid: 'MID', eadc: 'ADC', esup: 'SUP' }[spec];
    if (pos) t = byPos(E, pos);
  }
  if (t && t.alive) return t;
  const al = alive(E);
  return al.length ? ctx.g.rng.pick(al) : null;
}

export function applyEffects(g, ctx, eff) {
  const me = ctx.me, S = ctx.S, E = ctx.E;
  const myIdx = me.side;
  const lane = LANE_OF[me.pos] || 'MID';
  const allies = () => alive(S).filter(p => p !== me);
  if (eff.flashUsed) me.flashAt = g.t + 300;
  if (eff.ultUsed) me.ultAt = g.t + 80;
  // 내 킬
  for (let i = 0; i < (eff.kill || 0); i++) {
    const v = targetPlayer(ctx, i === 0 ? eff.target : null);
    if (v && me.alive) killPlayer(g, me, v, allies().slice(0, 2), { reason: 'choice', big: true, lane: g.t < CONFIG.match.laningEnd ? (LANE_OF[me.pos] || null) : null });
  }
  // 어시스트 (아군 킬 + 나 관여)
  for (let i = 0; i < (eff.assist || 0); i++) {
    const v = targetPlayer(ctx, i === 0 && !eff.kill ? eff.target : null);
    const al = allies();
    if (v && al.length) killPlayer(g, g.rng.pick(al), v, [me, ...al.slice(0, 1)], { reason: 'choice' });
  }
  for (let i = 0; i < (eff.allyKill || 0); i++) {
    const v = targetPlayer(ctx, null); const al = allies();
    if (v && al.length) killPlayer(g, g.rng.pick(al), v, al.slice(0, 2), { reason: 'choice' });
  }
  // 내 데스
  if (eff.death && me.alive) {
    const k = targetPlayer(ctx, eff.target && eff.target !== 'bounty' ? eff.target : 'opp');
    killPlayer(g, k, me, alive(E).filter(p => p !== k).slice(0, 2), { reason: 'choice', big: true });
  }
  for (let i = 0; i < (eff.allyDeath || 0); i++) {
    const al = allies(); const ek = alive(E);
    if (al.length) killPlayer(g, ek.length ? g.rng.pick(ek) : null, g.rng.pick(al), ek.slice(0, 2), { reason: 'choice' });
  }
  // 골드
  if (eff.gold) me.gold = Math.max(0, me.gold + eff.gold);
  if (eff.cs) { me.cs = Math.max(0, me.cs + eff.cs); me.gold = Math.max(0, me.gold + eff.cs * 21); }
  if (eff.teamGold) for (const p of S.players) p.gold = Math.max(0, p.gold + eff.teamGold / 5);
  if (eff.lane && LANE_OF[me.pos]) {
    const l = LANE_OF[me.pos];
    g.lane[l] = clamp(g.lane[l] + (myIdx === 0 ? eff.lane : -eff.lane), -30, 30);
  }
  if (eff.boost) me.boost = (me.boost || 0) + eff.boost;
  if (eff.mental) S.mental += eff.mental;
  // 오브젝트
  const objOr = (side, key) => {
    if (g.obj[key] && g.obj[key].alive) takeObjective(g, side, key);
    else for (const p of g.sides[side].players) p.gold += 60; // 대체 이득
  };
  if (eff.obj) objOr(myIdx, eff.obj);
  if (eff.enemyObj) objOr(1 - myIdx, eff.enemyObj);
  // 구조물
  for (let i = 0; i < (eff.tower || 0) && !g.over; i++) {
    const lanes = [lane, 'MID', 'TOP', 'BOT'];
    for (const l of lanes) { const t = nextStructure(g, myIdx, l); if (t && t.kind !== 'nexus') { takeStructure(g, myIdx, t); break; } }
  }
  for (let i = 0; i < (eff.enemyTower || 0) && !g.over; i++) {
    const lanes = ['MID', lane, 'TOP', 'BOT'];
    for (const l of lanes) { const t = nextStructure(g, 1 - myIdx, l); if (t && t.kind !== 'nexus') { takeStructure(g, 1 - myIdx, t); break; } }
  }
  if (eff.win && !g.over) {
    // 남은 구조물 정리 후 넥서스
    const D = E;
    D.nexusTowers = 0;
    for (const l of ['TOP', 'MID', 'BOT']) if (D.inhibs[l].alive) { D.inhibs[l].alive = false; D.inhibs[l].at = g.t + 300; break; }
    takeStructure(g, myIdx, { kind: 'nexus' });
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
