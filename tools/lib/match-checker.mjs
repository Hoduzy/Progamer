// ============================================================
//  경기 정합성 검사 공용 코드 (tools/validate-match.mjs, tools/replay-bug.mjs)
// ============================================================
import { CONFIG } from '../../js/config.js';
import { RNG } from '../../js/core/rng.js';
import { POS } from '../../js/core/util.js';
import { makePlayer } from '../../js/engine/players.js';
import { createMatch, step, allPlayers, userPlayer, flashReady, ultReady } from '../../js/engine/match.js';
import { newMeta } from '../../js/engine/meta.js';
import { buildScene, resolveScene } from '../../js/engine/choices.js';
import { checkEvent } from '../../js/engine/commentary.js';
import * as geo from '../../js/engine/mapgeo.js';
import * as nav from '../../js/engine/nav.js';
import { champsForPos } from '../../data/champions.js';

export const opts = { VERBOSE: false, SCENES: true, MAXSHOW: 4 };
export const S = CONFIG.match.sim, V = CONFIG.match.validate, dt = CONFIG.match.tickSec;
const TOL = 0.004;
const OBJ_TYPES = ['dragon', 'baron', 'elder', 'herald', 'grubs', 'atakhan'];
const FIGHT_TYPES = ['teamfight', 'skirmish', 'pick', 'gank', 'counterGank', 'soloKill', 'duel', 'trade'];
const STRUCT_TYPES = ['tower', 'inhib', 'nexusTower', 'nexus'];
const LANES = geo.LANES;

export const viol = {};
export let violTotal = 0;
function V_(check, seed, t, msg) {
  violTotal++; stats.violByGame[seed] = (stats.violByGame[seed] || 0) + 1;
  const v = viol[check] || (viol[check] = { n: 0, ex: [] });
  v.n++;
  if (v.ex.length < opts.MAXSHOW) v.ex.push(`seed=${seed} t=${fmt(t)} ${msg}`);
}
const fmt = t => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
const d2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export const stats = {
  moveSec: 0, laneWave: [],
  games: 0, dur: [], kills: [], tf: { '0-1': 0, '2-4': 0, '5-7': 0, ace: 0 }, tfN: 0, labels: {},
  objTime: {}, plan: {}, task: {}, earlyMid: [0, 0], side: [0, 0], scenes: 0, blueWins: 0, timeouts: 0,
  firstTower: [], objCount: {}, violByGame: {}, sceneIds: {}, killBy: {}, killLabel: {}, fr: {},
  kpos: {}, apos: {}, supRank: [0, 0, 0, 0, 0], objScenes: 0, objCombos: {}, recentTitles: [], ks: 0,
  objOut: {}, baronSwing: [], baronGames: 0, baronWins: 0, flips: 0,
};

// ---- 오브젝트 운영 통계: 한타/교환/견제/포기, 바론 후 골드 격차, 진입·후퇴 반복 (11) ----
const TRACK = ['dragon', 'baron', 'elder'];
const goldOf = s => s.players.reduce((a, p) => a + p.gold, 0);
// 1초 기록(g.secLog)으로 이동 검사 + 라인전 라이너와 자기 웨이브 거리
function checkSeconds(g, ps, moved, st, seed) {
  if (!g.secLog) return;
  const V = CONFIG.match.validate.move, vmax = S.moveSpeed * S.maxSpeedMult + 1e-4;
  st.last = st.last || {};
  st.turns = st.turns || {};
  st.turnCd = st.turnCd || {};
  for (const [k, sec] of g.secLog.entries()) {
    ps.forEach((p, i) => {
      const cur = sec.ps[i], prev = st.last[p.pid];
      st.last[p.pid] = cur;
      if (!cur[2]) { st.turns[p.pid] = []; return; }
      if (!nav.walkable(cur[0], cur[1])) V_('12 벽 통과', seed, sec.t, `${p.nick} 벽 안 위치 (${cur[0].toFixed(3)}, ${cur[1].toFixed(3)})`);
      if (!prev || !prev[2] || (k === 0 && moved[p.pid])) return;      // 귀환·텔레포트·부활 순간은 제외
      const d = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
      stats.moveSec++;
      if (d > vmax) V_('13 초당 이동 한도', seed, sec.t, `${p.nick} 1초 ${d.toFixed(4)} 이동 (한도 ${vmax.toFixed(4)})`);
      if (d > 1e-6 && !nav.segWalkable(prev[0], prev[1], cur[0], cur[1], 1)) V_('12 벽 통과', seed, sec.t, `${p.nick} (${prev[0].toFixed(3)},${prev[1].toFixed(3)}) → (${cur[0].toFixed(3)},${cur[1].toFixed(3)}) 벽을 지남`);
      // 방향 전환: 의미 있는 이동만 (최고 속도의 일정 비율 이상), 교전·도주 제외
      const fighting = p.fightId || p.flee || (p.task && (p.task.kind === 'fight' || p.task.kind === 'retreat'));
      const tr = st.turns[p.pid] || (st.turns[p.pid] = []);
      if (fighting || d < S.moveSpeed * V.turnMinFrac) return;
      const h = Math.atan2(cur[1] - prev[1], cur[0] - prev[0]);
      if (tr.length) {
        let da = Math.abs(h - tr[tr.length - 1].h); if (da > Math.PI) da = 2 * Math.PI - da;
        if (da >= V.reverseDeg * Math.PI / 180) tr.push({ t: sec.t, h, rev: true }); else tr.push({ t: sec.t, h, rev: false });
      } else tr.push({ t: sec.t, h, rev: false });
      while (tr.length && tr[0].t <= sec.t - V.turnWindow) tr.shift();
      const revs = tr.filter(x => x.rev).length;
      if (revs >= V.turnMax && sec.t >= (st.turnCd[p.pid] || 0)) {
        V_('14 방향 반복 전환', seed, sec.t, `${p.nick} ${V.turnWindow}초 안에 방향 ${revs}번 뒤집음 (${p.task ? p.task.kind : '-'})`);
        st.turnCd[p.pid] = sec.t + 10;
      }
    });
  }
  // 라인전: 라인에 서 있는 라이너와 자기 웨이브(앞 위치) 거리
  //  (와드 다녀오기 중, 귀환·부활 뒤 라인으로 걸어가는 중 = 자기 라인 자리에서 0.05 넘게 떨어진 때는 빼고)
  if (g.t < CONFIG.match.laningEnd && g.t >= 90) {
    for (const p of ps) {
      if (!p.alive || p.pos === 'JGL' || p.pos === 'SUP' || !p.task || p.task.kind !== 'lane') continue;
      if ((p.mv && p.mv.ward) || Math.hypot(p.task.target[0] - p.x, p.task.target[1] - p.y) > 0.05) continue;
      const l = p.task.lane, w = g.waves[l];
      const fr = geo.pointOnLane(l, w.s);
      stats.laneWave.push(Math.hypot(p.x - fr[0], p.y - fr[1]));
    }
  }
}

