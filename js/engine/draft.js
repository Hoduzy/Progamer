// 밴픽 (피어리스 드래프트) — AI 밴/픽, 조합 평가, 감독 추천
import { clamp, avg, POS } from '../core/util.js';
import { CHAMPIONS, CHAMP_IDS } from '../../data/champions.js';
import { champMetaPower } from './meta.js';
import { compTraits } from './match.js';

// F = 선픽 팀, S = 후픽 팀
export const DRAFT_ORDER = [
  { t: 'ban', s: 'F' }, { t: 'ban', s: 'S' }, { t: 'ban', s: 'F' }, { t: 'ban', s: 'S' }, { t: 'ban', s: 'F' }, { t: 'ban', s: 'S' },
  { t: 'pick', s: 'F' }, { t: 'pick', s: 'S' }, { t: 'pick', s: 'S' }, { t: 'pick', s: 'F' }, { t: 'pick', s: 'F' }, { t: 'pick', s: 'S' },
  { t: 'ban', s: 'S' }, { t: 'ban', s: 'F' }, { t: 'ban', s: 'S' }, { t: 'ban', s: 'F' },
  { t: 'pick', s: 'S' }, { t: 'pick', s: 'F' }, { t: 'pick', s: 'F' }, { t: 'pick', s: 'S' },
];

// teams: [{team, players(POS 순)}, …] (인덱스 0/1). blueIdx: 블루 진영 팀 인덱스, firstIdx: 선픽 팀 인덱스
export function createDraft({ teams, blueIdx, firstIdx, unavailable = [], meta, userPid = null }) {
  return {
    teams, blueIdx, firstIdx, meta, userPid,
    step: 0, bans: [[], []], picks: [{}, {}], pickOrder: [[], []],
    unavailable: new Set(unavailable), log: [], done: false,
  };
}

export function currentTurn(d) {
  if (d.step >= DRAFT_ORDER.length) return null;
  const o = DRAFT_ORDER[d.step];
  const teamIdx = o.s === 'F' ? d.firstIdx : 1 - d.firstIdx;
  return { type: o.t, teamIdx, step: d.step };
}

export function isTaken(d, id) {
  return d.unavailable.has(id) || d.bans[0].includes(id) || d.bans[1].includes(id)
    || Object.values(d.picks[0]).includes(id) || Object.values(d.picks[1]).includes(id);
}
export function available(d) { return CHAMP_IDS.filter(id => !isTaken(d, id)); }

export function userTeamIdx(d) {
  if (!d.userPid) return -1;
  for (let i = 0; i < 2; i++) if (d.teams[i].players.some(p => p.id === d.userPid)) return i;
  return -1;
}
export function userPos(d) {
  const ti = userTeamIdx(d);
  if (ti < 0) return null;
  return d.teams[ti].players.find(p => p.id === d.userPid).pos;
}

// 챔피언 평가 점수 (AI)
export function champScore(d, teamIdx, pos, id, rng = null, withNoise = true) {
  const c = CHAMPIONS[id];
  if (!c || !c.pos.includes(pos)) return -999;
  const player = d.teams[teamIdx].players[POS.indexOf(pos)];
  const m = player.champs[id] || 0;
  let s = m * 0.55 + champMetaPower(d.meta, id) * 4.2;
  if (c.pos[0] !== pos) s -= 4; // 부 포지션
  // 조합 보완
  const mine = Object.values(d.picks[teamIdx]);
  if (mine.length) {
    const ct = compTraits(mine);
    if (ct.engage < 6) s += (c.traits.engage - 5) * 1.0;
    if (ct.late < 5.5) s += (c.traits.late - 5) * 0.8;
    if (ct.early < 5) s += (c.traits.early - 5) * 0.6;
    const ap = mine.filter(x => CHAMPIONS[x] && CHAMPIONS[x].dmg === 'AP').length;
    if (ap === 0 && mine.length >= 3 && c.dmg === 'AP') s += 3;
    if (ap >= 3 && c.dmg === 'AP') s -= 3;
  }
  // 상대 같은 포지션 상성
  const opp = d.picks[1 - teamIdx][pos];
  if (opp) s += matchup(id, opp) * 1.6;
  if (withNoise && rng) s += rng.normal(0, 4);
  return s;
}

// +면 유리, -면 불리 (대략 -5 ~ +5)
export function matchup(a, b) {
  const A = CHAMPIONS[a], B = CHAMPIONS[b];
  if (!A || !B) return 0;
  let v = (A.traits.early - B.traits.early) * 0.45 + (A.traits.mobility - B.traits.mobility) * 0.2;
  // 원거리 견제형 vs 근접 / 스플릿 대결
  v += (A.traits.split - B.traits.split) * 0.15;
  // 해시 기반 고정 상성 (매번 같은 결과)
  let h = 0; for (const ch of a + '|' + b) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  let h2 = 0; for (const ch of b + '|' + a) h2 = (h2 * 31 + ch.charCodeAt(0)) >>> 0;
  v += ((h % 7) - (h2 % 7)) * 0.35;
  return clamp(Math.round(v * 10) / 10, -5, 5);
}
export function matchupLabel(v) { return v >= 1.5 ? '유리' : v <= -1.5 ? '불리' : '보통'; }

function unfilled(d, teamIdx) { return POS.filter(p => !d.picks[teamIdx][p]); }

