// ============================================================
//  팀 운영 AI: 팀 계획(상태 머신) → 선수별 임무·목표 지점
//  계획: 라인전 / 정글 동선 / 갱킹 / 귀환 / 사이드 운영(1-4, 1-3-1) / 미드 그룹
//        오브젝트 준비·처치·견제 / 공성 / 다이브 / 끊기 / 수비·후퇴 / 넥서스 공성 / 전령 사용
// ============================================================
import { CONFIG } from '../config.js';
import { clamp } from '../core/util.js';
import * as geo from './mapgeo.js';
import {
  SIM, dt, alive, emit, moveLog, distTo, pdist, byPos, trait, sideLead, LANE_OF,
  nextLaneStructure, attackableStructures, baseOpen, nexusAttackable,
} from './matchcore.js';
import { strength } from './combat.js';
import { nextItemCost, summonHerald } from './world.js';

export const TASK_KO = {
  lane: '라인전', camp: '정글 캠프', gank: '갱킹', recall: '귀환', retreat: '후퇴', side: '사이드 운영', group: '미드 그룹',
  objSetup: '시야 장악', objTake: '처치', objContest: '견제', siege: '공성', dive: '다이브', pick: '끊기', defend: '수비',
  nexus: '넥서스 공성', herald: '전령 소환', fight: '교전', dead: '사망', tp: '텔레포트', walk: '이동',
};
export const PLAN_KO = {
  laning: '라인전', midGroup: '미드 그룹 + 사이드', split131: '1-3-1 운영', objSetup: '오브젝트 준비', objTake: '오브젝트 처치',
  objContest: '오브젝트 견제', siege: '포탑 공성', nexus: '넥서스 공성', defend: '수비', pick: '끊기', herald: '전령 사용', trade: '반대편 교환',
};
const OBJ_KO = { dragon: '드래곤', baron: '바론', herald: '전령', grubs: '유충', elder: '장로', atakhan: '아타칸' };
const OBJ_VALUE = { elder: 10, baron: 8, dragon: 5, herald: 4, grubs: 3.5, atakhan: 5 };

// ---------------------------------------------------------------
export function think(g) {
  for (const s of g.sides) updatePlan(g, s);
  for (const s of g.sides) {
    const sideLaners = chooseSideLaners(g, s);
    s.sideLaners = sideLaners;
    for (const p of s.players) assign(g, s, p);
  }
}

// ---------------- 팀 계획 ----------------
function available(g, s) { return s.players.filter(p => p.alive && !(p.task && p.task.kind === 'recall' && p.chan)); }
function phase(g) { return g.t < CONFIG.match.laningEnd ? 'early' : g.t < CONFIG.match.midEnd ? 'mid' : 'late'; }

function ratioNear(g, s, pt, radius = 0.6, mine = null) {
  const E = g.sides[1 - s.idx];
  const my = mine || available(g, s);
  const en = E.players.filter(p => p.alive && distTo(p, pt) <= radius);
  const n = my.length + en.length;
  if (!en.length) return 9;
  return strength(g, my, n) / Math.max(1e-9, strength(g, en, n));
}

function planValid(g, s, plan) {
  const E = g.sides[1 - s.idx];
  if (['objSetup', 'objTake', 'objContest'].includes(plan.kind)) {
    const o = g.obj[plan.key];
    if (plan.kind === 'objSetup') return !!o && (o.alive || (o.next !== null && o.next - g.t <= SIM().setupLead + 10));
    if (!o || !o.alive) return false;
    if (plan.kind === 'objContest') return !!o.prog && o.prog.side !== s.idx;
    return true;
  }
  if (plan.kind === 'siege') return !!structureStill(g, s.idx, plan.target);
  if (plan.kind === 'nexus') return g.sides[1 - s.idx].nexus;
  if (plan.kind === 'defend') return E.players.some(p => p.alive && distTo(p, plan.target.pos) < 0.18);
  if (plan.kind === 'pick') { const v = g.byId[plan.targetPid]; return v && v.alive; }
  if (plan.kind === 'herald') return !!s.heraldEye && !!nextLaneStructure(g, s.idx, plan.lane);
  return true;
}
function structureStill(g, attIdx, t) {
  if (!t) return null;
  return attackableStructures(g, attIdx).find(x => x.kind === t.kind && x.lane === t.lane && x.idx === t.idx) || null;
}

