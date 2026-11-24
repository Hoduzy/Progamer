// 새 게임 상태 생성 + 직렬화
import { CONFIG } from '../config.js';
import { RNG } from '../core/rng.js';
import { clamp, POS } from '../core/util.js';
import { LCK_TEAMS, OVERSEAS_TEAMS } from '../../data/teams.js';
import { makeNamePool, makeCoachNames } from '../../data/names.js';
import { makePlayer, marketValue, setNextPlayerId, getNextPlayerId, genChampPool, assignStarAliases } from './players.js';
import { newMeta } from './meta.js';
import { CHAMPIONS } from '../../data/champions.js';
import { rosterOf, LCK_ROSTERS } from '../../data/rosters.js';


const COACH_STYLES = ['공격형', '운영형', '데이터형', '베테랑형', '육성형'];

export function regionTarget(tier, region) { return CONFIG.tierOvr[tier] + (CONFIG.regionOffset[region] || 0); }

// LCK 1군 50명 목표 OVR: 슈퍼스타(90+)는 강팀 위주, 85~89는 약팀 에이스부터, 나머지는 팀 티어 근처
export function lckTargets(rng, teams) {
  const C = CONFIG.stars, L = C.lck;
  const plan = {}, high = {};
  for (const t of teams) { plan[t.code] = {}; high[t.code] = 0; }
  const free = t => POS.filter(p => !plan[t.code][p]);
  // 자리 고르기: 로스터 비중(data/rosters.js)이 높은 주전부터 (low = 75 미만 자리는 비중이 낮은 쪽부터), 같으면 무작위
  const wOf = (t, pos) => { const r = rosterOf(t.code)[pos]; return r ? r[0].w : 1; };
  const pickPos = (t, low) => {
    const f = rng.shuffle(free(t));
    return f.sort((a, b) => low ? wOf(t, a) - wOf(t, b) : wOf(t, b) - wOf(t, a))[0];
  };
  const put = (t, target, o = {}) => {
    const pos = pickPos(t, target < CONFIG.stars.lck.rMid[0]);
    plan[t.code][pos] = { target, ...o };
    if (target >= L.r85[0]) high[t.code]++;
  };
  const pickTeam = (ok, w) => {
    const c = teams.filter(ok);
    return c.length ? rng.weighted(c.map(t => [t, w(t)])) : null;
  };
  const n90 = rng.int(...L.n90), n85 = rng.int(...L.n85), nLow = rng.int(...L.nLow);
  for (let i = 0; i < n90; i++) {
    const t = pickTeam(t => high[t.code] < L.maxPerTeam && free(t).length, t => C.tierW[t.tier] || 0.3);
    if (t) put(t, rng.int(...L.r90), { grade: rng.chance(0.6) ? 'S' : 'A', spikes: rng.chance(C.spikeChance) ? rng.int(1, 2) : 0 });
  }
  let left = n85;
  // 약팀에도 에이스: 85+ 선수가 없는 팀부터 한 명씩
  for (const t of rng.shuffle(teams.slice())) if (left > 0 && !high[t.code]) { put(t, rng.int(...L.r85), { grade: rng.chance(0.3) ? 'S' : 'A' }); left--; }
  for (; left > 0; left--) {
    const t = pickTeam(t => high[t.code] < L.maxPerTeam + 1 && free(t).length > 1, t => C.tierW[t.tier] || 0.3);
    if (t) put(t, rng.int(...L.r85), { grade: rng.chance(0.3) ? 'S' : 'A' });
  }
  for (let i = 0; i < nLow; i++) {
    const t = pickTeam(t => free(t).length > 1, t => 1 / (C.tierW[t.tier] || 0.3));
    if (t) put(t, rng.int(...L.rLow));
  }
  for (const t of teams) for (const pos of free(t)) {
    plan[t.code][pos] = { target: clamp(regionTarget(t.tier, 'LCK') + rng.int(-4, 3), ...L.rMid) };
  }
  return plan;
}

