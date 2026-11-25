// 사용자 커리어 일상 시뮬레이션: 예전(하루 3칸) 방식과 새(하루 1개 활동) 방식 비교
// 사용: node tools/sim-career.mjs [시드 수=6] [--mult 3] [--seasons 1]
//  - 같은 시드·같은 활동 비율로 2군에서 시작해 시즌 하나(새 시즌 직전까지)를 화면 없이 진행
//  - 예전: 평일 3칸(경기일 2칸 + 경기), 새: 경기 없는 날 활동 1개 (예전 주간 루틴의 칸들을 순서대로 하나씩)
//  - 비교: 능력치 성장, 숙련도, 피로 누적, 평균 피로, 수입(연봉+방송), 팬, 부상, 1군 콜업·첫 1군 출전까지 날짜
//  - 목표: 능력치 성장·피로 누적·수입이 예전 대비 ±10%
import { newWorld, createUserPlayer, signUserToTeam } from '../js/engine/state.js';
import { createSeason, beginDay, endDay, userMatchOn } from '../js/engine/season.js';
import { seasonTick, acceptOffer, newSeason } from '../js/engine/career.js';
import { runActivity, runDayActivity, markMatchDay } from '../js/engine/daily.js';
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

function career(seed, mode) {
  const { state, rng } = newWorld(seed);
  const pos = 'MID';
  const mains = champsForPos(pos).filter(id => CHAMPIONS[id].pos[0] === pos).slice(0, 3);
  createUserPlayer(state, rng, { nick: 'SimUser', pos, age: 18, style: '캐리형', mains });
  signUserToTeam(state, rng, 'DRX', 'academy', { salary: 3e7, endSeason: state.year, buyout: 1e8, starter: false });
  createSeason(state, rng);
  const u = state.user, me = state.players[u.pid];
  const st0 = { ...me.stats }, ovr0 = ovr(me), m0 = Object.values(me.champs).reduce((a, b) => a + b, 0), money0 = u.money, fans0 = u.fans;
  const start = state.date;
  const r = { fatigueAdded: 0, fatigueSum: 0, days: 0, injuries: 0, injuryDays: 0, stream: 0, callup: null, firstMain: null, actDays: 0, slots: 0 };
  let ptr = 0;
  const fixChamp = a => (a.a === 'practice' && !a.champ ? { ...a, champ: topChamps(me, 1)[0] } : a);
  // 피로 누적 = 활동으로 오른 양 (회복일 보너스는 따로 — 활동 전 피로 기준)
  const act = (fn) => { let f0 = u.fatigue; const m = u.money, inj = u.injury; const res = fn(); if (res && res.fatigueBefore !== undefined) f0 = res.fatigueBefore; if (u.fatigue > f0) r.fatigueAdded += u.fatigue - f0; if (res && res.act === 'stream') r.stream += u.money - m; if (!inj && u.injury) r.injuries++; };
  let seasonsLeft = SEASONS;
  for (let guard = 0; guard < 400 * SEASONS; guard++) {
    beginDay(state, rng);
    const match = userMatchOn(state, state.date);
    if (mode === 'old') {
      const slots = OLD_ROUTINE[weekday(state.date)];
      for (let i = 0; i < (match ? 2 : 3); i++) { act(() => runActivity(state, rng, fixChamp(slots[i]))); r.slots++; }
    } else if (!match) {
      act(() => runDayActivity(state, rng, fixChamp(FLAT[ptr++ % FLAT.length]))); r.actDays++;
    }
    if (match) {
      if (mode === 'new') markMatchDay(state);
      if (!u.injury) { u.fatigue = Math.min(100, u.fatigue + CONFIG.daily.fatigue.match); r.fatigueAdded += CONFIG.daily.fatigue.match; }
    }
    if (u.injury) r.injuryDays++;
    const mainGames = Object.entries(me.season.byComp || {}).filter(([id]) => state.season.comps[id] && state.season.comps[id].league !== 'CL').reduce((a, [, b]) => a + b.g, 0);
    if (me.squad === 'main' && r.callup === null) r.callup = dateDiff(start, state.date);
    endDay(state, rng);
    const mg2 = Object.entries(me.season.byComp || {}).filter(([id]) => state.season.comps[id] && state.season.comps[id].league !== 'CL').reduce((a, [, b]) => a + b.g, 0);
    if (r.firstMain === null && mg2 > mainGames) r.firstMain = dateDiff(start, state.date);
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
  };
}

const t0 = Date.now();
const rows = { old: [], new: [] };
for (let i = 0; i < N; i++) for (const mode of ['old', 'new']) rows[mode].push(career('career-' + (i + 1), mode));
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
const pad = (s, n) => s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (/[가-힣]/.test(c) ? 2 : 1), 0)));
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