// 공성하던 구조물이 깨지면, 그 자리에 공성 팀이 남아 있고 근처 전력이 밀리지 않으면
// 같은 라인 다음 구조물(→ 억제기 → 넥서스 포탑·넥서스)로 이어 간다 (버그 신고 342066142: 억제기 깨고 미드로 빠짐)
function continueSiege(g, s, plan) {
  if (plan.kind !== 'siege' || !plan.target || plan.until <= g.t || plan.trade) return null;
  if (structureStill(g, s.idx, plan.target)) return null;
  const here = plan.target.pos;
  const crew = available(g, s).filter(p => distTo(p, here) < SIM().siegeChainRadius);
  if (crew.length < 3) return null;
  const E = g.sides[1 - s.idx];
  const next = plan.target.lane ? nextLaneStructure(g, s.idx, plan.target.lane) : null;
  const base = attackableStructures(g, s.idx).filter(x => x.kind === 'nexusTower' || x.kind === 'nexus');
  const tg = next || base.sort((a, b) => Math.hypot(a.pos[0] - here[0], a.pos[1] - here[1]) - Math.hypot(b.pos[0] - here[0], b.pos[1] - here[1]))[0];
  if (!tg) return null;
  if (ratioNear(g, s, tg.pos, 0.3, crew) < SIM().siegeChainRatio) return null;
  const left = Math.max(20, plan.until - g.t);
  if (tg.kind === 'nexusTower' || tg.kind === 'nexus') return mk(g, 'nexus', Math.max(plan.pri, 7), { dur: Math.max(left, 40) });
  return mk(g, 'siege', plan.pri, { target: tg, lane: tg.lane, dur: Math.max(left, 35) });
}

function updatePlan(g, s) {
  const t = g.t;
  if (s.plan && (s.plan.until <= t || !planValid(g, s, s.plan))) {
    if (s.plan.kind === 'objSetup' && g.obj[s.plan.key] && g.obj[s.plan.key].alive) s.plan = { ...s.plan, kind: 'objTake', since: t, until: t + 90, pri: s.plan.pri + 0.5 };
    else s.plan = continueSiege(g, s, s.plan);
  }
  const cand = choosePlan(g, s);
  if (!s.plan || cand.pri > s.plan.pri + 0.6) s.plan = cand;
  else if (cand.kind === s.plan.kind && cand.key === s.plan.key && cand.lane === s.plan.lane) { s.plan.until = Math.max(s.plan.until, cand.until); s.plan.pri = cand.pri; s.plan.parts = cand.parts; }
  s.planLabel = planLabel(s.plan);
  s.planTime[s.plan.kind] = (s.planTime[s.plan.kind] || 0) + dt();
}
export function planLabel(plan) {
  if (!plan) return '';
  if (plan.key) return `${OBJ_KO[plan.key]} ${plan.kind === 'objSetup' ? '준비' : plan.kind === 'objTake' ? '처치' : '견제'}`;
  if (plan.kind === 'siege' && plan.target) return `${plan.target.lane ? geo.regionKo(geo.LANE_REGION[plan.target.lane]).replace(' 라인', '') + ' ' : ''}공성`;
  return PLAN_KO[plan.kind] || plan.kind;
}

function mk(g, kind, pri, extra = {}) { return { kind, pri, since: g.t, until: g.t + (extra.dur || 60), ...extra }; }

