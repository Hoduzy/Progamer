// 시즌 엔진: 대회 생성·일정·하루 진행·경기 시뮬레이션·기록
import { CONFIG } from '../config.js';
import { clamp, avg, dateAdd, dateDiff, weekday, POS } from '../core/util.js';
import { LCK_TEAMS, FIRST_CUP_GROUPS } from '../../data/teams.js';
import { createSeries, simSeries } from './series.js';
import { squadForSeries, teamInfo, isAcademyRef, teamIdOf, weeklyReview } from './roster.js';
import { mkMatch, newStandings, addResult, sortStandings, rrRounds, scheduleSequential, nextDay, newBracket, advanceBracket, newGauntlet, advanceGauntlet } from './tournament.js';
import { rollPatch } from './meta.js';
import { nightRecovery } from './daily.js';
import { growStat, growMastery, makePlayer, marketValue } from './players.js';
import { ovr, academyTarget } from '../stats.js';
import { addNews, addMsg } from './state.js';
import { champName } from '../../data/champions.js';
import * as intl from './international.js';
import { seriesPOM, compAwards } from './awards.js';

const LCK_DAYS = () => CONFIG.competitions.matchDays;
const CL_DAYS = [1, 2];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

export const COMP_INFO = {
  lckCup: { name: 'LCK컵', short: 'LCK컵', league: 'LCK' },
  fs: { name: 'First Stand', short: 'FS', league: 'INT' },
  lck12: { name: 'LCK 1~2라운드', short: 'LCK 1·2R', league: 'LCK' },
  rtm: { name: 'Road to MSI', short: 'RtMSI', league: 'LCK' },
  msi: { name: 'MSI', short: 'MSI', league: 'INT' },
  lck34: { name: 'LCK 3~4라운드', short: 'LCK 3·4R', league: 'LCK' },
  lckpo: { name: 'LCK 플레이오프', short: 'LCK PO', league: 'LCK' },
  worlds: { name: '월드 챔피언십', short: 'Worlds', league: 'INT' },
  cl12: { name: 'LCK CL 1~2라운드', short: 'CL 1·2R', league: 'CL' },
  cl34: { name: 'LCK CL 3~4라운드', short: 'CL 3·4R', league: 'CL' },
  clpo: { name: 'LCK CL 플레이오프', short: 'CL PO', league: 'CL' },
};

const md = (year, mmdd) => `${year}-${mmdd}`;

export function createSeason(state, rng) {
  const y = state.year;
  const C = CONFIG.competitions;
  const comps = {};
  const mk = (id, start, extra = {}) => { comps[id] = { id, ...COMP_INFO[id], start: md(y, start), started: false, done: false, stage: null, matches: [], result: null, ...extra }; };
  mk('lckCup', C.lckCup.start);
  mk('fs', C.firstStand.start, { city: C.firstStand.city });
  mk('lck12', C.lckR12.start);
  mk('rtm', C.roadToMsi.start);
  mk('msi', C.msi.start, { city: C.msi.city });
  mk('lck34', C.lckR34.start);
  mk('lckpo', C.lckPlayoffs.start);
  mk('worlds', C.worlds.start, { city: C.worlds.city });
  mk('cl12', C.cl12.start);
  mk('cl34', C.cl34.start);
  mk('clpo', C.clPlayoffs.start);
  state.season = {
    year: y, comps, order: ['lckCup', 'cl12', 'fs', 'lck12', 'rtm', 'msi', 'cl34', 'lck34', 'clpo', 'lckpo', 'worlds'],
    nextPatch: md(y, '01-07'), lastReview: state.date, regionReps: {}, finished: false,
    faStart: md(y, CONFIG.fa.startDate), faEnd: md(y, CONFIG.fa.endDate), phase: 'season',
  };
  state.season.cupGroups = state.prevStandings ? groupsFromStandings(state.prevStandings) : { ...FIRST_CUP_GROUPS };
  // 참가 팀이 정해진 대회는 미리 일정 생성
  for (const id of ['lckCup', 'cl12', 'lck12', 'cl34', 'lck34']) startComp(state, rng, comps[id]);
  return state.season;
}