// 해외 슈퍼스타: LPL 강팀 위주, 가끔 LEC
function overseasStars(rng, teams) {
  const C = CONFIG.stars, O = C.overseas;
  const out = {};
  const n = rng.int(...O.n);
  for (let i = 0; i < n; i++) {
    const lec = i === 0 && rng.chance(O.lecChance);
    const c = teams.filter(t => t.region === (lec ? 'LEC' : 'LPL') && ['S', 'A'].includes(t.tier));
    const t = rng.weighted(c.map(t => [t, C.tierW[t.tier]]));
    const pos = rng.pick(POS.filter(p => !out[t.code + ':' + p]));
    out[t.code + ':' + pos] = { target: rng.int(...O.r), grade: rng.chance(0.6) ? 'S' : 'A', spikes: rng.chance(C.spikeChance) ? rng.int(1, 2) : 0 };
  }
  return out;
}

// 시작 나이: 이미 정상급인 선수는 경력 중반 (몇 시즌 안에 노화로 내려오는 스타도 생기게)
const starAges = target => target >= CONFIG.stars.starOvr ? CONFIG.stars.starAge : target >= CONFIG.stars.lck.r85[0] ? CONFIG.stars.aceAge : [19, 27];

export function newWorld(seed) {
  const rng = new RNG(seed);
  setNextPlayerId(1);
  const names = makeNamePool(rng, 420);
  const coachNames = makeCoachNames(rng, 40);
  const year = CONFIG.startYear;
  const state = {
    version: CONFIG.saveVersion, seed, year, date: `${year}-01-02`, startDate: `${year}-01-02`,
    players: {}, teams: {}, namePool: names, coachPool: coachNames.slice(34),
    meta: newMeta(rng, year), news: [], inbox: [], community: [], records: { seasons: [], hof: [] },
    awards: [], user: null, season: null, flags: {}, eventLog: [], nextMsgId: 1, nameVersion: NAME_VERSION,
  };
  const takeName = () => state.namePool.length ? state.namePool.pop() : 'Rookie' + rng.int(100, 999);
  let ci = 0;
  const mkTeam = (t, region, league) => {
    const team = {
      id: t.code, code: t.code, name: t.name, color: t.color, tier: t.tier, region, league,
      depth: {}, squadOf: {}, coach: { nick: coachNames[ci++], style: rng.pick(COACH_STYLES), strictness: Math.round(rng.float(0.3, 0.9) * 100) / 100 },
      prestige: { S: 90, A: 75, B: 60, C: 45, D: 35 }[t.tier], budget: { S: 9e9, A: 6e9, B: 4e9, C: 2.5e9, D: 1.5e9 }[t.tier],
      history: [],
    };
    for (const pos of POS) team.depth[pos] = [];
    return team;
  };
  const addPlayer = (team, pos, squad, target, ageRange, star = null, real = null) => {
    const age = rng.int(...ageRange);
    const o = star || {};
    const p = makePlayer(rng, { nick: real ? real.nick : takeName(), pos, age, target: clamp(target, 40, 95), teamId: team.id, squad, region: team.region, season: year, grade: o.grade || null, spikes: o.spikes ?? null, exact: squad === 'main' });
    p.contract = { salary: marketValue(p), endSeason: year + rng.int(0, 2), buyout: 0, starter: squad === 'main' };
    p.contract.buyout = Math.round(p.contract.salary * rng.float(...CONFIG.salary.buyoutMult) / 1e6) * 1e6;
    if (real) p.ko = real.ko;   // 한글 표기 (커뮤니티에서 섞어 씀)
    state.players[p.id] = p;
    team.depth[pos].push(p.id);
    team.squadOf[p.id] = squad;
    return p;
  };
  const lckPlan = lckTargets(rng, LCK_TEAMS);
  for (const t of LCK_TEAMS) {
    const team = mkTeam(t, 'LCK', 'LCK');
    const base = regionTarget(t.tier, 'LCK');
    // 1군: 실제 로스터 이름(data/rosters.js). 같은 포지션 경쟁 선수는 주전보다 조금 낮게 1군 후보로
    const ros = rosterOf(t.code);
    for (const pos of POS) {
      const o = lckPlan[t.code][pos], r = ros[pos] && ros[pos][0];
      addPlayer(team, pos, 'main', o.target, starAges(o.target), o, r);
    }
    for (const pos of POS) for (const r of (ros[pos] || []).slice(1)) {
      const p = addPlayer(team, pos, 'main', lckPlan[t.code][pos].target - rng.int(...CONFIG.stars.lck.benchGap), [19, 26], null, r);
      p.contract.starter = false;
    }
    for (const pos of POS) addPlayer(team, pos, 'academy', base + CONFIG.academyOffset + rng.int(-4, 5), [17, 21]);
    state.teams[team.id] = team;
  }
  const osStars = overseasStars(rng, OVERSEAS_TEAMS);
  for (const t of OVERSEAS_TEAMS) {
    const team = mkTeam(t, t.region, t.region);
    const base = regionTarget(t.tier, t.region);
    for (const pos of POS) {
      const st = osStars[t.code + ':' + pos];
      addPlayer(team, pos, 'main', st ? st.target : base + rng.int(-4, 4), st ? starAges(st.target) : [19, 28], st || null);
    }
    state.teams[team.id] = team;
  }
  // FA 풀
  state.faPool = [];
  for (let i = 0; i < 12; i++) {
    const pos = POS[i % 5];
    const p = makePlayer(rng, { nick: takeName(), pos, age: rng.int(18, 26), target: rng.int(58, 72), teamId: null, squad: 'fa', season: year });
    state.players[p.id] = p; state.faPool.push(p.id);
  }
  assignStarAliases(state, rng);
  state.nextPlayerId = getNextPlayerId();
  state.rng = rng.toJSON();
  return { state, rng };
}

