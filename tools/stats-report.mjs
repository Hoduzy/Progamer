// 능력치 기준 비교표: LCK 1군 · LCK CL(2군) · 내 선수의 OVR 분포와 능력치 8개 평균
// 사용: node tools/stats-report.mjs [세이브.json] [--style 캐리형] [--diff normal] [--pos MID]
//   세이브 파일(게임의 "JSON 파일로 내보내기" 또는 저장 슬롯 내용)을 주면 그 세이브 기준,
//   없으면 새 월드 + 새 캐릭터(2군 입단 직후) 기준으로 출력한다.
import { readFileSync } from 'node:fs';
import { CONFIG } from '../js/config.js';
import { STAT_KEYS, POS } from '../js/core/util.js';
import { champsForPos, CHAMPIONS } from '../data/champions.js';

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const file = args.find(a => a.endsWith('.json'));
const stats = await import('../js/stats.js').catch(() => null);
const players = await import('../js/engine/players.js');
const ovr = stats ? stats.ovr : players.ovr;
const S = await import('../js/engine/state.js');

let state;
if (file) {
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  state = (S.deserialize(raw.state || raw)).state;
} else {
  const w = S.newWorld(Number(opt('--seed', 20260102)));
  state = w.state;
  const pos = opt('--pos', 'MID');
  const mains = champsForPos(pos).filter(id => CHAMPIONS[id].pos[0] === pos).slice(0, 3);
  S.createUserPlayer(state, w.rng, { nick: 'Me', pos, age: 18, style: opt('--style', '캐리형'), mains, difficulty: opt('--diff', 'normal') });
  S.signUserToTeam(state, w.rng, 'DRX', 'academy', { salary: 3e7, endSeason: state.year, buyout: 1e8, starter: false });
}

const lck = Object.values(state.teams).filter(t => t.region === 'LCK');
const group = squad => lck.flatMap(t => Object.entries(t.squadOf).filter(([, s]) => s === squad).map(([id]) => state.players[id])).filter(p => p && !p.isUser);
const user = state.user ? state.players[state.user.pid] : null;
const rows = [['LCK 1군', group('main')], ['LCK CL(2군)', group('academy')]];
if (user) {
  rows.push(['  CL 같은 포지션', group('academy').filter(p => p.pos === user.pos)]);
  rows.push(['내 선수 (' + user.pos + ')', [user]]);
}
const avg = a => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const KO = { laning: '라인', teamfight: '한타', mechanics: '피지컬', decision: '판단', vision: '시야', mental: '멘탈', pool: '폭', stamina: '체력' };
const pad = (s, n) => s + ' '.repeat(Math.max(0, n - [...String(s)].reduce((a, c) => a + (/[가-힣]/.test(c) ? 2 : 1), 0)));
console.log(file ? `세이브: ${file} (${state.date})` : `새 월드 (시드 ${opt('--seed', 20260102)}) + 새 캐릭터`);
console.log(pad('구분', 20) + pad('인원', 6) + pad('OVR 평균', 10) + pad('최소', 7) + pad('최대', 7) + STAT_KEYS.map(k => pad(KO[k], 7)).join(''));
for (const [name, ps] of rows) {
  const o = ps.map(ovr);
  console.log(pad(name, 20) + pad(ps.length, 6) + pad(avg(o).toFixed(1), 10) + pad(Math.min(...o).toFixed(1), 7) + pad(Math.max(...o).toFixed(1), 7)
    + STAT_KEYS.map(k => pad(avg(ps.map(p => p.stats[k])).toFixed(1), 7)).join(''));
}
if (user) {
  const cl = group('academy').filter(p => p.pos === user.pos);
  console.log(`\n내 선수 OVR ${ovr(user).toFixed(1)} · CL 같은 포지션 평균 ${avg(cl.map(ovr)).toFixed(1)} (차이 ${(ovr(user) - avg(cl.map(ovr))).toFixed(1)}) · 능력치 범위 ${Math.min(...Object.values(user.stats))}~${Math.max(...Object.values(user.stats))}`);
  const clAvg = Object.fromEntries(STAT_KEYS.map(k => [k, avg(cl.map(p => p.stats[k]))]));
  console.log('CL 같은 포지션 평균 대비: ' + STAT_KEYS.map(k => `${KO[k]} ${user.stats[k] - clAvg[k] >= 0 ? '+' : ''}${(user.stats[k] - clAvg[k]).toFixed(1)}`).join(' · '));
}
