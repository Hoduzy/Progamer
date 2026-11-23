// 대회 형식 공용 도구: 경기 객체, 순위, 라운드 로빈, 브래킷, 일정
import { dateAdd, weekday } from '../core/util.js';

export function mkMatch(comp, a, b, bo, extra = {}) {
  const n = comp.matches.length + 1;
  const m = { id: `${comp.id}#${n}`, compId: comp.id, teams: [a, b], bo, date: null, done: false, wins: [0, 0], winner: null, loser: null, games: [], stage: comp.stage, ...extra };
  comp.matches.push(m);
  return m;
}

export function newStandings(ids) {
  const st = {};
  for (const id of ids) st[id] = { w: 0, l: 0, gw: 0, gl: 0 };
  return st;
}
export function addResult(st, m) {
  const [a, b] = m.teams;
  if (!st[a]) st[a] = { w: 0, l: 0, gw: 0, gl: 0 };
  if (!st[b]) st[b] = { w: 0, l: 0, gw: 0, gl: 0 };
  st[m.winner].w++; st[m.loser].l++;
  st[a].gw += m.wins[0]; st[a].gl += m.wins[1];
  st[b].gw += m.wins[1]; st[b].gl += m.wins[0];
}
// 정렬: 승 → 세트 득실 → 승자승 → 고정 해시
export function sortStandings(st, matches = []) {
  const ids = Object.keys(st);
  const h = id => { let x = 0; for (const c of id) x = (x * 31 + c.charCodeAt(0)) >>> 0; return x % 1000; };
  const h2h = (a, b) => {
    let v = 0;
    for (const m of matches) {
      if (!m.done) continue;
      if (m.teams.includes(a) && m.teams.includes(b)) v += m.winner === a ? 1 : -1;
    }
    return v;
  };
  return ids.sort((a, b) => (st[b].w - st[a].w) || ((st[b].gw - st[b].gl) - (st[a].gw - st[a].gl)) || -h2h(a, b) || (h(a) - h(b)));
}

// 원형 방식 라운드 로빈
export function rrRounds(ids, double = false) {
  const t = ids.slice();
  if (t.length % 2) t.push(null);
  const n = t.length, rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) {
      const a = t[i], b = t[n - 1 - i];
      if (a && b) pairs.push(r % 2 ? [b, a] : [a, b]);
    }
    rounds.push(pairs);
    t.splice(1, 0, t.pop());
  }
  if (double) return rounds.concat(rounds.map(rd => rd.map(([a, b]) => [b, a])));
  return rounds;
}

// 경기일 배정: matches(라운드 순서대로)를 시작일부터 요일·하루 최대 수에 맞게 배치. 마지막 날짜 반환
export function scheduleSequential(matches, startDate, days, perDay, minGapDays = 0) {
  let d = startDate;
  let guard = 0;
  while (!days.includes(weekday(d)) && guard++ < 14) d = dateAdd(d, 1);
  let count = 0, last = d;
  const busy = {};
  for (const m of matches) {
    // 같은 팀이 같은 날 두 번 뛰지 않게
    while (count >= perDay || m.teams.some(t => t && busy[d + t])) {
      d = dateAdd(d, 1);
      guard = 0;
      while (!days.includes(weekday(d)) && guard++ < 14) d = dateAdd(d, 1);
      count = 0;
    }
    m.date = d; count++; last = d;
    for (const t of m.teams) if (t) busy[d + t] = true;
  }
  return last;
}
export function nextDay(date, days, gap = 1) {
  let d = dateAdd(date, gap);
  let guard = 0;
  while (!days.includes(weekday(d)) && guard++ < 14) d = dateAdd(d, 1);
  return d;
}

