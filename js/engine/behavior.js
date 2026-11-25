// ============================================================
//  이동 4층 구조의 2~4층
//   1) 팀 운영(teamai.js): 팀 계획 → 선수 임무(task: 종류·목표 지점)
//   2) 포지션별 행동(여기): 임무와 포지션으로 "지금 1초 동안 갈 곳"을 정함
//      라인전 움찔·시야 다녀오기, 정글 캠프 머물기·갱킹 우회, 서폿 원딜 따라가기, 그룹 대형, 교전 위치, 둥지 안 원 그리기
//   3) 길찾기(nav.js): 이동 그래프 위 A* → 곡선 경로
//   4) 조향(여기): 경로를 따라 가속·감속(arrive)·같은 팀 밀어내기·회전 속도 제한
//  위치는 게임 1초마다 계산하고(g.secLog), 화면은 그 사이를 보간한다.
// ============================================================
import { CONFIG } from '../config.js';
import * as geo from './mapgeo.js';
import * as nav from './nav.js';
import { CHAMPIONS } from '../../data/champions.js';
import { FRONT } from './matchcore.js';

const M = () => CONFIG.match.sim.move;
const SIM = () => CONFIG.match.sim;
const RANGED = new Set(['adc', 'adcCrit', 'adcLethal', 'adcOnhit', 'mage', 'mageBurst', 'mageControl', 'mageBattle', 'enchanter', 'enchant', 'ezreal', 'smolder', 'gpCrit']);
const DIVE = new Set(['apAssassin', 'lethality', 'skirm']);
const clsOf = p => (CHAMPIONS[p.champ] ? CHAMPIONS[p.champ].cls : 'bruiser');
const len = (x, y) => Math.hypot(x, y);
const norm = (x, y) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
const mvOf = p => p.mv || (p.mv = { vx: 0, vy: 0, path: null, goal: null, replanAt: 0, jitAt: 0, jit: [0, 0], ward: null, wardAt: 0, visionDone: {}, gankVia: null, dir: null });
// 선수마다 고정된 0~1 값 (흩어지는 방향 등)
const seedOf = p => ((p.side * 7 + ['TOP', 'JGL', 'MID', 'ADC', 'SUP'].indexOf(p.pos) * 13) % 10) / 10;

// ---------- 2) 포지션별 행동: 이번 1초의 목표 ----------
// 반환: { pt, agile(빠르게 꺾어도 됨), speed(최고 속도 배율), still(제자리) }
export function goalFor(g, p, t) {
  const mv = mvOf(p), task = p.task;
  if (!task) return { pt: [p.x, p.y], speed: 0.3 };
  if (task.still) return { pt: [p.x, p.y], speed: 0, still: true };
  const base = task.target;
  switch (task.kind) {
    case 'lane': return laneGoal(g, p, t, base);
    case 'camp': return campGoal(g, p, t, base);
    case 'gank': return gankGoal(g, p, t, base);
    case 'fight': return fightGoal(g, p, t);
    case 'retreat': return retreatGoal(g, p, base);
    case 'objTake': {
      // 둥지 안에서 천천히 돌며 치되, 적이 오는 쪽에 앞라인·반대쪽에 원거리
      const pit = geo.OBJ_POS[task.key] || base, cls = clsOf(p);
      const foe = enemyCenter(g, p.side, pit, M().formation.faceR) || geo.nexusPos(1 - p.side);
      const [fx, fy] = norm(foe[0] - pit[0], foe[1] - pit[1]);
      const k = (FRONT[cls] || 0) >= 1.4 ? M().orbitR.roleShift : (RANGED.has(cls) || p.pos === 'ADC' || p.pos === 'SUP') ? -M().orbitR.roleShift : 0;
      return orbit(p, t, [pit[0] + fx * k, pit[1] + fy * k], M().orbitR.pit, 0.35);
    }
    case 'group': case 'siege': case 'defend': case 'nexus': case 'objSetup': case 'objContest': case 'side': {
      const f = formationGoal(g, p, t);
      return f || idle(p, t, base);
    }
    default: return idle(p, t, base);
  }
}

