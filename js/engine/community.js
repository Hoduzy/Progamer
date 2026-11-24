// 커뮤니티: 글·댓글·대댓글 생성, 템플릿 쿨타임, 문장 변형기, 고정 유저(고닉) 호감도, 수위 필터, 인터뷰
// 데이터: data/community/ (titles·bodies·comments·replies·users·words·interview)
import { CONFIG } from '../config.js';
import { clamp, avg, fill, dateDiff, POS_KO } from '../core/util.js';
import * as D from '../../data/community/index.js';
import { champName } from '../../data/champions.js';
import { teamInfo } from './roster.js';
import { competitorOf } from './state.js';
import { allMatches, userRef, lckRegularStandings } from './season.js';
import { sortStandings } from './tournament.js';
import { ovr } from './players.js';
import { KO_OF } from '../../data/rosters.js';

const C = () => CONFIG.community;

// ---------- 템플릿 정리 ----------
const KIND_ALIAS = { other: 'otherTeam', big: 'bigMatch', stand: 'standings', meta: 'meta', rumor: 'rumor', intl: 'intl', q: 'question', any: 'any' };
// '@' 태그 없는 댓글이 달리는 글 종류 (경기·선수 이야기)
export const ME_KINDS = ['review', 'myGood', 'myBad', 'anti', 'fan', 'compare', 'meme', 'story'];
export const POST_KINDS = ['review', 'myGood', 'myBad', 'otherTeam', 'bigMatch', 'standings', 'meta', 'compare', 'rumor', 'intl', 'meme', 'question', 'anti', 'fan'];

function hash(s) { let h = 2166136261; for (const ch of s) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } return h.toString(36); }
const VAR_RE = /\{([^{}]+)\}/g;
function compile(src, cat, entry) {
  const [tagStr, text] = Array.isArray(entry) ? entry : ['', entry];
  const tags = tagStr.split(/\s+/).filter(Boolean);
  const need = [], not = [], kinds = [];
  let story = null;
  for (const t of tags) {
    if (t.startsWith('@')) kinds.push(KIND_ALIAS[t.slice(1)] || t.slice(1));
    else if (t.startsWith('!')) not.push(t.slice(1));
    else if (t.startsWith('story:')) story = t.slice(6);
    else need.push(t);
  }
  const vars = [...new Set([...text.matchAll(VAR_RE)].map(m => m[1]))];
  return { id: `${src}.${cat}.${hash(text)}`, src, cat, text, need, not, kinds, vars, story };
}
function compileAll(src, obj) { const out = []; for (const [cat, list] of Object.entries(obj)) for (const e of list) out.push(compile(src, cat, e)); return out; }
export const TPL = { t: compileAll('t', D.TITLES), b: compileAll('b', D.BODIES), c: compileAll('c', D.COMMENTS), r: compileAll('r', D.REPLIES) };
export function templateCounts() {
  // 고닉 이야기·마지못해 인정 같은 특수 템플릿도 모두 센다
  return { titles: TPL.t.length, bodies: TPL.b.length, comments: TPL.c.length, replies: TPL.r.length };
}

function fits(tp, facts, vars) {
  for (const n of tp.need) if (!facts.has(n)) return false;
  for (const n of tp.not) if (facts.has(n)) return false;
  for (const v of tp.vars) if (vars[v] === undefined || vars[v] === null || vars[v] === '') return false;
  return true;
}
function fitsKind(tp, kind) {
  if (!tp.kinds.length) return ME_KINDS.includes(kind);
  return tp.kinds.includes('any') || tp.kinds.includes(kind);
}

// ---------- 저장 상태 (세이브에 들어감) ----------
function logOf(state) {
  if (!state.commLog) state.commLog = { seq: { t: 0, b: 0, c: 0, r: 0 }, last: {}, forced: 0, stories: [], interview: null };
  const L = state.commLog;
  if (!L.seq) L.seq = { t: 0, b: 0, c: 0, r: 0 };
  if (!L.last) L.last = {};
  if (!L.stories) L.stories = [];
  return L;
}
export function commUsers(state) {
  if (!state.commUsers) state.commUsers = {};
  for (const u of D.FIXED_USERS) if (!state.commUsers[u.id]) state.commUsers[u.id] = { favor: u.favor, cat: catOf(u.favor), seen: 0 };
  return state.commUsers;
}
const catOf = f => (f >= C().fanAt ? 'fan' : f <= C().antiAt ? 'anti' : 'mid');

// 쿨타임 안 지난 템플릿 우선, 다 쿨타임이면 가장 오래전에 쓴 것
function pickTpl(state, rng, src, groups, block) {
  const L = logOf(state);
  const cd = C().cooldown[src];
  const seq = L.seq[src];
  for (const cands of groups) {
    const avail = cands.filter(t => !block.has(t.id) && (L.last[t.id] === undefined || seq - L.last[t.id] >= cd));
    if (avail.length) return useTpl(L, src, rng.pick(avail));
  }
  const all = groups.flat().filter(t => !block.has(t.id));
  if (!all.length) return null;
  all.sort((a, b) => (L.last[a.id] ?? -1e9) - (L.last[b.id] ?? -1e9));
  L.forced = (L.forced || 0) + 1;
  return useTpl(L, src, all[0]);
}
function useTpl(L, src, tp) { L.last[tp.id] = L.seq[src]; L.seq[src]++; return tp; }