function groupsFromStandings(order) {
  // 전 시즌 순위 지그재그: 1,4,5,8,9 → 바론 / 2,3,6,7,10 → 장로
  const baron = [], elder = [];
  order.forEach((id, i) => { const r = i % 4; (r === 0 || r === 3 ? baron : elder).push(id); });
  return { baron, elder };
}

export const lckIds = () => LCK_TEAMS.map(t => t.code);

// ---------------- 대회 시작 ----------------
function startComp(state, rng, comp) {
  comp.started = true;
  const C = CONFIG.competitions;
  switch (comp.id) {
    case 'lckCup': {
      const g = state.season.cupGroups;
      comp.groups = g; comp.stage = 'groups';
      comp.standings = newStandings([...g.baron, ...g.elder]);
      const rounds = [];
      for (let r = 0; r < 5; r++) rounds.push(g.baron.map((b, i) => [b, g.elder[(i + r) % 5]]));
      const ms = [];
      for (const rd of rounds) for (const [a, b] of rd) ms.push(mkMatch(comp, a, b, C.lckCup.groupBo, { label: '그룹 대항전' }));
      comp.cursor = scheduleSequential(ms, comp.start, LCK_DAYS(), C.seriesPerDay);
      break;
    }
    case 'lck12': case 'lck34': case 'cl12': case 'cl34': {
      const isCL = comp.id.startsWith('cl');
      const ids = lckIds().map(id => isCL ? id + ':A' : id);
      comp.stage = 'league';
      comp.standings = newStandings(ids);
      const bo = comp.id === 'lck34' ? C.lckR34.bo : comp.id === 'lck12' ? C.lckR12.bo : C.cl12.bo;
      const rounds = rrRounds(rng.shuffle(ids), true);
      const ms = [];
      rounds.forEach((rd, ri) => { for (const [a, b] of rd) ms.push(mkMatch(comp, a, b, bo, { label: `${ri < 9 ? (comp.id === 'lck34' || comp.id === 'cl34' ? 3 : 1) : (comp.id === 'lck34' || comp.id === 'cl34' ? 4 : 2)}라운드`, round: ri + 1 })); });
      comp.cursor = scheduleSequential(ms, comp.start, isCL ? CL_DAYS : LCK_DAYS(), isCL ? 3 : C.seriesPerDay);
      break;
    }
    default:
      intl.startComp(state, rng, comp, helpers);
  }
}

