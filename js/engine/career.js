// 계약·연봉·FA·이적·노화·은퇴·신인·다음 시즌
import { CONFIG } from '../config.js';
import { clamp, avg, POS, dateAdd, STAT_KEYS } from '../core/util.js';
import { ovr, makePlayer, marketValue, emptySeason, potentialGrade } from './players.js';
import { addNews, addMsg, regionTarget, competitorOf } from './state.js';
import { createSeason, lckRegularStandings, lckIds } from './season.js';
import { REGIONS } from '../../data/teams.js';

const TIER_OF = o => { const T = CONFIG.tierThresholds; return o >= T.S ? 'S' : o >= T.A ? 'A' : o >= T.B ? 'B' : o >= T.C ? 'C' : 'D'; };
const BUDGET = CONFIG.salary.teamBudget;
const REGION_PAY = CONFIG.salary.regionPay;

export function teamStrength(state, tid) {
  const t = state.teams[tid];
  const ids = Object.keys(t.squadOf).filter(id => t.squadOf[id] === 'main' && state.players[id]);
  const best = POS.map(pos => Math.max(0, ...t.depth[pos].filter(id => t.squadOf[id] === 'main' && state.players[id]).map(id => ovr(state.players[id]))));
  return avg(best.filter(Boolean)) || avg(ids.map(id => ovr(state.players[id])));
}
export function posStarterOvr(state, tid, pos) {
  const t = state.teams[tid];
  const ids = t.depth[pos].filter(id => t.squadOf[id] === 'main' && state.players[id] && !state.players[id].isUser);
  return ids.length ? Math.max(...ids.map(id => ovr(state.players[id]))) : 0;
}

// ---------------- 시즌 단계 전환 (endDay 이후 호출) ----------------
export function seasonTick(state, rng) {
  const S = state.season;
  const out = [];
  // 월급 (매달 25일)
  if (state.date.endsWith('-25') && state.user.pid) {
    const u = state.players[state.user.pid];
    if (u.contract) { const pay = Math.round(u.contract.salary / 12 / 10000) * 10000; state.user.money += pay; }
  }
  if (S.phase === 'season' && S.order.every(id => S.comps[id].done)) {
    S.phase = 'offseason';
    out.push({ type: 'seasonEnd' });
  }
  if ((S.phase === 'season' || S.phase === 'offseason') && state.date >= S.faStart && S.comps.worlds.done) {
    S.phase = 'fa';
    startFA(state, rng);
    out.push({ type: 'faStart' });
  }
  if (S.phase === 'fa' && state.date >= S.faEnd) {
    S.phase = 'faClosed';
    out.push({ type: 'faEnd' });
  }
  if (state.date >= `${state.year}-12-31` && S.phase !== 'season') {
    out.push({ type: 'newSeasonReady' });
  }
  return out;
}

// ---------------- 사용자 평가 ----------------
export function userEval(state) {
  const u = state.players[state.user.pid];
  const S = u.season;
  const avgR = S.games ? S.ratingSum / S.games : 6.0;
  const awards = (state.user.awards || []).filter(a => a.year === state.year).length;
  const ageF = u.age <= 21 ? 4 : u.age <= 24 ? 2 : u.age <= 26 ? 0 : -3 * (u.age - 26);
  const potF = (u.hidden.potential - ovr(u)) * 0.15;
  return Math.round(ovr(u) + (avgR - 6.3) * 4 + awards * 2.5 + state.user.popularity * 0.05 + ageF + potF);
}

// ---------------- FA 시작 ----------------
export function startFA(state, rng) {
  const u = state.players[state.user.pid];
  const fa = state.fa = { offers: [], requested: false, status: 'contract', log: [], signed: null, nextOfferId: 1 };
  // AI 계약 만료 처리
  aiContracts(state, rng);
  if (!u.contract || u.contract.endSeason <= state.year) {
    fa.status = 'free';
    generateOffers(state, rng, { fromOwnTeam: true });
    addMsg(state, '에이전트', 'FA 시장 개장', `계약이 끝났습니다. ${fa.offers.length}개 팀이 제안을 보냈어요. 연봉 협상도 가능하지만, 너무 세게 나가면 제안이 철회될 수 있습니다. FA 기간은 ${state.season.faEnd.slice(5).replace('-', '월 ')}일까지입니다.`);
  } else {
    addMsg(state, '에이전트', 'FA 기간', `계약이 ${u.contract.endSeason} 시즌까지 남아 있습니다. 다른 팀으로 가고 싶다면 구단에 이적을 요청할 수 있어요. 받아들여질지는 구단 결정입니다.`);
  }
}