// 도착한 뒤에도 완전히 멈추지 않는다: 목표 주변을 아주 작게
function idle(p, t, base, r = M().wanderR) {
  const mv = mvOf(p);
  if (t >= mv.jitAt) { const a = (t * 0.37 + seedOf(p) * 6.28) % 6.28; mv.jit = [Math.cos(a) * r, Math.sin(a) * r]; mv.jitAt = t + 2 + ((t * 7 + seedOf(p) * 10) % 2); }
  const near = Math.hypot(base[0] - p.x, base[1] - p.y) < 0.02;
  return { pt: [base[0] + mv.jit[0], base[1] + mv.jit[1]], speed: near ? M().jitSpeed : 1 };
}
// 원을 그리며 (캠프 정리·오브젝트 처치)
function orbit(p, t, c, r, w) {
  const a = t * w + seedOf(p) * 6.28;
  return { pt: [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r], speed: 0.45 };
}

// 라인전: 웨이브 바로 뒤에서 막타 치듯 작게 움찔, 가끔 부쉬·강가로 와드, 서폿은 원딜 곁
function laneGoal(g, p, t, base) {
  const mv = mvOf(p), C = M();
  const E = g.sides[1 - p.side];
  const enemyNear = E.players.some(q => q.alive && Math.hypot(q.x - p.x, q.y - p.y) < 0.08);
  // 서폿: 원딜 근처 (원딜보다 살짝 뒤·옆)
  let anchor = base;
  if (p.pos === 'SUP') {
    const adc = g.sides[p.side].players.find(q => q.pos === 'ADC');
    if (adc && adc.alive && adc.task && adc.task.kind === 'lane') {
      // 원딜 위치를 부드럽게 따라감 (원딜의 움찔까지 따라 하지 않게)
      const sm = mv.adcSm && Math.hypot(mv.adcSm[0] - adc.x, mv.adcSm[1] - adc.y) < 0.06 ? [mv.adcSm[0] * (1 - C.supFollow) + adc.x * C.supFollow, mv.adcSm[1] * (1 - C.supFollow) + adc.y * C.supFollow] : [adc.x, adc.y];
      mv.adcSm = sm;
      const nx = geo.nexusPos(p.side), [bx, by] = norm(nx[0] - sm[0], nx[1] - sm[1]);
      anchor = clipToward(nav.snap(sm[0], sm[1], 1), [sm[0] + bx * 0.012 - by * 0.01, sm[1] + by * 0.012 + bx * 0.01]);   // 원딜과 같은 쪽 (바위 너머 X)
    }
    // 시야 타이밍: 오브젝트가 곧 나오면 강·정글 입구로 와드
    for (const k of ['dragon', 'baron', 'grubs', 'herald']) {
      const o = g.obj[k];
      if (!o || o.done || o.alive || o.next === null || mv.visionDone[k + o.next]) continue;
      const left = o.next - t;
      if (left > 0 && left <= C.visionLead && !enemyNear && p.hp > 0.5) {
        const pts = geo.visionPoints(k).slice().sort((a, b) => Math.hypot(a[0] - p.x, a[1] - p.y) - Math.hypot(b[0] - p.x, b[1] - p.y));
        mv.ward = { pt: nav.snap(pts[0][0], pts[0][1]), until: null, key: k + o.next };
        mv.visionDone[k + o.next] = true;
      }
    }
  }
  // 라이너: 가끔 가까운 부쉬·강가로 와드 박으러 짧게
  const inLane = Math.hypot(anchor[0] - p.x, anchor[1] - p.y) < 0.03;
  if (!mv.ward && p.pos !== 'SUP' && inLane && t >= (mv.wardAt || (mv.wardAt = t + C.wardEvery[0] + seedOf(p) * (C.wardEvery[1] - C.wardEvery[0]))) && !enemyNear && p.hp > 0.6) {
    const near = nav.nodes.filter(n => (n[2] === 'bush' || n[2] === 'river') && Math.hypot(n[0] - anchor[0], n[1] - anchor[1]) < C.wardRange);
    if (near.length) { const n = near[Math.floor(seedOf(p) * near.length + t) % near.length]; mv.ward = { pt: [n[0], n[1]], until: null }; }
    mv.wardAt = t + C.wardEvery[0] + ((t * 13) % (C.wardEvery[1] - C.wardEvery[0]));
  }
  if (mv.ward) {
    if (enemyNear && p.hp < 0.5) mv.ward = null;
    else {
      const d = Math.hypot(mv.ward.pt[0] - p.x, mv.ward.pt[1] - p.y);
      if (d < 0.012 && mv.ward.until === null) mv.ward.until = t + C.wardStay;
      if (mv.ward.until !== null && t >= mv.ward.until) mv.ward = null;
      else return { pt: mv.ward.pt, speed: 1 };
    }
  }
  // 막타 움찔: 1~3초마다 작은 무작위 위치
  if (t >= mv.jitAt) {
    const a = ((t * 2.3 + seedOf(p) * 17) % 6.28);
    const r = C.laneJitR * (0.4 + ((t * 0.61) % 0.6));
    mv.jit = [Math.cos(a) * r, Math.sin(a) * r];
    mv.jitAt = t + C.laneJitSec[0] + ((t * 3.7 + seedOf(p) * 5) % (C.laneJitSec[1] - C.laneJitSec[0]));
  }
  // 자리에 와 있으면 움찔은 천천히 (작은 움직임), 멀면 따라붙기
  const far = Math.hypot(anchor[0] - p.x, anchor[1] - p.y) > (p.pos === 'SUP' ? C.supFar : C.laneJitR * 2);
  return { pt: clipToward(nav.snap(anchor[0], anchor[1], 1), [anchor[0] + mv.jit[0], anchor[1] + mv.jit[1]]), speed: far ? 1 : C.jitSpeed };
}

