// 시상: 시리즈 POM, 라운드 POM, All-LCK 1st/2nd/3rd, 신인왕, 정규시즌 MVP, 결승 MVP, 대회 MVP
import { clamp, avg, POS, POS_KO } from '../core/util.js';
import { addNews, addMsg } from './state.js';
import { ovr } from '../stats.js';

function giveUser(state, name, extra = {}) {
  const us = state.user;
  us.awards = us.awards || [];
  if (us.awards.some(a => a.year === state.year && a.name === name)) return;
  us.awards.push({ year: state.year, name, date: state.date, ...extra });
  us.fans += 3000; us.popularity = clamp(us.popularity + 4, 0, 100); us.trust = clamp(us.trust + 4, 0, 100);
  addMsg(state, 'LCK 사무국', `수상: ${name}`, `축하합니다! ${state.year} ${name} 수상자로 선정되었습니다.`);
  us.pendingAwards = (us.pendingAwards || []).concat([name]);
}
function record(state, name, pid, extra = '') {
  const p = state.players[pid];
  if (!p) return;
  state.awards.push({ year: state.year, name, pid, nick: p.nick, team: p.teamId, pos: p.pos, extra });
  if (p.isUser) giveUser(state, name);
}

// 시리즈 POM: 승리 팀에서 시리즈 평균 평점 최고
export function seriesPOM(state, comp, match, series) {
  const winIdx = series.winner;
  const scores = {};
  for (const gm of series.games) {
    const sideIdx = gm.blueIdx === winIdx ? 0 : 1;
    for (const p of gm.summary.sides[sideIdx].players) (scores[p.pid] = scores[p.pid] || []).push(gm.ratings[p.pid].rating);
  }
  let best = null, bv = -1;
  for (const pid in scores) { const v = avg(scores[pid]); if (v > bv) { bv = v; best = pid; } }
  match.pom = best;
  if (!best) return;
  const p = state.players[best];
  if (p) { p.season.pom = (p.season.pom || 0) + 1; }
  if (comp.id === 'lck12' || comp.id === 'lck34') {
    const round = comp.id === 'lck12' ? (match.round <= 9 ? 1 : 2) : (match.round <= 9 ? 3 : 4);
    const S = state.season;
    S.pom = S.pom || {};
    const R = S.pom[round] = S.pom[round] || {};
    R[best] = (R[best] || 0) + 100;
    // 라운드 종료 확인
    const roundMatches = comp.matches.filter(m => (comp.id === 'lck12' ? (m.round <= 9 ? 1 : 2) : (m.round <= 9 ? 3 : 4)) === round);
    if (roundMatches.every(m => m.done) && !(S.roundPomDone || []).includes(round)) {
      S.roundPomDone = (S.roundPomDone || []).concat([round]);
      const top = Object.entries(R).sort((a, b) => b[1] - a[1] || (state.players[b[0]] ? state.players[b[0]].season.ratingSum : 0) - (state.players[a[0]] ? state.players[a[0]].season.ratingSum : 0))[0];
      if (top) {
        record(state, `LCK ${round}라운드 POM`, top[0], `${top[1]}점`);
        addNews(state, `🏅 LCK ${round}라운드 POM: ${state.players[top[0]] ? state.players[top[0]].nick : '?'} (${top[1]}점)`, 'award');
      }
    }
  }
}

// 결승 MVP: 결승 시리즈 승리 팀 평균 평점 최고
function finalsMVP(state, comp) {
  const finals = comp.matches.filter(m => m.done && (m.node === 'gf' || m.node === 'f'));
  const m = finals[finals.length - 1];
  return m ? m.pom : null;
}

// 대회 종료 시상
export function compAwards(state, comp) {
  if (!comp.result) return;
  const champ = comp.result.champion;
  const names = { lckCup: 'LCK컵', fs: 'First Stand', msi: 'MSI', lckpo: 'LCK 플레이오프', worlds: '월즈' };
  if (!names[comp.id]) return;
  const fm = finalsMVP(state, comp);
  if (fm) {
    record(state, `${names[comp.id]} 결승 MVP`, fm);
    addNews(state, `🏅 ${names[comp.id]} 결승 MVP: ${state.players[fm].nick}`, 'award');
  }
  if (['fs', 'msi', 'worlds', 'lckCup'].includes(comp.id)) {
    // 대회 MVP: 우승 팀 선수 중 대회 평균 평점 최고
    const ids = Object.values(state.players).filter(p => p.teamId === champ.replace(':A', '') && p.season.byComp && p.season.byComp[comp.id] && p.season.byComp[comp.id].g >= 3);
    const best = ids.sort((a, b) => b.season.byComp[comp.id].r / b.season.byComp[comp.id].g - a.season.byComp[comp.id].r / a.season.byComp[comp.id].g)[0];
    if (best) {
      record(state, `${comp.name} MVP`, best.id);
      addNews(state, `🏅 ${comp.name} 대회 MVP: ${best.nick}`, 'award');
    }
  }
  if (comp.id === 'lckpo') seasonAwards(state);
}

// LCK 시즌 시상 (플레이오프 종료 후)
export function seasonAwards(state) {
  if (state.season.awardsDone) return;
  state.season.awardsDone = true;
  const lckPlayers = Object.values(state.players).filter(p => p.teamId && state.teams[p.teamId] && state.teams[p.teamId].region === 'LCK' && p.season.lckGames >= 12);
  const avgR = p => p.season.lckRatingSum / p.season.lckGames + (p.season.pom || 0) * 0.02;
  const ceremony = [];
  for (const pos of POS) {
    const list = lckPlayers.filter(p => p.pos === pos).sort((a, b) => avgR(b) - avgR(a));
    ['1st', '2nd', '3rd'].forEach((t, i) => { if (list[i]) { record(state, `All-LCK ${t} 팀 (${POS_KO[pos]})`, list[i].id); ceremony.push(`All-LCK ${t} ${POS_KO[pos]}: ${list[i].nick}`); } });
  }
  const rookies = lckPlayers.filter(p => p.rookieSeason === state.year).sort((a, b) => avgR(b) - avgR(a));
  if (rookies[0]) { record(state, '신인왕', rookies[0].id); ceremony.push(`신인왕: ${rookies[0].nick}`); }
  const mvpPool = lckPlayers.filter(p => p.season.lckGames >= 20).sort((a, b) => (avgR(b) + (b.season.pom || 0) * 0.03) - (avgR(a) + (a.season.pom || 0) * 0.03));
  if (mvpPool[0]) { record(state, '정규시즌 MVP', mvpPool[0].id); ceremony.push(`정규시즌 MVP: ${mvpPool[0].nick}`); }
  state.season.ceremony = ceremony;
  addNews(state, `🏆 ${state.year} LCK 어워드 발표 — ${ceremony.slice(-2).join(' · ')}`, 'award');
}
