// 시리즈 (Bo1/Bo3/Bo5) — 퍼스트 셀렉션, 피어리스 상태, 빠른 시뮬레이션
import { CONFIG } from '../config.js';
import { POS } from '../core/util.js';
import { createDraft, autoDraft, draftToMatchInput } from './draft.js';
import { createMatch, runToEnd, summary } from './match.js';
import { computeRatings, pickPOG } from './rating.js';

// teams: [{ team, players(POS 순), mentalBonus, chem }, ...]  selector: 1세트 퍼스트 셀렉션 팀 인덱스(시드 높은 팀)
export function createSeries({ teams, bo = 3, selector = 0, label = '', compId = null, matchId = null }) {
  return {
    teams, bo, label, compId, matchId, wins: [0, 0], games: [], used: [], selector,
    over: false, winner: null,
  };
}
export const winsNeeded = s => Math.ceil(s.bo / 2);

// AI의 퍼스트 셀렉션
export function aiFirstSelection(rng) {
  if (rng.chance(0.55)) return { kind: 'side', side: rng.chance(0.75) ? 'blue' : 'red' };
  return { kind: 'order', order: rng.chance(0.8) ? 'first' : 'second' };
}
export function aiRemaining(rng, firstChoice) {
  if (firstChoice.kind === 'side') return { kind: 'order', order: rng.chance(0.7) ? 'first' : 'second' };
  return { kind: 'side', side: rng.chance(0.72) ? 'blue' : 'red' };
}
// 선택 결과 → { blueIdx, firstIdx }
export function resolveSelection(selectorIdx, choice, remaining) {
  const other = 1 - selectorIdx;
  let blueIdx, firstIdx;
  const sideC = choice.kind === 'side' ? { who: selectorIdx, side: choice.side } : { who: other, side: remaining.side };
  const orderC = choice.kind === 'order' ? { who: selectorIdx, order: choice.order } : { who: other, order: remaining.order };
  blueIdx = sideC.side === 'blue' ? sideC.who : 1 - sideC.who;
  firstIdx = orderC.order === 'first' ? orderC.who : 1 - orderC.who;
  return { blueIdx, firstIdx };
}

export function recordGame(s, { blueIdx, firstIdx, picks, bans, result }) {
  // result: { summary, ratings, pog }
  const winnerIdx = result.summary.winner === 0 ? blueIdx : 1 - blueIdx;
  s.wins[winnerIdx]++;
  for (const ti of [0, 1]) for (const c of Object.values(picks[ti])) if (!s.used.includes(c)) s.used.push(c);
  s.games.push({ blueIdx, firstIdx, picks, bans, winnerIdx, duration: result.summary.duration, pog: result.pog, summary: result.summary, ratings: result.ratings });
  s.selector = 1 - winnerIdx; // 패배 팀이 다음 세트 선택권
  if (s.wins[winnerIdx] >= winsNeeded(s)) { s.over = true; s.winner = winnerIdx; }
}

// 한 세트를 화면 없이 진행
export function simGame(s, rng, meta) {
  const ch = aiFirstSelection(rng);
  const rem = aiRemaining(rng, ch);
  const { blueIdx, firstIdx } = resolveSelection(s.selector, ch, rem);
  const d = createDraft({ teams: s.teams, blueIdx, firstIdx, unavailable: s.used, meta });
  autoDraft(d, rng);
  const input = draftToMatchInput(d);
  const g = createMatch({ blue: input.blue, red: input.red, seed: rng.int(1, 2 ** 30), meta });
  runToEnd(g);
  const sum = summary(g);
  const ratings = computeRatings(sum);
  const pog = pickPOG(sum, ratings);
  const result = { summary: sum, ratings, pog };
  recordGame(s, { blueIdx, firstIdx, picks: d.picks, bans: d.bans, result });
  return result;
}

export function simSeries(s, rng, meta) {
  let guard = 0;
  while (!s.over && guard++ < 9) simGame(s, rng, meta);
  return s;
}