function trackStrat(g, evs, st, seed) {
  for (const e of evs) {
    if (e.type === 'spawn' && TRACK.includes(e.obj)) st.inst[e.obj] = { t: g.t, fight: false, contest: false, trade: [false, false] };
    if (FIGHT_TYPES.includes(e.type) && e.pos) {
      for (const k of TRACK) {
        const I = st.inst[k];
        if (!I) continue;
        if (e.obj === k || d2(e.pos, geo.OBJ_POS[k]) <= CONFIG.scene.obj.radius) { if (e.type === 'teamfight') I.fight = true; else I.contest = true; }
      }
    }
    if (STRUCT_TYPES.includes(e.type)) for (const k of TRACK) { const I = st.inst[k]; if (I) I.trade[e.side] = true; }
    if (TRACK.includes(e.type) && st.inst[e.type]) {
      const I = st.inst[e.type], taker = e.side;
      const cls = I.fight ? 'fight' : I.trade[1 - taker] ? 'trade' : I.contest ? 'contest' : 'concede';
      const o = stats.objOut[e.type] || (stats.objOut[e.type] = { fight: 0, trade: 0, contest: 0, concede: 0 });
      o[cls]++;
      delete st.inst[e.type];
      if (e.type === 'baron') {
        // 처치 직전(바론 보상 지급 전) 대비: 보상 = 생존자 1인당 baronPerAlive
        const reward = g.sides[taker].players.filter(p => p.alive).length * CONFIG.match.gold.baronPerAlive;
        st.baron.push({ side: taker, t: g.t, d0: goldOf(g.sides[taker]) - goldOf(g.sides[1 - taker]) - reward });
        if (st.firstBaron === null) st.firstBaron = taker;
      }
    }
  }
  for (const b of st.baron) if (!b.done && (g.t >= b.t + CONFIG.match.objectives.baronBuff || g.over)) { b.done = true; stats.baronSwing.push(goldOf(g.sides[b.side]) - goldOf(g.sides[1 - b.side]) - b.d0); }
  // 진입(오브젝트 처치·견제 계획) ↔ 후퇴(오브젝트가 살아 있는데 그 계획을 버림) 전환이 30초 안에 3번 이상
  for (const s of g.sides) {
    const p = s.plan;
    const cur = p && (p.kind === 'objTake' || p.kind === 'objContest') ? p.key : null;
    const prev = st.flipState[s.idx];
    // 진입 = 오브젝트 계획이 아니다가 들어감, 후퇴 = 오브젝트가 살아 있는데 오브젝트 계획을 버림 (오브젝트끼리 옮겨 가는 건 제외)
    const objPlan = p && ['objSetup', 'objTake', 'objContest'].includes(p.kind);
    const prevObjPlan = st.prevObjPlan[s.idx];
    if (!prev && cur && !p.forced && !prevObjPlan) st.flip[s.idx].push(g.t);   // 진입: 오브젝트와 무관한 계획에서 들어감 (장면 선택 강제 계획 제외)
    else if (prev && !objPlan && g.obj[prev] && g.obj[prev].alive) st.flip[s.idx].push(g.t);   // 후퇴: 오브젝트 계획을 아예 떠남
    st.prevObjPlan[s.idx] = objPlan;
    st.flipState[s.idx] = cur;
    const lab = p ? `${p.kind}${p.key ? ':' + p.key : ''}` : '-';
    const ph = st.planHist[s.idx];
    if (!ph.length || ph[ph.length - 1].l !== lab) ph.push({ t: g.t, l: lab });
    while (ph.length && ph[0].t < g.t - 40) ph.shift();
    st.flip[s.idx] = st.flip[s.idx].filter(x => x > g.t - 30);
    if (st.flip[s.idx].length >= 3 && g.t >= st.flipCd[s.idx]) {
      V_('11 진입·후퇴 반복', seed, g.t, `${s.idx === 0 ? '블루' : '레드'} 30초 안에 오브젝트 진입·후퇴 ${st.flip[s.idx].length}번 전환: ${st.planHist[s.idx].map(x => fmt(x.t) + ' ' + x.l).join(' → ')}`);
      stats.flips++; st.flipCd[s.idx] = g.t + 30;
    }
  }
}

function makeTeam(rng, id, target) {
  const players = POS.map(p => makePlayer(rng, { nick: id + p, pos: p, age: 21, target: target + rng.int(-4, 4) }));
  const used = new Set();
  const picks = POS.map(p => { let c, k = 0; do c = rng.pick(champsForPos(p)); while (used.has(c) && k++ < 50); used.add(c); return c; });
  players.forEach((pl, i) => { pl.champs[picks[i]] = rng.int(20, 95); });
  return { team: { id, code: id, name: id === 'A' ? '블루팀' : '레드팀' }, players, picks };
}

// 검사용 무작위 경기 만들기
export function makeGame(seed, scenes = true) {
  const rng = new RNG(seed);
  const meta = newMeta(rng, 2026);
  const A = makeTeam(rng, 'A', rng.int(72, 85)), B = makeTeam(rng, 'B', rng.int(72, 85));   // 리그 티어 범위(C~S)
  const userPid = scenes ? rng.pick([...A.players, ...B.players]).id : null;
  // 최근 경기 장면 제목 (생성 장면이 피해야 함) — 연속한 검사 경기를 한 사람의 경기처럼 본다
  const recentSceneTitles = stats.recentTitles.slice(-V.recentTitleGames).flat();
  return createMatch({ blue: A, red: B, seed: rng.int(1, 2 ** 30), meta, userPid, keepInput: true, recentSceneTitles });
}