export function generateOffers(state, rng, { fromOwnTeam = false, buyoutNeeded = false } = {}) {
  const u = state.players[state.user.pid];
  const fa = state.fa;
  const ev = userEval(state);
  const myOvr = ovr(u);
  const pop = state.user.popularity;
  const base = marketValue(u, pop);
  const cands = Object.values(state.teams).filter(t => t.id !== u.teamId || fromOwnTeam);
  for (const t of cands) {
    const own = t.id === u.teamId;
    const starter = posStarterOvr(state, t.id, u.pos);
    const need = clamp((myOvr - starter + 6) / 12, 0.05, 1.2);
    const lck = t.region === 'LCK';
    let p = CONFIG.fa.offerInterest * need * (lck ? 1 : CONFIG.fa.overseasShare * 1.6) * (ev >= 70 ? 1.2 : ev >= 60 ? 0.9 : 0.6);
    if (buyoutNeeded) p *= 0.55;
    if (own) p = state.user.trust >= 35 || ev >= 62 ? 0.95 : 0.4;
    if (!rng.chance(clamp(p, 0, 0.95))) continue;
    const squad = !lck ? 'main' : (myOvr >= starter - 7 || ev >= 72 ? 'main' : 'academy');
    let salary = base * rng.float(0.85, 1.3) * BUDGET[t.tier] * REGION_PAY[t.region] * (squad === 'academy' ? 0.55 : 1);
    if (own) salary *= 1.05;
    salary = Math.max(CONFIG.salary.minAcademy, Math.round(salary / 1e6) * 1e6);
    const years = rng.int(1, 3);
    const starterG = squad === 'main' && myOvr >= starter - 1 && rng.chance(0.7);
    fa.offers.push({
      id: fa.nextOfferId++, teamId: t.id, salary, years, squad, starter: starterG, own,
      buyout: Math.round(salary * rng.float(...CONFIG.salary.buyoutMult) / 1e6) * 1e6,
      strength: Math.round(teamStrength(state, t.id)), status: 'open', rounds: 0,
    });
  }
  // 최소 1개 보장
  if (!fa.offers.some(o => o.status === 'open')) {
    const lck = Object.values(state.teams).filter(t => t.region === 'LCK' && t.id !== u.teamId);
    const t = rng.pick(lck);
    fa.offers.push({ id: fa.nextOfferId++, teamId: t.id, salary: Math.max(CONFIG.salary.minAcademy, Math.round(base * 0.6 / 1e6) * 1e6), years: 1, squad: 'academy', starter: false, own: false, buyout: Math.round(base * 1.5 / 1e6) * 1e6, strength: Math.round(teamStrength(state, t.id)), status: 'open', rounds: 0 });
  }
  fa.offers.sort((a, b) => b.salary - a.salary);
}

// 협상: level 'small' | 'mid' | 'big'
export function negotiate(state, rng, offerId, level) {
  const o = state.fa.offers.find(x => x.id === offerId);
  if (!o || o.status !== 'open') return null;
  const N = CONFIG.salary.negotiate[level];
  const ev = userEval(state);
  const p = clamp(N.accept + (ev - 70) * 0.01 - o.rounds * 0.12 + (o.own ? 0.08 : 0), 0.05, 0.95);
  o.rounds++;
  if (rng.chance(p)) {
    o.salary = Math.round(o.salary * (1 + N.raise) / 1e6) * 1e6;
    if (level !== 'small' && rng.chance(0.3)) o.starter = o.squad === 'main' ? true : o.starter;
    return { ok: true, offer: o, p };
  }
  if (rng.chance(CONFIG.salary.withdrawOnReject * (level === 'big' ? 1.5 : level === 'mid' ? 1 : 0.5))) {
    o.status = 'withdrawn';
    return { ok: false, withdrawn: true, offer: o, p };
  }
  return { ok: false, offer: o, p };
}

export function requestTransfer(state, rng) {
  const fa = state.fa;
  if (fa.requested) return null;
  fa.requested = true;
  const p = clamp(CONFIG.salary.transferRequestAccept + (50 - state.user.trust) / 200, 0.1, 0.8);
  if (rng.chance(p)) {
    fa.status = 'transfer';
    generateOffers(state, rng, { buyoutNeeded: true });
    return { ok: true, p };
  }
  state.user.mental = clamp(state.user.mental - 6, 0, 100);
  state.user.trust = clamp(state.user.trust - 8, 0, 100);
  return { ok: false, p };
}

