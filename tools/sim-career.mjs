// 사용자 커리어 일상 시뮬레이션: 예전(하루 3칸) 방식과 새(하루 1개 활동) 방식 비교
// 사용: node tools/sim-career.mjs [시드 수=6] [--mult 3] [--seasons 1]
//       node tools/sim-career.mjs [시드 수] [--only old|new] [--save 파일] [--load 파일,파일]   (예전/새 비교를 나눠 돌리기)
//       node tools/sim-career.mjs [시드 수] --advisor [--only base,balance,growth,condition] [--skip 시드 건너뛸 수] [--save 파일] [--load 파일,파일]
//  --advisor: 추천 루틴 3종(균형·성장 집중·컨디션 관리)을 각각 시즌 내내 쓴 경우 비교 — 매주 그 주 상황으로 새로 추천을 계산해 적용.
//     시즌 말 OVR·부상 횟수·1군 출전까지 기간·경기 평점(평균·표준편차)·경기 직전 컨디션. 기준 = 기본 루틴(새 방식).
//     목표: 성장 집중형 OVR 최고·부상 최다, 컨디션 관리형 평점 가장 안정적
//  - 같은 시드·같은 활동 비율로 2군에서 시작해 시즌 하나(새 시즌 직전까지)를 화면 없이 진행
//  - 예전: 평일 3칸(경기일 2칸 + 경기), 새: 경기 없는 날 활동 1개 (예전 주간 루틴의 칸들을 순서대로 하나씩)
//  - 비교: 능력치 성장, 숙련도, 피로 누적, 평균 피로, 수입(연봉+방송), 팬, 부상, 1군 콜업·첫 1군 출전까지 날짜
//  - 목표: 능력치 성장·피로 누적·수입이 예전 대비 ±10%
import { newWorld, createUserPlayer, signUserToTeam } from '../js/engine/state.js';
import { createSeason, beginDay, endDay, userMatchOn, simOtherMatches, allMatches, buildSeries } from '../js/engine/season.js';
import { simGame } from '../js/engine/series.js';
import { RNG } from '../js/core/rng.js';
import { seasonTick, acceptOffer, newSeason } from '../js/engine/career.js';
import { runActivity, runDayActivity, markMatchDay, computeCondition } from '../js/engine/daily.js';
import { autoApply, PLAN_KINDS } from '../js/routine-advisor.js';
import { writeFileSync, readFileSync } from 'node:fs';
import { topChamps } from '../js/engine/players.js';
import { ovr } from '../js/stats.js';
import { CONFIG } from '../js/config.js';
import { STAT_KEYS, weekday, dateDiff, avg } from '../js/core/util.js';
import { champsForPos, CHAMPIONS } from '../data/champions.js';

const args = process.argv.slice(2);
const N = Number(args.find(a => /^\d+$/.test(a)) || 6);
if (args.includes('--mult')) CONFIG.daily.ACTIVITY_DAY_MULTIPLIER = Number(args[args.indexOf('--mult') + 1]);
const MULT = CONFIG.daily.ACTIVITY_DAY_MULTIPLIER;
const SEASONS = args.includes('--seasons') ? Number(args[args.indexOf('--seasons') + 1]) : 1;

// 비교용 예전 주간 루틴 (요일 0=일 ~ 6=토, 하루 3칸) — 방송·케미·연습이 섞인 보통 플레이
const OLD_ROUTINE = [
  [{ a: 'scrim' }, { a: 'train', stat: 'laning' }, { a: 'solo' }],
  [{ a: 'rest' }, { a: 'replay' }, { a: 'rest' }],
  [{ a: 'scrim' }, { a: 'train', stat: 'teamfight' }, { a: 'practice' }],
  [{ a: 'scrim' }, { a: 'train', stat: 'laning' }, { a: 'solo' }],
  [{ a: 'scrim' }, { a: 'replay' }, { a: 'bond' }],
  [{ a: 'scrim' }, { a: 'train', stat: 'mechanics' }, { a: 'solo' }],
  [{ a: 'scrim' }, { a: 'stream' }, { a: 'practice' }],
];
// 새 방식: 같은 칸들을 순서대로 하루에 하나씩 (활동 비율이 같음)
const FLAT = [1, 2, 3, 4, 5, 6, 0].flatMap(d => OLD_ROUTINE[d]);