// ---------------- 브래킷 정의 ----------------
// src: ['s', n] 시드 / ['w', id] 승자 / ['l', id] 패자 / ['lowW', [id1,id2]] 두 승자 중 낮은 시드 / ['highW', [...]]
export const BRACKETS = {
  DE6: {
    nodes: [
      { id: 'r1a', round: 1, a: ['s', 3], b: ['s', 6], label: '1라운드' },
      { id: 'r1b', round: 1, a: ['s', 4], b: ['s', 5], label: '1라운드' },
      { id: 'u1', round: 2, a: ['s', 1], b: ['lowW', ['r1a', 'r1b']], label: '승자조 2라운드' },
      { id: 'u2', round: 2, a: ['s', 2], b: ['highW', ['r1a', 'r1b']], label: '승자조 2라운드' },
      { id: 'uf', round: 3, a: ['w', 'u1'], b: ['w', 'u2'], label: '승자조 결승' },
      { id: 'l1', round: 3, a: ['l', 'u1'], b: ['l', 'u2'], label: '패자조 1라운드' },
      { id: 'lf', round: 4, a: ['l', 'uf'], b: ['w', 'l1'], label: '패자조 결승' },
      { id: 'gf', round: 5, a: ['w', 'uf'], b: ['w', 'lf'], label: '결승전' },
    ],
    place: [['w', 'gf'], ['l', 'gf'], ['l', 'lf'], ['l', 'l1'], ['l', 'r1a'], ['l', 'r1b']],
  },
  DE8: {
    nodes: [
      { id: 'q1', round: 1, a: ['s', 1], b: ['s', 8], label: '승자조 1라운드' },
      { id: 'q2', round: 1, a: ['s', 4], b: ['s', 5], label: '승자조 1라운드' },
      { id: 'q3', round: 1, a: ['s', 2], b: ['s', 7], label: '승자조 1라운드' },
      { id: 'q4', round: 1, a: ['s', 3], b: ['s', 6], label: '승자조 1라운드' },
      { id: 'u1', round: 2, a: ['w', 'q1'], b: ['w', 'q2'], label: '승자조 2라운드' },
      { id: 'u2', round: 2, a: ['w', 'q3'], b: ['w', 'q4'], label: '승자조 2라운드' },
      { id: 'l1', round: 2, a: ['l', 'q1'], b: ['l', 'q2'], label: '패자조 1라운드' },
      { id: 'l2', round: 2, a: ['l', 'q3'], b: ['l', 'q4'], label: '패자조 1라운드' },
      { id: 'l3', round: 3, a: ['l', 'u1'], b: ['w', 'l2'], label: '패자조 2라운드' },
      { id: 'l4', round: 3, a: ['l', 'u2'], b: ['w', 'l1'], label: '패자조 2라운드' },
      { id: 'uf', round: 3, a: ['w', 'u1'], b: ['w', 'u2'], label: '승자조 결승' },
      { id: 'l5', round: 4, a: ['w', 'l3'], b: ['w', 'l4'], label: '패자조 3라운드' },
      { id: 'lf', round: 5, a: ['l', 'uf'], b: ['w', 'l5'], label: '패자조 결승' },
      { id: 'gf', round: 6, a: ['w', 'uf'], b: ['w', 'lf'], label: '결승전' },
    ],
    place: [['w', 'gf'], ['l', 'gf'], ['l', 'lf'], ['l', 'l5'], ['l', 'l3'], ['l', 'l4'], ['l', 'l1'], ['l', 'l2']],
  },
  SE8: {
    nodes: [
      { id: 'q1', round: 1, a: ['s', 1], b: ['s', 8], label: '8강' },
      { id: 'q2', round: 1, a: ['s', 4], b: ['s', 5], label: '8강' },
      { id: 'q3', round: 1, a: ['s', 2], b: ['s', 7], label: '8강' },
      { id: 'q4', round: 1, a: ['s', 3], b: ['s', 6], label: '8강' },
      { id: 's1', round: 2, a: ['w', 'q1'], b: ['w', 'q2'], label: '4강' },
      { id: 's2', round: 2, a: ['w', 'q3'], b: ['w', 'q4'], label: '4강' },
      { id: 'f', round: 3, a: ['w', 's1'], b: ['w', 's2'], label: '결승전' },
    ],
    place: [['w', 'f'], ['l', 'f'], ['l', 's1'], ['l', 's2'], ['l', 'q1'], ['l', 'q2'], ['l', 'q3'], ['l', 'q4']],
  },
  SE4: {
    nodes: [
      { id: 's1', round: 1, a: ['s', 1], b: ['s', 4], label: '4강' },
      { id: 's2', round: 1, a: ['s', 2], b: ['s', 3], label: '4강' },
      { id: 'f', round: 2, a: ['w', 's1'], b: ['w', 's2'], label: '결승전' },
    ],
    place: [['w', 'f'], ['l', 'f'], ['l', 's1'], ['l', 's2']],
  },
  GSL: {
    nodes: [
      { id: 'o1', round: 1, a: ['s', 1], b: ['s', 4], label: '개막전' },
      { id: 'o2', round: 1, a: ['s', 2], b: ['s', 3], label: '개막전' },
      { id: 'wm', round: 2, a: ['w', 'o1'], b: ['w', 'o2'], label: '승자전' },
      { id: 'em', round: 2, a: ['l', 'o1'], b: ['l', 'o2'], label: '패자전' },
      { id: 'dm', round: 3, a: ['l', 'wm'], b: ['w', 'em'], label: '최종전' },
    ],
    place: [['w', 'wm'], ['w', 'dm'], ['l', 'dm'], ['l', 'em']],
  },
};