// 사용자 선수 생성
export function createUserPlayer(state, rng, { nick, pos, age, style, mains }) {
  // 사용자: 튀는 능력치·유망주 보정 없이 (능력치 성향은 플레이 스타일로, 잠재력은 아래에서 따로)
  const p = makePlayer(rng, { nick, pos, age, target: CONFIG.userStartAvg, teamId: null, squad: 'fa', season: state.year, spikes: 0, exact: true });
  const mod = CONFIG.playstyles[style] || {};
  for (const k in mod) p.stats[k] = clamp(p.stats[k] + mod[k], 35, 80);
  p.champs = genChampPool(rng, pos, 52, mains);
  mains.forEach((m, i) => { p.champs[m] = clamp(62 + rng.int(0, 8) - i * 3, 0, 100); });
  p.isUser = true;
  p.style = style;
  p.mains = mains.slice();
  p.hidden.potential = clamp(Math.round(rng.normal(87, 5)), 76, 99);
  p.rookieSeason = state.year;
  state.players[p.id] = p;
  state.nextPlayerId = getNextPlayerId();
  state.user = {
    pid: p.id, fatigue: 15, condition: 80, mental: 65, trust: 40, chem: {}, fans: 500, popularity: 5, money: 5000000,
    injury: null, soloRank: { tier: '마스터', lp: 120, games: 0, wins: 0 }, scrimScore: 50, recentRatings: [], benchStreak: 0,
    routine: defaultRoutine(), daySlots: null, joinedDate: state.date, matchLog: [], career: [], trophies: [], awards: [],
    evalLevel: 0, lastReview: state.date, totalGames: 0, retired: false, competitorId: null, lastLineup: null,
    salaryHistory: [], seasonStart: { fans: 500 }, flags: {},
  };
  return p;
}

export function defaultRoutine() {
  // 요일(0=일~6=토) × 3칸
  const wk = [{ a: 'scrim' }, { a: 'train', stat: 'laning' }, { a: 'solo' }];
  const r = [];
  for (let d = 0; d < 7; d++) r.push(d === 1 ? [{ a: 'rest' }, { a: 'replay' }, { a: 'rest' }] : wk.map(x => ({ ...x })));
  return r;
}

// 다른 팀 2군 → 사용자 입단 시 2군 정리
export function signUserToTeam(state, rng, teamId, squad, contract) {
  const u = state.players[state.user.pid];
  const team = state.teams[teamId];
  const pos = u.pos;
  u.teamId = teamId; u.squad = squad; u.contract = contract;
  if (squad === 'academy') {
    // 기존 2군 같은 포지션 선수는 방출
    for (const pid of team.depth[pos].slice()) {
      if (team.squadOf[pid] === 'academy') {
        team.depth[pos] = team.depth[pos].filter(x => x !== pid);
        delete team.squadOf[pid];
        const p = state.players[pid]; p.teamId = null; p.squad = 'fa'; p.contract = null;
        state.faPool.push(pid);
      }
    }
  }
  team.depth[pos].push(u.id);
  team.squadOf[u.id] = squad;
  state.user.competitorId = competitorOf(state);
  state.user.salaryHistory.push({ year: state.year, team: teamId, salary: contract.salary });
}