export function acceptOffer(state, rng, offerId) {
  const o = state.fa.offers.find(x => x.id === offerId);
  if (!o || o.status !== 'open') return false;
  o.status = 'accepted';
  for (const x of state.fa.offers) if (x !== o && x.status === 'open') x.status = 'declined';
  state.fa.signed = o;
  state.fa.status = 'signed';
  const u = state.players[state.user.pid];
  const team = state.teams[o.teamId];
  const contract = { salary: o.salary, endSeason: state.year + o.years, buyout: o.buyout, starter: o.starter };
  if (o.teamId !== u.teamId) {
    moveUser(state, rng, o.teamId, o.squad, contract);
    addNews(state, `[오피셜] ${team.name}, ${u.nick} 영입 (${o.years}년)`, 'roster');
  } else {
    u.contract = contract;
    if (o.squad === 'main' && u.squad !== 'main') { team.squadOf[u.id] = 'main'; u.squad = 'main'; }
    addNews(state, `[오피셜] ${team.name}, ${u.nick}와(과) 재계약 (${o.years}년)`, 'roster');
  }
  state.user.salaryHistory.push({ year: state.year + 1, team: o.teamId, salary: o.salary });
  state.user.trust = o.starter ? 60 : 45;
  return true;
}

function moveUser(state, rng, teamId, squad, contract) {
  const u = state.players[state.user.pid];
  if (u.teamId) {
    const old = state.teams[u.teamId];
    old.depth[u.pos] = old.depth[u.pos].filter(id => id !== u.id);
    delete old.squadOf[u.id];
    fillTeam(state, rng, old);
  }
  const t = state.teams[teamId];
  u.teamId = teamId; u.squad = squad; u.contract = contract; u.region = t.region;
  if (squad === 'academy') {
    for (const pid of t.depth[u.pos].filter(id => t.squadOf[id] === 'academy')) releasePlayer(state, t, pid);
  }
  t.depth[u.pos].push(u.id);
  t.squadOf[u.id] = squad;
  if (contract.starter) state.user.lineupPriority = true;
  state.user.chem = {};
  state.user.competitorId = competitorOf(state);
  state.user.recentRatings = [];
  state.user.benchStreak = 0;
}

function releasePlayer(state, team, pid) {
  const p = state.players[pid];
  for (const pos of POS) team.depth[pos] = team.depth[pos].filter(id => id !== pid);
  delete team.squadOf[pid];
  if (p) { p.teamId = null; p.squad = 'fa'; p.contract = null; if (!state.faPool.includes(pid)) state.faPool.push(pid); }
}

function signPlayer(state, team, pid, squad, years, rng) {
  const p = state.players[pid];
  state.faPool = state.faPool.filter(x => x !== pid);
  p.teamId = team.id; p.squad = squad; p.region = team.region;
  p.contract = { salary: Math.round(marketValue(p) * rng.float(0.9, 1.2) / 1e6) * 1e6, endSeason: state.year + years, buyout: 0, starter: squad === 'main' };
  team.depth[p.pos].push(pid); team.squadOf[pid] = squad;
}

function newRookie(state, rng, team, pos, squad) {
  const base = regionTarget(team.tier, team.region) + (squad === 'academy' ? CONFIG.academyOffset : -4);
  const p = makePlayer(rng, { nick: state.namePool.pop() || 'Rookie' + rng.int(100, 999), pos, age: rng.int(17, 19), target: base + rng.int(-3, 4), teamId: team.id, squad, region: team.region, season: state.year + 1 });
  p.contract = { salary: marketValue(p), endSeason: state.year + rng.int(1, 2), buyout: 0, starter: false };
  state.players[p.id] = p;
  team.depth[pos].push(p.id); team.squadOf[p.id] = squad;
  return p;
}