// 경기를 끝까지(또는 stopAt까지) 돌리며 매 틱 검사.
//  chooseOpt(g, scene) → 선택지 번호 (없으면 무작위), onTick(g, events) 선택
export function runChecked(g, seed, { chooseOpt = null, stopAt = Infinity, onTick = null } = {}) {
  const ps = allPlayers(g);
  const hist = [];                 // 틱별 위치 [{t, pos:{pid:[x,y,alive]}}]
  const presence = OBJ_TYPES.map(() => [0, 0]);  // 오브젝트별 팀별 연속 둥지 체류 틱
  const spawned = {};
  const destroyed = [new Set(), new Set()];      // 방어 팀 기준 파괴된 구조물 키
  const inhibDown = [new Set(), new Set()];
  const prev = {};
  for (const p of ps) prev[p.pid] = [p.x, p.y, true];
  let guard = 0;
  const strat = { inst: {}, baron: [], flip: [[], []], flipState: [null, null], flipCd: [0, 0], firstBaron: null, planHist: [[], []], prevObjPlan: [false, false] };
  g.__strat = strat;
  takeSnap(g);
  while (!g.over && guard++ < 1200 && g.t < stopAt) {
    const r = step(g);
    const t = g.t;
    const cur = {};
    for (const p of ps) cur[p.pid] = [p.x, p.y, p.alive];
    hist.push({ t, pos: cur });
    if (hist.length > 20) hist.shift();
    const evs = r.events.slice();
    // ---- 장면 (9) ----
    if (r.sceneDue && g.userSide >= 0) {
      const sc = buildScene(g, { condition: 70, mental: 60, fatigue: 30 });
      if (sc) {
        stats.scenes++;
        stats.sceneIds[sc.id] = (stats.sceneIds[sc.id] || 0) + 1;
        if (/\{\w+\}/.test(sc.desc + sc.title)) V_('9 주요 장면', seed, g.t, `장면 ${sc.id} 설명에 빈 변수`);
        checkScene(g, sc, seed);
        const pick = chooseOpt ? chooseOpt(g, sc) : g.rng.int(0, sc.options.length - 1);
        if (pick != null) {   // null: 신고 시점에 아직 고르지 않은 장면
          const res = resolveScene(g, sc, pick, g.userState || { condition: 70, mental: 60, fatigue: 30 });
          for (const e of res.events) evs.push(e);
        }
        for (const p of ps) cur[p.pid] = [p.x, p.y, p.alive];
      }
    }
    const moved = {};
    for (const e of evs) if (e.type === 'move') moved[e.pid] = e;
    // ---- 1초 단위 이동 (12 벽 통과, 13 초당 이동 한도, 14 방향 반복 전환) ----
    checkSeconds(g, ps, moved, strat, seed);
    // ---- 이동 (2), 사망 (3) ----
    const maxStep = S.moveSpeed * S.maxSpeedMult * dt + TOL;
    for (const p of ps) {
      const a = prev[p.pid], b = cur[p.pid];
      const dd = d2(a, b);
      const mv = moved[p.pid];
      if (mv) {
        if (d2(mv.from, a) > TOL && !(mv.kind === 'respawn')) V_('2 이동 속도', seed, t, `${p.nick} ${mv.kind} 출발점 불일치`);
        if (mv.kind === 'respawn') {
          if (a[2]) V_('3 사망자', seed, t, `${p.nick} 살아 있는데 부활 처리`);
          if (d2(mv.to, geo.fountain(p.side)) > TOL) V_('2 이동 속도', seed, t, `${p.nick} 부활 위치가 우물이 아님`);
        } else if (mv.kind === 'recall') {
          if (d2(mv.to, geo.fountain(p.side)) > TOL) V_('2 이동 속도', seed, t, `${p.nick} 귀환 위치가 우물이 아님`);
          // 8초 채널링: 직전 두 틱 동안 제자리
          // 채널링 시간(버프 중엔 짧음)만큼 직전 틱들에 제자리
          const chan = g.sides[p.side].baronUntil >= t - dt ? S.recallChannelBaron : S.recallChannel;
          const need = Math.ceil(chan / dt);
          for (let k = 2; k < 2 + need; k++) { const h = hist[hist.length - k]; if (!h || d2(h.pos[p.pid], mv.from) > TOL) { V_('2 이동 속도', seed, t, `${p.nick} 귀환 채널링 없이 순간이동`); break; } }
        } else if (mv.kind === 'tp') {
          const h1 = hist[hist.length - 2];
          if (!h1 || d2(h1.pos[p.pid], mv.from) > TOL) V_('2 이동 속도', seed, t, `${p.nick} 텔레포트 채널링 없음`);
          if (!tpDestOk(g, p, mv)) V_('2 이동 속도', seed, t, `${p.nick} 텔레포트 도착지가 아군 포탑·와드·미니언이 아님`);
        }
        // 순간이동 후 같은 틱 이동은 없어야 함
        if (d2(mv.to, b) > maxStep) V_('2 이동 속도', seed, t, `${p.nick} 순간이동 후 추가 이동 과다`);
      } else if (dd > maxStep) V_('2 이동 속도', seed, t, `${p.nick} 한 틱 ${dd.toFixed(3)} 이동 (한도 ${maxStep.toFixed(3)})`);
      if (!a[2] && !b[2] && dd > 1e-9 && !mv) V_('3 사망자', seed, t, `${p.nick} 죽은 상태로 이동`);
    }
    // ---- 이벤트 (1, 3, 4, 5, 6, 10) ----
    for (const e of evs) checkEvent_(g, e, seed, hist, prev, presence, spawned, destroyed, inhibDown);
    trackStrat(g, evs, strat, seed);
    // 오브젝트 둥지 체류 (이벤트 처리 후 갱신 → 처치 틱 포함)
    OBJ_TYPES.forEach((k, ki) => {
      for (const s of [0, 1]) {
        const any = ps.some(p => p.side === s && p.alive && d2([p.x, p.y], geo.OBJ_POS[k]) <= geo.PIT_RADIUS + TOL);
        presence[ki][s] = any ? presence[ki][s] + 1 : 0;
      }
    });
    // ---- 운영 통계 (7, 8) ----
    for (const s of g.sides) {
      const reg = s.players.filter(p => p.alive).map(p => geo.regionOf(p.x, p.y));
      if (t < CONFIG.match.laningEnd) {
        stats.earlyMid[1]++;
        if (reg.length === 5 && reg.every(x => x === 'midLane')) stats.earlyMid[0]++;
      } else {
        stats.side[1]++;
        if (reg.some(x => x === 'topLane' || x === 'botLane')) stats.side[0]++;
      }
      stats.plan[s.plan ? s.plan.kind : '-'] = (stats.plan[s.plan ? s.plan.kind : '-'] || 0) + 1;
      for (const p of s.players) { const k = p.task ? p.task.kind : '-'; stats.task[k] = (stats.task[k] || 0) + 1; }
    }
    for (const p of ps) prev[p.pid] = cur[p.pid];
    takeSnap(g);
    if (onTick) onTick(g, evs);
  }
  if (g.t < stopAt || g.over) finishGame(g, seed);
  return g;
}
function finishGame(g, seed) {
  if (!g.over || g.timedOut) { V_('5 구조물·넥서스', seed, g.t, '넥서스 파괴 없이 시간 초과로 종료'); stats.timeouts++; }
  stats.games++;
  stats.dur.push(g.t / 60);
  stats.kills.push(g.sides[0].kills + g.sides[1].kills);
  if (g.winner === 0) stats.blueWins++;
  if (g.__strat && g.__strat.firstBaron !== null) { stats.baronGames++; if (g.winner === g.__strat.firstBaron) stats.baronWins++; }
  // 포지션별 킬·어시스트
  for (const s of g.sides) {
    for (const p of s.players) { stats.kpos[p.pos] = (stats.kpos[p.pos] || 0) + p.k; stats.apos[p.pos] = (stats.apos[p.pos] || 0) + p.a; }
    stats.supRank[s.players.slice().sort((a, b) => b.a - a.a).findIndex(p => p.pos === 'SUP')]++;
  }
  stats.ks += g.feed.filter(e => e.type === 'kill' && e.ks).length;
  // 최근 경기 장면 제목 반복 검사
  const titles = g.sceneLog.filter(r => r.combo).map(r => r.title);
  const recent = new Set(stats.recentTitles.slice(-V.recentTitleGames).flat());
  for (const t of titles) if (recent.has(t)) V_('9 주요 장면', seed, g.t, `생성 장면 제목이 최근 ${V.recentTitleGames}경기 안에서 반복: ${t}`);
  if (new Set(titles).size !== titles.length) V_('9 주요 장면', seed, g.t, '같은 경기 안에서 생성 장면 제목 반복');
  if (g.userSide >= 0) stats.recentTitles.push(titles);
}