// ---------- 문장 변형기 ----------
// 변수 뒤 조사를 값에 맞게 (케티이 → 케티가, Starling가 → Starling이)
function hasBatchim(word) {
  const w = String(word).trim();
  const ch = w[w.length - 1] || '';
  const c = ch.charCodeAt(0);
  if (c >= 0xac00 && c <= 0xd7a3) return (c - 0xac00) % 28 !== 0;
  if (/[0-9]/.test(ch)) return '013678'.includes(ch);   // 영 일 삼 육 칠 팔
  return /(ng|[lmn])$/i.test(w);
}
const JOSA = { 이: ['이', '가'], 가: ['이', '가'], 은: ['은', '는'], 는: ['은', '는'], 을: ['을', '를'], 를: ['을', '를'], 과: ['과', '와'], 와: ['과', '와'], 이랑: ['이랑', '랑'], 랑: ['이랑', '랑'], 으로: ['으로', '로'], 로: ['으로', '로'] };
const COPULA = { 이었: '였', 이면: '면', 이라: '라', 이냐: '냐', 이네: '네', 이지: '지', 이야: '야' };
export const fillK = (text, vars) => text.replace(/\{([^{}]+)\}(이었|이면|이라|이냐|이네|이지|이야)/g, (m, k, j) => {
  if (vars[k] === undefined || vars[k] === null) return m;
  const val = String(vars[k]);
  return val + (hasBatchim(val) ? j : COPULA[j]);
}).replace(/\{([^{}]+)\}(이랑|으로|이|가|은|는|을|를|과|와|랑|로)?(?=[\s.,!?~)\]]|$)/g, (m, k, j) => {
  if (vars[k] === undefined || vars[k] === null) return m;
  const val = String(vars[k]);
  if (!j) return val;
  const b = hasBatchim(val);
  let out = b ? JOSA[j][0] : JOSA[j][1];
  if (j === '로' || j === '으로') {
    const c = val.charCodeAt(val.length - 1);
    const rieul = c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 === 8;   // ㄹ 받침은 '로'
    out = b && !rieul && !/l$/i.test(val) ? '으로' : '로';
  }
  return val + out;
}).replace(VAR_RE, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));
const TRAIL = /[\s.!?~;ㅋㅎㅠ♡]+$/;
export function vary(text, mood, rng, strength = 1) {
  let s = text;
  if (rng.chance(0.28 * strength)) {
    const opts = D.CHOSUNG.filter(([w]) => s.includes(w));
    if (opts.length) { const [w, to] = rng.pick(opts); s = s.replace(w, rng.pick(to)); }
  }
  if (rng.chance(0.12 * strength)) {
    const opts = D.TYPOS.filter(([w]) => s.includes(w));
    if (opts.length) { const [w, to] = rng.pick(opts); s = s.replace(w, to); }
  }
  if (strength >= 1 && rng.chance(0.1) && s.length < 22) s = s.replace(/\s+/g, '');
  if (strength >= 1 && rng.chance(0.12)) s = rng.pick(['아 ', '와 ', '솔직히 ', '근데 ', 'ㄹㅇ ', '그니까 ', '아니 ']) + s;
  const ends = D.ENDINGS[mood] || D.ENDINGS.plain;
  if (rng.chance(0.65 * Math.min(1, strength))) {
    const e = rng.pick(ends);
    const laughEnd = /[ㅋㅎ]$/.test(s.replace(/[\s.!?~]+$/, ''));
    if (e && !(laughEnd && /^[ㅋㅎ]/.test(e))) {
      let base = rng.chance(0.5) ? s.replace(TRAIL, '') : s;
      if (!base) base = s;
      const sp = /^[가-힣]/.test(e) ? ' ' : /^[ㄱ-ㅎㅏ-ㅣ]/.test(e) ? (rng.chance(0.5) ? ' ' : '') : '';
      s = base + sp + e;
    }
  }
  return s.replace(/\s{2,}/g, ' ').trim();
}

// ---------- 수위 (화면에서 적용) ----------
export function toneText(text, tone) {
  if (!tone || tone === 'spicy') return text;
  let s = text;
  for (const r of D.TONE_RULES) s = s.replace(r.re, tone === 'mild' ? r.mild : r.normal);
  return s.replace(/\s{2,}/g, ' ').replace(/^\s+|\s+$/g, '') || 'ㅇㅇ';
}

// ---------- 닉네임 ----------
function randomNick(rng) {
  const r = rng.next();
  if (r < 0.18) return rng.pick(D.NICK_FIXED) + (rng.chance(0.6) ? `(${rng.int(1, 223)}.${rng.int(10, 250)})` : '');
  const a = rng.pick(D.NICK_A), b = rng.pick(D.NICK_B);
  return a + b + (rng.chance(0.45) ? rng.int(1, 999) : '');
}