function choosePlan(g, s) {
  const t = g.t, E = g.sides[1 - s.idx];
  const my = available(g, s), en = alive(E);
  const ph = phase(g);
  const lead = sideLead(g, s.idx);
  const buffed = s.baronUntil > t || s.elderUntil > t;
  const cands = [];

  // 장면 효과로 정해진 계획
  if (s.force && s.force.until > t) {
    const f = s.force;
    if (f.kind === 'objTake' && g.obj[f.key] && g.obj[f.key].alive) cands.push(mk(g, 'objTake', 9.5, { key: f.key, dur: f.until - t }));
    if (f.kind === 'siege') { const tg = nearestStructure(g, s, f.near); if (tg) cands.push(mk(g, 'siege', 9.5, { target: tg, lane: tg.lane, dur: f.until - t })); }
    if (f.kind === 'nexus') cands.push(mk(g, 'nexus', 9.6, { dur: f.until - t }));
  }

  // 1) 넥서스 공성
  if (baseOpen(E) && my.length >= 3) {
    const advN = my.length - en.length;
    const lateOk = t >= CONFIG.match.midEnd || buffed;
    if (advN >= 3 || en.length <= 1 || (lateOk && (advN >= 2 || (buffed && advN >= 0) || (nexusAttackable(g, s.idx) && advN >= 1)))) cands.push(mk(g, 'nexus', 9, { dur: 50 }));
  }
  // 2) 기지 수비
  const baseThreat = E.players.filter(p => p.alive && geo.inBase(s.idx, p.x, p.y)).length;
  if (baseThreat >= 2 && my.length >= 1) cands.push(mk(g, 'defend', 8.8, { target: { pos: geo.nexusPos(s.idx) }, dur: 25 }));
  // 3) 상대 오브젝트 처치 중 → 견제 또는 반대편 교환
  for (const k of ['elder', 'baron', 'dragon', 'herald', 'grubs', 'atakhan']) {
    const o = g.obj[k];
    if (!o.alive || !o.prog || o.prog.side === s.idx) continue;
    if (s.concede && s.concede[k] > t) continue;
    const pit = geo.OBJ_POS[k];
    const helpers = ph === 'early' && k !== 'elder' && k !== 'baron' ? objCrew(g, s, k) : my;
    const r = ratioNear(g, s, pit, 0.35, helpers);
    const need = k === 'elder' ? 0.55 : k === 'baron' ? 0.7 : ph === 'early' ? 1.05 : 0.9;
    const reach = helpers.filter(p => distTo(p, pit) < 0.45).length;
    // 견제 여부는 상대가 처치를 시작할 때 한 번만 정한다 (매 틱 다시 굴리지 않음)
    const memo = s.contestMemo[k];
    if (!memo || memo.start !== o.prog.start) s.contestMemo[k] = { start: o.prog.start, yes: g.rng.chance(clamp((r - need + 0.25) / 0.6, 0.04, 0.9)) };
    if (s.contestMemo[k].yes && reach >= Math.min(2, helpers.length)) cands.push(mk(g, 'objContest', 8 + OBJ_VALUE[k] / 10, { key: k, parts: helpers.map(p => p.pid), dur: 40 }));
    else if (ph !== 'early') { const tg = farStructure(g, s, pit); if (tg) cands.push(mk(g, 'siege', 6.5, { target: tg, lane: tg.lane, dur: 45, trade: true })); }
  }
  // 4) 오브젝트 준비·처치
  for (const k of ['elder', 'baron', 'dragon', 'herald', 'grubs', 'atakhan']) {
    const o = g.obj[k];
    if (o.done) continue;
    const soon = o.alive || (o.next !== null && o.next - t <= SIM().setupLead && o.next - t > 0);
    if (!soon) continue;
    if (s.concede && s.concede[k] > t) continue;
    if (o.prog && o.prog.side !== s.idx) continue;
    // 상대가 이미 처치하러 들어가는 중이면 견제 여부를 한 번만 정한다
    const ep = E.plan;
    if (o.alive && ep && ep.kind === 'objTake' && ep.key === k && !(s.plan && s.plan.kind === 'objTake' && s.plan.key === k)) {
      const m = s.contestMemo['in-' + k];
      if (!m || m.since !== ep.since) s.contestMemo['in-' + k] = { since: ep.since, yes: g.rng.chance(clamp((ratioNear(g, s, geo.OBJ_POS[k], 0.4) - 0.9 + 0.25) / 0.6, 0.04, 0.85)) };
      if (!s.contestMemo['in-' + k].yes) continue;
    }
    const crew = (ph === 'early' && k !== 'baron' && k !== 'elder') ? objCrew(g, s, k) : my.filter(p => !(s.sideLaners || []).includes(p.pid) || k === 'baron' || k === 'elder');
    if (crew.length < (k === 'grubs' || k === 'dragon' ? 2 : 3)) continue;
    const pit = geo.OBJ_POS[k];
    const r = ratioNear(g, s, pit, 0.4, crew);
    let want = OBJ_VALUE[k] / 10;
    if (k === 'dragon' && (s.dragons.length >= 3 || E.dragons.length >= 3)) want += 0.3;
    if (k === 'baron' && t < 1380) want -= 0.2;
    if (s.idx === 0 ? g.lane.BOT > 6 : g.lane.BOT < -6) want += k === 'dragon' ? 0.15 : 0;
    const enemyAtPit = E.players.filter(p => p.alive && distTo(p, pit) < 0.13).length;
    // 대치: 오래 버티면 한쪽이 먼저 들어간다
    const hold = s.plan && s.plan.kind === 'objSetup' && s.plan.key === k ? t - s.plan.since : 0;
    const commit = r >= 1.15 || enemyAtPit === 0 && r >= 0.8 || (hold > 20 && hold > (s.holdPatience || 45) && r >= 0.85);
    if (r < 0.7 && enemyAtPit >= 2) continue;
    const pri = 6 + want + (o.alive ? 0.3 : 0);
    if (!o.alive) cands.push(mk(g, 'objSetup', pri, { key: k, parts: crew.map(p => p.pid), dur: 75 }));
    else if (commit) cands.push(mk(g, 'objTake', pri + 0.4, { key: k, parts: crew.map(p => p.pid), dur: 80 }));
    else cands.push(mk(g, 'objSetup', pri, { key: k, parts: crew.map(p => p.pid), dur: 40 }));
  }
  // 5) 전령 사용
  if (s.heraldEye && s.heraldEye.until > t && ph !== 'early') {
    const lane = ['MID', 'TOP', 'BOT'].find(l => { const tg = nextLaneStructure(g, s.idx, l); return tg && tg.kind === 'tower'; });
    if (lane) cands.push(mk(g, 'herald', 6.6, { lane, dur: 70 }));
  }
  // 6) 공성: 버프 / 교전 승리 직후 / 인원 우세 / 후반 웨이브
  if (ph !== 'early' || (s.lastWin && t - s.lastWin.t <= 15 && s.lastWin.kills >= 2)) {
    const advN = my.length - en.length;
    let why = 0;
    if (buffed) why = 7.4;
    else if (s.lastWin && t - s.lastWin.t <= 20 && s.lastWin.kills >= 2) why = 7.1;
    else if (advN >= 2) why = 6.9;
    else if (ph === 'late' && lead > 3000 && g.rng.chance(0.08)) why = 5.5;
    else if (ph !== 'early' && g.rng.chance(ph === 'late' ? 0.05 : 0.025)) why = 4.5;
    if (why && my.length >= 3) {
      const ref = s.lastWin && t - s.lastWin.t <= 20 ? s.lastWin.pos : centroid(my);
      const tg = nearestStructure(g, s, ref);
      if (tg) cands.push(mk(g, 'siege', why, { target: tg, lane: tg.lane, dur: buffed ? 70 : 50 }));
    }
  }
  // 7) 구조물 수비
  for (const tg of attackableStructures(g, 1 - s.idx)) {
    const threat = E.players.filter(p => p.alive && distTo(p, tg.pos) < 0.12);
    const need = ph === 'early' ? 3 : 2;
    if (threat.length >= need || (threat.length && (tg.kind === 'inhib' || tg.kind === 'nexusTower'))) {
      const helpers = my.filter(p => distTo(p, tg.pos) < 0.5);
      const r = ratioNear(g, s, tg.pos, 0.2, helpers);
      if (helpers.length && (r >= 0.7 || tg.kind !== 'tower')) cands.push(mk(g, 'defend', 6 + (tg.kind === 'tower' ? tg.idx * 0.3 : 1.2), { target: tg, lane: tg.lane, dur: 25, parts: helpers.map(p => p.pid) }));
    }
  }
  // 8) 끊기: 고립된 적
  if (ph !== 'early') {
    for (const v of en) {
      if (E.players.some(q => q !== v && q.alive && pdist(q, v) < 0.25)) continue;
      const hunters = my.filter(p => pdist(p, v) < 0.35 && !(s.sideLaners || []).includes(p.pid));
      if (hunters.length >= 2 && !geo.inBase(E.idx, v.x, v.y)) { cands.push(mk(g, 'pick', 5.2, { targetPid: v.pid, parts: hunters.slice(0, 3).map(p => p.pid), dur: 20 })); break; }
    }
  }
  // 9) 기본
  if (ph === 'early') cands.push(mk(g, 'laning', 1, { dur: 9999 }));
  else cands.push(mk(g, s.comp.split >= 7 && ph === 'late' ? 'split131' : 'midGroup', 1, { dur: 9999 }));
  cands.sort((a, b) => b.pri - a.pri);
  return cands[0];
}