// 활동 효과 비교(예전 vs 새, --advisor 없이)는 예전 피로 기준(legacyFatigue)으로 돌린다. --advisor 는 지금 피로 모델 그대로
const LEGACY = !args.includes('--advisor');
function career(seed, mode) {
  const night = CONFIG.daily.nightRecovery, perf = CONFIG.match.userPerf;
  if (LEGACY) { CONFIG.daily.nightRecovery = CONFIG.daily.legacyFatigue.nightRecovery; CONFIG.match.userPerf = CONFIG.daily.legacyFatigue.userPerf; }
  try { return careerRun(seed, mode); } finally { CONFIG.daily.nightRecovery = night; CONFIG.match.userPerf = perf; }
}
function careerRun(seed, mode) {
  const { state, rng } = newWorld(seed);
  const pos = 'MID';
  const mains = champsForPos(pos).filter(id => CHAMPIONS[id].pos[0] === pos).slice(0, 3);
  createUserPlayer(state, rng, { nick: 'SimUser', pos, age: 18, style: '캐리형', mains });
  signUserToTeam(state, rng, 'DRX', 'academy', { salary: 3e7, endSeason: state.year, buyout: 1e8, starter: false });
  createSeason(state, rng);
  const u = state.user, me = state.players[u.pid];
  const st0 = { ...me.stats }, ovr0 = ovr(me), m0 = Object.values(me.champs).reduce((a, b) => a + b, 0), money0 = u.money, fans0 = u.fans;
  const start = state.date;
  const adv = mode.startsWith('adv:') ? mode.slice(4) : null;
  const ratings = [], matchCond = [], matchMods = [];
  let seenGames = 0;
  const r = { fatigueAdded: 0, fatigueSum: 0, days: 0, injuries: 0, injuryDays: 0, stream: 0, callup: null, firstMain: null, actDays: 0, slots: 0 };
  let ptr = 0;
  const fixChamp = a => (a.a === 'practice' && !a.champ ? { ...a, champ: topChamps(me, 1)[0] } : a);
  // 피로 누적 = 활동으로 오른 양 (회복일 보너스는 따로 — 활동 전 피로 기준)
  const act = (fn) => { let f0 = u.fatigue; const m = u.money, inj = u.injury; const res = fn(); if (res && res.fatigueBefore !== undefined) f0 = res.fatigueBefore; if (u.fatigue > f0) r.fatigueAdded += u.fatigue - f0; if (res && res.act === 'stream') r.stream += u.money - m; if (!inj && u.injury) r.injuries++; };
  let seasonsLeft = SEASONS;
  for (let guard = 0; guard < 400 * SEASONS; guard++) {
    beginDay(state, rng);
    const match = userMatchOn(state, state.date);
    if (adv && r.days % 7 === 0) autoApply(state, adv);    // 매주 그 주 상황으로 새로 추천
    if (mode === 'old') {
      const slots = OLD_ROUTINE[weekday(state.date)];
      for (let i = 0; i < (match ? 2 : 3); i++) { act(() => runActivity(state, rng, fixChamp(slots[i]))); r.slots++; }
    } else if (!match) {
      act(() => runDayActivity(state, rng, fixChamp(adv ? { ...u.routine[weekday(state.date)] } : FLAT[ptr++ % FLAT.length]))); r.actDays++;
    }
    const mainGamesOf = () => Object.entries(me.season.byComp || {}).filter(([id]) => state.season.comps[id] && state.season.comps[id].league !== 'CL').reduce((a, [, b]) => a + b.g, 0);
    const mainGames = mainGamesOf();
    let matchFatigue = 0;
    if (match) {
      if (mode !== 'old') markMatchDay(state);
      matchCond.push(computeCondition(state));
      matchMods.push({ condition: computeCondition(state), mental: u.mental, fatigue: u.fatigue });
      if (!u.injury) { matchFatigue = CONFIG.daily.fatigue.match; r.fatigueAdded += matchFatigue; }
      // 경기는 경기 전 컨디션으로 치르고, 경기 피로는 그 뒤에 쌓인다 (직접 진행하는 경기와 같은 순서)
      simOtherMatches(state, rng);
      u.fatigue = Math.min(100, u.fatigue + matchFatigue);
    }
    if (u.injury) r.injuryDays++;
    if (me.squad === 'main' && r.callup === null) r.callup = dateDiff(start, state.date);
    endDay(state, rng);
    const mg2 = mainGamesOf();
    if (r.firstMain === null && mg2 > mainGames) r.firstMain = dateDiff(start, state.date);
    // 이번 날 새로 치른 내 경기 평점
    if (u.totalGames > seenGames) { for (let i = 0; i < u.totalGames - seenGames && i < u.matchLog.length; i++) ratings.push(u.matchLog[i].rating); seenGames = u.totalGames; }
    r.fatigueSum += u.fatigue; r.days++;
    const evs = seasonTick(state, rng);
    if (state.fa && state.fa.status !== 'signed' && state.fa.offers.length) {
      const best = state.fa.offers.filter(o => o.status === 'open').sort((a, b) => b.salary - a.salary)[0];
      if (best) acceptOffer(state, rng, best.id);
    }
    if (evs.some(e => e.type === 'newSeasonReady')) { if (--seasonsLeft <= 0) break; newSeason(state, rng); }
  }
  return {
    statGain: STAT_KEYS.reduce((a, k) => a + me.stats[k] - st0[k], 0),
    ovrGain: ovr(me) - ovr0,
    mastery: Object.values(me.champs).reduce((a, b) => a + b, 0) - m0,
    fatigueAdded: r.fatigueAdded, fatigueAvg: r.fatigueSum / r.days,
    income: u.money - money0, stream: r.stream, fans: u.fans - fans0,
    injuries: r.injuries, injuryDays: r.injuryDays, callup: r.callup, firstMain: r.firstMain, days: r.days,
    mental: u.mental, trust: u.trust,
    ovrEnd: ovr(me), games: ratings.length, ratings, matchCond, matchMods,
  };
}