// 정글: 캠프로 가서 정리 시간 동안 캠프 둘레를 돈다
function campGoal(g, p, t, base) {
  const J = p.jg;
  const camp = base;
  if (J && J.clearUntil > t) return orbit(p, t, camp, M().orbitR.camp, 0.9);
  return { pt: camp, speed: 1 };
}

// 갱킹: 바로 가지 않고 대상 근처 부쉬·강을 거쳐 돌아 들어간다
function gankGoal(g, p, t, base) {
  const mv = mvOf(p);
  const d = Math.hypot(base[0] - p.x, base[1] - p.y);
  // 같은 갱 임무 동안: 한 번 덮쳤으면(가까워졌으면) 다시 부쉬로 돌아가지 않는다
  const key = p.task.targetPid ?? p.task.lane;
  if (mv.gankKey !== key || t - (mv.gankSeen ?? -99) > 10) { mv.gankKey = key; mv.gankVia = null; }
  mv.gankSeen = t;
  if (d < M().gankDirect) { mv.gankVia = { pt: base, t, done: true, direct: true }; return { pt: base, speed: 1, agile: true }; }
  if (mv.gankVia && mv.gankVia.direct) return { pt: base, speed: 1, agile: true };
  if (!mv.gankVia || mv.gankVia.t < t - 30) {
    let best = null, bv = Infinity;
    for (const n of nav.nodes) {
      if (n[2] !== 'bush' && n[2] !== 'river') continue;
      const dt = Math.hypot(n[0] - base[0], n[1] - base[1]);
      if (dt > 0.12 || dt < 0.03) continue;
      const v = Math.hypot(n[0] - p.x, n[1] - p.y) + dt * 1.6;
      if (v < bv) { bv = v; best = n; }
    }
    mv.gankVia = best ? { pt: [best[0], best[1]], t, done: false } : { pt: base, t, done: true };
  }
  if (!mv.gankVia.done && Math.hypot(mv.gankVia.pt[0] - p.x, mv.gankVia.pt[1] - p.y) < 0.015) mv.gankVia.done = true;
  return { pt: mv.gankVia.done ? base : mv.gankVia.pt, speed: 1 };
}

