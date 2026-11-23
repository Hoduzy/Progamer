// 커뮤니티 글·댓글, 인터뷰 효과
import { CONFIG } from '../config.js';
import { clamp, avg, fill } from '../core/util.js';
import { POSTERS, TITLES, BODIES, COMMENTS, INTERVIEW_Q, INTERVIEW_A } from '../../data/community.js';
import { champName } from '../../data/champions.js';
import { teamInfo } from './roster.js';
import { competitorOf } from './state.js';

// info: { played, win, rating, kda, champ, moment, opp, score, compName, cl }
export function generatePosts(state, rng, info) {
  const u = state.players[state.user.pid];
  const team = u.teamId ? state.teams[u.teamId] : null;
  const rivalId = competitorOf(state);
  const vars = {
    me: u.nick, team: team ? team.name : '', opp: info.opp || '상대', champ: info.champ ? champName(info.champ) : '주력 챔피언',
    rating: info.rating != null ? info.rating.toFixed(1) : '-', kda: info.kda || '', rival: rivalId ? state.players[rivalId].nick : '경쟁자',
    moment: info.moment || '그 장면', score: info.score || '', comp: info.compName || 'LCK',
  };
  let cat;
  if (!info.played) cat = 'bench';
  else if (info.cl) cat = info.rating >= 6.8 ? 'cl' : info.win ? 'winBad' : 'loseBad';
  else if (info.win) cat = info.rating >= 6.8 ? 'winGood' : 'winBad';
  else cat = info.rating >= 7.0 ? 'loseGood' : 'loseBad';
  const n = rng.int(CONFIG.community.postsMin, CONFIG.community.postsMax);
  const cats = [cat, cat];
  if (info.moment && info.played) cats.push('meme');
  cats.push('general');
  while (cats.length < n) cats.push(rng.pick([cat, 'general', info.played ? 'meme' : cat]));
  const posts = [];
  const positive = cat === 'winGood' || cat === 'loseGood' || cat === 'cl';
  const usedT = new Set();
  const pickU = (arr, used) => { const left = arr.filter(x => !used.has(x)); const v = rng.pick(left.length ? left : arr); used.add(v); return v; };
  for (const c of cats.slice(0, n)) {
    const title = fill(pickU(TITLES[c], usedT), vars);
    const body = fill(rng.pick(BODIES[c]), vars);
    const usedC = new Set();
    const nc = rng.int(CONFIG.community.commentsMin, CONFIG.community.commentsMax);
    const comments = [];
    for (let i = 0; i < nc; i++) {
      let pool;
      const r = rng.next();
      if (c === 'meme') pool = r < 0.7 ? 'meme' : 'praise';
      else if (c === 'bench') pool = r < 0.6 ? 'rival' : 'neutral';
      else if (c === 'general') pool = r < 0.6 ? 'neutral' : 'meme';
      else if (positive) pool = r < 0.6 ? 'praise' : r < 0.75 ? 'meme' : r < 0.9 ? 'neutral' : 'mock';
      else pool = r < 0.5 ? 'mock' : r < 0.7 ? 'neutral' : r < 0.85 ? 'meme' : 'praise';
      if (pool === 'rival' && !rivalId) pool = 'neutral';
      comments.push({ who: rng.pick(POSTERS), text: fill(pickU(COMMENTS[pool], usedC), vars), up: rng.int(0, 120) });
    }
    posts.push({ date: state.date, title, body, who: rng.pick(POSTERS), up: rng.int(5, positive ? 600 : 300), views: rng.int(300, 9000), comments, cat: c });
  }
  state.community = posts.concat(state.community).slice(0, 40);
  return posts;
}

// 인터뷰
export function interviewQuestion(state, rng, info) {
  const u = state.players[state.user.pid];
  return fill(rng.pick(INTERVIEW_Q), { champ: info.champ ? champName(info.champ) : '', opp: info.opp || '상대' });
}
export function applyInterview(state, rng, kind, info) {
  const us = state.user, u = state.players[us.pid];
  const team = state.teams[u.teamId];
  const mates = Object.keys(team.squadOf).filter(id => id !== u.id && team.squadOf[id] === u.squad);
  const mate = mates.length ? state.players[rng.pick(mates)].nick : '팀원';
  const answer = fill(rng.pick(INTERVIEW_A[kind]), { opp: info.opp || '상대', mate });
  const lines = [];
  if (kind === 'humble') {
    us.fans += 300; us.popularity = clamp(us.popularity + 1, 0, 100); us.trust = clamp(us.trust + 2, 0, 100);
    lines.push('팬 +300', '인기도 +1', '감독 신뢰 +2', '팬들: "인성까지 갖췄네"');
  } else if (kind === 'provoke') {
    const hit = rng.chance(0.55);
    us.fans += hit ? 1800 : 400; us.popularity = clamp(us.popularity + (hit ? 3 : -1), 0, 100); us.trust = clamp(us.trust - 3, 0, 100);
    us.flags.provokedTeam = info.oppRef ? info.oppRef.replace(':A', '') : null;
    lines.push(hit ? '팬 +1,800 · 인기도 +3 · 도발이 화제가 됐다!' : '팬 +400 · 인기도 -1 · 건방지다는 반응도…', '감독 신뢰 -3', `⚠ ${info.opp}의 다음 맞대결 동기부여 상승`);
  } else {
    us.fans += 500; us.trust = clamp(us.trust + 2, 0, 100);
    for (const pid of mates) us.chem[pid] = clamp((us.chem[pid] || 0) + 3, 0, 100);
    lines.push('팬 +500', '감독 신뢰 +2', '팀 케미 +3');
  }
  return { answer, lines };
}