// 초반 오브젝트 담당: 드래곤 = 정글·바텀 듀오(+미드), 유충·전령 = 정글·미드(+탑)
function objCrew(g, s, k) {
  const pos = k === 'dragon' || k === 'elder' ? ['JGL', 'ADC', 'SUP', 'MID'] : ['JGL', 'MID', 'TOP'];
  return pos.map(p => byPos(s, p)).filter(p => p.alive && !(p.chan && p.chan.kind === 'recall'));
}
function centroid(ps) { return [ps.reduce((a, p) => a + p.x, 0) / ps.length, ps.reduce((a, p) => a + p.y, 0) / ps.length]; }
function nearestStructure(g, s, ref) {
  const list = attackableStructures(g, s.idx).filter(t => t.kind !== 'nexus');
  if (!list.length) return null;
  return list.sort((a, b) => Math.hypot(a.pos[0] - ref[0], a.pos[1] - ref[1]) - Math.hypot(b.pos[0] - ref[0], b.pos[1] - ref[1]))[0];
}
function farStructure(g, s, ref) {
  const list = attackableStructures(g, s.idx).filter(t => t.kind === 'tower' || t.kind === 'inhib');
  if (!list.length) return null;
  return list.sort((a, b) => Math.hypot(b.pos[0] - ref[0], b.pos[1] - ref[1]) - Math.hypot(a.pos[0] - ref[0], a.pos[1] - ref[1]))[0];
}

// 사이드 라이너: 14분 이후 1~2명
function chooseSideLaners(g, s) {
  if (phase(g) === 'early') return [];
  const plan = s.plan;
  if (plan && plan.pri >= 7) return [];
  const top = byPos(s, 'TOP');
  // 공성·넥서스 공성 중 그 자리에 와 있는 탑 선수는 사이드로 빼지 않는다 (공성 도중 혼자 빠지는 문제)
  if (plan && (plan.kind === 'siege' || plan.kind === 'nexus') && !plan.trade) {
    const at = plan.target ? plan.target.pos : geo.nexusPos(1 - s.idx);
    if (top.alive && distTo(top, at) < SIM().siegeChainRadius * 1.5) return [];
  }
  const out = [];
  const lanes = sideLanesFor(g, s);
  if (top.alive) out.push(top.pid);
  if (plan && plan.kind === 'split131') {
    const cand = ['MID', 'ADC', 'JGL'].map(p => byPos(s, p)).filter(p => p.alive).sort((a, b) => trait(b, 'split') - trait(a, 'split'))[0];
    if (cand) out.push(cand.pid);
  }
  s.sideLaneOf = {};
  out.forEach((pid, i) => { s.sideLaneOf[pid] = lanes[i % lanes.length]; });
  return out;
}
function sideLanesFor(g, s) {
  // 상대 구조물이 더 많이 남은 사이드부터
  const E = g.sides[1 - s.idx];
  const left = l => E.towers[l].filter(h => h > 0).length + (E.inhibs[l].alive ? 1 : 0);
  return ['TOP', 'BOT'].sort((a, b) => left(b) - left(a) || (a === 'TOP' ? -1 : 1));
}