// ---------------- 대회 갱신 (경기 종료 후) ----------------
export function updateComp(state, rng, comp) {
  const C = CONFIG.competitions;
  if (comp.done) return;
  if (comp.id === 'lckCup') {
    if (comp.stage === 'groups' && comp.matches.every(m => m.done)) {
      const st = comp.standings;
      const tot = ids => ids.reduce((s, id) => s + st[id].w, 0);
      const gd = ids => ids.reduce((s, id) => s + st[id].gw - st[id].gl, 0);
      const bW = tot(comp.groups.baron), eW = tot(comp.groups.elder);
      const winGroup = bW > eW || (bW === eW && gd(comp.groups.baron) >= gd(comp.groups.elder)) ? 'baron' : 'elder';
      const loseGroup = winGroup === 'baron' ? 'elder' : 'baron';
      const sub = ids => { const s = {}; for (const id of ids) s[id] = st[id]; return s; };
      const W = sortStandings(sub(comp.groups[winGroup]), comp.matches), L = sortStandings(sub(comp.groups[loseGroup]), comp.matches);
      comp.groupResult = { winGroup, W, L, totals: { baron: bW, elder: eW } };
      comp.direct = [W[0], L[0], W[1]];
      comp.stage = 'playin';
      comp.gauntlet = newGauntlet([W[2], L[1], W[3], L[2]], 3, C.lckCup.playInBo);
      const ms = advanceGauntlet(comp, comp.gauntlet, { stage: 'playin' });
      comp.cursor = scheduleSequential(ms, nextDay(comp.cursor, LCK_DAYS(), 2), LCK_DAYS(), 2);
      addNews(state, `LCK컵 그룹 대항전 종료: ${winGroup === 'baron' ? '바론' : '장로'} 그룹 승리 (${bW}:${eW}). ${comp.direct.map(id => state.teams[id].name).join(', ')} 플레이오프 직행`, 'comp');
    } else if (comp.stage === 'playin') {
      const ms = advanceGauntlet(comp, comp.gauntlet, { stage: 'playin' });
      if (ms.length) comp.cursor = scheduleSequential(ms, nextDay(comp.cursor, LCK_DAYS()), LCK_DAYS(), 2);
      if (comp.gauntlet.done) {
        comp.stage = 'playoffs';
        comp.bracket = newBracket('DE6', [...comp.direct, ...comp.gauntlet.qualified], C.lckCup.playoffBo);
        const nm = advanceBracket(comp, comp.bracket, { stage: 'playoffs' });
        comp.cursor = scheduleSequential(nm, nextDay(comp.cursor, LCK_DAYS(), 3), LCK_DAYS(), 2);
      }
    } else if (comp.stage === 'playoffs') {
      advanceBracketScheduled(comp, comp.bracket, LCK_DAYS(), 1, { stage: 'playoffs' });
      if (comp.bracket.done) finishComp(state, comp, comp.bracket.placements);
    }
    return;
  }
  if (['lck12', 'lck34', 'cl12', 'cl34'].includes(comp.id)) {
    if (comp.matches.every(m => m.done)) finishComp(state, comp, sortStandings(comp.standings, comp.matches));
    return;
  }
  intl.updateComp(state, rng, comp, helpers);
}

// 브래킷 진행 + 새 경기 일정
export function advanceBracketScheduled(comp, bracket, days, perDay, extra) {
  const nm = advanceBracket(comp, bracket, extra);
  if (nm.length) {
    // 같은 라운드끼리 묶어서 다음 경기일부터
    nm.sort((a, b) => a.round - b.round);
    const lastDate = comp.matches.filter(m => m.done && m.date).map(m => m.date).sort().pop() || comp.cursor;
    const start = nextDay(lastDate > comp.cursor ? lastDate : comp.cursor, days);
    comp.cursor = scheduleSequential(nm, start, days, perDay);
  }
  return nm;
}

export function finishComp(state, comp, placements) {
  comp.done = true;
  comp.result = { placements, champion: placements[0] };
  const champ = placements[0];
  addNews(state, `🏆 ${comp.name} 우승: ${teamInfo(state, champ).name}!`, 'trophy');
  compAwards(state, comp);
  const u = state.players[state.user.pid];
  // 사용자 팀 성적 기록
  const myRef = u.teamId ? (comp.league === 'CL' ? u.teamId + ':A' : u.teamId) : null;
  if (myRef && placements.includes(myRef)) {
    const rank = placements.indexOf(myRef) + 1;
    state.user.career.push({ year: state.year, comp: comp.id, compName: comp.name, team: u.teamId, rank, squad: u.squad });
    if (rank === 1) {
      const played = comp.matches.some(m => m.games.some(gm => gm.me));
      state.user.trophies.push({ year: state.year, comp: comp.id, name: comp.name, team: u.teamId, played });
      addMsg(state, '구단', `${comp.name} 우승!`, played ? `${comp.name} 우승을 축하합니다! 당신의 활약이 컸습니다.` : `팀이 ${comp.name}에서 우승했습니다. 다음엔 무대 위에서 함께하자.`);
      state.user.fans += played ? CONFIG.fans.trophyBonus : Math.round(CONFIG.fans.trophyBonus / 5);
    }
  }
}

const helpers = { mkMatch, scheduleSequential, nextDay, newStandings, sortStandings, newBracket, advanceBracketScheduled, newGauntlet, advanceGauntlet, finishComp, addNews, addMsg, teamInfo, lckIds, LCK_DAYS, ALL_DAYS, CL_DAYS, rrRounds };