const respawned = (g, pid) => g.newEvents.some(e => e.type === 'move' && e.kind === 'respawn' && e.pid === pid);
// 순간이동 판정은 직전 틱 끝 상태(snap)로 본다 (채널링 완료는 틱 맨 앞에서 처리됨)
let snap = null;
function takeSnap(g) {
  snap = { t: g.t, towers: g.sides.map(s => { const out = []; for (const l of LANES) for (let i = 0; i < 3; i++) if (s.towers[l][i] > 0) out.push(geo.towerPos(s.idx, l, i)); return out; }),
    wards: g.sides.map(s => s.wards.map(w => ({ x: w.x, y: w.y, until: w.until }))), fronts: LANES.map(l => geo.pointOnLane(l, g.waves[l].s)) };
}
function destOk(g, side, pt) {
  if (!snap) return false;
  if (snap.towers[side].some(q => d2(q, pt) <= 0.02 + TOL)) return true;
  if (snap.wards[side].some(w => w.until > g.t && d2([w.x, w.y], pt) <= 0.02 + TOL)) return true;
  return snap.fronts.some(f => d2(f, pt) <= 0.07 + TOL);
}
function tpDestOk(g, p, mv) { return destOk(g, p.side, mv.to); }
function tpStartOk(g, p, e) { return destOk(g, p.side, e.dest); }