const perfShift = md => { const U = CONFIG.match.userPerf; return (md.condition - U.conditionRef) * U.condition - Math.max(0, md.fatigue - U.fatigueFrom) * U.fatigue + (md.mental - 60) * U.mental; };
const sd = a => { if (a.length < 2) return NaN; const m = avg(a); return Math.sqrt(avg(a.map(v => (v - m) ** 2))); };
const pad = (s, n) => s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (/[가-힣]/.test(c) ? 2 : 1), 0)));
if (args.includes('--advisor')) {
  const flag = f => (args.includes(f) ? args[args.indexOf(f) + 1] : null);
  const ALL = ['base', ...PLAN_KINDS], only = flag('--only') ? flag('--only').split(',') : flag('--load') ? [] : ALL;
  const NAMES = { base: '기본 루틴', balance: '균형형', growth: '성장 집중형', condition: '컨디션 관리형' };
  const res = {};
  const t1 = Date.now();
  const skip = Number(flag('--skip') || 0);   // 시드 번호 건너뛰기 (같은 모드를 나눠 돌린 결과를 --load 로 이어 붙일 때)
  for (const m of only) { res[m] = []; for (let i = 0; i < N; i++) res[m].push(career('career-' + (skip + i + 1), m === 'base' ? 'new' : 'adv:' + m)); console.error(`  ${NAMES[m]} 완료 (${((Date.now() - t1) / 1000).toFixed(0)}초)`); }
  if (flag('--save')) writeFileSync(flag('--save'), JSON.stringify(res));
  if (flag('--load')) for (const f of flag('--load').split(',')) for (const [k, v] of Object.entries(JSON.parse(readFileSync(f, 'utf8')))) res[k] = (res[k] || []).concat(v);
  const modes = ALL.filter(m => res[m] && res[m].length);
  const M = (m, k) => avg(res[m].map(x => x[k]).filter(v => v !== null && v !== undefined && !Number.isNaN(v)));
  const pooled = (m, k) => res[m].flatMap(x => x[k]);
  const rows = [
    ['시즌 말 OVR', m => M(m, 'ovrEnd'), 1], ['OVR 성장', m => M(m, 'ovrGain'), 1], ['능력치 성장 (8개 합)', m => M(m, 'statGain'), 1],
    ['부상 횟수 (시즌)', m => M(m, 'injuries'), 2], ['부상 결장 일수', m => M(m, 'injuryDays'), 1], ['평균 피로', m => M(m, 'fatigueAvg'), 1],
    ['1군 콜업까지 (일)', m => M(m, 'callup'), 0], ['첫 1군 출전까지 (일)', m => M(m, 'firstMain'), 0],
    ['경기 수 (시즌)', m => M(m, 'games'), 1], ['평균 평점', m => avg(pooled(m, 'ratings')), 2], ['평점 표준편차', m => sd(pooled(m, 'ratings')), 3],
    ['평점 5.5 미만 비율 (%)', m => 100 * avg(pooled(m, 'ratings').map(v => (v < 5.5 ? 1 : 0))), 1],
    ['평점 하위 10% 경계', m => { const a = pooled(m, 'ratings').slice().sort((x, y) => x - y); return a[Math.floor(a.length * 0.1)]; }, 2],
    ['경기 직전 컨디션 평균', m => avg(pooled(m, 'matchCond')), 1], ['경기 직전 컨디션 표준편차', m => sd(pooled(m, 'matchCond')), 1],
    ['경기력 보정(파워) 평균', m => avg(pooled(m, 'matchMods').map(perfShift)), 2], ['경기력 보정(파워) 표준편차', m => sd(pooled(m, 'matchMods').map(perfShift)), 2],
    ['수입 (연봉+방송, 만 원)', m => M(m, 'income') / 1e4, 0],
  ];
  console.log(`=== 추천 루틴 3종 시즌 내내 (시드 ${N}개 × 시즌 ${SEASONS}개, 2군 시작) ===\n`);
  console.log(pad('항목', 28) + modes.map(m => pad(NAMES[m], 16)).join(''));
  for (const [name, fn, dec] of rows) console.log(pad(name, 28) + modes.map(m => pad(Number.isFinite(fn(m)) ? fn(m).toFixed(dec) : '-', 16)).join(''));
  // 평점 안정성 실험: 같은 경기 시드로, 계획마다 실제 경기 직전 상태(컨디션·멘탈·피로) 분포만 바꿔 다시 시뮬 — 경기 운(무작위)이 같아서 계획의 효과만 남는다
  const stab = {};
  if (flag('--stability') !== '0' && ['balance', 'growth', 'condition'].every(m => modes.includes(m))) {
    const T = Number(flag('--stability') || 400);
    const { state: ws, rng: wr } = newWorld('stab-world');
    const mains = champsForPos('MID').filter(id => CHAMPIONS[id].pos[0] === 'MID').slice(0, 3);
    const me0 = createUserPlayer(ws, wr, { nick: 'Stab', pos: 'MID', age: 18, style: '캐리형', mains, difficulty: 'normal' });
    signUserToTeam(ws, wr, 'DRX', 'academy', { salary: 3e7, endSeason: ws.year, buyout: 1e8, starter: false });
    createSeason(ws, wr);
    ws.user.lineupOverride = me0.id;
    const m0 = allMatches(ws).find(m => m.teams.includes('DRX:A'));
    for (const m of ['balance', 'growth', 'condition']) {
      const pool = res[m].flatMap(x => x.matchMods);
      stab[m] = [];
      for (let t = 0; t < T; t++) {
        const pick = pool[new RNG('pick-' + m + t).int(0, pool.length - 1)];
        const s = buildSeries(ws, m0);
        const out = simGame(s, new RNG('stab-' + t), ws.meta, { pid: me0.id, mods: pick });
        stab[m].push(out.ratings[me0.id].rating);
      }
    }
  }
  if (['balance', 'growth', 'condition'].every(m => modes.includes(m))) {
    const v = (m, f) => f(m);
    const ovrs = ['balance', 'growth', 'condition'].map(m => M(m, 'ovrEnd')), inj = ['balance', 'growth', 'condition'].map(m => M(m, 'injuries'));
    const K = ['balance', 'growth', 'condition'];
    const bad = K.map(m => avg(pooled(m, 'ratings').map(v => (v < 5.5 ? 1 : 0)))), csd = K.map(m => sd(pooled(m, 'matchCond')));
    const sds = K.map(m => sd(pooled(m, 'ratings'))), n = Math.min(...K.map(m => pooled(m, 'ratings').length));
    if (stab.balance) {
      console.log(`\n[평점 안정성 — 같은 경기 시드 ${stab.balance.length}판, 계획별 실제 경기 직전 상태 분포만 적용]`);
      console.log(pad('', 28) + K.map(m => pad(NAMES[m], 16)).join(''));
      console.log(pad('평균 평점', 28) + K.map(m => pad(avg(stab[m]).toFixed(2), 16)).join(''));
      console.log(pad('평점 표준편차', 28) + K.map(m => pad(sd(stab[m]).toFixed(3), 16)).join(''));
      console.log(pad('평점 5.5 미만 비율 (%)', 28) + K.map(m => pad((100 * avg(stab[m].map(v => (v < 5.5 ? 1 : 0)))).toFixed(1), 16)).join(''));
    }
    const checks = [
      ['성장 집중형 OVR 최고', ovrs[1] >= Math.max(...ovrs)], ['성장 집중형 부상 최다', inj[1] >= Math.max(...inj)],
      ['컨디션 관리형 경기 직전 컨디션이 가장 일정 (표준편차 최소)', csd[2] <= Math.min(...csd)],
      ['컨디션 관리형 경기력 보정(컨디션·피로·멘탈 → 파워)이 가장 일정 (표준편차 최소, 경기 운 없이 계산)', K.map(m => sd(pooled(m, 'matchMods').map(perfShift)))[2] <= Math.min(...K.map(m => sd(pooled(m, 'matchMods').map(perfShift))))],
      ['컨디션 관리형 나쁜 경기(평점 5.5 미만) 비율 최소 (시즌 실경기)', bad[2] <= Math.min(...bad)],
    ];
    console.log('\n[목표 점검]'); for (const [k, ok] of checks) console.log(`  ${ok ? '✓' : '✗'} ${k}`);
    // 평점 표준편차는 목표로 삼지 않는다: 경기 운(무작위)에 묻히고(표본 ${n}경기 안팎 오차 ±${(Math.min(...sds) / Math.sqrt(2 * n)).toFixed(2)}), 상태가 나쁘면 평점이 낮은 쪽에 몰려 오히려 줄어든다
    console.log(`\n[참고] 평점 표준편차 (시즌 실경기): ${K.map((m, i) => `${NAMES[m]} ${sds[i].toFixed(2)}`).join(' · ')}${stab.balance ? ` / 같은 경기 시드: ${K.map(m => `${NAMES[m]} ${sd(stab[m]).toFixed(2)}`).join(' · ')}` : ''} — 경기 운에 묻히고 상태가 나쁘면 낮은 평점 쪽에 몰려 줄어드는 지표라 목표로 쓰지 않는다`);
  }
  process.exit(0);
}