// 팀 로스터 빈자리 채우기
export function fillTeam(state, rng, team) {
  for (const pos of POS) {
    const main = team.depth[pos].filter(id => team.squadOf[id] === 'main' && state.players[id]);
    if (!main.length) {
      // 2군 승격 or FA 영입 or 신인
      const acad = team.depth[pos].filter(id => team.squadOf[id] === 'academy' && state.players[id] && !state.players[id].isUser).sort((a, b) => ovr(state.players[b]) - ovr(state.players[a]));
      const fas = state.faPool.filter(id => state.players[id] && state.players[id].pos === pos && !state.players[id].isUser).sort((a, b) => ovr(state.players[b]) - ovr(state.players[a]));
      const target = regionTarget(team.tier, team.region);
      if (fas.length && ovr(state.players[fas[0]]) >= target - 6 && (!acad.length || ovr(state.players[fas[0]]) > ovr(state.players[acad[0]]) + 2)) {
        signPlayer(state, team, fas[0], 'main', rng.int(1, 2), rng);
        if (team.region === 'LCK') addNews(state, `[오피셜] ${team.name}, ${state.players[fas[0]].nick}(${pos}) 영입`, 'roster');
      } else if (acad.length && team.region === 'LCK') {
        team.squadOf[acad[0]] = 'main'; state.players[acad[0]].squad = 'main';
        addNews(state, `${team.name}, 2군 ${state.players[acad[0]].nick} 1군 승격`, 'roster');
      } else newRookie(state, rng, team, pos, 'main');
    }
    if (team.region === 'LCK') {
      const acad = team.depth[pos].filter(id => team.squadOf[id] === 'academy' && state.players[id]);
      if (!acad.length) newRookie(state, rng, team, pos, 'academy');
    }
  }
}

// AI 계약 만료·이적
function aiContracts(state, rng) {
  const moved = [];
  for (const team of Object.values(state.teams)) {
    for (const pid of Object.keys(team.squadOf)) {
      const p = state.players[pid];
      if (!p || p.isUser || !p.contract) continue;
      if (p.contract.endSeason > state.year) continue;
      if (rng.chance(CONFIG.fa.aiMoveChance + (p.age >= 27 ? 0.1 : 0))) {
        releasePlayer(state, team, pid);
        moved.push(pid);
      } else {
        p.contract.endSeason = state.year + rng.int(1, 2);
        p.contract.salary = Math.round(marketValue(p) * rng.float(0.95, 1.2) / 1e6) * 1e6;
      }
    }
  }
  // 강팀부터 빈자리 + 업그레이드 영입
  const teams = Object.values(state.teams).sort((a, b) => b.prestige - a.prestige + rng.normal(0, 8));
  for (const team of teams) {
    fillTeam(state, rng, team);
    // 업그레이드 1건
    const weakest = POS.map(pos => [pos, posStarterOvr(state, team.id, pos)]).filter(x => x[1] > 0).sort((a, b) => a[1] - b[1])[0];
    if (!weakest) continue;
    const [pos, cur] = weakest;
    const fas = state.faPool.filter(id => state.players[id] && state.players[id].pos === pos && !state.players[id].isUser).sort((a, b) => ovr(state.players[b]) - ovr(state.players[a]));
    if (fas.length && ovr(state.players[fas[0]]) > cur + 2 && rng.chance(team.prestige / 100)) {
      const pid = fas[0];
      // 기존 주전은 2군/방출
      const oldMain = team.depth[pos].find(id => team.squadOf[id] === 'main' && !state.players[id].isUser);
      signPlayer(state, team, pid, 'main', rng.int(1, 3), rng);
      if (oldMain) {
        if (team.region === 'LCK' && state.players[oldMain].age <= 22) { team.squadOf[oldMain] = 'academy'; state.players[oldMain].squad = 'academy'; }
        else releasePlayer(state, team, oldMain);
      }
      const p = state.players[pid];
      if (team.region === 'LCK') addNews(state, `[오피셜] ${team.name}, ${p.nick}(${pos}, 종합 ${Math.round(ovr(p))}) 영입`, 'roster');
    }
  }
  if (moved.length) addNews(state, `FA 시장: 계약 만료 선수 ${moved.length}명이 시장에 나왔습니다.`, 'roster');
}