// ---------------- 선수 임무 ----------------
function setTask(p, kind, target, extra = {}) { p.task = { kind, target: target ? [geo.clamp01(target[0]), geo.clamp01(target[1])] : [p.x, p.y], label: TASK_KO[kind], ...extra }; }
const own = (side, d) => (side === 0 ? -d : d);   // 라인 s 방향 아군 쪽 오프셋

function assign(g, s, p) {
  const t = g.t, S = SIM();
  if (!p.alive) { p.task = { kind: 'dead', target: [p.x, p.y], label: TASK_KO.dead }; return; }
  if (p.chan) return; // 채널링 중에는 제자리
  if (p.fightId) { const f = g.fights.find(x => x.id === p.fightId); if (f) { setTask(p, 'fight', jit(f.center, p, 0.012)); return; } p.fightId = null; }
  if (p.flee) {
    if (t >= p.fleeUntil) p.flee = false;
    else { setTask(p, 'retreat', retreatPoint(g, p)); return; }
  }
  // 귀환
  if (needRecall(g, s, p)) { doRecall(g, p); return; }
  if (p.avoidUntil > t && !(s.plan && s.plan.pri >= 8)) { setTask(p, 'retreat', retreatPoint(g, p)); return; }

  const plan = s.plan;
  const inPlan = plan && (!plan.parts || plan.parts.includes(p.pid)) && !(s.sideLaners || []).includes(p.pid);
  const idx = s.players.indexOf(p);
  if (plan && inPlan && plan.kind !== 'laning' && plan.kind !== 'midGroup' && plan.kind !== 'split131') {
    switch (plan.kind) {
      case 'objSetup': return goTask(g, p, 'objSetup', geo.setupPoint(s.idx, plan.key, idx), { key: plan.key });
      case 'objTake': return goTask(g, p, 'objTake', geo.pitPoint(plan.key, idx), { key: plan.key });
      case 'objContest': return goTask(g, p, 'objContest', geo.pitPoint(plan.key, idx + 2), { key: plan.key });
      case 'siege': return siegeTask(g, s, p, plan.target, idx);
      case 'nexus': {
        const list = attackableStructures(g, s.idx);
        const tg = list.find(x => x.kind === 'nexus') || list.find(x => x.kind === 'nexusTower') || nearestStructure(g, s, [p.x, p.y]);
        if (tg) return goTask(g, p, 'nexus', approach(tg.pos, s.idx, 0.02, idx), { struct: tg });
        break;
      }
      case 'defend': return goTask(g, p, 'defend', approach(plan.target.pos, 1 - s.idx, -0.03, idx));
      case 'pick': { const v = g.byId[plan.targetPid]; if (v && v.alive) return goTask(g, p, 'pick', [v.x, v.y], { targetPid: v.pid }); break; }
      case 'herald': {
        const tg = nextLaneStructure(g, s.idx, plan.lane);
        if (!tg) break;
        const spot = geo.pointOnLane(plan.lane, tg.s + own(s.idx, 0.07));
        const holder = byPos(s, 'JGL').alive ? byPos(s, 'JGL') : alive(s)[0];
        if (p === holder && distTo(p, spot) < 0.03 && s.heraldEye) { summonHerald(g, p, plan.lane); s.plan = mk(g, 'siege', 6.8, { target: tg, lane: plan.lane, dur: 50 }); setTask(p, 'herald', [p.x, p.y], { lane: plan.lane }); return; }
        return goTask(g, p, 'herald', jit(spot, p, 0.015), { lane: plan.lane });
      }
    }
  }
  // 기본 역할
  if (phase(g) === 'early') return laningRole(g, s, p, idx);
  if ((s.sideLaners || []).includes(p.pid)) return sideRole(g, s, p, s.sideLaneOf[p.pid] || 'TOP');
  if (p.pos === 'JGL' && !(plan && plan.pri >= 5) && junglerFarms(g, s)) return jungleRoute(g, s, p);
  return groupRole(g, s, p, idx);
}

