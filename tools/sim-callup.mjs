// 2군 → 1군 콜업 기간 검사: 새 캐릭터(난이도별) · 옛 세이브 보정 후 · 옛 기준(보정 없음)
// 사용: node tools/sim-callup.mjs [시드 수=8] [--days 140] [--case 0~4]
//  - 하루 1개 활동(보통 루틴)으로 진행, 1군 첫 출전 또는 --days일에서 멈춤 (시즌 전체를 돌리지 않아 빠름)
//  - 콜업 게이지 = 주전 점수(내 선수) - 주전 점수(1군 같은 포지션) — 콜업 기준은 +callupMargin×10
//  - 목표: 보통 난이도 첫 1군 출전까지 6~10주 (중앙값)
import { newWorld, createUserPlayer, signUserToTeam, migrateStats } from '../js/engine/state.js';
import { createSeason, beginDay, endDay, userMatchOn } from '../js/engine/season.js';
import { seasonTick } from '../js/engine/career.js';
import { runDayActivity, markMatchDay } from '../js/engine/daily.js';
import { userProfile, rivalProfile, lineupScore } from '../js/engine/roster.js';
import { topChamps } from '../js/engine/players.js';
import { ovr, genStats } from '../js/stats.js';
import { CONFIG } from '../js/config.js';
import { STAT_KEYS, dateDiff, clamp, POS } from '../js/core/util.js';
import { champsForPos, CHAMPIONS } from '../data/champions.js';

const args = process.argv.slice(2);
const N = Number(args.find(a => /^\d+$/.test(a)) || 8);
const DAYS = args.includes('--days') ? Number(args[args.indexOf('--days') + 1]) : 140;
const ROUTINE = [{ a: 'scrim' }, { a: 'train', stat: 'laning' }, { a: 'solo' }, { a: 'replay' }, { a: 'train', stat: 'teamfight' }, { a: 'scrim' }, { a: 'rest' }];

function run(seed, mode, difficulty = 'normal') {
  const { state, rng } = newWorld(seed);
  const pos = POS[Number(String(seed).replace(/\D/g, '')) % 5];
  const mains = champsForPos(pos).filter(id => CHAMPIONS[id].pos[0] === pos).slice(0, 3);
  const style = '캐리형';
  const p = createUserPlayer(state, rng, { nick: 'SimUser', pos, age: 18, style, mains, difficulty });
  if (mode !== 'new') {
    // 옛 기준으로 다시 만든다: 목표 55 + 옛 플레이스타일 가감(35~80)
    const L = CONFIG.legacyStats;
    p.stats = genStats(rng, pos, L.userStartAvg, { spread: 4.5 });
    for (const [k, v] of Object.entries(L.playstyles[style])) p.stats[k] = clamp(p.stats[k] + v, ...L.clamp);
    state.user.statsVersion = 1; delete state.user.startStats; delete state.user.difficulty;
    if (mode === 'migrated') migrateStats(state);
  }
  signUserToTeam(state, rng, 'DRX', 'academy', { salary: 3e7, endSeason: state.year, buyout: 1e8, starter: false });
  createSeason(state, rng);
  const u = state.user, me = state.players[u.pid];
  const gauge = () => {
    const t = state.teams[me.teamId], rid = t.depth[me.pos].find(id => t.squadOf[id] === 'main');
    return rid ? lineupScore(userProfile(state)) - lineupScore(rivalProfile(state, rid)) : null;
  };
  const r = { ovr0: ovr(me), gauge0: gauge(), callup: null, firstMain: null, gaugeAtCallup: null };
  const start = state.date;
  let i = 0;
  for (let d = 0; d < DAYS; d++) {
    beginDay(state, rng);
    const match = userMatchOn(state, state.date);
    if (!match) { const a = ROUTINE[i++ % ROUTINE.length]; runDayActivity(state, rng, a.a === 'practice' ? { ...a, champ: topChamps(me, 1)[0] } : a); }
    else { markMatchDay(state); if (!u.injury) u.fatigue = Math.min(100, u.fatigue + CONFIG.daily.fatigue.match); }
    // 1군 경기 수 = CL이 아닌 대회(LCK컵·정규·국제전 등)에서 뛴 경기
    const mainGames = () => Object.entries(me.season.byComp || {}).filter(([id]) => state.season.comps[id] && state.season.comps[id].league !== 'CL').reduce((a, [, b]) => a + b.g, 0);
    const g0 = mainGames();
    endDay(state, rng);
    seasonTick(state, rng);
    if (me.squad === 'main' && r.callup === null) { r.callup = dateDiff(start, state.date); r.gaugeAtCallup = gauge(); }
    if (mainGames() > g0 && r.firstMain === null) { r.firstMain = dateDiff(start, state.date); break; }
  }
  r.ovrEnd = ovr(me);
  return r;
}

const avg = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const med = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const cases = [['새 캐릭터 · 쉬움', 'new', 'easy'], ['새 캐릭터 · 보통', 'new', 'normal'], ['새 캐릭터 · 어려움', 'new', 'hard'], ['옛 세이브 보정 후 (보통)', 'migrated'], ['옛 기준 그대로 (보정 없음)', 'legacy']];
const t0 = Date.now();
console.log(`=== 콜업 기간 (시드 ${N}개, 최대 ${DAYS}일, 2군 입단부터) ===`);
// --case i: 그 경우만 (여러 프로세스로 나눠 돌릴 때)
const only = args.includes('--case') ? Number(args[args.indexOf('--case') + 1]) : null;
for (const [ci, [name, mode, diff]] of cases.entries()) {
  if (only !== null && ci !== only) continue;
  const rs = [];
  for (let i = 0; i < N; i++) rs.push(run('callup-' + i, mode, diff));
  const cu = rs.map(r => r.callup).filter(v => v !== null), fm = rs.map(r => r.firstMain).filter(v => v !== null);
  console.log(`${name.padEnd(22)} 시작 OVR ${avg(rs.map(r => r.ovr0)).toFixed(1)} · 시작 게이지 ${avg(rs.map(r => r.gauge0)).toFixed(1)} (콜업 기준 +${CONFIG.lineup.callupMargin * 10})`
    + ` · 콜업 ${cu.length}/${N}명 중앙값 ${(med(cu) / 7).toFixed(1)}주 · 첫 1군 출전 ${fm.length}/${N}명 중앙값 ${(med(fm) / 7).toFixed(1)}주 (${fm.map(d => (d / 7).toFixed(0)).join('/')})`);
}
console.log(`(${((Date.now() - t0) / 1000).toFixed(0)}초)`);