export function competitorOf(state) {
  const u = state.players[state.user.pid];
  if (!u.teamId) return null;
  const team = state.teams[u.teamId];
  const others = team.depth[u.pos].filter(id => id !== u.id && state.players[id]);
  const main = others.filter(id => team.squadOf[id] === 'main');
  return main[0] || others[0] || null;
}

export function serialize(state, rng) {
  state.rng = rng.toJSON();
  state.nextPlayerId = getNextPlayerId();
  return JSON.stringify(state);
}
// ---------- 선수 이름 변환 (실제 로스터 영문 표기) ----------
// nameVersion 2: LCK 1군이 data/rosters.js 이름. 그 전 세이브는 게임 시작 때 만든 순서대로 id가 정해져 있다
//   (LCK 팀 순서대로 팀마다 1군 TOP~SUP 5명, 2군 5명 → p1~p100) — 그 id의 1군 선수 이름만 바꾼다.
export const NAME_VERSION = 2;
export function needsNameMigration(state) { return !!state && (state.nameVersion || 1) < NAME_VERSION && !!state.players; }
export function migrateNames(state) {
  if (!needsNameMigration(state)) return { renamed: 0, map: {} };
  const map = {};
  LCK_TEAMS.forEach((t, i) => {
    const ros = rosterOf(t.code);
    POS.forEach((pos, j) => {
      const id = 'p' + (i * 10 + j + 1);
      const p = state.players[id], r = ros[pos] && ros[pos][0];
      if (!p || !r || p.isUser || p.pos !== pos) return;
      if (p.nick !== r.nick) map[p.nick] = r.nick;
      p.nick = r.nick; p.ko = r.ko;
    });
  });
  // 팀 이름도 지금 표기로 (예: 브리온 → 한진 브리온)
  for (const t of LCK_TEAMS) if (state.teams[t.code]) state.teams[t.code].name = t.name;
  // 같은 이름이 남아 있으면(가상 선수가 우연히 같은 이름) 뒤에 숫자를 붙인다
  const real = new Set(Object.values(LCK_ROSTERS).flat().map(r => r[1]));
  const renamedIds = new Set(LCK_TEAMS.flatMap((t, i) => POS.map((_, j) => 'p' + (i * 10 + j + 1))));
  for (const p of Object.values(state.players)) if (!renamedIds.has(p.id) && real.has(p.nick) && !p.isUser) { map[p.nick] = p.nick + '2'; p.nick += '2'; }
  // 뉴스·기록·커뮤니티 등 저장된 문장 속 옛 이름도 바꾼다 (단어 단위)
  const olds = Object.keys(map).sort((a, b) => b.length - a.length);
  if (olds.length) {
    const re = new RegExp('(^|[^A-Za-z0-9])(' + olds.map(o => o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')(?![A-Za-z0-9])', 'g');
    const fix = v => typeof v === 'string' ? v.replace(re, (m, a, b) => a + map[b])
      : Array.isArray(v) ? v.map(fix)
      : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fix(x)])) : v;
    for (const k of ['news', 'inbox', 'community', 'records', 'awards', 'eventLog', 'commLog']) if (state[k]) state[k] = fix(state[k]);
    if (state.user) for (const k of ['matchLog', 'career', 'trophies', 'awards']) if (state.user[k]) state.user[k] = fix(state.user[k]);
    for (const p of Object.values(state.players)) if (p.history) p.history = fix(p.history);
  }
  state.nameVersion = NAME_VERSION;
  return { renamed: Object.keys(map).length, map };
}

export function deserialize(json) {
  const state = typeof json === 'string' ? JSON.parse(json) : json;
  migrateNames(state);
  setNextPlayerId(state.nextPlayerId || 10000);
  const rng = RNG.from(state.rng);
  return { state, rng };
}

export function addNews(state, text, kind = 'info', extra = {}) {
  state.news.unshift({ date: state.date, text, kind, ...extra });
  if (state.news.length > 200) state.news.length = 200;
}
export function addMsg(state, from, title, body, extra = {}) {
  state.inbox.unshift({ id: state.nextMsgId++, date: state.date, from, title, body, read: false, ...extra });
  if (state.inbox.length > 120) state.inbox.length = 120;
}