// 교전: 앞라인은 파고들고, 원거리는 뒤에서 앞뒤로 카이팅, 암살자는 옆으로 돌아 들어간다
function fightGoal(g, p, t) {
  const f = g.fights.find(x => x.id === p.fightId);
  const c = f ? f.center : [p.x, p.y];
  const mine = [], theirs = [];
  for (const q of g.sides[0].players.concat(g.sides[1].players)) {
    if (!q.alive || !f || q.fightId !== f.id) continue;
    (q.side === p.side ? mine : theirs).push(q);
  }
  const cen = list => (list.length ? [list.reduce((a, q) => a + q.x, 0) / list.length, list.reduce((a, q) => a + q.y, 0) / list.length] : c);
  const me = cen(mine), en = cen(theirs);
  let [dx, dy] = norm(en[0] - me[0], en[1] - me[1]);
  if (!theirs.length) [dx, dy] = norm(c[0] - p.x, c[1] - p.y);
  const cls = clsOf(p), F = M().fight;
  if (DIVE.has(cls)) {
    const sgn = seedOf(p) > 0.5 ? 1 : -1;
    return { pt: [en[0] - dy * F.flank * sgn + dx * F.diveIn, en[1] + dx * F.flank * sgn + dy * F.diveIn], speed: 1, agile: true };
  }
  // 줄: 교전 중심에서 우리 쪽으로 — 앞라인은 중심 바로 앞, 브루저는 그 뒤, 원거리·서폿은 맨 뒤 (상대도 반대쪽에 같은 줄)
  const side = (seedOf(p) - 0.5) * F.spread;
  const at = back => clipToward(nav.snap(c[0], c[1], 1), [c[0] - dx * back - dy * side, c[1] - dy * back + dx * side]);
  if (FRONT[cls] >= 1.4) return { pt: at(F.front), speed: 1, agile: true };
  if (RANGED.has(cls) || p.pos === 'ADC' || p.pos === 'SUP') {
    const kite = (Math.floor(t) % 2 === 0 ? 1 : -1) * F.kite;
    return { pt: at(F.back + kite), speed: 1, agile: true };
  }
  return { pt: at(F.mid), speed: 1, agile: true };
}

// 도망: 기지 쪽으로 가되 서로 흩어지며
function retreatGoal(g, p, base) {
  const [dx, dy] = norm(base[0] - p.x, base[1] - p.y);
  const s = (seedOf(p) - 0.5) * M().scatter;
  return { pt: [base[0] - dy * s, base[1] + dx * s], speed: 1, agile: !!p.flee };
}