// ---------- 경기 정보 → 사실(태그)·변수 ----------
const tName = (state, ref) => { const t = teamInfo(state, ref); return t ? (D.TEAM_NICK[t.code] || t.name) : null; };
// 시리즈가 끝난 뒤 글에 필요한 정보 (UI·검사 도구 공용)
export function seriesPostInfo(state, match, opts = {}) {
  const u = state.players[state.user.pid];
  const comp = state.season.comps[match.compId];
  const myRef = match.teams.find(t => t.replace(':A', '') === u.teamId);
  const oppRef = match.teams.find(t => t !== myRef);
  const mi = match.teams.indexOf(myRef);
  const win = match.winner === myRef;
  const myGames = match.games.filter(g => g.me);
  const logs = state.user.matchLog.slice(0, myGames.length);
  const played = opts.played !== undefined ? opts.played && logs.length > 0 : logs.length > 0;
  const rating = played ? avg(logs.map(l => l.rating)) : null;
  const kda = played ? `${logs.reduce((a, l) => a + l.k, 0)}/${logs.reduce((a, l) => a + l.d, 0)}/${logs.reduce((a, l) => a + l.a, 0)}` : '';
  const champ = played ? logs[0].champ : null;
  const xs = myGames.map(g => g.x).filter(Boolean);
  return {
    played, win, rating, kda, champ, pog: played && logs.some(l => l.pog), moment: opts.moment || null,
    opp: teamInfo(state, oppRef).name, oppRef, myRef, score: `${match.wins[mi]}:${match.wins[1 - mi]}`,
    myWins: match.wins[mi], oppWins: match.wins[1 - mi], bo: match.bo || 1,
    compId: comp.id, compName: comp.name, compShort: comp.short || comp.name, cl: comp.league === 'CL', league: comp.league,
    stage: match.stage || comp.stage, label: match.label || '',
    dur: avg(match.games.map(g => g.d || 0)),
    laneOpp: xs.length ? xs[xs.length - 1].ln : null,
    lo: xs.length ? Math.min(...xs.map(x => x.lo)) : 0, hi: xs.length ? Math.max(...xs.map(x => x.hi)) : 0,
    myBarons: xs.reduce((a, x) => a + x.mb, 0), oppBarons: xs.reduce((a, x) => a + x.ob, 0),
    myElders: xs.reduce((a, x) => a + x.me, 0), oppElders: xs.reduce((a, x) => a + x.oe, 0), soul: xs.map(x => x.soul).find(Boolean) || null,
    ks: xs.reduce((a, x) => a + (x.ks || 0), 0),
  };
}

function teamStreak(state) {
  const log = state.user.matchLog;
  if (!log.length) return { w: 0, l: 0 };
  const first = log[0].win;
  let n = 0;
  for (const m of log) { if (m.win !== first) break; n++; }
  return first ? { w: n, l: 0 } : { w: 0, l: n };
}
function myRank(state, info) {
  const comp = state.season.comps[info.compId];
  if (!comp || !comp.standings) return null;
  const order = sortStandings({ ...comp.standings }, comp.matches);
  const i = order.indexOf(info.myRef);
  return i >= 0 ? i + 1 : null;
}
function nextOpp(state) {
  const ref = userRef(state);
  if (!ref) return null;
  const ms = allMatches(state).filter(m => !m.done && m.date && m.date >= state.date && m.teams.includes(ref) && m.teams.every(Boolean)).sort((a, b) => (a.date < b.date ? -1 : 1));
  if (!ms.length || dateDiff(state.date, ms[0].date) > 14) return null;
  return tName(state, ms[0].teams.find(t => t !== ref));
}
function intlName(state) {
  const C2 = state.season.comps;
  const list = ['fs', 'msi', 'worlds'].map(id => C2[id]).filter(Boolean);
  const cur = list.find(c => !c.result && c.matches.some(m => m.done));
  if (cur) return cur.short || cur.name;
  const up = list.find(c => !c.result);
  return up ? (up.short || up.name) : null;
}
function otherTeams(state, info, rng) {
  const myTeam = state.players[state.user.pid].teamId;
  const comp = state.season.comps[info.compId];
  let ids = comp && comp.standings ? Object.keys(comp.standings) : [];
  ids = ids.map(r => r.replace(':A', '')).filter(id => id !== myTeam && id !== (info.oppRef || '').replace(':A', ''));
  if (ids.length < 2) ids = Object.keys(state.teams).filter(id => state.teams[id].region === 'LCK' && id !== myTeam);
  const a = rng.pick(ids), b = rng.pick(ids.filter(x => x !== a));
  return [a, b];
}
// 실제 로스터 선수는 커뮤니티에서 한글 표기도 섞어 쓴다 (예: Faker / 페이커)
function callName(nick, rng) {
  const ko = nick && KO_OF[nick.toLowerCase()];
  return ko && rng.chance(C().koShare) ? ko : nick;
}
function starOf(state, teamId, pos, rng) {
  const t = state.teams[teamId];
  if (!t || !t.squadOf) return null;
  const ids = Object.keys(t.squadOf).filter(id => t.squadOf[id] === 'main' && state.players[id]);
  if (!ids.length) return null;
  const same = ids.filter(id => state.players[id].pos === pos);
  const pool = same.length && rng.chance(0.6) ? same : ids;
  pool.sort((a, b) => ovr(state.players[b]) - ovr(state.players[a]));
  return callName(state.players[pool[0]].nick, rng);
}

// 별명이 붙은 슈퍼스타 (사용자 제외): {슈퍼스타} {별명} {슈퍼스타팀}, 사용자 별명: {내별명}
function superstarVars(state, rng, u) {
  const stars = Object.values(state.players).filter(p => p.alias && !p.isUser && p.teamId && state.teams[p.teamId] && p.squad === 'main');
  const lck = stars.filter(p => state.teams[p.teamId].region === 'LCK');
  const s = (lck.length && rng.chance(0.75)) ? rng.pick(lck) : stars.length ? rng.pick(stars) : null;
  const t = s && state.teams[s.teamId];
  return {
    슈퍼스타: s ? callName(s.nick, rng) : null, 별명: s ? s.alias : null, 슈퍼스타팀: t ? (D.TEAM_NICK[t.code] || t.name) : null,
    내별명: u.alias || null,
  };
}