function jit(pt, p, a) { const k = (p.side * 0.5 + POS_I[p.pos] * 0.2) % 1; return [pt[0] + Math.cos(k * 6.28) * a, pt[1] + Math.sin(k * 6.28) * a]; }
const POS_I = { TOP: 0, JGL: 1, MID: 2, ADC: 3, SUP: 4 };
function approach(pos, attSide, d, i = 0) {
  // 구조물 앞 (공격 팀 기지 쪽으로 d만큼)
  const n = geo.nexusPos(attSide);
  const dx = n[0] - pos[0], dy = n[1] - pos[1], L = Math.hypot(dx, dy) || 1;
  const sp = ((i % 5) - 2) * 0.012;
  return [pos[0] + dx / L * d - dy / L * sp, pos[1] + dy / L * d + dx / L * sp];
}

function goTask(g, p, kind, target, extra = {}) {
  setTask(p, kind, target, extra);
  maybeTeleport(g, p);
}

function siegeTask(g, s, p, tg, idx) {
  if (!tg) return groupRole(g, s, p, idx);
  if (tg.kind === 'tower' || tg.kind === 'inhib') {
    const w = g.waves[tg.lane];
    const waveThere = s.idx === 0 ? w.atRed : w.atBlue;
    const buffed = s.baronUntil > g.t || s.elderUntil > g.t;
    if (waveThere || tg.kind === 'inhib' || buffed) return goTask(g, p, 'siege', approach(tg.pos, s.idx, 0.025, idx), { struct: tg });
    // 웨이브와 함께 전진
    const front = geo.pointOnLane(tg.lane, w.s + own(s.idx, 0.012));
    return goTask(g, p, 'siege', jit(front, p, 0.015), { struct: tg });
  }
  return goTask(g, p, 'siege', approach(tg.pos, s.idx, 0.02, idx), { struct: tg });
}

function laneFront(g, s, lane, back = 0.025) {
  const w = g.waves[lane];
  return geo.pointOnLane(lane, w.s + own(s.idx, back));
}

function laningRole(g, s, p, idx) {
  if (p.pos === 'JGL') return jungleRoute(g, s, p);
  const lane = LANE_OF[p.pos];
  // 상대 정글이 근처면 체력이 낮을 때 물러난다
  const ej = byPos(g.sides[1 - s.idx], 'JGL');
  const back = ej.alive && pdist(ej, p) < 0.15 && p.hp < 0.6 ? 0.07 : p.pos === 'SUP' ? 0.032 : 0.025;
  let target = laneFront(g, s, lane, back);
  if (g.t < 80) target = geo.pointOnLane(lane, 0.5 + own(s.idx, 0.12));
  setTask(p, 'lane', jit(target, p, 0.008), { lane });
  maybeTeleport(g, p);
}

function sideRole(g, s, p, lane) {
  const E = g.sides[1 - s.idx];
  const threats = E.players.filter(q => q.alive && pdist(q, p) < 0.16).length;
  const allies = s.players.filter(q => q.alive && q !== p && pdist(q, p) < 0.2).length;
  if (threats >= 2 && threats > allies + 1) { setTask(p, 'retreat', retreatPoint(g, p)); return; }
  const tg = nextLaneStructure(g, s.idx, lane);
  const w = g.waves[lane];
  const atStruct = tg && (s.idx === 0 ? w.atRed : w.atBlue);
  const target = atStruct ? approach(tg.pos, s.idx, 0.025, 0) : laneFront(g, s, lane, 0.012);
  setTask(p, 'side', target, { lane });
  maybeTeleport(g, p);
}

function groupRole(g, s, p, idx) {
  // 미드 웨이브 근처에서 그룹 (오브젝트가 곧 나오면 그쪽 강가 근처)
  const lane = 'MID';
  const tg = nextLaneStructure(g, s.idx, lane);
  const w = g.waves[lane];
  let target;
  if (tg && (s.idx === 0 ? w.atRed : w.atBlue) && alive(s).length >= alive(g.sides[1 - s.idx]).length) target = approach(tg.pos, s.idx, 0.03, idx);
  else target = geo.pointOnLane(lane, w.s + own(s.idx, 0.06 + (idx % 3) * 0.015));
  setTask(p, 'group', jit(target, p, 0.014), { lane });
  maybeTeleport(g, p);
}

function junglerFarms(g, s) {
  if (g.t % 150 < 75) return false;
  return !['baron', 'dragon', 'elder', 'herald'].some(k => g.obj[k].alive || (g.obj[k].next !== null && g.obj[k].next - g.t < 70));
}