// 그룹 대형: 같은 임무로 모인 3명 이상 → 탱커·이니시는 앞, 원딜·서폿은 뒤, 미드·정글은 옆. 이동 방향에 맞춰 회전
function formationGoal(g, p, t) {
  const s = g.sides[p.side], kind = p.task.kind;
  const mates = s.players.filter(q => q.alive && !q.chan && q.task && q.task.kind === kind && q.task.target && Math.hypot(q.task.target[0] - p.task.target[0], q.task.target[1] - p.task.target[1]) < M().formation.joinR);
  if (mates.length < 3) return null;
  const tc = [mates.reduce((a, q) => a + q.task.target[0], 0) / mates.length, mates.reduce((a, q) => a + q.task.target[1], 0) / mates.length];
  const pc = [mates.reduce((a, q) => a + q.x, 0) / mates.length, mates.reduce((a, q) => a + q.y, 0) / mates.length];
  // 방향: 이동 중이면 이동 방향, 도착했으면 상대 넥서스 쪽. 천천히 회전
  const en = geo.nexusPos(1 - p.side);
  const key = 'form' + kind;
  const prev = s[key] && s[key].t >= t - 6 ? s[key] : null;
  const moving = Math.hypot(tc[0] - pc[0], tc[1] - pc[1]) > M().formation.moveR;
  // 이동 중: 이동 방향으로 천천히 회전 / 멈춰 있으면: 이전 방향 유지 (없으면 상대 넥서스 쪽)
  let [dx, dy] = moving ? norm(tc[0] - pc[0], tc[1] - pc[1]) : prev ? prev.d : norm(en[0] - tc[0], en[1] - tc[1]);
  // 가까이 적 무리가 있으면 그쪽을 본다 (앞라인이 적 쪽, 원딜·서폿이 뒤)
  const foe = enemyCenter(g, p.side, pc, M().formation.faceR);
  if (foe) [dx, dy] = norm(foe[0] - pc[0], foe[1] - pc[1]);
  if (prev) [dx, dy] = norm(prev.d[0] * 0.75 + dx * 0.25, prev.d[1] * 0.75 + dy * 0.25);
  // 대형 간격 배율: 이동 중 1, 도착 후 arrived 쪽으로 천천히 (간격이 한 번에 바뀌어 자리가 튀지 않게)
  const scT = moving ? 1 : M().formation.arrived;
  const scPrev = prev && prev.sc != null ? prev.sc : scT;
  const scNow = prev && prev.t === t ? prev.sc : scPrev + (scT - scPrev) * 0.2;
  if (!prev || prev.t !== t) s[key] = { t, d: [dx, dy], sc: scNow };
  // 역할 칸 (앞 f, 오른쪽 r)
  const F = M().formation;
  const cls = clsOf(p);
  const fronts = mates.filter(q => (FRONT[clsOf(q)] || 0) >= 1.4).sort((a, b) => (FRONT[clsOf(b)] || 0) - (FRONT[clsOf(a)] || 0)).slice(0, 2);
  let f, r;
  if (fronts.includes(p)) { f = F.front; r = (fronts.indexOf(p) ? 1 : -1) * F.side * 0.6; }
  else if (p.pos === 'ADC') { f = -F.back; r = 0; }
  else if (p.pos === 'SUP') { f = -F.back * 0.6; r = F.side * 0.8; }
  else if (p.pos === 'MID') { f = 0; r = -F.side; }
  else if (p.pos === 'JGL') { f = F.front * 0.3; r = F.side; }
  else { f = F.front * 0.6; r = -F.side * 0.5; }
  // 이동 중엔 대형을 넓게(보이게), 도착하면(공성·대기) 좁게 모인다
  f *= scNow; r *= scNow;
  const slot = clipToward(nav.snap(tc[0], tc[1], 1), [tc[0] + dx * f - dy * r, tc[1] + dy * f + dx * r]);
  // 공성·넥서스: 대형이 넓어도 구조물 사거리 안(towerRange × siegeIn)에는 서 있는다 (뒷줄이 사거리 밖으로 밀려나 공성이 느려지지 않게)
  const st = p.task.struct && p.task.struct.pos;
  if (st) {
    const R = SIM().towerRange * M().formation.siegeIn, d = Math.hypot(slot[0] - st[0], slot[1] - st[1]);
    if (d > R) { const c = clipToward(nav.snap(st[0], st[1], 1), [st[0] + (slot[0] - st[0]) * R / d, st[1] + (slot[1] - st[1]) * R / d]); slot[0] = c[0]; slot[1] = c[1]; }
  }
  const mv = mvOf(p);
  if (t >= mv.jitAt) { const a = (t * 1.3 + seedOf(p) * 6.28) % 6.28; mv.jit = [Math.cos(a) * M().wanderR, Math.sin(a) * M().wanderR]; mv.jitAt = t + 2.5; }
  const near = Math.hypot(slot[0] - p.x, slot[1] - p.y) < M().formation.moveR;
  return { pt: [slot[0] + mv.jit[0], slot[1] + mv.jit[1]], speed: near ? M().jitSpeed : 1 };
}