function checkEvent_(g, e, seed, hist, prev, presence, spawned, destroyed, inhibDown) {
  const t = g.t;
  const P = pid => g.byId[pid];
  const pos = pid => { const p = P(pid); return [p.x, p.y]; };
  // (10) 문자중계
  for (const b of checkEvent(g, e)) V_('10 문자중계', seed, t, `[${e.type}] "${b.text}" (${b.why})`);
  // (3) 이벤트 참여자는 틱 시작 시점에 살아 있어야 함 (교전 요약은 교전 중 사망 허용)
  if (e.parts && !FIGHT_TYPES.includes(e.type) && e.type !== 'ace' && e.type !== 'multi' && e.type !== 'move' && e.type !== 'heraldDown') {
    for (const pid of e.parts) if (!prev[pid][2] && !respawned(g, pid)) V_('3 사망자', seed, t, `[${e.type}] 죽어 있던 ${P(pid).nick} 참여`);
  }
  switch (e.type) {
    case 'kill': {
      const v = P(e.victim);
      const fl = e.fightId ? (g.fights.find(f => f.id === e.fightId) || {}).kind : null;
      stats.killBy[e.reason] = (stats.killBy[e.reason] || 0) + 1;
      if (d2(e.pos, pos(e.victim)) > TOL) V_('1 위치', seed, t, `킬 위치 ≠ 희생자 위치`);
      for (const pid of [e.killer, ...e.assisters].filter(Boolean)) {
        const d = d2(pos(pid), e.pos);
        if (d > S.eventRadius + TOL) V_('1 위치', seed, t, `${P(pid).nick}이(가) ${d.toFixed(3)} 떨어진 ${v.nick} 킬에 참여 (${e.reason})`);
      }
      break;
    }
    case 'move': break;
    default: break;
  }
  if (FIGHT_TYPES.includes(e.type)) {
    stats.labels[e.type] = (stats.labels[e.type] || 0) + 1;
    stats.killLabel[e.type] = (stats.killLabel[e.type] || 0) + e.kills;
    if (opts.VERBOSE && e.type === 'teamfight') { const k2 = 'PLAN ' + e.region + ' ' + g.sides.map(s => s.plan ? s.plan.kind + (s.plan.key ? ':' + s.plan.key : '') : '-').join(' / ') + ' prog=' + (e.obj && g.obj[e.obj] && g.obj[e.obj].prog ? g.obj[e.obj].prog.side : '-'); stats.fr[k2] = (stats.fr[k2] || 0) + 1; }
    if (opts.VERBOSE) { const k = e.type + ' @' + e.region + ' ' + (g.t < 840 ? 'E' : g.t < 1500 ? 'M' : 'L'); stats.fr[k] = (stats.fr[k] || 0) + e.kills; }
    // (1) 참여자는 교전 기간 중 한 번은 교전 반경 안에 있었어야 함
    const window = hist.filter(h => h.t >= e.start && h.t <= t);
    for (const pid of e.parts) {
      const ok = window.some(h => h.pos[pid] && d2(h.pos[pid], e.pos) <= S.fightRadius + TOL);
      if (!ok) V_('1 위치', seed, t, `[${e.type}] ${P(pid).nick} 교전 반경 밖인데 참여`);
    }
    // (6) 한타 표기
    const nA = e.partsBySide[0].length, nB = e.partsBySide[1].length;
    if (e.type === 'teamfight' && (nA < 4 || nB < 4)) V_('6 한타 표기', seed, t, `한타인데 ${nA}대${nB}`);
    if (e.type !== 'teamfight' && nA >= 4 && nB >= 4) V_('6 한타 표기', seed, t, `${nA}대${nB}인데 ${e.type}`);
    if (e.type === 'teamfight') {
      stats.tfN++;
      const d = e.kills;
      const ace = e.ace || (e.deaths[0] >= nA || e.deaths[1] >= nB);
      if (ace) stats.tf.ace++;
      else if (d <= 1) stats.tf['0-1']++;
      else if (d <= 4) stats.tf['2-4']++;
      else stats.tf['5-7']++;
    }
  }
  if (e.type === 'spawn') spawned[e.obj] = t;
  if (e.type === 'objStart') {
    for (const pid of e.parts) if (d2(pos(pid), geo.OBJ_POS[e.obj]) > geo.PIT_RADIUS + TOL) V_('4 오브젝트', seed, t, `${P(pid).nick} 둥지 밖에서 ${e.obj} 시작`);
  }
  if (OBJ_TYPES.includes(e.type)) {
    const k = e.type, ki = OBJ_TYPES.indexOf(k);
    stats.objCount[k] = (stats.objCount[k] || 0) + 1;
    const [mn] = S.objTime[k];
    if (spawned[k] == null || spawned[k] > e.start) V_('4 오브젝트', seed, t, `${k} 등장 전 처치 시작`);
    const took = t - e.start;
    (stats.objTime[k] = stats.objTime[k] || []).push(took);
    if (took < mn) V_('4 오브젝트', seed, t, `${k} ${took}초 만에 처치 (최소 ${mn}초)`);
    const pres = presence[ki][e.progSide] * dt;   // 직전 틱까지 연속 체류 시간
    if (pres + dt < mn) V_('4 오브젝트', seed, t, `${k} 처치 팀 둥지 체류 ${pres + dt}초 < ${mn}초`);
    for (const pid of e.parts) {
      const d = d2(pos(pid), geo.OBJ_POS[k]);
      if (d > geo.PIT_RADIUS + 0.02 + TOL) V_('4 오브젝트', seed, t, `${k} 처치 참여자 ${P(pid).nick}이(가) 둥지에서 ${d.toFixed(3)} 떨어짐`);
    }
    if (!e.parts.length) V_('4 오브젝트', seed, t, `${k} 처치 참여자 없음`);
    spawned[k] = null;
  }
  if (STRUCT_TYPES.includes(e.type)) checkStruct(g, e, seed, destroyed, inhibDown);
  if (e.type === 'inhibRespawn') { inhibDown[e.side].delete(e.lane); destroyed[e.side].delete(`I-${e.lane}`); }
  if (e.type === 'tower' && e.first) stats.firstTower.push(t / 60);
  if (e.type === 'tpStart') { if (!tpStartOk(g, P(e.pid), e)) V_('2 이동 속도', seed, t, `${P(e.pid).nick} 텔레포트 목적지가 아군 포탑·와드·미니언이 아님`); }
  if (e.type === 'heraldSummon' && d2(pos(e.pid), e.pos) > TOL) V_('1 위치', seed, t, '전령 소환 위치 ≠ 소환자 위치');
}

