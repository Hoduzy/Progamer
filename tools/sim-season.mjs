// 화면 없이 시즌을 자동으로 돌려 통계 출력
// 사용: node tools/sim-season.mjs [시즌 수=10] [--chain]   (--chain: 한 월드에서 연속 시즌, 시즌 넘김·FA 검증)
import { newWorld, createUserPlayer, signUserToTeam } from '../js/engine/state.js';
import { createSeason, beginDay, endDay, lckRegularStandings, lckIds } from '../js/engine/season.js';
import { seasonTick, newSeason, acceptOffer } from '../js/engine/career.js';
import { ovr } from '../js/engine/players.js';
import { avg } from '../js/core/util.js';

const args = process.argv.slice(2);
const N = Number(args.find(a => /^\d+$/.test(a)) || 10);
const CHAIN = args.includes('--chain');

const stats = {
  rank: {}, playoffs: {}, worldsQual: {}, lckTitles: {}, intlRegion: { fs: {}, msi: {}, worlds: {} }, intlTeam: { fs: {}, msi: {}, worlds: {} },
  games: 0, dur: 0, kills: 0, durs: [], killsArr: [], sizes: [], upsets: 0, seriesCount: 0,
};
const inc = (o, k, v = 1) => { o[k] = (o[k] || 0) + v; };

function runSeason(state, rng) {
  let guard = 0;
  while (guard++ < 400) {
    beginDay(state, rng);
    endDay(state, rng);
    const evs = seasonTick(state, rng);
    if (state.fa && state.fa.status !== 'signed' && state.fa.offers.length) {
      const best = state.fa.offers.filter(o => o.status === 'open').sort((a, b) => b.salary - a.salary)[0];
      if (best) acceptOffer(state, rng, best.id);
    }
    if (evs.some(e => e.type === 'newSeasonReady')) return true;
  }
  return false;
}

function collect(state) {
  const C = state.season.comps;
  const reg = lckRegularStandings(state).order;
  const po = C.lckpo.result ? C.lckpo.result.placements : [];
  const finalOrder = [...po.filter(id => reg.includes(id)), ...reg.filter(id => !po.includes(id))];
  finalOrder.forEach((id, i) => { (stats.rank[id] = stats.rank[id] || []).push(i + 1); });
  for (const id of [...(C.lckpo.direct || []), ...((C.lckpo.gauntlet && C.lckpo.gauntlet.qualified) || [])]) inc(stats.playoffs, id);
  for (const id of po.slice(0, 4)) inc(stats.worldsQual, id);
  for (const k of ['lckCup', 'lckpo']) if (C[k].result) inc(stats.lckTitles, C[k].result.champion);
  for (const k of ['fs', 'msi', 'worlds']) if (C[k].result) {
    const ch = C[k].result.champion;
    inc(stats.intlRegion[k], state.teams[ch].region);
    inc(stats.intlTeam[k], ch);
  }
  for (const id of state.season.order) for (const m of C[id].matches) {
    if (!m.done) continue;
    stats.seriesCount++;
    for (const g of m.games) { stats.games++; stats.dur += g.d; stats.kills += g.k[0] + g.k[1]; stats.durs.push(g.d); stats.killsArr.push(g.k[0] + g.k[1]); }
  }
}