// ---------------- 조회 ----------------
export function allMatches(state) {
  const out = [];
  for (const id of state.season.order) out.push(...state.season.comps[id].matches);
  return out;
}
export function matchesOn(state, date) { return allMatches(state).filter(m => m.date === date); }
export function userRef(state) {
  const u = state.players[state.user.pid];
  if (!u.teamId) return null;
  return u.squad === 'academy' ? u.teamId + ':A' : u.teamId;
}
// 사용자 팀(현재 스쿼드)의 오늘 경기
export function userMatchOn(state, date) {
  const u = state.players[state.user.pid];
  if (!u.teamId) return null;
  const refs = [u.teamId, u.teamId + ':A'];
  const ref = userRef(state);
  return matchesOn(state, date).find(m => !m.done && m.teams.includes(ref)) || null;
}
export function nextUserMatch(state) {
  const ref = userRef(state);
  if (!ref) return null;
  return allMatches(state).filter(m => !m.done && m.date && m.date >= state.date && m.teams.includes(ref)).sort((a, b) => (a.date < b.date ? -1 : 1))[0] || null;
}
export function nextTeamMatch(state, teamId) {
  return allMatches(state).filter(m => !m.done && m.date && m.date >= state.date && (m.teams.includes(teamId))).sort((a, b) => (a.date < b.date ? -1 : 1))[0] || null;
}

// ---------------- 경기 시뮬레이션·기록 ----------------
export function buildSeries(state, match) {
  const comp = state.season.comps[match.compId];
  const teams = match.teams.map(ref => squadForSeries(state, ref));
  // 1세트 퍼스트 셀렉션: 시드 높은 팀 (순위표 기준, 없으면 첫 번째)
  let selector = 0;
  if (comp.standings) {
    const order = sortStandings(comp.standings, comp.matches);
    selector = order.indexOf(match.teams[0]) <= order.indexOf(match.teams[1]) ? 0 : 1;
  }
  return createSeries({ teams, bo: match.bo, selector, label: `${comp.short} ${match.label || ''}`.trim(), compId: comp.id, matchId: match.id });
}

export function simulateMatch(state, rng, match) {
  const s = buildSeries(state, match);
  simSeries(s, rng, state.meta);
  recordSeries(state, rng, match, s);
  return s;
}

// 커뮤니티 글에 쓰는 경기 사실 (내가 뛴 경기만): 라인 상대, 역전승/역전패, 오브젝트
function gameFacts(sum, upid) {
  const si = sum.sides.findIndex(sd => sd.players.some(p => p.pid === upid));
  const me = sum.sides[si].players.find(p => p.pid === upid);
  const opp = sum.sides[1 - si].players.find(p => p.pos === me.pos);
  const sign = si === 0 ? 1 : -1;                     // goldHist.diff 는 블루 - 레드
  const diffs = (sum.goldHist || []).map(h => h.diff * sign);
  const minD = Math.min(0, ...diffs), maxD = Math.max(0, ...diffs);
  const mine = sum.sides[si], theirs = sum.sides[1 - si];
  return { ln: opp ? opp.nick : null, lo: Math.round(minD), hi: Math.round(maxD), mb: mine.barons, ob: theirs.barons, me: mine.elders, oe: theirs.elders, soul: mine.soul || null, ks: mine.ks || 0 };
}