// 정글 동선: 아군 캠프 순서대로, 도착 후 정리 시간, 그 뒤 갱킹 판단
const ROUTES = [['red', 'krugs', 'raptors', 'wolves', 'blue', 'gromp'], ['blue', 'gromp', 'wolves', 'raptors', 'red', 'krugs']];
function jungleRoute(g, s, p) {
  const S = SIM(), t = g.t;
  const J = p.jg || (p.jg = { route: ROUTES[g.rng.int(0, 1)], i: 0, clearUntil: 0, campAt: {}, gank: null, reached: false });
  // 갱킹 진행 중
  if (J.gank) {
    const v = g.byId[J.gank.targetPid];
    if (!v.alive || t > J.gank.until || v.flee) {
      if (J.gank.reached && v.alive && !J.gank.fought) emit(g, { type: 'gankFail', side: s.idx, pid: p.pid, lane: J.gank.lane, pos: [p.x, p.y], region: geo.regionOf(p.x, p.y), parts: [p.pid, v.pid] });
      J.gank = null;
    } else {
      if (pdist(p, v) < 0.1) J.gank.reached = true;
      if (p.lastFightT && p.lastFightT >= J.gank.start) J.gank.fought = true;
      return goTask(g, p, 'gank', [v.x, v.y], { lane: J.gank.lane, targetPid: v.pid });
    }
  }
  // 캠프 정리 중
  if (J.clearUntil > t) { setTask(p, 'camp', [p.x, p.y], { camp: J.route[J.i % 6] }); return; }
  // 갱킹 판단 (첫 정글 돌기 이후)
  if (t >= 200 && t < CONFIG.match.laningEnd + 300 && (J.lastGank || 0) + 70 <= t) {
    const opp = gankTarget(g, s, p);
    if (opp && g.rng.chance(0.18 * (0.6 + p.st.decision / 150))) {
      J.gank = { targetPid: opp.v.pid, lane: opp.lane, until: t + 35, start: t, reached: false };
      J.lastGank = t;
      return goTask(g, p, 'gank', [opp.v.x, opp.v.y], { lane: opp.lane, targetPid: opp.v.pid });
    }
  }
  // 다음 캠프 (재생성된 캠프만)
  for (let k = 0; k < 6; k++) {
    const id = J.route[J.i % 6];
    if (!J.campAt[id] || t >= J.campAt[id]) break;
    J.i++;
  }
  const id = J.route[J.i % 6];
  const cp = geo.campPos(s.idx, id);
  if (distTo(p, cp) < 0.02) {
    J.clearUntil = t + S.campClearSec;
    J.campAt[id] = t + S.campClearSec + S.campRespawn;
    J.i++;
    setTask(p, 'camp', cp, { camp: id });
    return;
  }
  setTask(p, 'camp', cp, { camp: id });
}
function gankTarget(g, s, p) {
  const E = g.sides[1 - s.idx];
  let best = null, bv = 0;
  for (const lane of ['TOP', 'MID', 'BOT']) {
    const vs = E.players.filter(q => q.alive && LANE_OF[q.pos] === lane && q.task && q.task.kind === 'lane');
    if (!vs.length) continue;
    const v = vs.reduce((a, b) => (a.hp < b.hp ? a : b));
    const d = pdist(p, v);
    if (d > 0.45) continue;
    // 상대가 앞으로 나와 있을수록(웨이브가 우리 쪽) 갱킹 각
    const w = g.waves[lane].s;
    const over = s.idx === 0 ? 0.5 - w : w - 0.5;
    const val = (1.3 - v.hp) + over * 4 + (lane === 'BOT' ? 0.15 : 0) - d;
    if (val > bv) { bv = val; best = { v, lane }; }
  }
  return bv > 0.5 ? best : null;
}

// ---------------- 귀환·후퇴·텔레포트 ----------------
function needRecall(g, s, p) {
  const S = SIM();
  if (p.task && p.task.kind === 'recall') return distTo(p, geo.fountain(p.side)) > 0.05;
  if (distTo(p, geo.fountain(p.side)) < 0.06) return false;
  const important = s.plan && s.plan.pri >= 7.5 && (!s.plan.parts || s.plan.parts.includes(p.pid));
  if (p.hp < S.recallHp && !(important && p.hp > 0.18)) return true;
  if (important) return false;
  const unspent = p.gold - p.spent;
  if (unspent >= nextItemCost(p) + S.recallGoldExtra) {
    if (s.plan && s.plan.pri >= 6 && (!s.plan.parts || s.plan.parts.includes(p.pid))) return false;
    const soon = ['dragon', 'baron', 'elder', 'herald', 'grubs'].some(k => { const o = g.obj[k]; return !o.done && o.next !== null && o.next - g.t > 0 && o.next - g.t < 40; });
    return !soon || g.t < CONFIG.match.laningEnd;
  }
  return false;
}
function doRecall(g, p) {
  const S = SIM();
  const enemyNear = g.sides[1 - p.side].players.some(q => q.alive && pdist(q, p) < 0.12);
  if (!enemyNear) {
    p.chan = { kind: 'recall', until: g.t + S.recallChannel, dest: geo.fountain(p.side) };
    setTask(p, 'recall', [p.x, p.y]);
  } else setTask(p, 'recall', retreatPoint(g, p));
}
export function retreatPoint(g, p) {
  // 가장 가까운 아군 포탑(지금 위치보다 기지에서 멀지 않은 것) 바로 뒤, 없으면 우물.
  // 1차 포탑 앞에서 물러날 때 2차 포탑까지 가지 않게, 바로 옆 포탑도 후보로 본다 (버그 신고 56409656: 1차↔2차 왕복)
  const s = g.sides[p.side];
  const nx = geo.nexusPos(p.side);
  const meBase = Math.hypot(p.x - nx[0], p.y - nx[1]);
  let best = geo.fountain(p.side), bd = Infinity;
  const consider = pt => {
    const toBase = Math.hypot(pt[0] - nx[0], pt[1] - nx[1]);
    if (toBase > meBase + SIM().retreatSlack) return;          // 적진 쪽 포탑은 제외
    const d = distTo(p, pt);
    if (d < bd) { bd = d; best = geo.stepToward(pt[0], pt[1], nx[0], nx[1], SIM().retreatBehind); }
  };
  for (const l of geo.LANES) for (let i = 0; i < 3; i++) if (s.towers[l][i] > 0) consider(geo.towerPos(p.side, l, i));
  return best;
}

