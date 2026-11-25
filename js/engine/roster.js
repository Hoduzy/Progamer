// 로스터: 출전 명단, 주전 결정, 콜업/강등
import { CONFIG } from '../config.js';
import { clamp, avg, POS } from '../core/util.js';
import { ovr } from '../stats.js';
import { competitorOf, addMsg, addNews } from './state.js';

export const isAcademyRef = ref => ref.endsWith(':A');
export const teamIdOf = ref => ref.replace(':A', '');

export function teamInfo(state, ref) {
  const t = state.teams[teamIdOf(ref)];
  if (!t) return { id: ref, code: ref, name: ref, color: '#555' };
  return isAcademyRef(ref)
    ? { id: ref, code: t.code, name: t.name + ' (CL)', color: t.color, academy: true }
    : { id: ref, code: t.code, name: t.name, color: t.color };
}

function available(state, pid) {
  const p = state.players[pid];
  if (!p) return false;
  if (p.isUser && state.user.injury) return false;
  return true;
}

// 포지션별 출전 선수 (AI 기준: 같은 스쿼드에서 OVR 최고)
export function lineup(state, ref) {
  const team = state.teams[teamIdOf(ref)];
  const squad = isAcademyRef(ref) ? 'academy' : 'main';
  const players = POS.map(pos => {
    const ids = team.depth[pos].filter(id => team.squadOf[id] === squad && available(state, id));
    let pick = null;
    const u = state.user && state.players[state.user.pid];
    if (u && u.teamId === team.id && u.pos === pos && state.user.lineupOverride && team.squadOf[u.id] === squad) {
      const o = state.user.lineupOverride;
      if (ids.includes(o)) pick = o;
    }
    if (!pick) {
      const sorted = ids.map(id => state.players[id]).sort((a, b) => ovr(b) + (b.form || 0) * 0.3 - ovr(a) - (a.form || 0) * 0.3);
      pick = sorted[0] ? sorted[0].id : null;
    }
    if (!pick) {
      // 비상: 다른 스쿼드에서 빌림
      const any = team.depth[pos].filter(id => available(state, id));
      pick = any[0] || null;
    }
    return pick ? state.players[pick] : null;
  });
  return players;
}

export function squadForSeries(state, ref) {
  const players = lineup(state, ref);
  const team = state.teams[teamIdOf(ref)];
  // 팀 멘탈 보정: 사용자 팀이면 케미 반영
  let chem = 0, mentalBonus = 0;
  if (state.user && players.some(p => p && p.isUser)) {
    const vals = players.filter(p => p && !p.isUser).map(p => state.user.chem[p.id] || 0);
    chem = avg(vals) / 10;
    mentalBonus = (state.user.mental - 60) * 0.05;
  }
  // 도발 인터뷰를 들은 상대 팀은 동기부여
  if (state.user && state.user.flags && state.user.flags.provokedTeam === teamIdOf(ref)) mentalBonus += 3;
  return { team: teamInfo(state, ref), players, chem, mentalBonus, ref };
}

// ---------------- 주전 결정 (사용자 팀) ----------------
export function rivalProfile(state, pid) {
  const p = state.players[pid];
  const r = p.lastRatings && p.lastRatings.length ? avg(p.lastRatings.slice(-5)) : 6.3 + (ovr(p) - 70) * 0.04;
  const coachTrust = clamp(50 + (ovr(p) - 70) * 2 + (p.form || 0) * 2 + (p.age >= 24 ? 6 : 0), 10, 95);
  return { pid, nick: p.nick, trust: p.trustOverride ?? coachTrust, rating: r, condition: clamp(75 + (p.form || 0) * 2, 40, 95), scrim: state.user.rivalScrim ?? 50, ovr: ovr(p) };
}
export function userProfile(state) {
  const u = state.players[state.user.pid];
  const r = state.user.recentRatings.length ? avg(state.user.recentRatings.slice(-5)) : 6.0;
  return { pid: u.id, nick: u.nick, trust: state.user.trust, rating: r, condition: state.user.condition, scrim: state.user.scrimScore, ovr: ovr(u) };
}
export function lineupScore(pr, rng = null) {
  const W = CONFIG.lineup.w;
  return pr.trust * W.trust + pr.rating * W.rating + pr.condition * W.condition + pr.scrim * W.scrim + pr.ovr * W.ovr + (rng ? rng.normal(0, CONFIG.lineup.noise) : 0);
}