export function recordSeries(state, rng, match, s) {
  const comp = state.season.comps[match.compId];
  match.done = true;
  match.wins = s.wins.slice();
  match.winner = match.teams[s.winner];
  match.loser = match.teams[1 - s.winner];
  const upid = state.user ? state.user.pid : null;
  match.games = s.games.map(gm => {
    const blueRef = match.teams[gm.blueIdx], redRef = match.teams[1 - gm.blueIdx];
    const me = gm.summary.sides.some(sd => sd.players.some(p => p.pid === upid));
    return {
      w: match.teams[gm.winnerIdx], d: gm.duration, pog: gm.pog, blue: blueRef, red: redRef,
      k: gm.blueIdx === 0 ? [gm.summary.sides[0].kills, gm.summary.sides[1].kills] : [gm.summary.sides[1].kills, gm.summary.sides[0].kills],
      picks: me ? gm.summary.sides.map(sd => sd.players.map(p => p.champ)).flat().join(',') : undefined, me: me || undefined,
      x: me ? gameFacts(gm.summary, upid) : undefined,
    };
  });
  if (comp.standings && (comp.stage === 'groups' || comp.stage === 'league' || comp.stage === 'swiss')) addResult(comp.standings, match);
  // 선수 기록
  for (const gm of s.games) recordGameStats(state, rng, comp, gm);
  seriesPOM(state, comp, match, s);
  if (state.user.flags && state.user.flags.provokedTeam && match.teams.some(t => teamIdOf(t) === state.user.flags.provokedTeam)) state.user.flags.provokedTeam = null;
  // 뉴스 (LCK/국제 대회 + 사용자 팀)
  const ref = userRef(state);
  const myTeam = state.players[state.user.pid].teamId;
  const involvesMine = match.teams.some(t => teamIdOf(t) === myTeam);
  if (comp.league !== 'CL' || involvesMine) {
    const a = teamInfo(state, match.teams[0]), b = teamInfo(state, match.teams[1]);
    addNews(state, `[${comp.short}] ${a.name} ${match.wins[0]}:${match.wins[1]} ${b.name}${match.label ? ' · ' + match.label : ''}`, 'result', { matchId: match.id });
  }
  updateComp(state, rng, comp);
}

function recordGameStats(state, rng, comp, gm) {
  const sum = gm.summary, ratings = gm.ratings;
  const isLCKreg = comp.id === 'lck12' || comp.id === 'lck34';
  for (const [si, side] of sum.sides.entries()) {
    const win = sum.winner === si;
    for (const p of side.players) {
      const pl = state.players[p.pid];
      if (!pl) continue;
      const r = ratings[p.pid] ? ratings[p.pid].rating : 6;
      const S = pl.season;
      S.games++; if (win) S.wins++;
      S.k += p.k; S.d += p.d; S.a += p.a; S.cs += p.cs; S.ratingSum += r;
      S.champs[p.champ] = (S.champs[p.champ] || 0) + 1;
      if (gm.pog === p.pid) S.pogs++;
      if (isLCKreg) { S.lckGames++; S.lckRatingSum += r; }
      S.byComp = S.byComp || {};
      const bc = S.byComp[comp.id] || (S.byComp[comp.id] = { g: 0, r: 0, w: 0, k: 0, d: 0, a: 0 });
      bc.g++; bc.r += r; if (win) bc.w++; bc.k += p.k; bc.d += p.d; bc.a += p.a;
      pl.lastRatings = (pl.lastRatings || []).concat([r]).slice(-10);
      pl.form = clamp((pl.form || 0) + (r - 6.5) * 0.5, -10, 10);
      // 경기 경험 성장 (숙련도)
      pl.champs[p.champ] = clamp((pl.champs[p.champ] || 0) + 0.8, 0, 100);
      if (pl.isUser) {
        const u = state.user;
        u.recentRatings = u.recentRatings.concat([r]).slice(-10);
        u.totalGames++;
        growMastery(pl, p.champ, CONFIG.growth.masteryGain.match);
        const keys = ['laning', 'teamfight', 'mechanics', 'decision'];
        growStat(pl, rng.pick(keys), CONFIG.growth.baseGain.match);
        u.trust = clamp(u.trust + (r - 6.3) * 1.5 + (win ? 0.8 : -0.4), 0, 100);
        u.fans += Math.max(0, Math.round((CONFIG.fans.winBase * (win ? 1 : 0.3) + (r - 6) * CONFIG.fans.ratingMult + (gm.pog === p.pid ? CONFIG.fans.pogBonus : 0)) * (comp.league === 'CL' ? 0.3 : comp.league === 'INT' ? 2 : 1)));
        u.popularity = clamp(u.popularity + (r - 6.2) * (comp.league === 'CL' ? 0.15 : 0.5) + (gm.pog === p.pid ? 1 : 0), 0, 100);
        const cs = u.champStats = u.champStats || {};
        const cst = cs[p.champ] = cs[p.champ] || { g: 0, w: 0, k: 0, d: 0, a: 0, r: 0 };
        cst.g++; if (win) cst.w++; cst.k += p.k; cst.d += p.d; cst.a += p.a; cst.r += r;
        u.matchLog.unshift({ date: state.date, comp: comp.id, compName: comp.short, win, champ: p.champ, k: p.k, d: p.d, a: p.a, cs: p.cs, rating: r, pog: gm.pog === p.pid, dur: sum.duration, opp: sum.sides[1 - si].teamId });
        if (u.matchLog.length > 80) u.matchLog.length = 80;
      }
    }
  }
}

