// 선택 장면 검사: 확률 범위(5~95%), 특정 선택지가 항상 유리한지
// 실행: node tools/sim-choices.mjs [반복수]
import { CONFIG } from '../js/config.js';
import { RNG } from '../js/core/rng.js';
import { POS } from '../js/core/util.js';
import { makePlayer } from '../js/engine/players.js';
import { createMatch, step, userPlayer } from '../js/engine/match.js';
import { newMeta } from '../js/engine/meta.js';
import { buildContext, calcProb, effectValue, eligible } from '../js/engine/choices.js';
import { SCENARIOS } from '../data/scenarios.js';
import { champsForPos } from '../data/champions.js';

const N = Number(process.argv[2] || 400);
const rng = new RNG('choices');
const meta = newMeta(rng, 2026);
const S = CONFIG.scene;

function makeTeam(id, target, userPos = null) {
  const players = POS.map(p => makePlayer(rng, { nick: id + p, pos: p, age: 20, target: target + rng.int(-6, 6) }));
  const picks = POS.map(p => rng.pick(champsForPos(p)));
  players.forEach((pl, i) => { pl.champs[picks[i]] = rng.int(10, 95); });
  return { team: { id, code: id, name: id }, players, picks };
}

const stats = {};
for (const sc of SCENARIOS) stats[sc.id] = { sc, n: 0, min: 100, max: 0, best: sc.opts.map(() => 0), avgP: sc.opts.map(() => 0), elig: 0 };

let ctxCount = 0;
for (let i = 0; i < N; i++) {
  const pos = POS[i % 5];
  const A = makeTeam('A', rng.int(62, 88)), B = makeTeam('B', rng.int(62, 88));
  const user = A.players[POS.indexOf(pos)];
  const g = createMatch({ blue: A, red: B, seed: rng.int(1, 1e9), meta, userPid: user.id, scenes: false });
  const stopAt = rng.int(15, 200) * 10;
  while (!g.over && g.t < stopAt) step(g);
  const me = userPlayer(g);
  if (!me.alive) { me.alive = true; me.hp = 1; }
  const ctx = buildContext(g);
  const us = { condition: rng.int(40, 100), mental: rng.int(30, 95), fatigue: rng.int(0, 90) };
  ctxCount++;
  for (const sc of SCENARIOS) {
    if (sc.pos !== 'ALL' && sc.pos !== pos) continue;
    const st = stats[sc.id];
    st.n++;
    if (eligible(sc, ctx)) st.elig++;
    let bestV = -1e9, bestI = 0;
    sc.opts.forEach((op, oi) => {
      const pr = calcProb(op, ctx, us);
      st.min = Math.min(st.min, pr.p); st.max = Math.max(st.max, pr.p);
      st.avgP[oi] += pr.p;
      const p = pr.p / 100;
      const cs = S.critShare[op.risk], fs = S.fumbleShare[op.risk];
      const rd = S.ratingDelta, rm = S.riskMult[op.risk];
      const ev = p * cs * (effectValue(op.eff.crit) + rd.crit * rm * 2)
        + p * (1 - cs) * (effectValue(op.eff.succ) + rd.success * rm * 2)
        + (1 - p) * (1 - fs) * (effectValue(op.eff.fail) + rd.fail * rm * 2)
        + (1 - p) * fs * (effectValue(op.eff.fumble) + rd.fumble * rm * 2);
      if (ev > bestV) { bestV = ev; bestI = oi; }
    });
    st.best[bestI]++;
  }
}

let problems = 0, outOfRange = 0;
console.log(`장면 ${SCENARIOS.length}개, 무작위 상황 ${ctxCount}개\n`);
const byPos = {};
for (const sc of SCENARIOS) byPos[sc.pos] = (byPos[sc.pos] || 0) + 1;
console.log('포지션별 장면 수:', byPos, '\n');
for (const id in stats) {
  const st = stats[id];
  if (!st.n) continue;
  const shares = st.best.map(b => b / st.n);
  const dom = Math.max(...shares);
  const flag = [];
  if (st.min < S.clampMin || st.max > S.clampMax) { flag.push('범위초과'); outOfRange++; }
  if (dom >= 0.97) { flag.push('한 선택지 우월'); problems++; }
  const avgs = st.avgP.map(v => Math.round(v / st.n));
  console.log(`${flag.length ? '✗' : '✓'} ${id.padEnd(22)} 확률 ${String(st.min).padStart(2)}~${String(st.max).padStart(2)}%  평균 [${avgs.join(', ')}]  최선 비율 [${shares.map(s => (s * 100).toFixed(0) + '%').join(', ')}]  조건충족 ${(st.elig / st.n * 100).toFixed(0)}% ${flag.join(' ')}`);
}
console.log(`\n범위 초과 ${outOfRange}건, 우월 선택지 ${problems}건`);
process.exitCode = (outOfRange || problems) ? 1 : 0;