// 브래킷 객체 생성: seeds = [팀id,...] (1번 시드부터)
export function newBracket(type, seeds, bo, prefix = '') {
  return { type, seeds, bo, prefix, nodes: {}, done: false, placements: null };
}

function seedIndex(bracket, id) { const i = bracket.seeds.indexOf(id); return i < 0 ? 99 : i; }

function resolveSrc(bracket, src, comp) {
  const [k, v] = src;
  if (k === 's') return bracket.seeds[v - 1] || null;
  const getM = nid => comp.matches.find(m => m.id === bracket.nodes[nid]);
  if (k === 'w' || k === 'l') { const m = getM(v); return m && m.done ? (k === 'w' ? m.winner : m.loser) : undefined; }
  if (k === 'lowW' || k === 'highW') {
    const ms = v.map(getM);
    if (ms.some(m => !m || !m.done)) return undefined;
    const ws = ms.map(m => m.winner).sort((a, b) => seedIndex(bracket, a) - seedIndex(bracket, b));
    return k === 'lowW' ? ws[ws.length - 1] : ws[0];
  }
  return undefined;
}

// 준비된 노드의 경기 생성. 새로 만들어진 경기 배열 반환
export function advanceBracket(comp, bracket, extra = {}) {
  const def = BRACKETS[bracket.type];
  const created = [];
  for (const node of def.nodes) {
    if (bracket.nodes[node.id]) continue;
    const a = resolveSrc(bracket, node.a, comp), b = resolveSrc(bracket, node.b, comp);
    if (a === undefined || b === undefined) continue;
    const bo = typeof bracket.bo === 'function' ? bracket.bo(node) : (node.id === 'gf' || node.id === 'f') && bracket.finalBo ? bracket.finalBo : bracket.bo;
    const m = mkMatch(comp, a, b, bo, { label: (bracket.prefix ? bracket.prefix + ' ' : '') + node.label, node: node.id, round: node.round, bracket: bracket.key || bracket.type, ...extra });
    bracket.nodes[node.id] = m.id;
    created.push(m);
  }
  // 완료 확인
  const allDone = def.nodes.every(n => { const id = bracket.nodes[n.id]; const m = id && comp.matches.find(x => x.id === id); return m && m.done; });
  if (allDone && !bracket.done) {
    bracket.done = true;
    bracket.placements = def.place.map(src => resolveSrc(bracket, src, comp));
  }
  return created;
}

// 플레이-인 건틀릿: teams(시드 순) 중 slots 팀 진출. 상태 객체로 관리
export function newGauntlet(teams, slots, bo, key = 'playin') {
  return { key, teams: teams.slice(), slots, bo, rounds: [], qualified: [], eliminated: [], pool: teams.slice(), done: false };
}
export function advanceGauntlet(comp, gt, extra = {}) {
  if (gt.done) return [];
  const last = gt.rounds[gt.rounds.length - 1];
  if (last) {
    const ms = last.ids.map(id => comp.matches.find(m => m.id === id));
    if (ms.some(m => !m.done)) return [];
    const winners = ms.map(m => m.winner), losers = ms.map(m => m.loser);
    if (last.mode === 'qualify') {
      gt.qualified.push(...winners);
      if (last.bye) gt.qualified.push(last.bye);
      gt.pool = losers;
    } else {
      gt.eliminated.push(...losers);
      gt.pool = winners.concat(last.bye ? [last.bye] : []);
    }
  }
  const need = gt.slots - gt.qualified.length;
  if (need <= 0) { gt.eliminated.push(...gt.pool); gt.pool = []; gt.done = true; return []; }
  const pool = gt.pool.slice().sort((a, b) => gt.teams.indexOf(a) - gt.teams.indexOf(b));
  if (need >= pool.length) { gt.qualified.push(...pool); gt.pool = []; gt.done = true; return []; }
  const pairs = Math.floor(pool.length / 2);
  let mode, bye = null;
  if (need >= pairs) {
    mode = 'qualify';
    if (pool.length % 2) { if (need > pairs) bye = pool.shift(); else gt.eliminated.push(pool.pop()); }
  } else {
    mode = 'elim';
    if (pool.length % 2) bye = pool.shift();
  }
  const ids = [], created = [];
  for (let i = 0; i < pool.length / 2; i++) {
    const m = mkMatch(comp, pool[i], pool[pool.length - 1 - i], gt.bo, { label: mode === 'qualify' ? (gt.rounds.length ? '플레이-인 최종 진출전' : '플레이-인 진출전') : '플레이-인', round: gt.rounds.length + 1, ...extra });
    created.push(m); ids.push(m.id);
  }
  gt.rounds.push({ ids, mode, bye });
  return created;
}