export function buildContext(state, rng, info = {}) {
  const u = state.players[state.user.pid];
  const team = u.teamId ? state.teams[u.teamId] : null;
  const facts = new Set();
  const add = (c, f) => { if (c) facts.add(f); };
  const rivalId = competitorOf(state);
  const st = teamStreak(state);
  const L = logOf(state);
  const hasMatch = info.myRef !== undefined;
  if (hasMatch) {
    add(info.played, 'played'); add(!info.played, 'bench');
    add(info.win, 'win'); add(!info.win, 'lose');
    if (info.played) {
      add(info.rating >= 7.0, 'good'); add(info.rating < 6.0, 'bad');
      add(info.rating >= 8.3 || (info.pog && info.rating >= 7.8), 'great'); add(info.rating < 5.0, 'awful');
      add(info.pog, 'pog');
    }
    add(info.win && info.lo <= -C().comebackGold, 'comeback');
    add(!info.win && info.hi >= C().comebackGold, 'thrown');
    add(info.win && info.oppWins === 0 && (info.bo > 1 || info.dur < 27 * 60), 'stomp');
    add(!info.win && info.myWins === 0 && info.bo > 1, 'swept');
    add(info.bo > 1 && Math.abs(info.myWins - info.oppWins) === 1 && info.myWins + info.oppWins === info.bo, 'close');
    add(info.cl, 'cl'); add(info.league === 'LCK', 'lck'); add(info.league === 'INTL' || ['fs', 'msi', 'worlds'].includes(info.compId), 'intl');
    add(/po|playoff|knock|bracket|final/i.test(String(info.stage) + info.compId) || /플레이오프|결승|4강|8강/.test(info.label), 'playoff');
    add(/결승/.test(info.label), 'final');
    add(info.win && info.myBarons > 0, 'baron'); add(info.win && info.myElders > 0, 'elder');
    add(info.ks > 0, 'ks');   // 우리 서폿이 원딜 킬을 가져감
  } else add(!!team && !(u.season && u.season.games), 'bench');
  add(st.w >= 3, 'streakW'); add(st.l >= 3, 'streakL');
  add(state.season.nextPatch && dateDiff(state.date, state.season.nextPatch) >= CONFIG.patch.everyDays - 7, 'patch');
  add(u.age <= 19 || (state.records && state.records.seasons.length === 0 && u.age <= 20), 'rookie');
  add(L.interview && L.interview.kind === 'provoke' && dateDiff(L.interview.date, state.date) <= 14, 'provoked');
  add(L.interview && L.interview.kind === 'humble' && dateDiff(L.interview.date, state.date) <= 10, 'humble');
  add(!!rivalId, 'rival');
  add(!!state.fa || (u.contract && u.contract.endSeason && u.contract.endSeason <= state.year && /-(0[89]|1[0-2])-/.test(state.date)), 'fa');
  add(u.squad === 'academy', 'academy');

  const [o1, o2] = otherTeams(state, info, rng);
  const metaOP = Object.entries(state.meta.tiers || {}).filter(([, t]) => t === 'OP').map(([id]) => id);
  const meta1 = Object.entries(state.meta.tiers || {}).filter(([, t]) => t === '1').map(([id]) => id);
  const objective = hasMatch ? (info.win ? (info.myElders ? '장로' : info.myBarons ? '바론' : info.soul ? '드래곤 영혼' : rng.pick(['드래곤', '전령', '유충'])) : (info.oppElders ? '장로' : info.oppBarons ? '바론' : rng.pick(['드래곤', '전령']))) : rng.pick(['바론', '드래곤', '장로']);
  const vars = {
    선수: u.nick, 팀: team ? (D.TEAM_NICK[team.code] || team.name) : null, 포지션: POS_KO[u.pos],
    상대팀: hasMatch ? tName(state, info.oppRef) : null, 스코어: hasMatch ? info.score : null,
    챔피언: info.champ ? champName(info.champ) : null, KDA: info.played ? info.kda : null, 평점: info.played ? info.rating.toFixed(1) : null,
    분: hasMatch && info.dur ? Math.round(info.dur / 60) : null, 오브젝트: objective, 대회: hasMatch ? info.compShort : null,
    라이벌: rivalId ? callName(state.players[rivalId].nick, rng) : null, 상대선수: info.played && info.laneOpp ? callName(info.laneOpp, rng) : null, 장면: info.moment || null,
    다른팀: o1 ? (D.TEAM_NICK[o1] || state.teams[o1].name) : null, 다른팀2: o2 ? (D.TEAM_NICK[o2] || state.teams[o2].name) : null,
    다른선수: o1 ? starOf(state, o1, u.pos, rng) : null,
    ...superstarVars(state, rng, u),
    순위: hasMatch ? myRank(state, info) : null,
    메타챔: (metaOP.length || meta1.length) ? champName(rng.pick(metaOP.length ? metaOP : meta1)) : null, 패치: state.meta.version,
    다음상대: nextOpp(state), 연승: st.w >= 2 ? st.w : null, 연패: st.l >= 2 ? st.l : null, 국제대회: intlName(state),
  };
  return { facts, vars, info, hasMatch };
}

