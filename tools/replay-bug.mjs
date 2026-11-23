// ============================================================
//  버그 신고 재현기
//  사용: node tools/replay-bug.mjs bug-reports/bug-XXXX.json [--from 초]
//  경기 화면의 "🐞 버그 신고" 버튼으로 받은 JSON을 읽어, 같은 입력·시드·선택으로 경기를 그대로 다시 돌린다.
//  1) 신고 시점의 선수 상태가 똑같이 재현되는지 확인
//  2) 그 경기에 정합성 검사기(tools/lib/match-checker.mjs)를 적용
//  3) 신고 직전 30초의 타임라인(팀 계획, 선수 위치·임무, 이벤트)을 출력
// ============================================================
import fs from 'node:fs';
import { createMatch, allPlayers } from '../js/engine/match.js';
import { regionOf, regionKo } from '../js/engine/mapgeo.js';
import { opts, runChecked, viol, violCount } from './lib/match-checker.mjs';

const file = process.argv[2];
if (!file) { console.log('사용: node tools/replay-bug.mjs <버그 신고 JSON>'); process.exit(2); }
const rep = JSON.parse(fs.readFileSync(file, 'utf8'));
if (rep.kind !== 'lckc-bug-report' || !rep.input) { console.log('버그 신고 파일이 아닙니다.'); process.exit(2); }
const from = process.argv.includes('--from') ? Number(process.argv[process.argv.indexOf('--from') + 1]) : rep.gameT - 30;
const fmt = t => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;

const inp = rep.input;
const g = createMatch({ ...inp, visual: true, keepInput: true });
g.userState = inp.userMods || undefined;
const queue = (rep.choices || []).slice();
let mismatch = 0;
const chooseOpt = (g, sc) => {
  const i = queue.findIndex(c => c.t === sc.t);
  if (i < 0 && sc.t >= rep.gameT) { console.log(`  · ${fmt(sc.t)} 장면(${sc.id})은 신고 시점에 열려 있던 장면 (선택 전)`); return null; }
  if (i < 0) { mismatch++; console.log(`  ! ${fmt(sc.t)} 장면(${sc.id})의 선택 기록이 없음 → 가장 안전한 선택지`); return sc.safest; }
  const c = queue.splice(i, 1)[0];
  if (c.id !== sc.id) { mismatch++; console.log(`  ! ${fmt(sc.t)} 장면이 다름: 기록 ${c.id} / 재현 ${sc.id}`); }
  return c.opt;
};
opts.MAXSHOW = 20;
const timeline = [];
runChecked(g, 'bug', {
  chooseOpt, stopAt: rep.gameT,
  onTick: (g, evs) => {
    if (g.t < from) return;
    timeline.push({ t: g.t, plans: g.sides.map(s => s.planLabel), ps: allPlayers(g).map(p => ({ nick: p.nick, side: p.side, x: p.x, y: p.y, alive: p.alive, hp: p.hp, task: p.chan ? p.chan.kind : p.task ? p.task.kind : '-' })), evs: evs.filter(e => e.type !== 'move' || e.kind !== 'respawn') });
  },
});

console.log(`\n=== 버그 재현: 시드 ${rep.seed}, ${rep.gameTime} ===`);
if (rep.note) console.log(`메모: ${rep.note}`);
// 1) 상태 비교
const last = rep.recent && rep.recent[rep.recent.length - 1];
if (last && last.t === g.t) {
  let diff = 0;
  for (const [pid, x, y, al] of last.ps) { const p = g.byId[pid]; if (!p || Math.abs(p.x - x) > 1e-3 || Math.abs(p.y - y) > 1e-3 || (p.alive ? 1 : 0) !== al) diff++; }
  console.log(diff === 0 && !mismatch ? '재현 일치 ✓ (신고 시점 선수 10명의 위치·생존이 같음)' : `재현 불일치 ✗ (다른 선수 ${diff}명, 장면 불일치 ${mismatch}건) — 엔진이 신고 이후 바뀌었을 수 있음`);
} else console.log(`재현 시각 ${fmt(g.t)} (신고 ${rep.gameTime})`);
// 2) 검사 결과
console.log(`\n[정합성 검사] 이 경기 위반 ${violCount()}건`);
for (const [k, v] of Object.entries(viol)) { console.log(`  ✗ ${k} ${v.n}건`); for (const ex of v.ex) console.log(`      - ${ex}`); }
// 3) 타임라인
console.log(`\n[타임라인 ${fmt(from)} ~ ${fmt(g.t)}]`);
for (const tk of timeline) {
  console.log(`\n${fmt(tk.t)}  블루: ${tk.plans[0]}  /  레드: ${tk.plans[1]}`);
  for (const p of tk.ps) console.log(`   ${p.side === 0 ? 'B' : 'R'} ${p.nick.padEnd(10)} ${p.alive ? '' : '(사망) '}${p.task.padEnd(10)} (${p.x.toFixed(3)}, ${p.y.toFixed(3)}) ${regionKo(regionOf(p.x, p.y))} 체력 ${(p.hp * 100).toFixed(0)}%`);
  for (const e of tk.evs) console.log(`   ▶ ${e.type}${e.kind ? ':' + e.kind : ''}${e.obj ? ' ' + e.obj : ''}${e.lane ? ' ' + e.lane : ''}${e.pos ? ` @(${e.pos[0].toFixed(3)}, ${e.pos[1].toFixed(3)}) ${regionKo(e.region || regionOf(...e.pos))}` : ''}${e.parts ? ' 참여 ' + e.parts.map(pid => g.byId[pid] ? g.byId[pid].nick : pid).join(',') : ''}`);
}