// ---------------- 노화·성장·은퇴 (새 시즌 직전) ----------------
function agePlayers(state, rng) {
  const G = CONFIG.growth;
  const retired = [];
  for (const p of Object.values(state.players)) {
    if (p.squad === 'retired') continue;
    p.age++;
    if (p.isUser) {
      // 사용자: 노화 하락만 (성장은 훈련으로)
      if (p.age >= G.declineStartAge) {
        const d = G.declinePerYear[Math.min(G.declinePerYear.length - 1, p.age - G.declineStartAge)] || 4;
        for (const k of ['mechanics', 'stamina', 'laning']) p.stats[k] = clamp(Math.round(p.stats[k] - d * rng.float(0.6, 1.3)), 30, 99);
      }
      continue;
    }
    const af = G.ageFactor[p.age] ?? 0.1;
    for (const k of STAT_KEYS) {
      let v = p.stats[k];
      if (p.age < G.declineStartAge && v < p.hidden.potential) v += rng.float(0, G.aiSeasonGrowth * 2) * af * p.hidden.growth;
      if (p.age >= G.declineStartAge) {
        const d = G.declinePerYear[Math.min(G.declinePerYear.length - 1, p.age - G.declineStartAge)] || 4;
        if (['mechanics', 'stamina', 'laning'].includes(k)) v -= d * rng.float(0.6, 1.3);
        else if (k === 'decision') v += rng.float(0, 0.8);
      }
      p.stats[k] = clamp(Math.round(v), 30, 99);
    }
    // 은퇴
    const F = CONFIG.fa;
    if (p.age >= F.retireAge[0]) {
      const pr = F.retireBase + (p.age - F.retireAge[0]) * F.retirePerYear + (ovr(p) < 66 ? 0.25 : 0) + (p.age >= F.retireAge[1] ? 0.5 : 0);
      if (rng.chance(pr)) retired.push(p.id);
    } else if (!p.teamId && p.age >= 22 && rng.chance(0.3)) retired.push(p.id);
  }
  for (const pid of retired) {
    const p = state.players[pid];
    if (p.teamId) {
      const t = state.teams[p.teamId];
      if (t.region === 'LCK' && ovr(p) >= 78) addNews(state, `${t.name}의 ${p.nick}(${p.age}세) 현역 은퇴 발표`, 'roster');
      releasePlayer(state, t, pid);
    }
    state.faPool = state.faPool.filter(x => x !== pid);
    p.squad = 'retired'; p.teamId = null;
  }
  // 은퇴 선수는 저장 공간 절약을 위해 정리 (기록만 남김)
  for (const pid of retired) {
    const p = state.players[pid];
    if (!p.isUser) delete state.players[pid];
  }
  // FA 풀 정리: 너무 많으면 약한 선수 삭제
  state.faPool = state.faPool.filter(id => state.players[id]);
  if (state.faPool.length > 40) {
    state.faPool.sort((a, b) => ovr(state.players[b]) - ovr(state.players[a]));
    for (const id of state.faPool.slice(40)) delete state.players[id];
    state.faPool = state.faPool.slice(0, 40);
  }
}

// ---------------- 새 시즌 ----------------
export function newSeason(state, rng) {
  const year = state.year;
  const u = state.players[state.user.pid];
  // 시즌 기록 보관
  const lckOrder = lckFinalOrder(state);
  archiveSeason(state, lckOrder);
  // FA 미계약 처리
  if (state.fa && state.fa.status === 'free' && !state.fa.signed) {
    const best = state.fa.offers.filter(o => o.status === 'open').sort((a, b) => b.salary - a.salary)[0];
    if (best) acceptOffer(state, rng, best.id);
  }
  // 노화·은퇴·신인
  agePlayers(state, rng);
  for (const t of Object.values(state.teams)) fillTeam(state, rng, t);
  // 팀 티어 갱신
  for (const t of Object.values(state.teams)) {
    const s = teamStrength(state, t.id);
    const offs = CONFIG.regionOffset[t.region] || 0;
    const nt = TIER_OF(s - offs);
    t.tier = nt;
    t.prestige = clamp(Math.round(t.prestige * 0.7 + { S: 90, A: 75, B: 60, C: 45, D: 35 }[nt] * 0.3), 20, 100);
  }
  // 선수 시즌 기록 리셋
  for (const p of Object.values(state.players)) {
    if (p.season && p.season.games) p.history = (p.history || []).concat([{ year, team: p.teamId, g: p.season.games, w: p.season.wins, r: +(p.season.ratingSum / p.season.games).toFixed(2), k: p.season.k, d: p.season.d, a: p.season.a }]).slice(-6);
    p.season = emptySeason();
    p.lastRatings = (p.lastRatings || []).slice(-3);
  }
  state.prevStandings = lckOrder;
  state.year = year + 1;
  state.date = `${state.year}-01-02`;
  state.meta.year = state.year; state.meta.num = 1; state.meta.version = `${state.year % 100}.1`;
  state.fa = null;
  state.user.seasonStart = { fans: state.user.fans };
  state.user.recentRatings = state.user.recentRatings.slice(-3);
  createSeason(state, rng);
  addNews(state, `🎆 ${state.year} 시즌 개막! LCK컵 그룹: 바론 ${state.season.cupGroups.baron.join(', ')} / 장로 ${state.season.cupGroups.elder.join(', ')}`, 'comp');
  addMsg(state, `감독 ${state.teams[u.teamId].coach.nick}`, `${state.year} 시즌 시작`, `새 시즌이다. 작년은 잊고 처음부터 증명해라. ${u.squad === 'main' ? '1군 주전 경쟁은 매 경기 새로 시작된다.' : '2군에서 다시 시작하지만 기회는 반드시 온다.'}`);
}