// ---------- 고정 유저 ----------
const userDef = id => D.FIXED_USERS.find(u => u.id === id);
function behavior(state, def) {
  const c = commUsers(state)[def.id].cat;
  return c === 'fan' || c === 'anti' ? c : def.role;
}
function withTic(text, def, vars, rng) {
  const r = rng.next();
  if (r < 0.3) { const p = fillK(rng.pick(def.pre), vars); if (p) return `${p} ${text}`; }
  else if (r < 0.65) { const p = fillK(rng.pick(def.post), vars); if (p && !/\{/.test(p)) return `${text} ${p}`; }
  return text;
}

// 고닉 호감도 변화 (천천히) — 이야기 거리(돌아섬)는 다음 글 생성 때 글로 올라온다
export function updateFavor(state, ev, info = {}) {
  const users = commUsers(state);
  const L = logOf(state);
  for (const def of D.FIXED_USERS) {
    const s = users[def.id];
    const beh = s.cat;
    let d = 0;
    if (ev === 'series') {
      if (info.played) d = ((info.rating - 6.6) * 1.6 + (info.win ? 0.6 : -0.6) + (info.pog ? 1.2 : 0)) * C().favorRate;
      else d = def.role === 'fan' ? -0.15 : 0;
      // 이미 안티·팬인 사람은 같은 방향으로는 덜 움직인다 (끝까지 쏠리지 않게)
      if (beh === 'anti') d *= d > 0 ? 0.6 : 0.4;
      if (beh === 'fan') d *= d < 0 ? (info.rating < 5 ? 1 : 0.5) : 0.4;
      if (def.role === 'analyst') d *= 1.2;
      else if (def.role !== 'anti' && def.role !== 'fan') d *= 0.6;
      if (def.role === 'teamFan' && info.oppRef && info.oppRef.replace(':A', '') === def.team && info.win) d -= 1.5;
      if (def.rivalFan && info.played) d -= 0.3;
      // 원래 성향으로 천천히 돌아가려는 힘 (확 돌아서지 않게)
      d += (def.favor - s.favor) * C().favorPull;
    } else if (ev === 'humble') d = beh === 'anti' ? 0.5 : 1.5;
    else if (ev === 'team') d = 1;
    else if (ev === 'provoke') {
      d = beh === 'anti' ? -3 : beh === 'fan' ? 1 : -2;
      if (def.role === 'teamFan' && info.oppRef && info.oppRef.replace(':A', '') === def.team) d -= 8;
    } else if (ev === 'controversy') d = beh === 'fan' ? -2 : beh === 'anti' ? -5 : -4;
    d = clamp(d, -C().favorStep, C().favorStep);
    s.favor = clamp(Math.round((s.favor + d) * 10) / 10, -100, 100);
    // 경계선 근처에서 왔다 갔다 하지 않게 여유를 둔다 (팬 되기 ≥ fanAt, 팬 그만두기 < fanAt - 15)
    const H = C().favorHyst;
    let cat = s.cat;
    if (s.favor >= C().fanAt) cat = 'fan';
    else if (s.favor <= C().antiAt) cat = 'anti';
    else if ((s.cat === 'fan' && s.favor < C().fanAt - H) || (s.cat === 'anti' && s.favor > C().antiAt + H)) cat = 'mid';
    if (cat !== s.cat) {
      const kind = cat === 'fan' ? 'turnFan' : s.cat === 'anti' && cat === 'mid' ? 'turnNeutral' : s.cat === 'fan' && cat === 'mid' ? 'leaveFan' : cat === 'anti' && (s.cat === 'fan' || def.role === 'fan') ? 'turnAnti' : null;
      s.storyAt = s.storyAt || {};
      if (kind && (!s.storyAt[kind] || dateDiff(s.storyAt[kind], state.date) >= 120)) { L.stories.push({ uid: def.id, kind, date: state.date }); s.storyAt[kind] = state.date; }
      s.cat = cat;
    }
  }
}

// ---------- 글 생성 ----------
const STANCE_W = {
  pos: { agree: 2, cheer: 2, joke: 1.5, info: 1, side: 1, sarcasm: 0.6, rebut: 0.6, ask: 0.5, curse: 0.3 },
  neg: { curse: 2, sarcasm: 1.5, rebut: 1, agree: 1.2, joke: 1, cheer: 0.8, info: 0.8, ask: 0.5, side: 0.4 },
  anti: { rebut: 1.4, shield: 1.4, agree: 1, curse: 1, sarcasm: 1, joke: 0.7 },
  fan: { cheer: 2, shield: 1, agree: 1, sarcasm: 0.8, rebut: 0.6, joke: 0.6 },
  topic: { agree: 1.5, rebut: 1.2, joke: 1, info: 1, ask: 0.8, side: 1, sarcasm: 0.8, curse: 0.6, cheer: 0.5 },
};
const NEAR = { agree: ['cheer', 'info'], rebut: ['sarcasm', 'info'], joke: ['sarcasm', 'agree'], info: ['agree', 'ask'], ask: ['info', 'agree'], side: ['cheer', 'agree'], sarcasm: ['joke', 'rebut'], cheer: ['agree', 'side'], curse: ['sarcasm', 'rebut'], anti: ['sarcasm', 'curse', 'rebut'], shield: ['cheer', 'rebut'], grudging: ['agree'] };
function wpick(rng, w) {
  const ent = Object.entries(w).filter(([, v]) => v > 0);
  let r = rng.next() * ent.reduce((a, [, v]) => a + v, 0);
  for (const [k, v] of ent) { if ((r -= v) <= 0) return k; }
  return ent[ent.length - 1][0];
}

function kindWeights(ctx, state) {
  const f = ctx.facts, v = ctx.vars, users = commUsers(state);
  const anyAnti = D.FIXED_USERS.some(d => users[d.id].cat === 'anti');
  const anyFan = D.FIXED_USERS.some(d => users[d.id].cat === 'fan');
  const me = f.has('played') || f.has('bench');
  return {
    review: ctx.hasMatch ? 2.5 : 0, myGood: f.has('played') && f.has('good') ? 2.5 : 0, myBad: f.has('played') && f.has('bad') ? 2.5 : 0,
    anti: anyAnti && me ? (f.has('bad') ? 2 : 1) : 0, fan: anyFan && me ? (f.has('good') ? 1.5 : 1) : 0,
    otherTeam: 1, bigMatch: v.다음상대 ? 1 : 0, standings: v.순위 ? 0.8 : 0, meta: f.has('patch') ? 0.7 : 0.25,
    compare: 0.8, rumor: f.has('fa') ? 1.2 : 0.35, intl: v.국제대회 ? (f.has('intl') ? 2 : 0.4) : 0,
    meme: 1, question: f.has('bench') ? 1.5 : 0.7,
  };
}

function makePost(state, rng, ctx, kind, story) {
  const { facts, vars } = ctx;
  const users = commUsers(state);
  // 작성자
  let who, uid = null;
  const pickUser = pred => { const c = D.FIXED_USERS.filter(d => pred(d)); return c.length ? rng.pick(c) : null; };
  let author = null;
  if (story) author = userDef(story.uid);
  else if (kind === 'anti') author = rng.chance(0.75) ? pickUser(d => users[d.id].cat === 'anti') : null;
  else if (kind === 'fan') author = rng.chance(0.7) ? pickUser(d => users[d.id].cat === 'fan') : null;
  else if (kind === 'otherTeam' || kind === 'standings') author = rng.chance(0.3) ? pickUser(d => d.role === 'teamFan') : null;
  else if (kind === 'meta' || kind === 'compare') author = rng.chance(0.3) ? pickUser(d => d.role === 'analyst') : null;
  else if (kind === 'question') author = rng.chance(0.35) ? pickUser(d => d.role === 'asker') : null;
  else if (kind === 'meme') author = rng.chance(0.25) ? pickUser(d => d.role === 'joker') : null;
  if (author) { who = author.nick; uid = author.id; } else who = randomNick(rng);
  const pv = { ...vars, 고닉: author ? author.nick : null };
  // 제목·본문
  const titleC = TPL.t.filter(t => (story ? t.story === story.kind : t.cat === kind && !t.story) && fits(t, facts, pv));
  const tt = pickTpl(state, rng, 't', [titleC], new Set());
  if (!tt) return null;
  const bodyC = TPL.b.filter(t => (story ? t.story === story.kind : t.cat === kind && !t.story) && fits(t, facts, pv));
  const bt = pickTpl(state, rng, 'b', [bodyC, TPL.b.filter(t => t.cat === 'question' && fits(t, facts, pv))], new Set());
  const title = vary(fillK(tt.text, pv), 'plain', rng, 0.35);
  const body = bt ? vary(fillK(bt.text, pv), 'plain', rng, 0.25) : '';
  const post = { id: `p${logOf(state).seq.t}`, date: state.date, kind, title, body, who, uid, tid: tt.id, bid: bt ? bt.id : null, up: 0, views: rng.int(200, 9000), comments: [] };
  if (story) { post.story = story.kind; users[story.uid].seen++; }
  // 댓글
  const blockC = new Set(), blockR = new Set();
  const posMood = facts.has('win') || facts.has('good');
  const W = story ? (story.kind === 'turnFan' || story.kind === 'turnNeutral' ? STANCE_W.fan : STANCE_W.anti)
    : kind === 'anti' ? STANCE_W.anti : kind === 'fan' ? STANCE_W.fan : ME_KINDS.includes(kind) ? (posMood ? STANCE_W.pos : STANCE_W.neg) : STANCE_W.topic;
  const nc = rng.int(C().commentsMin, C().commentsMax);
  const usedUsers = new Set(uid ? [uid] : []);
  const myPost = ME_KINDS.includes(kind);
  for (let i = 0; i < nc; i++) {
    // 작성자: 고닉 또는 랜덤 닉
    let def = null;
    if (rng.chance(C().fixedShare)) {
      const cands = D.FIXED_USERS.filter(d => !usedUsers.has(d.id));
      const wts = cands.map(d => {
        const beh = behavior(state, d);
        if (myPost) return beh === 'anti' || beh === 'fan' ? 3 : d.role === 'teamFan' ? 0.4 : 1;
        if (kind === 'otherTeam' || kind === 'standings' || kind === 'bigMatch') return d.role === 'teamFan' ? 3 : 1;
        return d.role === 'analyst' || d.role === 'joker' ? 2 : 1;
      });
      let r = rng.next() * wts.reduce((a, b) => a + b, 0);
      for (let k = 0; k < cands.length; k++) { if ((r -= wts[k]) <= 0) { def = cands[k]; break; } }
      if (def) usedUsers.add(def.id);
    }
    let stance;
    if (def) {
      const beh = behavior(state, def);
      if (myPost && beh === 'anti') stance = facts.has('great') && rng.chance(C().grudgingChance) ? 'grudging' : rng.pick(facts.has('bad') ? ['anti', 'curse', 'sarcasm'] : ['anti', 'anti', 'sarcasm']);
      else if (myPost && beh === 'fan') stance = facts.has('bad') ? rng.pick(['shield', 'shield', 'cheer']) : rng.pick(['cheer', 'shield', 'agree']);
      else stance = rng.pick(def.stances);
    } else stance = wpick(rng, W);
    const order = [stance, ...(NEAR[stance] || [])];
    const groups = order.map(st => TPL.c.filter(t => t.cat === st && fitsKind(t, kind) && fits(t, facts, pv)));
    // 그 성향 댓글이 다 쿨타임이면 이 글에 어울리는 다른 성향 댓글로 (안티·인정은 제외)
    groups.push(TPL.c.filter(t => t.cat !== 'grudging' && t.cat !== 'anti' && fitsKind(t, kind) && fits(t, facts, pv)));
    const ct = pickTpl(state, rng, 'c', groups, blockC);
    if (!ct) continue;
    blockC.add(ct.id);
    let text = vary(fillK(ct.text, pv), D.STANCE_MOOD[ct.cat], rng);
    if (def) text = withTic(text, def, pv, rng);
    post.comments.push({ who: def ? def.nick : randomNick(rng), uid: def ? def.id : null, text, stance: ct.cat, tid: ct.id, up: rng.int(0, ct.cat === 'curse' || ct.cat === 'joke' ? 160 : 90), replies: [] });
  }
  addThreads(state, rng, ctx, post, pv, blockR, kind);
  const totalUp = post.comments.reduce((a, c) => a + c.up, 0);
  post.up = rng.int(3, 60) + Math.round(totalUp / 4) + (facts.has('great') ? rng.int(50, 300) : 0);
  return post;
}

// 그 종류 대댓글이 다 쿨타임이면 넘어갈 종류
const REPLY_ALT = {
  vsAnti: ['counter', 'escalate'], vsFan: ['escalate', 'counter'], escalate: ['counter', 'vsFan', 'vsAnti'], counter: ['escalate'],
  calm: ['ok'], ok: ['jokeback', 'calm'], jokeback: ['ok'], answer: ['ok'], team: ['escalate', 'counter'],
};
// 대댓글: 안티 vs 팬, 다른 팀 팬끼리, 드립 받아치기, 질문 답 등
function addThreads(state, rng, ctx, post, pv, blockR, kind) {
  const users = commUsers(state);
  const fans = D.FIXED_USERS.filter(d => users[d.id].cat === 'fan');
  const antis = D.FIXED_USERS.filter(d => users[d.id].cat === 'anti');
  const teamFans = D.FIXED_USERS.filter(d => d.role === 'teamFan');
  const calmer = D.FIXED_USERS.find(d => d.id === 'n7');
  let budget = C().repliesMax;
  const say = (c, type, def, target) => {
    if (budget <= 0) return false;
    const cands = TPL.r.filter(t => t.cat === type && fits(t, ctx.facts, { ...pv, 대상: target }));
    const alt = REPLY_ALT[type] || ['escalate'];
    const groups = [cands, ...alt.map(a => TPL.r.filter(t => t.cat === a && fits(t, ctx.facts, { ...pv, 대상: target })))];
    const rt = pickTpl(state, rng, 'r', groups, blockR);
    if (!rt) return false;
    blockR.add(rt.id);
    let text = vary(fillK(rt.text, { ...pv, 대상: target }), D.STANCE_MOOD[type], rng);
    if (def) text = withTic(text, def, pv, rng);
    c.replies.push({ who: def ? def.nick : randomNick(rng), uid: def ? def.id : null, text, type, tid: rt.id, up: rng.int(0, 80) });
    budget--;
    return true;
  };
  const myPost = ME_KINDS.includes(kind);
  for (const c of post.comments) {
    if (budget <= 0) break;
    const st = c.stance;
    const authorDef = c.uid ? userDef(c.uid) : null;
    if (myPost && (st === 'anti' || st === 'curse') && rng.chance(fans.length ? C().fightAnti : 0.2)) {
      const fan = fans.filter(d => d.id !== c.uid);
      const f = fan.length && rng.chance(0.75) ? rng.pick(fan) : null;
      if (!say(c, 'vsAnti', f, c.who)) continue;
      const defender = c.replies[c.replies.length - 1];
      if (rng.chance(0.6)) say(c, rng.chance(0.5) ? 'vsFan' : 'escalate', authorDef && behavior(state, authorDef) === 'anti' ? authorDef : null, defender.who);
      if (rng.chance(0.45)) say(c, 'escalate', f, c.who);
      if (rng.chance(0.35)) say(c, 'calm', calmer && rng.chance(0.6) ? calmer : null, c.who);
    } else if (myPost && (st === 'shield' || st === 'cheer') && antis.length && rng.chance(C().fightFan)) {
      const a = rng.pick(antis.filter(d => d.id !== c.uid).concat(antis).slice(0, 4));
      if (!say(c, 'vsFan', a, c.who)) continue;
      if (rng.chance(0.55)) say(c, 'escalate', authorDef || null, a.nick);
      if (rng.chance(0.3)) say(c, 'calm', calmer && rng.chance(0.5) ? calmer : null, c.who);
    } else if (!myPost && (st === 'side' || (authorDef && authorDef.role === 'teamFan')) && rng.chance(C().fightTeam)) {
      const other = teamFans.filter(d => d.id !== c.uid);
      const t = other.length ? rng.pick(other) : null;
      if (!say(c, 'team', t, c.who)) continue;
      if (rng.chance(0.55)) say(c, 'team', authorDef, t ? t.nick : '그쪽');
      if (rng.chance(0.3)) say(c, 'calm', calmer && rng.chance(0.5) ? calmer : null, c.who);
    } else if (st === 'ask' && rng.chance(0.55)) say(c, 'answer', null, c.who);
    else if (st === 'joke' && rng.chance(0.22)) say(c, 'jokeback', null, c.who);
    else if (st === 'agree' && rng.chance(0.15)) say(c, 'ok', null, c.who);
    else if ((st === 'rebut' || st === 'sarcasm') && rng.chance(0.3)) { if (say(c, 'counter', null, c.who) && rng.chance(0.35)) say(c, 'escalate', authorDef, c.replies[c.replies.length - 1].who); }
  }
}

function storePosts(state, posts) {
  state.community = posts.concat(state.community || []).slice(0, C().keepPosts);
}

// 시리즈 직후 글 (UI hooks와 검사 도구 공용)
export function generatePosts(state, rng, info) {
  commUsers(state);
  if (info.myRef !== undefined) updateFavor(state, 'series', info);
  const ctx = buildContext(state, rng, info);
  const L = logOf(state);
  const posts = [];
  // 고닉 이야기 (돌아섬)
  while (L.stories.length && posts.length < 2) {
    const sto = L.stories.shift();
    // 쓸 수 있는 이야기 제목이 남아 있을 때만 (없으면 이야기 글은 건너뜀)
    const cd = C().cooldown.t, seq = L.seq.t;
    const pv = { ...ctx.vars, 고닉: userDef(sto.uid).nick };
    if (!TPL.t.some(t => t.story === sto.kind && fits(t, ctx.facts, pv) && (L.last[t.id] === undefined || seq - L.last[t.id] >= cd))) continue;
    const p = makePost(state, rng, ctx, sto.kind === 'turnFan' || sto.kind === 'turnNeutral' ? 'fan' : 'anti', sto);
    if (p) posts.push(p);
  }
  const n = rng.int(C().postsMin, C().postsMax);
  const W = kindWeights(ctx, state);
  const usedKinds = {};
  let guard = 0;
  while (posts.length < n && guard++ < 30) {
    const w = { ...W };
    for (const k of Object.keys(usedKinds)) w[k] *= 0.35;
    // 쓸 수 있는 제목이 남은 종류만
    for (const k of Object.keys(w)) if (w[k] > 0 && !hasFreshTitle(state, ctx, k)) w[k] = 0;
    if (!Object.values(w).some(v => v > 0)) break;
    const kind = wpick(rng, w);
    const p = makePost(state, rng, ctx, kind);
    if (p) { posts.push(p); usedKinds[kind] = (usedKinds[kind] || 0) + 1; }
  }
  storePosts(state, posts);
  return posts;
}
function hasFreshTitle(state, ctx, kind) {
  const L = logOf(state), cd = C().cooldown.t, seq = L.seq.t;
  return TPL.t.some(t => t.cat === kind && !t.story && fits(t, ctx.facts, ctx.vars) && (L.last[t.id] === undefined || seq - L.last[t.id] >= cd));
}

// 경기 없는 날의 글 (패치 등)
export function generateTopicPosts(state, rng, topic) {
  commUsers(state);
  const ctx = buildContext(state, rng, {});
  const kinds = (topic === 'patch' ? (rng.chance(0.6) ? ['meta'] : []) : [rng.pick(['otherTeam', 'meme', 'question'])]).filter(k => hasFreshTitle(state, ctx, k));
  const posts = kinds.map(k => makePost(state, rng, ctx, k)).filter(Boolean);
  storePosts(state, posts);
  return posts;
}

// 인터뷰·논란 반응 (호감도)
export function communityReact(state, ev, info = {}) {
  commUsers(state);
  if (ev === 'humble' || ev === 'provoke' || ev === 'team') logOf(state).interview = { kind: ev, date: state.date };
  updateFavor(state, ev, info);
}

// 고닉 목록 (화면용)
export function fixedUserList(state) {
  const users = commUsers(state);
  return D.FIXED_USERS.map(d => ({ ...d, favor: users[d.id].favor, cat: users[d.id].cat, now: behavior(state, d) }));
}

// ---------- 인터뷰 ----------
export function interviewQuestion(state, rng, info) {
  return fill(rng.pick(D.INTERVIEW_Q), { champ: info.champ ? champName(info.champ) : '', opp: info.opp || '상대' });
}
export function applyInterview(state, rng, kind, info) {
  const us = state.user, u = state.players[us.pid];
  const team = state.teams[u.teamId];
  const mates = Object.keys(team.squadOf).filter(id => id !== u.id && team.squadOf[id] === u.squad);
  const mate = mates.length ? state.players[rng.pick(mates)].nick : '팀원';
  const answer = fill(rng.pick(D.INTERVIEW_A[kind]), { opp: info.opp || '상대', mate });
  const lines = [];
  if (kind === 'humble') {
    us.fans += 300; us.popularity = clamp(us.popularity + 1, 0, 100); us.trust = clamp(us.trust + 2, 0, 100);
    lines.push('팬 +300', '인기도 +1', '감독 신뢰 +2', '팬들: "인성까지 갖췄네"');
  } else if (kind === 'provoke') {
    const hit = rng.chance(0.55);
    us.fans += hit ? 1800 : 400; us.popularity = clamp(us.popularity + (hit ? 3 : -1), 0, 100); us.trust = clamp(us.trust - 3, 0, 100);
    us.flags.provokedTeam = info.oppRef ? info.oppRef.replace(':A', '') : null;
    lines.push(hit ? '팬 +1,800 · 인기도 +3 · 도발이 화제가 됐다!' : '팬 +400 · 인기도 -1 · 건방지다는 반응도…', '감독 신뢰 -3', `⚠ ${info.opp}의 다음 맞대결 동기부여 상승`);
  } else {
    us.fans += 500; us.trust = clamp(us.trust + 2, 0, 100);
    for (const pid of mates) us.chem[pid] = clamp((us.chem[pid] || 0) + 3, 0, 100);
    lines.push('팬 +500', '감독 신뢰 +2', '팀 케미 +3');
  }
  communityReact(state, kind, info);
  return { answer, lines };
}