function maybeTeleport(g, p) {
  const S = SIM();
  if (p.spells[1] !== 'SummonerTeleport' || g.t < (p.tpAt || 0) || g.t < 240) return;
  const tgt = p.task.target;
  if (distTo(p, tgt) < 0.5) return;
  const s = g.sides[p.side];
  // 목적지: 아군 포탑·와드·아군 미니언(웨이브)
  const dests = [];
  for (const l of geo.LANES) for (let i = 0; i < 3; i++) if (s.towers[l][i] > 0) dests.push({ pt: geo.towerPos(p.side, l, i), via: 'tower' });
  for (const w of s.wards) dests.push({ pt: [w.x, w.y], via: 'ward' });
  for (const l of geo.LANES) dests.push({ pt: geo.pointOnLane(l, g.waves[l].s + own(p.side, 0.01)), via: 'minion' });
  let best = null, bd = 0.12;
  for (const d of dests.filter(d => tpDestValid(g, p, d.pt))) { const dd = Math.hypot(d.pt[0] - tgt[0], d.pt[1] - tgt[1]); if (dd < bd) { bd = dd; best = d; } }
  if (!best) return;
  if (g.sides[1 - p.side].players.some(q => q.alive && pdist(q, p) < 0.1)) return;
  p.chan = { kind: 'tp', until: g.t + S.tpChannel, dest: best.pt.slice(), via: best.via };
  p.tpAt = g.t + S.tpCooldown;
  emit(g, { type: 'tpStart', pid: p.pid, side: p.side, pos: [p.x, p.y], dest: best.pt.slice(), via: best.via, parts: [p.pid] });
}

// 텔레포트 목적지: 아군 포탑·와드·아군 미니언(웨이브) 근처만
export function tpDestValid(g, p, pt) {
  const s = g.sides[p.side];
  const near = (q, r) => Math.hypot(q[0] - pt[0], q[1] - pt[1]) <= r;
  for (const l of geo.LANES) for (let i = 0; i < 3; i++) if (s.towers[l][i] > 0 && near(geo.towerPos(p.side, l, i), 0.02)) return true;
  if (s.wards.some(w => w.until > g.t && near([w.x, w.y], 0.02))) return true;
  for (const l of geo.LANES) if (near(geo.pointOnLane(l, g.waves[l].s), 0.07)) return true;
  return false;
}
// 채널링 완료 처리 (이동 전에 호출)
export function channels(g) {
  for (const p of g.sides[0].players.concat(g.sides[1].players)) {
    if (!p.alive || !p.chan) continue;
    if (g.t >= p.chan.until) {
      const c = p.chan;
      p.chan = null;
      if (c.kind === 'recall') { moveLog(g, p, 'recall', c.dest); p.task = { kind: 'walk', target: [p.x, p.y], label: TASK_KO.walk }; }
      else if (c.kind === 'tp') {
        if (tpDestValid(g, p, c.dest)) moveLog(g, p, 'tp', c.dest, { via: c.via });
        else emit(g, { type: 'tpCancel', pid: p.pid, side: p.side, pos: [p.x, p.y], parts: [p.pid] });
      }
    }
  }
}

// ---------------- 이동 ----------------
export function movement(g) {
  const S = SIM();
  for (const p of g.sides[0].players.concat(g.sides[1].players)) {
    if (!p.alive || p.chan || !p.task) continue;
    const spd = S.moveSpeed * speedMult(g, p) * dt();
    const [x, y] = geo.stepToward(p.x, p.y, p.task.target[0], p.task.target[1], spd);
    p.x = x; p.y = y;
  }
}
export function speedMult(g, p) {
  const S = SIM();
  let m = 1 + (trait(p, 'mobility') - 5) * 0.012 + Math.min(0.05, p.items.length * 0.01);
  if (p.flee) m += 0.03;
  return clamp(m, 0.9, S.maxSpeedMult);
}