function checkStruct(g, e, seed, destroyed, inhibDown) {
  const t = g.t;
  const D = 1 - e.side;
  const key = e.type === 'tower' ? `T-${e.lane}-${e.idx}` : e.type === 'inhib' ? `I-${e.lane}` : e.type === 'nexusTower' ? `N-${e.idx}` : 'NX';
  // 순서
  if (e.type === 'tower') for (let i = 0; i < e.idx; i++) if (!destroyed[D].has(`T-${e.lane}-${i}`)) V_('5 구조물·넥서스', seed, t, `${e.lane} ${e.idx}번 포탑을 ${i}번보다 먼저 파괴`);
  if (e.type === 'inhib') for (let i = 0; i < 3; i++) if (!destroyed[D].has(`T-${e.lane}-${i}`)) V_('5 구조물·넥서스', seed, t, `${e.lane} 억제기를 포탑보다 먼저 파괴`);
  if (e.type === 'nexusTower' && !inhibDown[D].size) V_('5 구조물·넥서스', seed, t, '억제기 없이 쌍둥이 포탑 파괴');
  if (e.type === 'nexus') {
    if (!destroyed[D].has('N-0') || !destroyed[D].has('N-1')) V_('5 구조물·넥서스', seed, t, '쌍둥이 포탑이 남았는데 넥서스 파괴');
    if (!inhibDown[D].size) V_('5 구조물·넥서스', seed, t, '억제기가 모두 있는데 넥서스 파괴');
    const inBase = g.sides[e.side].players.filter(p => p.alive && geo.inBase(D, p.x, p.y));
    if (inBase.length < S.nexusMinAttackers) V_('5 구조물·넥서스', seed, t, `상대 기지 안 공격 팀 ${inBase.length}명`);
    const nearNexus = g.sides[e.side].players.filter(p => p.alive && d2([p.x, p.y], geo.nexusPos(D)) <= S.towerRange + TOL);
    if (!nearNexus.length) V_('5 구조물·넥서스', seed, t, '넥서스 앞에 공격 팀 선수 없음');
  }
  // 참여자 위치 / 미니언·전령
  for (const pid of e.parts) {
    const p = g.byId[pid];
    const d = d2([p.x, p.y], e.pos);
    if (d > S.towerRange * (e.herald ? 2 : 1) + TOL) V_('1 위치', seed, t, `${e.type} 파괴 참여자 ${p.nick}이(가) ${d.toFixed(3)} 떨어짐`);
  }
  if (!e.parts.length && !e.minions && !e.herald) V_('5 구조물·넥서스', seed, t, `${e.type} 근처에 공격자·미니언 없음`);
  if (e.minions && e.type !== 'nexus') {
    if (e.type === 'tower' || e.type === 'inhib') {
      const w = g.waves[e.lane].s;
      const ss = e.type === 'tower' ? geo.STRUCT_S[D][e.lane].towers[e.idx] : geo.STRUCT_S[D][e.lane].inhib;
      if (Math.abs(w - ss) > 0.03) V_('5 구조물·넥서스', seed, t, `미니언이 없는데 미니언 피해로 ${e.type} 파괴 (웨이브 ${w.toFixed(2)} 구조물 ${ss.toFixed(2)})`);
    }
  }
  if (destroyed[D].has(key)) V_('5 구조물·넥서스', seed, t, `${key} 중복 파괴`);
  destroyed[D].add(key);
  if (e.type === 'inhib') inhibDown[D].add(e.lane);
}

function checkScene(g, sc, seed) {
  const t = g.t;
  if (!sc.loc) { V_('9 주요 장면', seed, t, '장면 위치 없음'); return; }
  const me = userPlayer(g);
  const R = sc.R || S.sceneRadius;
  if (!me.alive) V_('9 주요 장면', seed, t, '죽은 상태에서 장면');
  if (sc.gen) checkObjScene(g, sc, seed, me);
  for (const pid of sc.involved) {
    const p = g.byId[pid];
    if (!p.alive) V_('9 주요 장면', seed, t, `장면 참여자 ${p.nick} 사망 상태`);
    const d = d2([p.x, p.y], sc.loc);
    if (d > R + TOL) V_('9 주요 장면', seed, t, `장면 참여자 ${p.nick}이(가) 장면 위치에서 ${d.toFixed(3)} 떨어짐`);
    const c = sc.cards && sc.cards[pid];
    if (!c || Math.abs(c.hp - p.hp) > 1e-6 || c.ult !== ultReady(g, p) || c.flash !== flashReady(g, p) || c.level !== p.level) V_('9 주요 장면', seed, t, `장면 카드 ${p.nick} 상태 불일치`);
  }
  // 근처에 있는데 빠진 선수
  for (const p of allPlayers(g)) if (p.alive && d2([p.x, p.y], sc.loc) <= R - TOL && !sc.involved.includes(p.pid)) V_('9 주요 장면', seed, t, `장면 위치 근처 ${p.nick} 누락`);
  if (sc.region !== geo.regionOf(...sc.loc)) V_('9 주요 장면', seed, t, '장면 지역 이름 불일치');
}

// 생성 장면: 설명 속 수치가 그 틱의 엔진 상태와 같은지 (검사기가 직접 다시 계산)
const OBJ_KO = { baron: '바론', dragon: '드래곤', elder: '장로 드래곤' };
function checkObjScene(g, sc, seed, me) {
  const t = g.t, f = sc.facts, key = sc.gen.key;
  stats.objScenes++;
  stats.objCombos[sc.combo] = (stats.objCombos[sc.combo] || 0) + 1;
  const pit = geo.OBJ_POS[key], R = CONFIG.scene.obj.radius;
  const near = allPlayers(g).filter(p => p.alive && d2([p.x, p.y], pit) <= R);
  const nA = near.filter(p => p.side === me.side).length, nE = near.length - nA;
  const o = g.obj[key];
  const hp = o.alive ? Math.round((o.prog ? 1 - o.prog.val : 1) * 100) : null;
  const ej = g.sides[1 - me.side].players.find(p => p.pos === 'JGL');
  const eSmite = ej.alive && d2([ej.x, ej.y], pit) <= R && t >= (ej.smiteAt || 0);
  const bad = [];
  if (f.nA !== nA || f.nE !== nE) bad.push(`인원 ${f.nA}대${f.nE} ≠ 실제 ${nA}대${nE}`);
  if (!sc.desc.includes(`${nA}대${nE}`)) bad.push('설명에 실제 인원 없음');
  if (hp !== null && !sc.desc.includes(`${OBJ_KO[key]} 체력 ${hp}%`)) bad.push(`설명의 ${OBJ_KO[key]} 체력이 실제 ${hp}%와 다름`);
  if (!sc.desc.includes(`상대 정글 강타 ${eSmite ? '있음' : '없음'}`)) bad.push(`강타 표기 불일치 (실제 ${eSmite ? '있음' : '없음'})`);
  if (!sc.desc.includes(`내 체력 ${Math.round(me.hp * 100)}%`)) bad.push('내 체력 표기 불일치');
  const sit = f.sit;
  if (sit === 'weTake' && !(o.prog && o.prog.side === me.side)) bad.push('우리가 치는 중이 아닌데 weTake');
  if (sit === 'theyTake' && !(o.prog && o.prog.side !== me.side)) bad.push('상대가 치는 중이 아닌데 theyTake');
  if (sit === 'spawnVision' && o.alive) bad.push('이미 등장했는데 등장 전 장면');
  if (sit === 'pickedEnemy' && g.sides[1 - me.side].players.every(p => p.alive)) bad.push('상대가 모두 살아 있는데 "잘림"');
  if (sit === 'pickedAlly' && g.sides[me.side].players.every(p => p.alive)) bad.push('아군이 모두 살아 있는데 "잘림"');
  for (const b of bad) V_('9 주요 장면', seed, t, `생성 장면 ${sc.id}: ${b}`);
}