// 중심 c에서 pt 쪽으로 직선으로 갈 수 있는 데까지 (자리가 벽 너머면 벽 앞에서 멈춤)
function clipToward(c, pt) {
  const n = 12;
  let last = c;
  for (let k = 1; k <= n; k++) {
    const q = [c[0] + (pt[0] - c[0]) * k / n, c[1] + (pt[1] - c[1]) * k / n];
    if (nav.clearance(q[0], q[1]) < 1) break;
    last = q;
  }
  return last;
}

// 기준점 r 안에 있는 적(살아 있는) 무리 중심 (없으면 null)
function enemyCenter(g, side, at, r) {
  const en = g.sides[1 - side].players.filter(q => q.alive && Math.hypot(q.x - at[0], q.y - at[1]) < r);
  if (en.length < 2) return null;
  return [en.reduce((a, q) => a + q.x, 0) / en.length, en.reduce((a, q) => a + q.y, 0) / en.length];
}

// ---------- 4) 조향: 1초 이동 ----------
// maxSpeed: 1초 최대 이동 거리. 반환 없음 (p.x, p.y, p.mv 갱신)
export function steer(g, p, t, maxSpeed, sep) {
  const mv = mvOf(p), C = M();
  const goal = goalFor(g, p, t);
  if (goal.still) { mv.vx = 0; mv.vy = 0; return; }
  const vmax = maxSpeed * (goal.speed ?? 1);
  // 길찾기: 목표가 바뀌었거나 오래됐으면 다시
  // 가까운 목표가 바위·벽 안이면 내가 있는 쪽 가장자리로 (작은 바위 양쪽을 오가지 않게)
  let [gx, gy] = nav.snap(goal.pt[0], goal.pt[1], 1);
  if (nav.clearance(goal.pt[0], goal.pt[1]) < 1 && Math.hypot(goal.pt[0] - p.x, goal.pt[1] - p.y) < C.nearGoal) {
    const c = clipToward([p.x, p.y], goal.pt);
    if (Math.hypot(c[0] - p.x, c[1] - p.y) > 1e-4) [gx, gy] = c;
  }
  // 가까운 목표가 조금 옮겨져 바로 못 가게 됐는데 원래 목표로는 바로 갈 수 있으면 잠시(holdSec) 원래 목표 유지
  // (바위·벽 모서리를 두고 왼쪽·오른쪽으로 번갈아 돌아가지 않게)
  if (!goal.agile && mv.goal && Math.hypot(gx - p.x, gy - p.y) < C.nearGoal && Math.hypot(gx - mv.goal[0], gy - mv.goal[1]) < C.nearGoal
    && !nav.segWalkable(p.x, p.y, gx, gy, 1) && nav.segWalkable(p.x, p.y, mv.goal[0], mv.goal[1], 1)) {
    if (mv.holdUntil == null) mv.holdUntil = t + C.holdSec;
    if (t < mv.holdUntil) [gx, gy] = mv.goal;
  } else mv.holdUntil = null;
  const moved = mv.goal ? Math.hypot(gx - mv.goal[0], gy - mv.goal[1]) : Infinity;
  const spH = len(mv.vx, mv.vy), heading = spH > 1e-6 ? [mv.vx / spH, mv.vy / spH] : null;
  if (mv.path && mv.path.length && moved > C.repathDist && moved < C.repathFar) {
    // 목표가 조금만 옮겨졌으면 경로는 그대로, 끝점만 새 목표로 (갈림길에서 다른 길로 바뀌지 않게)
    const last = mv.path.length > 1 ? mv.path[mv.path.length - 2] : [p.x, p.y];
    if (nav.segWalkable(last[0], last[1], gx, gy, 1)) { mv.path[mv.path.length - 1] = [gx, gy]; mv.goal = [gx, gy]; }
    // 벽 너머로 살짝 옮겨진 목표: 바로 다른 길로 갈아타지 않고 다시 찾을 때까지 원래 경로 유지
    else if (t >= mv.replanAt) mv.path = null;
  }
  // 귀환·순간이동·부활로 위치가 뛰었으면 예전 경로는 버림
  if (mv.lastPos && Math.hypot(mv.lastPos[0] - p.x, mv.lastPos[1] - p.y) > maxSpeed * 1.5) mv.path = null;
  // 다시 찾기: 경로 없음 / 목표가 많이 바뀜 / 막혀서 제자리
  const stuck = mv.lastPos && Math.hypot(mv.lastPos[0] - p.x, mv.lastPos[1] - p.y) < 1e-4 && mv.path && mv.path.length && Math.hypot(mv.path[mv.path.length - 1][0] - p.x, mv.path[mv.path.length - 1][1] - p.y) > 0.01;
  if (!mv.path || !mv.path.length || moved >= C.repathFar || (stuck && t >= mv.replanAt)) {
    mv.path = nav.findPath(p.x, p.y, gx, gy, heading);
    mv.goal = [gx, gy];
    mv.replanAt = t + C.replanSec;
  }
  mv.lastPos = [p.x, p.y];
  // 경로 위 앞쪽 점 (지나간 점은 버림)
  // 가장 가까운 앞쪽 점까지 건너뜀 (점을 비껴 지나쳐도 그 점에 붙잡히지 않게)
  {
    let k = 0, bd = Infinity;
    for (let i = 0; i < Math.min(mv.path.length, 8); i++) {
      const d = Math.hypot(mv.path[i][0] - p.x, mv.path[i][1] - p.y);
      if (d < bd && nav.segWalkable(p.x, p.y, mv.path[i][0], mv.path[i][1], 1)) { bd = d; k = i; }
    }
    if (k > 0) mv.path.splice(0, k);
  }
  // 가까운 점은 지나간 것으로 (단, 그다음 점이 보일 때만: 모퉁이를 미리 건너뛰지 않게)
  while (mv.path.length > 1) {
    const d0 = Math.hypot(mv.path[0][0] - p.x, mv.path[0][1] - p.y);
    if (d0 < 0.002 || (d0 < Math.max(0.004, vmax * 0.5) && nav.segWalkable(p.x, p.y, mv.path[1][0], mv.path[1][1], 1))) mv.path.shift();
    else break;
  }
  // 다음 점이 안 보이면(벽 모서리에서 밀려남) 지금 가던 방향을 살려 바로 다시 찾음
  if (!nav.segWalkable(p.x, p.y, mv.path[0][0], mv.path[0][1], 1)) {
    mv.path = nav.findPath(p.x, p.y, gx, gy, heading);
    mv.goal = [gx, gy];
    mv.replanAt = t + C.replanSec;
  }
  let carrot = mv.path[0], acc = Math.hypot(carrot[0] - p.x, carrot[1] - p.y), cIdx = 0;
  for (let i = 1; i < mv.path.length && acc < vmax * C.lookahead; i++) {
    if (!nav.segWalkable(p.x, p.y, mv.path[i][0], mv.path[i][1], 1)) break;
    acc += Math.hypot(mv.path[i][0] - mv.path[i - 1][0], mv.path[i][1] - mv.path[i - 1][1]);
    carrot = mv.path[i]; cIdx = i;
  }
  // 앞쪽 점을 향해 곧장 가기로 했으면 그 앞의 점들은 버린다 (다음 초에 뒤 점으로 되돌아가지 않게)
  if (cIdx > 0) mv.path.splice(0, cIdx);
  const end = mv.path[mv.path.length - 1];
  const remain = Math.hypot(end[0] - p.x, end[1] - p.y) + 1e-9;
  // 도착 감속
  let speedT = vmax * Math.min(1, remain / C.arriveR);
  // 그 너머가 안 보이는 모퉁이 점은 지나치지 않는다 (지나치면 되돌아와야 함)
  if (carrot !== end) speedT = Math.min(speedT, Math.hypot(carrot[0] - p.x, carrot[1] - p.y));
  let [dx, dy] = norm(carrot[0] - p.x, carrot[1] - p.y);
  // 가까운 목표가 진행 방향 뒤쪽이면 천천히 (목표가 앞뒤로 바뀔 때 홱홱 꺾지 않게)
  if (!goal.agile && remain < C.backR && len(mv.vx, mv.vy) > 1e-6 && (dx * mv.vx + dy * mv.vy) / len(mv.vx, mv.vy) < -0.3) speedT = Math.min(speedT, maxSpeed * C.jitSpeed);
  mv.sep = mv.sep ? [mv.sep[0] * C.sepSmooth + sep[0] * (1 - C.sepSmooth), mv.sep[1] * C.sepSmooth + sep[1] * (1 - C.sepSmooth)] : sep;
  let wx = dx * speedT + mv.sep[0], wy = dy * speedT + mv.sep[1];
  // 가속 제한
  const ax = wx - mv.vx, ay = wy - mv.vy, al = len(ax, ay), amax = maxSpeed * C.accel;
  if (al > amax) { wx = mv.vx + ax / al * amax; wy = mv.vy + ay / al * amax; }
  // 회전 속도 제한 (교전 카이팅·도주는 예외)
  const sp0 = len(mv.vx, mv.vy), sp1 = len(wx, wy);
  if (!goal.agile && sp0 > maxSpeed * 0.25 && sp1 > 1e-6) {
    const a0 = Math.atan2(mv.vy, mv.vx), a1 = Math.atan2(wy, wx);
    let da = a1 - a0; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
    const lim = C.turnDeg * Math.PI / 180;
    if (Math.abs(da) > lim) { const a = a0 + Math.sign(da) * lim; wx = Math.cos(a) * sp1; wy = Math.sin(a) * sp1; }
  }
  // 속도 상한
  const sp = len(wx, wy);
  if (sp > maxSpeed) { wx = wx / sp * maxSpeed; wy = wy / sp * maxSpeed; }
  // 이동: 벽을 지나면 경로 쪽으로만 (그래도 막히면 제자리)
  let nx = p.x + wx, ny = p.y + wy;
  if (!nav.segWalkable(p.x, p.y, nx, ny, 1)) {
    const l = Math.min(len(wx, wy), Math.hypot(carrot[0] - p.x, carrot[1] - p.y));
    nx = p.x + dx * l; ny = p.y + dy * l;
    if (!nav.segWalkable(p.x, p.y, nx, ny, 1)) { nx = p.x; ny = p.y; mv.path = null; }
    wx = nx - p.x; wy = ny - p.y;
  }
  mv.vx = wx; mv.vy = wy;
  p.x = nx; p.y = ny;
}

// 같은 팀끼리 겹치지 않게 (가까우면 서로 밀어냄)
export function separation(team, p) {
  const C = M();
  let sx = 0, sy = 0;
  for (const q of team) {
    if (q === p || !q.alive) continue;
    const dx = p.x - q.x, dy = p.y - q.y, d = Math.hypot(dx, dy);
    if (d >= C.sepR || d < 1e-6) continue;
    const w = (C.sepR - d) / C.sepR * C.sepW;
    sx += dx / d * w; sy += dy / d * w;
  }
  const l = Math.hypot(sx, sy);
  return l > C.sepW ? [sx / l * C.sepW, sy / l * C.sepW] : [sx, sy];
}