function lckFinalOrder(state) {
  const po = state.season.comps.lckpo;
  const reg = lckRegularStandings(state).order;
  if (po && po.result) {
    const top = po.result.placements.filter(id => reg.includes(id));
    return [...top, ...reg.filter(id => !top.includes(id))];
  }
  return reg;
}

function archiveSeason(state, lckOrder) {
  const u = state.players[state.user.pid];
  const S = u.season;
  const champCount = Object.entries(S.champs).sort((a, b) => b[1] - a[1]);
  const comps = {};
  for (const id of state.season.order) {
    const c = state.season.comps[id];
    comps[id] = { name: c.name, champion: c.result ? c.result.champion : null, placements: c.result ? c.result.placements.slice(0, 8) : [] };
  }
  const rec = {
    year: state.year, team: u.teamId, squad: u.squad, games: S.games, wins: S.wins, k: S.k, d: S.d, a: S.a,
    rating: S.games ? +(S.ratingSum / S.games).toFixed(2) : null, pogs: S.pogs, topChamp: champCount[0] ? champCount[0][0] : null,
    topChamps: champCount.slice(0, 3).map(x => x[0]), salary: u.contract ? u.contract.salary : 0, ovr: Math.round(ovr(u)),
    trophies: state.user.trophies.filter(t => t.year === state.year).map(t => t.name),
    awards: (state.user.awards || []).filter(a => a.year === state.year).map(a => a.name),
    lckRank: lckOrder.indexOf(u.teamId) + 1 || null, fans: state.user.fans, comps,
  };
  state.records.seasons.push(rec);
  // 오래된 대회 경기 데이터는 버림 (용량)
  state.lastSeason = { year: state.year, comps };
}

// ---------------- 은퇴 ----------------
export function careerSummary(state) {
  const u = state.players[state.user.pid];
  const seasons = state.records.seasons.slice();
  const S = u.season;
  if (S.games && !seasons.some(x => x.year === state.year)) {
    const cc = Object.entries(S.champs).sort((a, b) => b[1] - a[1]);
    seasons.push({ year: state.year, team: u.teamId, squad: u.squad, games: S.games, wins: S.wins, k: S.k, d: S.d, a: S.a, rating: +(S.ratingSum / S.games).toFixed(2), pogs: S.pogs, topChamp: cc[0] ? cc[0][0] : null, salary: u.contract ? u.contract.salary : 0, ovr: Math.round(ovr(u)), trophies: state.user.trophies.filter(t => t.year === state.year).map(t => t.name), awards: (state.user.awards || []).filter(a => a.year === state.year).map(a => a.name), partial: true });
  }
  const tot = seasons.reduce((a, s) => ({ g: a.g + s.games, w: a.w + s.wins, k: a.k + s.k, d: a.d + s.d, a: a.a + s.a, pog: a.pog + (s.pogs || 0) }), { g: 0, w: 0, k: 0, d: 0, a: 0, pog: 0 });
  const rated = seasons.filter(s => s.rating);
  return {
    nick: u.nick, pos: u.pos, age: u.age, years: seasons.length, seasons, totals: tot,
    avgRating: rated.length ? +(avg(rated.map(s => s.rating))).toFixed(2) : null,
    trophies: state.user.trophies.slice(), awards: (state.user.awards || []).slice(), fans: state.user.fans,
    peakOvr: Math.max(Math.round(ovr(u)), ...seasons.map(s => s.ovr || 0)), money: state.user.money,
    teams: [...new Set(seasons.map(s => s.team).filter(Boolean))],
  };
}
export function retireUser(state) {
  const sum = careerSummary(state);
  state.user.retired = true;
  const u = state.players[state.user.pid];
  u.squad = 'retired';
  return sum;
}