// ---------------- 하루 진행 ----------------
export function beginDay(state, rng) {
  const out = [];
  for (const id of state.season.order) {
    const c = state.season.comps[id];
    if (!c.started && c.start <= state.date) {
      if (intl.ready(state, c)) { startComp(state, rng, c); out.push(c); }
    }
  }
  return out;
}

// 사용자 경기를 제외한 오늘 경기 모두 시뮬레이션
export function simOtherMatches(state, rng, exceptId = null) {
  let guard = 0, any = true;
  while (any && guard++ < 10) {
    any = false;
    for (const m of matchesOn(state, state.date)) {
      if (m.done || m.id === exceptId || m.teams.some(t => !t)) continue;
      simulateMatch(state, rng, m);
      any = true;
    }
  }
}

export function endDay(state, rng) {
  const res = { patch: null, review: null };
  simOtherMatches(state, rng);
  // 패치
  if (state.date >= state.season.nextPatch) {
    const notes = rollPatch(rng, state.meta);
    state.season.nextPatch = dateAdd(state.season.nextPatch, CONFIG.patch.everyDays);
    addNews(state, `패치 ${state.meta.version} 적용: 버프 ${notes.filter(n => n.type === 'buff').length}개, 너프 ${notes.filter(n => n.type === 'nerf').length}개`, 'patch');
    res.patch = state.meta.version;
  }
  nightRecovery(state, rng);
  // 주간 평가
  if (dateDiff(state.season.lastReview, state.date) >= CONFIG.lineup.reviewEveryDays) {
    state.season.lastReview = state.date;
    res.review = weeklyReview(state, rng);
    if (res.review && res.review.type === 'callup') ensureAcademy(state, rng, state.players[state.user.pid].teamId, state.players[state.user.pid].pos);
  }
  // AI 선수 폼 변동
  if (weekday(state.date) === 1) for (const p of Object.values(state.players)) if (!p.isUser && p.teamId) p.form = clamp((p.form || 0) * 0.8 + rng.normal(0, 1), -10, 10);
  state.date = dateAdd(state.date, 1);
  return res;
}

// 2군 포지션 공백 채우기
export function ensureAcademy(state, rng, teamId, pos) {
  const team = state.teams[teamId];
  if (team.depth[pos].some(id => team.squadOf[id] === 'academy')) return;
  const p = makePlayer(rng, { nick: state.namePool.pop() || 'Rookie' + rng.int(100, 999), pos, age: rng.int(17, 19), target: academyTarget(rng, team.tier), teamId, squad: 'academy', season: state.year, exact: true });
  p.contract = { salary: marketValue(p), endSeason: state.year + 1, buyout: 0, starter: false };
  state.players[p.id] = p;
  team.depth[pos].push(p.id); team.squadOf[p.id] = 'academy';
}

// LCK 정규 시즌 통합 순위 (1~4라운드)
export function lckRegularStandings(state) {
  const st = newStandings(lckIds());
  const ms = [];
  for (const id of ['lck12', 'lck34']) for (const m of state.season.comps[id].matches) if (m.done) { addResult(st, m); ms.push(m); }
  return { standings: st, order: sortStandings(st, ms) };
}