// 결과 출력. 반환: 통과 여부
export function printReport(sec) {
  console.log(`\n=== 경기 정합성 검사: ${stats.games}판 (${sec}초) ===\n`);
const avg = a => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const pct = (a, b) => (b ? (a / b * 100).toFixed(1) + '%' : '-');
const quant = (a, q) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(q * (s.length - 1))]; };

console.log(`[위반] 총 ${violTotal}건`);
const CHECKS = ['1 위치', '2 이동 속도', '3 사망자', '4 오브젝트', '5 구조물·넥서스', '6 한타 표기', '7 초반 미드 뭉침', '8 사이드 운영', '9 주요 장면', '10 문자중계', '11 진입·후퇴 반복', '12 벽 통과', '13 초당 이동 한도', '14 방향 반복 전환'];
const em = stats.earlyMid[0] / Math.max(1, stats.earlyMid[1]);
const sd = stats.side[0] / Math.max(1, stats.side[1]);
if (em >= V.earlyMidStackMax) V_('7 초반 미드 뭉침', 'ALL', 0, `0~14분 5명 미드 비율 ${pct(stats.earlyMid[0], stats.earlyMid[1])} ≥ ${V.earlyMidStackMax * 100}%`);
if (sd < V.sideLaneMin) V_('8 사이드 운영', 'ALL', 0, `14분 이후 사이드 라인 체류 비율 ${pct(stats.side[0], stats.side[1])} < ${V.sideLaneMin * 100}%`);
for (const c of CHECKS) {
  const v = viol[c];
  console.log(`  ${v ? '✗' : '✓'} ${c.padEnd(14)} ${v ? v.n + '건' : '0건'}`);
  if (v) for (const ex of v.ex) console.log(`      - ${ex}`);
}
console.log('\n[통계]');
console.log(`  평균 경기 시간 ${avg(stats.dur).toFixed(1)}분 (10%~90%: ${quant(stats.dur, 0.1).toFixed(0)}~${quant(stats.dur, 0.9).toFixed(0)}분)  목표 ${V.durationMin.join('~')}`);
console.log(`  평균 총 킬 ${avg(stats.kills).toFixed(1)} (10%~90%: ${quant(stats.kills, 0.1)}~${quant(stats.kills, 0.9)})  목표 ${V.killsAvg.join('~')}`);
console.log(`  블루 승률 ${pct(stats.blueWins, stats.games)} · 첫 포탑 평균 ${avg(stats.firstTower).toFixed(1)}분 · 장면 ${stats.scenes}개`);
console.log(`  한타 ${stats.tfN}회 (경기당 ${(stats.tfN / stats.games).toFixed(1)}) 사망자 분포:`);
const tfTarget = V.tfDeaths;
const statOk = [];
for (const k of ['0-1', '2-4', '5-7', 'ace']) {
  const r = stats.tf[k] / Math.max(1, stats.tfN);
  const ok = r >= tfTarget[k][0] && r <= tfTarget[k][1];
  statOk.push(ok);
  console.log(`    ${ok ? "✓" : "✗"} ${k.padEnd(4)} ${(r * 100).toFixed(1)}%  (목표 ${Math.round(tfTarget[k][0] * 100)}~${Math.round(tfTarget[k][1] * 100)}%)`);
}
console.log(`  교전 종류: ${Object.entries(stats.labels).map(([k, v]) => `${k} ${(v / stats.games).toFixed(1)}`).join(' · ')} (경기당)`);
console.log(`  교전 종류별 킬: ${Object.entries(stats.killLabel).map(([k, v]) => `${k} ${(v / stats.games).toFixed(1)}`).join(' · ')} · 기타 킬 원인: ${Object.entries(stats.killBy).filter(([k]) => !['fight', 'trade'].includes(k)).map(([k, v]) => `${k} ${(v / stats.games).toFixed(1)}`).join(' · ')}`);
if (opts.VERBOSE) console.log(Object.entries(stats.fr).sort((a, b) => b[1] - a[1]).slice(0, 80).map(([k, v]) => `${k} ${(v / stats.games).toFixed(2)}`).join('\n'));
console.log(`  등장한 장면 종류 ${Object.keys(stats.sceneIds).length}개 · 경기당 장면 ${(stats.scenes / Math.max(1, stats.games)).toFixed(1)}개`);
console.log('  오브젝트 평균 처치 시간:');
for (const k of OBJ_TYPES) if (stats.objTime[k]) console.log(`    ${k.padEnd(7)} ${avg(stats.objTime[k]).toFixed(1)}초 (${Math.min(...stats.objTime[k])}~${Math.max(...stats.objTime[k])}초, 설정 ${S.objTime[k].join('~')}) · 경기당 ${(stats.objCount[k] / stats.games).toFixed(2)}회`);
const planTot = Object.values(stats.plan).reduce((a, b) => a + b, 0);
console.log('  팀 계획 시간 비율: ' + Object.entries(stats.plan).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${pct(v, planTot)}`).join(' · '));
const taskTot = Object.values(stats.task).reduce((a, b) => a + b, 0);
console.log('  선수 임무 시간 비율: ' + Object.entries(stats.task).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${pct(v, taskTot)}`).join(' · '));
console.log(`  0~14분 5명 미드 비율 ${pct(stats.earlyMid[0], stats.earlyMid[1])} (상한 ${V.earlyMidStackMax * 100}%) · 14분 이후 사이드 체류 ${pct(stats.side[0], stats.side[1])} (하한 ${V.sideLaneMin * 100}%)`);
// 포지션별 킬 비율·서폿 어시스트 순위
const kTot = Object.values(stats.kpos).reduce((a, b) => a + b, 0);
const shareOk = Object.entries(V.killShare).map(([pos, [lo, hi]]) => { const r = (stats.kpos[pos] || 0) / Math.max(1, kTot); console.log(`  ${r >= lo && r <= hi ? '✓' : '✗'} 킬 비율 ${pos.padEnd(3)} ${(r * 100).toFixed(1)}% (목표 ${Math.round(lo * 100)}~${Math.round(hi * 100)}%)`); return r >= lo && r <= hi; });
const aAvg = Object.fromEntries(Object.entries(stats.apos).map(([k, v]) => [k, v / Math.max(1, stats.games * 2)]));
const aOrder = Object.keys(aAvg).sort((a, b) => aAvg[b] - aAvg[a]);
const supRankAvg = aOrder.indexOf('SUP') + 1;
const assistOk = supRankAvg >= 1 && supRankAvg <= V.supAssistRankMax;
console.log(`  ${assistOk ? '✓' : '✗'} 경기당 어시스트: ${aOrder.map(k => `${k} ${aAvg[k].toFixed(1)}`).join(' · ')} → 서폿 ${supRankAvg}위 (팀별 서폿 순위 1~5위: ${stats.supRank.join('/')}) · 서폿 킬스틸 경기당 ${(stats.ks / Math.max(1, stats.games)).toFixed(2)}회`);
// 생성 장면 조합
const comboN = Object.keys(stats.objCombos).length;
const comboTop = Object.entries(stats.objCombos).sort((a, b) => b[1] - a[1]).slice(0, 5);
const comboMax = comboTop.length ? comboTop[0][1] / Math.max(1, stats.objScenes) : 0;
const comboOk = !opts.SCENES || (comboN >= V.objCombosMin && comboMax <= V.objComboMaxShare);
if (opts.SCENES) {
  console.log(`  ${comboOk ? '✓' : '✗'} 바론·드래곤·장로 생성 장면 ${stats.objScenes}개 · 상황+장소+인원 조합 ${comboN}종 (하한 ${V.objCombosMin}) · 최다 조합 비율 ${(comboMax * 100).toFixed(1)}% (상한 ${V.objComboMaxShare * 100}%)`);
  for (const [k, n] of comboTop) console.log(`      ${k}  ${n}회 (${(n / Math.max(1, stats.objScenes) * 100).toFixed(1)}%)`);
}
statOk.push(...shareOk, assistOk, comboOk);
// 오브젝트 운영
const KO_OUT = { fight: '한타', trade: '교환', contest: '견제', concede: '포기' };
for (const k of TRACK) {
  const o = stats.objOut[k]; if (!o) continue;
  const n = o.fight + o.trade + o.contest + o.concede;
  const r = o.fight / Math.max(1, n), [lo, hi] = V.objFightRate[k];
  const ok = r >= lo && r <= hi; statOk.push(ok);
  console.log(`  ${ok ? '✓' : '✗'} ${k.padEnd(6)} ${n}회 중 ${Object.entries(o).map(([c, v]) => `${KO_OUT[c]} ${(v / Math.max(1, n) * 100).toFixed(1)}%`).join(' · ')} (한타 목표 ${Math.round(lo * 100)}~${Math.round(hi * 100)}%)`);
}
const bs = stats.baronSwing, bsAvg = avg(bs), bs90 = bs.length ? quant(bs, 0.9) : 0;
const bsOk = bsAvg >= V.baronSwing[0] && bsAvg <= V.baronSwing[1] && bs90 >= V.baronSwingP90;
const bwr = stats.baronWins / Math.max(1, stats.baronGames), bwOk = bwr >= V.baronWinRate[0] && bwr <= V.baronWinRate[1];
statOk.push(bsOk, bwOk);
console.log(`  ${bsOk ? '✓' : '✗'} 바론 처치 직전 → 버프 종료 골드 격차 증가: 평균 ${Math.round(bsAvg)} (목표 ${V.baronSwing.join('~')}) · 10%/50%/90% ${Math.round(quant(bs, 0.1) || 0)}/${Math.round(quant(bs, 0.5) || 0)}/${Math.round(bs90)} (상위 10% 목표 ${V.baronSwingP90} 이상)`);
console.log(`  ${bwOk ? '✓' : '✗'} 첫 바론 처치 팀 승률 ${(bwr * 100).toFixed(1)}% (${stats.baronGames}경기, 목표 ${Math.round(V.baronWinRate[0] * 100)}~${Math.round(V.baronWinRate[1] * 100)}%) · 진입·후퇴 반복 ${stats.flips}건`);
const lw = avg(stats.laneWave), lwOk = lw >= V.move.laneWaveDist[0] && lw <= V.move.laneWaveDist[1];
statOk.push(lwOk);
console.log(`  ${lwOk ? '✓' : '✗'} 라인전 라이너 ↔ 자기 웨이브 평균 거리 ${lw.toFixed(3)} (목표 ${V.move.laneWaveDist.join('~')}, 10%/90% ${(quant(stats.laneWave, 0.1) || 0).toFixed(3)}/${(quant(stats.laneWave, 0.9) || 0).toFixed(3)}) · 1초 이동 검사 ${stats.moveSec.toLocaleString()}회`);
const durOk = avg(stats.dur) >= V.durationMin[0] && avg(stats.dur) <= V.durationMin[1];
const killOk = avg(stats.kills) >= V.killsAvg[0] && avg(stats.kills) <= V.killsAvg[1];
console.log(`\n[목표 범위] 경기 시간 ${durOk ? '✓' : '✗'} · 킬 ${killOk ? '✓' : '✗'} · 한타 분포·킬 비율·어시스트·장면 조합 ${statOk.every(Boolean) ? '✓' : '✗'}`);
console.log(violTotal === 0 && durOk && killOk && statOk.every(Boolean) ? '\n결과: 통과 ✓' : '\n결과: 실패 ✗');
  return violTotal === 0 && durOk && killOk && statOk.every(Boolean);
}
export const violCount = () => violTotal;