const t0 = Date.now();
const rows = { old: [], new: [] };
// 나눠 돌리기: --only old|new (한 방식만) --save 파일 / --load 파일,파일 (저장한 결과 합치기). 예전 방식은 배율과 무관해 한 번 돌려 재사용
{
  const fl = f => (args.includes(f) ? args[args.indexOf(f) + 1] : null);
  const only = fl('--only') ? fl('--only').split(',') : fl('--load') ? [] : ['old', 'new'];
  for (const mode of only) for (let i = 0; i < N; i++) rows[mode].push(career('career-' + (i + 1), mode));
  if (fl('--save')) { writeFileSync(fl('--save'), JSON.stringify(rows)); console.log('저장', fl('--save')); process.exit(0); }
  if (fl('--load')) for (const f of fl('--load').split(',')) { const d = JSON.parse(readFileSync(f, 'utf8')); for (const m of ['old', 'new']) rows[m] = rows[m].concat(d[m] || []); }
}
const mean = (mode, k) => avg(rows[mode].map(x => x[k]).filter(v => v !== null && v !== undefined));
const cnt = (mode, k) => rows[mode].filter(x => x[k] !== null && x[k] !== undefined).length;

console.log(`=== 커리어 일상 비교 (시드 ${N}개 × 시즌 ${SEASONS}개, 2군 시작 · 새 방식 배율 ${MULT}) — ${((Date.now() - t0) / 1000).toFixed(0)}초 ===\n`);
const ITEMS = [
  ['statGain', '능력치 성장 (8개 합)', 1, true],
  ['ovrGain', 'OVR 성장', 1, false],
  ['mastery', '챔피언 숙련도 합 증가', 0, false],
  ['fatigueAdded', '피로 누적 (활동·경기로 쌓인 양)', 0, true],
  ['fatigueAvg', '평균 피로', 1, false],
  ['income', '수입 (연봉+방송, 원)', 0, true],
  ['stream', '방송 수입 (원)', 0, false],
  ['fans', '팬 증가', 0, false],
  ['injuries', '부상 횟수', 2, false],
  ['injuryDays', '부상 결장 일수', 1, false],
];
console.log(pad('항목', 34) + pad('예전(3칸)', 16) + pad('새(1개)', 16) + '차이');
let fail = 0;
for (const [k, name, dec, target] of ITEMS) {
  const a = mean('old', k), b = mean('new', k);
  const d = a ? (b - a) / Math.abs(a) * 100 : 0;
  const ok = !target || Math.abs(d) <= 10;
  if (!ok) fail++;
  const f = v => (Math.abs(v) >= 10000 ? Math.round(v).toLocaleString() : v.toFixed(dec));
  console.log(pad(name, 34) + pad(f(a), 16) + pad(f(b), 16) + `${d >= 0 ? '+' : ''}${d.toFixed(1)}%${target ? (ok ? '  ✓' : '  ✗ (목표 ±10%)') : ''}`);
}
console.log('');
for (const [k, name] of [['callup', '1군 콜업까지 (일)'], ['firstMain', '첫 1군 출전까지 (일)']]) {
  console.log(pad(name, 34) + pad(`${mean('old', k).toFixed(0)}일 (${cnt('old', k)}/${N})`, 16) + pad(`${mean('new', k).toFixed(0)}일 (${cnt('new', k)}/${N})`, 16) + `시드별 예전 ${rows.old.map(x => x[k] ?? '-').join('/')} · 새 ${rows.new.map(x => x[k] ?? '-').join('/')}`);
}
console.log(`\n결과: ${fail ? `목표 범위 밖 ${fail}개 ✗` : '능력치 성장·피로 누적·수입 모두 ±10% ✓'}`);