// 1군 경기 전 감독이 주전 결정. 반환: { starter: pid, user, rival, reasons[] }
export function decideStarter(state, rng) {
  const u = state.players[state.user.pid];
  const team = state.teams[u.teamId];
  // 경쟁자 = 같은 스쿼드(1군이면 1군, 2군이면 2군) 같은 포지션 선수. 2군도 감독이 정한다
  // (강등 뒤 2군에 같은 포지션 선수가 있으면 OVR만으로 빠져 경기가 조용히 넘어가던 문제)
  const squad = team.squadOf[u.id];
  const rivalId = team.depth[u.pos].find(id => id !== u.id && team.squadOf[id] === squad);
  state.user.lineupOverride = null;
  if (state.user.injury) {
    state.user.lineupOverride = rivalId || null;
    return { starter: rivalId, injured: true, reasons: ['부상으로 출전 불가'] };
  }
  if (!rivalId) { state.user.lineupOverride = u.id; return { starter: u.id, solo: true, reasons: ['포지션 내 경쟁자 없음'] }; }
  const up = userProfile(state), rp = rivalProfile(state, rivalId);
  let su = lineupScore(up, rng); const sr = lineupScore(rp, rng);
  if (u.contract && u.contract.starter) su += CONFIG.lineup.starterGuarantee;
  const starter = su >= sr ? u.id : rivalId;
  state.user.lineupOverride = starter;
  const W = CONFIG.lineup.w;
  const cmp = [
    ['감독 신뢰도', up.trust, rp.trust, W.trust],
    ['최근 평점', up.rating, rp.rating, W.rating],
    ['컨디션', up.condition, rp.condition, W.condition],
    ['스크림 성적', up.scrim, rp.scrim, W.scrim],
    ['종합 능력치', up.ovr, rp.ovr, W.ovr],
  ];
  const reasons = cmp.map(([k, a, b, w]) => ({ k, user: a, rival: b, diff: (a - b) * w }));
  reasons.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  if (starter === u.id) { state.user.benchStreak = 0; } else state.user.benchStreak++;
  return { starter, user: up, rival: rp, su, sr, reasons };
}

// 주간 평가: 콜업 / 강등
export function weeklyReview(state, rng) {
  const u = state.players[state.user.pid];
  if (!u.teamId) return null;
  const team = state.teams[u.teamId];
  const L = CONFIG.lineup;
  const squad = team.squadOf[u.id];
  const coach = team.coach.nick;
  if (squad === 'academy') {
    const mainId = team.depth[u.pos].find(id => team.squadOf[id] === 'main');
    if (!mainId) { promote(state, u, team); return { type: 'callup' }; }
    const up = userProfile(state), rp = rivalProfile(state, mainId);
    const enoughGames = state.user.recentRatings.length >= 3;
    if (enoughGames && lineupScore(up) > lineupScore(rp) + L.callupMargin * 10 && rng.chance(0.75)) {
      promote(state, u, team);
      addMsg(state, `감독 ${coach}`, '1군 콜업', `2군에서 보여준 경기력을 높게 평가했다. 오늘부터 1군 훈련에 합류해라. 주전 경쟁은 이제부터다.`);
      addNews(state, `[오피셜] ${team.name}, 2군 ${u.nick} 1군 콜업`, 'roster');
      return { type: 'callup' };
    }
  } else {
    const r = state.user.recentRatings.length ? avg(state.user.recentRatings.slice(-5)) : 6.5;
    if (state.user.benchStreak >= L.demoteBenchStreak && (r < L.demoteRatingBelow || state.user.trust < 35) && rng.chance(0.6)) {
      demote(state, u, team);
      addMsg(state, `감독 ${coach}`, '2군 재정비', `한동안 2군에서 실전 감각을 되찾고 와라. 기회는 다시 온다.`);
      addNews(state, `${team.name}, ${u.nick} 2군으로 이동`, 'roster');
      return { type: 'demote' };
    }
  }
  return null;
}

function promote(state, u, team) {
  team.squadOf[u.id] = 'main'; u.squad = 'main';
  // 2군 포지션 공백이면 신인 영입은 career.js에서 처리 (여기선 비워둠)
  state.user.competitorId = competitorOf(state);
  state.user.benchStreak = 0;
  state.user.trust = Math.min(100, state.user.trust + 5);
}
function demote(state, u, team) {
  team.squadOf[u.id] = 'academy'; u.squad = 'academy';
  state.user.competitorId = competitorOf(state);
  state.user.benchStreak = 0;
}