// AI 결정: { type:'ban'|'pick', champ, pos } 또는 { needUser:true }
export function aiDecide(d, rng) {
  const turn = currentTurn(d);
  if (!turn) return null;
  const ti = turn.teamIdx;
  const avail = available(d);
  if (turn.type === 'ban') {
    const enemy = 1 - ti;
    const cand = [];
    for (const id of avail) {
      const c = CHAMPIONS[id];
      let best = 0;
      for (const pos of c.pos) {
        if (d.picks[enemy][pos]) continue;
        const pl = d.teams[enemy].players[POS.indexOf(pos)];
        const v = (pl.champs[id] || 0) * 0.5 + champMetaPower(d.meta, id) * 5 + (c.pos[0] === pos ? 3 : 0);
        best = Math.max(best, v);
      }
      cand.push([id, best + rng.normal(0, 5)]);
    }
    cand.sort((a, b) => b[1] - a[1]);
    return { type: 'ban', champ: cand[0][0] };
  }
  // 픽
  const roles = unfilled(d, ti);
  const uPos = userTeamIdx(d) === ti ? userPos(d) : null;
  let best = null;
  for (const pos of roles) {
    for (const id of avail) {
      const s = champScore(d, ti, pos, id, rng);
      if (s <= -900) continue;
      const pri = s + (pos === 'JGL' || pos === 'MID' ? 1 : 0) + rng.normal(0, 3);
      if (!best || pri > best.pri) best = { pos, champ: id, pri, s };
    }
  }
  if (uPos && roles.includes(uPos)) {
    // 사용자 포지션을 이번에 뽑을지: 남은 역할 수와 무작위
    const r = roles.length;
    if (r === 1 || (best && best.pos === uPos) || rng.chance(1 / r * 0.9)) return { needUser: true, pos: uPos };
    if (best && best.pos === uPos) best = null;
    if (!best) {
      const others = roles.filter(p => p !== uPos);
      if (!others.length) return { needUser: true, pos: uPos };
    }
  }
  if (!best || (uPos && best.pos === uPos)) {
    // 사용자 포지션 제외하고 다시
    best = null;
    for (const pos of roles.filter(p => p !== uPos)) {
      for (const id of avail) {
        const s = champScore(d, ti, pos, id, rng);
        if (s <= -900) continue;
        if (!best || s > best.s) best = { pos, champ: id, s };
      }
    }
    if (!best) return { needUser: true, pos: uPos };
  }
  return { type: 'pick', champ: best.champ, pos: best.pos };
}

export function applyDecision(d, dec) {
  const turn = currentTurn(d);
  if (!turn) return;
  const ti = turn.teamIdx;
  if (turn.type === 'ban') {
    d.bans[ti].push(dec.champ);
    d.log.push({ type: 'ban', teamIdx: ti, champ: dec.champ });
  } else {
    d.picks[ti][dec.pos] = dec.champ;
    d.pickOrder[ti].push(dec.pos);
    d.log.push({ type: 'pick', teamIdx: ti, champ: dec.champ, pos: dec.pos });
  }
  d.step++;
  if (d.step >= DRAFT_ORDER.length) d.done = true;
}

// 사용자 개입 없이 끝까지
export function autoDraft(d, rng, userPicker = null) {
  while (!d.done) {
    const dec = aiDecide(d, rng);
    if (dec.needUser) {
      const champ = userPicker ? userPicker(d, dec.pos) : recommend(d, userTeamIdx(d), dec.pos, rng)[0].champ;
      applyDecision(d, { type: 'pick', champ, pos: dec.pos });
    } else applyDecision(d, dec);
  }
  return d;
}

export function recommend(d, teamIdx, pos, rng = null, n = 3) {
  const avail = available(d);
  const list = avail.map(id => ({ champ: id, s: champScore(d, teamIdx, pos, id, null, false) })).filter(x => x.s > -900);
  list.sort((a, b) => b.s - a.s);
  const player = d.teams[teamIdx].players[POS.indexOf(pos)];
  return list.slice(0, n).map(x => {
    const reasons = [];
    const m = player.champs[x.champ] || 0;
    if (m >= 60) reasons.push(`숙련도 ${Math.round(m)}`);
    const tier = d.meta ? d.meta.tiers[x.champ] : null;
    if (tier === 'OP' || tier === '1') reasons.push(`메타 ${tier === 'OP' ? 'OP' : '1티어'}`);
    const opp = d.picks[1 - teamIdx][pos];
    if (opp) { const mu = matchup(x.champ, opp); if (mu >= 1.5) reasons.push(`상대 ${CHAMPIONS[opp].name} 상대 유리`); }
    const mine = Object.values(d.picks[teamIdx]);
    if (mine.length) { const ct = compTraits(mine); if (ct.engage < 6 && CHAMPIONS[x.champ].traits.engage >= 7) reasons.push('이니시 보완'); }
    if (!reasons.length) reasons.push('조합 밸런스');
    return { ...x, reasons };
  });
}

export function compBars(picks) {
  const ids = Object.values(picks);
  if (!ids.length) return { early: 0, late: 0, teamfight: 0, engage: 0, split: 0 };
  const t = compTraits(ids);
  return { early: t.early, late: t.late, teamfight: t.teamfight, engage: t.engage, split: t.split };
}

// 드래프트 결과를 엔진 입력으로
export function draftToMatchInput(d) {
  const mk = ti => ({ team: d.teams[ti].team, players: d.teams[ti].players, picks: POS.map(p => d.picks[ti][p]), mentalBonus: d.teams[ti].mentalBonus || 0, chem: d.teams[ti].chem || 0 });
  return { blue: mk(d.blueIdx), red: mk(1 - d.blueIdx), blueIdx: d.blueIdx };
}