const t0 = Date.now();
let state, rng;
for (let s = 0; s < N; s++) {
  if (!CHAIN || s === 0) {
    ({ state, rng } = newWorld('sim-' + (s + 1)));
    createUserPlayer(state, rng, { nick: 'SimUser', pos: ['TOP', 'JGL', 'MID', 'ADC', 'SUP'][s % 5], age: 18, style: '캐리형', mains: [] });
    signUserToTeam(state, rng, 'DRX', 'academy', { salary: 3e7, endSeason: state.year, buyout: 1e8, starter: false });
    createSeason(state, rng);
  }
  const yr = state.year;
  const ok = runSeason.call(null, state, rng);
  // runSeason 은 새 시즌으로 넘어가기 직전에 newSeason을 호출하지 않으므로 여기서 통계 후 넘김
  collect(state);
  stats.sizes.push(JSON.stringify(state).length);
  const lckStr = lckIds().map(id => `${id}:${Math.round(avg(Object.keys(state.teams[id].squadOf).filter(p => state.teams[id].squadOf[p] === 'main' && state.players[p]).map(p => ovr(state.players[p]))))}`).join(' ');
  console.log(`시즌 ${yr} 완료${ok ? '' : ' (경고: 시즌 종료 미도달)'} · LCK컵 ${state.season.comps.lckCup.result.champion} · FS ${state.season.comps.fs.result.champion} · MSI ${state.season.comps.msi.result.champion} · LCK PO ${state.season.comps.lckpo.result.champion} · Worlds ${state.season.comps.worlds.result.champion}`);
  if (CHAIN) { console.log('   전력: ' + lckStr); newSeason(state, rng); }
}

const pct = (arr, p) => { const a = arr.slice().sort((x, y) => x - y); return a[Math.floor(a.length * p)]; };
console.log(`\n=== ${N}시즌 결과 (${((Date.now() - t0) / 1000).toFixed(1)}초) ===`);
console.log('\n[LCK 팀별 평균 최종 순위 / 플레이오프 진출 / 월즈 진출 / LCK 우승(컵+PO)]');
for (const id of lckIds().sort((a, b) => avg(stats.rank[a]) - avg(stats.rank[b]))) {
  console.log(`  ${id.padEnd(4)} 평균 ${avg(stats.rank[id]).toFixed(1).padStart(4)}위  PO ${String(stats.playoffs[id] || 0).padStart(2)}회  월즈 ${String(stats.worldsQual[id] || 0).padStart(2)}회  우승 ${stats.lckTitles[id] || 0}`);
}
console.log('\n[국제 대회 우승 지역 분포]');
for (const k of ['fs', 'msi', 'worlds']) console.log(`  ${k.padEnd(6)} ${Object.entries(stats.intlRegion[k]).map(([r, n]) => `${r} ${n}`).join(', ')}   (팀: ${Object.entries(stats.intlTeam[k]).map(([r, n]) => `${r} ${n}`).join(', ')})`);
const avgDur = stats.dur / stats.games / 60, avgK = stats.kills / stats.games;
console.log(`\n[경기] 총 ${stats.games}세트 · 평균 경기 시간 ${avgDur.toFixed(1)}분 (10%~90%: ${(pct(stats.durs, 0.1) / 60).toFixed(0)}~${(pct(stats.durs, 0.9) / 60).toFixed(0)}분) · 평균 총 킬 ${avgK.toFixed(1)} (10%~90%: ${pct(stats.killsArr, 0.1)}~${pct(stats.killsArr, 0.9)})`);
console.log(`[저장 크기] 평균 ${(avg(stats.sizes) / 1024).toFixed(0)}KB`);
const bottom = lckIds().filter(id => ['DRX', 'DNS', 'BRO'].includes(id));
const sTier = ['GEN', 'HLE', 'T1'];
const sTitles = sTier.reduce((a, id) => a + (stats.lckTitles[id] || 0), 0);
const allTitles = Object.values(stats.lckTitles).reduce((a, b) => a + b, 0);
const checks = [
  ['평균 경기 시간 28~34분', avgDur >= 28 && avgDur <= 34],
  ['평균 총 킬 18~32', avgK >= 18 && avgK <= 32],
  ['S티어 팀이 LCK 우승 다수(60% 이상)', sTitles / Math.max(1, allTitles) >= 0.6],
  ['S티어 우승이 한 팀에 몰리지 않음', sTier.filter(id => stats.lckTitles[id]).length >= Math.min(2, allTitles)],
  ['하위 팀도 가끔 플레이오프', bottom.some(id => stats.playoffs[id] > 0)],
];
console.log('\n[목표 점검]');
for (const [k, v] of checks) console.log(`  ${v ? '✓' : '✗'} ${k}`);
