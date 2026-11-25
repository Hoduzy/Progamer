// ============================================================
//  추천 루틴: 앞으로 7일의 활동을 실제 공식의 기댓값으로 계산해 고른다
//   - 성장·피로·멘탈·케미·수입 계산은 daily.js / players.js / stats.js의 같은 함수·설정값(CONFIG.daily 등)을 쓴다.
//     무작위 요소는 기댓값으로 계산한다 (스크림 승률, 솔로 랭크, 부상, 방송 논란)
//   - 후보 배치는 빔 탐색: 7일 × 활동 후보, 플랜(CONFIG.advisor.plans)마다 점수 가중치가 다르다
//   - DOM 의존 없음 (tools에서도 쓴다)
// ============================================================
import { CONFIG } from './config.js';
import { clamp, avg, dateAdd, dateDiff, weekday, STAT_KO, STAT_KEYS, POS_KO, WEEKDAY_KO } from './core/util.js';
import { ovrExact } from './stats.js';
import { growStat, masteryGainOf, topChamps } from './engine/players.js';
import { conditionOf, staminaMult, TRAINING, TRAINABLE, actKey } from './engine/daily.js';
import { allMatches, userRef } from './engine/season.js';
import { competitorOf } from './engine/state.js';
import { userProfile, rivalProfile, lineupScore } from './engine/roster.js';
import { champsForPos, CHAMPIONS, champName } from '../data/champions.js';

const A = () => CONFIG.advisor;
const D = () => CONFIG.daily;
const WINDOW = 7;   // 앞으로 7일
export const PLAN_KINDS = ['balance', 'growth', 'condition'];

// ---------- 시작 상태 ----------
function squadMates(state, me) {
  const team = me.teamId ? state.teams[me.teamId] : null;
  return team ? Object.keys(team.squadOf).filter(id => id !== me.id && team.squadOf[id] === me.squad && state.players[id]) : [];
}
// 비교 기준 (약점 계산): 2군이면 1군 주전 경쟁자, 1군이면 LCK 1군 같은 포지션 평균
export function referenceStats(state) {
  const u = state.user, me = state.players[u.pid];
  const rivalId = competitorOf(state);
  const rival = rivalId ? state.players[rivalId] : null;
  if (me.squad === 'academy' && rival && state.teams[me.teamId].squadOf[rivalId] === 'main') {
    return { stats: rival.stats, label: `1군 주전 경쟁자 ${rival.nick}`, short: '주전 경쟁자', rival };
  }
  const mains = Object.values(state.teams).filter(t => t.region === 'LCK')
    .flatMap(t => t.depth[me.pos].filter(id => t.squadOf[id] === 'main' && id !== me.id)).map(id => state.players[id]).filter(Boolean);
  const stats = Object.fromEntries(STAT_KEYS.map(k => [k, avg(mains.map(p => p.stats[k]))]));
  return { stats, label: `LCK 1군 ${POS_KO[me.pos]} 평균`, short: `1군 ${POS_KO[me.pos]} 평균`, rival: rival && state.teams[me.teamId].squadOf[rivalId] === 'main' ? rival : null };
}
export function weaknesses(state) {
  const me = state.players[state.user.pid], ref = referenceStats(state);
  const gaps = TRAINABLE.map(k => ({ k, gap: Math.round((ref.stats[k] - me.stats[k]) * 10) / 10 })).sort((a, b) => b.gap - a.gap);
  return { gaps, top: gaps.slice(0, 3), ref, pos: me.pos };
}
// 메타 챔피언 연습 후보: 이번 패치 1티어 이상 + 내 포지션 + 숙련도 낮음
export function metaCandidate(state) {
  const me = state.players[state.user.pid], M = state.meta;
  if (!M || !M.tiers) return null;
  const order = A().metaTiers;
  const list = champsForPos(me.pos).filter(id => order.includes(M.tiers[id]) && (me.champs[id] || 0) < A().metaMastery);
  list.sort((a, b) => order.indexOf(M.tiers[a]) - order.indexOf(M.tiers[b]) || (me.champs[a] || 0) - (me.champs[b] || 0));
  return list.length ? { champ: list[0], tier: M.tiers[list[0]], mastery: Math.round(me.champs[list[0]] || 0) } : null;
}

// 앞으로 7일의 일정: 날짜, 요일, 경기일, 경기 전날, 경기 다음 날(회복일)
function schedule(state) {
  const ref = userRef(state), N = WINDOW;
  const dates = new Set(allMatches(state).filter(m => !m.done && m.date && ref && m.teams.includes(ref)).map(m => m.date));
  const u = state.user;
  const days = [];
  for (let i = 0; i < N; i++) {
    const date = dateAdd(state.date, i);
    days.push({ i, date, wd: weekday(date), match: dates.has(date) });
  }
  const lastMatch = u.lastMatchDate;
  days.forEach((d, i) => {
    d.pre = !d.match && (i + 1 < N ? days[i + 1].match : dates.has(dateAdd(state.date, N)));
    d.recovery = i === 0 ? (!!lastMatch && dateAdd(lastMatch, 1) === d.date) : days[i - 1].match;
  });
  return days;
}

// ---------- 예상 상태 ----------
function startState(state) {
  const u = state.user, me = state.players[u.pid];
  const mates = squadMates(state, me);
  const P = {
    fatigue: u.fatigue, mental: u.mental, trust: u.trust, scrim: u.scrimScore, money: u.money, fans: u.fans, pop: u.popularity,
    stats: { ...me.stats }, frac: { ...(me.statFrac || {}) }, hidden: me.hidden, age: me.age, pos: me.pos,
    mast: { ...me.champs }, chem: Object.fromEntries(mates.map(id => [id, u.chem[id] || 0])),
    streak: u.actStreak ? { ...u.actStreak } : null, injDays: u.injury ? u.injury.days : 0,
    gain: Object.fromEntries(STAT_KEYS.map(k => [k, 0])), gainRaw: Object.fromEntries(STAT_KEYS.map(k => [k, 0])), mgain: {}, chemGain: 0,
    moneyGain: 0, fansGain: 0, noInj: 1, peak: u.fatigue, matchCond: [], J: 0,
    rating: u.recentRatings.length ? avg(u.recentRatings.slice(-5)) : A().defaultRating,
    fatigue0: u.fatigue, mental0: u.mental, trust0: u.trust, scrim0: u.scrimScore,
  };
  P.ovr0 = ovrExact(P.pos, fracStats(P));
  return P;
}
const cloneP = P => ({ ...P, stats: { ...P.stats }, frac: { ...P.frac }, mast: { ...P.mast }, chem: { ...P.chem }, gain: { ...P.gain }, gainRaw: { ...P.gainRaw }, mgain: { ...P.mgain }, matchCond: P.matchCond.slice(), streak: P.streak ? { ...P.streak } : null });
const fracStats = P => Object.fromEntries(STAT_KEYS.map(k => [k, P.stats[k] + (P.frac[k] || 0)]));
const cond = P => conditionOf(P.fatigue, P.mental, P.injDays > 0);

// 능력치 경험치: growStat과 같은 식 (복사본에 적용해 얻은 소수 증가량)
function gStat(P, k, base) {
  const fake = { stats: P.stats, statFrac: P.frac, hidden: P.hidden, age: P.age };
  const before = P.stats[k] + (P.frac[k] || 0);
  growStat(fake, k, base, P.fatigue);
  const d = P.stats[k] + (P.frac[k] || 0) - before;
  P.gain[k] += d;
  P.gainRaw[k] += d / Math.max(0.3, 1 - P.fatigue / 200);     // 피로 감소 효과를 뺀 성장량 (성장 집중형은 이걸 기준으로 고른다)
  return d;
}
function gMastery(P, c, base) {
  const d = masteryGainOf(P.mast[c] || 0, P.stats.pool, base);
  P.mast[c] = clamp((P.mast[c] || 0) + d, 0, 100);
  P.mgain[c] = (P.mgain[c] || 0) + d;
}
// 피로 변화 (+면 체력 보정, 부상 확률의 기댓값을 누적). 반환: 이번 활동의 부상 확률
function addF(P, v) {
  const I = CONFIG.injury;
  P.fatigue = clamp(P.fatigue + v * (v > 0 ? staminaMult(P.stats.stamina) : 1), 0, 100);
  P.peak = Math.max(P.peak, P.fatigue);
  if (v > 0 && P.injDays <= 0 && P.fatigue > I.threshold) {
    const p = Math.min(1, (P.fatigue - I.threshold) * I.perPoint);
    const h = P.noInj * p;
    P.noInj *= 1 - p;
    return h;
  }
  return 0;
}
const streakFactorP = (P, act) => {
  const S = D();
  if (!TRAINING.includes(act.a)) return 1;
  const n = P.streak && P.streak.key === actKey(act) ? P.streak.n + 1 : 1;
  return Math.max(S.streakMin, 1 - Math.max(0, n - S.streakFrom + 1) * S.streakStep);
};

// 하루 활동 한 번 (runDayActivity와 같은 순서·같은 식). 반환: { act(실제), hazard, factor }
function dayStep(P, ctx, day, act) {
  const S = D(), G = CONFIG.growth;
  let hazard = 0;
  if (day.match) {
    // 경기일: 활동 없음, 연속 끊김, 경기 피로(세트 수 평균), 경기 경험 성장
    P.matchCond.push(cond(P));
    P.fatigueAtMatch = (P.fatigueAtMatch || []).concat([P.fatigue]);
    P.fatigue = clamp(P.fatigue + S.fatigue.match * A().matchFatigueFrac, 0, 100);
    P.peak = Math.max(P.peak, P.fatigue);
    const games = A().matchGames;
    for (const k of ['laning', 'teamfight', 'mechanics', 'decision']) gStat(P, k, G.baseGain.match / 4 * games);
    // 감독 신뢰: 세트마다 (평점 − 6.3) × 1.5 + 승패 보정 (이기고 질 확률을 반반으로)
    P.trust = clamp(P.trust + games * ((P.rating - 6.3) * 1.5 + 0.2), 0, 100);
    P.streak = null;
    return { act: null, hazard: 0, factor: 1 };
  }
  if (P.injDays > 0 && !['rest', 'replay', 'stream'].includes(act.a)) act = { a: 'rest' };
  if (day.recovery) { P.fatigue = clamp(P.fatigue - S.recoveryDay.fatigue, 0, 100); P.mental = clamp(P.mental + S.recoveryDay.mental, 0, 100); }
  const factor = streakFactorP(P, act);
  const mult = S.ACTIVITY_DAY_MULTIPLIER * (act.a === 'rest' && day.recovery ? S.recoveryDay.restMult : 1);
  const g = mult * factor;
  const mental = v => { P.mental = clamp(P.mental + v * mult, 0, 100); };
  switch (act.a) {
    case 'scrim': {
      const perf = (ovrExact(P.pos, fracStats(P)) - 65) * 0.06 + (cond(P) - 70) * 0.04;
      const pWin = clamp(0.5 + perf * 0.04, 0.15, 0.85);
      const e = 3 * (2 * (0.35 + 0.3 * pWin) - 1);           // 세트 평균 3개, 이긴 세트 − 진 세트의 기댓값
      P.scrim = clamp(P.scrim + (e * 1.6 + perf * 0.8) * mult, 0, 100);
      gStat(P, 'teamfight', G.baseGain.scrim * g); gStat(P, 'decision', G.baseGain.scrim * g);
      const tc = ctx.top4; for (const c of tc) gMastery(P, c, G.masteryGain.scrim * g / tc.length);
      for (const id of Object.keys(P.chem)) { const d = Math.min(100 - P.chem[id], 0.6 * mult); P.chem[id] += d; P.chemGain += d; }
      P.trust = clamp(P.trust + e * 0.4 * mult, 0, 100);
      hazard = addF(P, S.fatigue.scrim * mult);
      break;
    }
    case 'train': {
      gStat(P, act.stat || 'laning', G.baseGain.train * g);
      hazard = addF(P, S.fatigue.train * mult);
      break;
    }
    case 'practice': {
      P.practiceN = (P.practiceN || 0) + 1;
      gMastery(P, act.champ || ctx.top1, G.masteryGain.practice * g);
      const prob = Math.min(1, 0.25 * mult);
      gStat(P, 'pool', 0.3 * g * prob);
      hazard = addF(P, S.fatigue.practice * mult);
      break;
    }
    case 'solo': {
      const games = Math.max(1, Math.round(4 * mult));
      const p = clamp(S.soloWinBase + (ovrExact(P.pos, fracStats(P)) - 65) * 0.006 + (cond(P) - 70) * 0.003, 0.3, 0.72);
      P.lp = (P.lp || 0) + games * (p * avg(S.soloLpWin) - (1 - p) * avg(S.soloLpLoss));
      const tc = ctx.top5; for (const c of tc) gMastery(P, c, G.masteryGain.solo * g / tc.length);
      gStat(P, 'mechanics', G.baseGain.solo * g); gStat(P, 'laning', G.baseGain.solo * 0.7 * g);
      hazard = addF(P, S.fatigue.solo * mult);
      break;
    }
    case 'replay':
      gStat(P, 'decision', G.baseGain.replay * g); gStat(P, 'vision', G.baseGain.replay * 0.7 * g);
      hazard = addF(P, S.fatigue.replay * mult);
      break;
    case 'rest':
      addF(P, S.fatigue.rest * mult);
      mental(S.mental.rest);
      break;
    case 'stream': {
      const fans = avg(S.streamFans) * (1 + P.pop / 50) * g, money = avg(S.streamMoney) * (1 + P.pop / 40) * g;
      P.fans += fans; P.fansGain += fans; P.money += money; P.moneyGain += money;
      P.pop = clamp(P.pop + 0.3 * mult, 0, 100);
      mental(S.mental.stream);
      const pc = Math.min(1, S.streamControversy * mult);        // 논란: 멘탈 −6, 신뢰 −3, 인기 −2의 기댓값
      P.mental = clamp(P.mental - 6 * pc, 0, 100); P.trust = clamp(P.trust - 3 * pc, 0, 100); P.pop = clamp(P.pop - 2 * pc, 0, 100);
      hazard = addF(P, S.fatigue.stream * mult);
      break;
    }
    case 'bond': {
      const id = act.mate && act.mate in P.chem ? act.mate : null;
      const v = avg(S.bondChem) * mult;
      if (id) { const d = Math.min(100 - P.chem[id], v); P.chem[id] += d; P.chemGain += d; }
      mental(S.mental.bond);
      addF(P, S.fatigue.bond * mult);
      break;
    }
  }
  const key = actKey(act);
  P.streak = P.streak && P.streak.key === key ? { key, n: P.streak.n + 1 } : { key, n: 1 };
  return { act, hazard, factor };
}
// 밤: 피로 회복, 부상 일수, 멘탈·신뢰 수렴 (nightRecovery와 같은 식)
function night(P) {
  P.fatigue = clamp(P.fatigue - D().nightRecovery, 0, 100);
  if (P.injDays > 0) P.injDays--;
  P.mental = clamp(P.mental + (65 - P.mental) * 0.04, 0, 100);
  P.trust = clamp(P.trust + (50 - P.trust) * 0.012, 0, 100);
}

// ---------- 점수 ----------
function makeScorer(plan, weak, meta) {
  const W = plan.w;
  // 능력치 가치 = (약점 2개면 1, 아니면 weakLow) × 내 포지션에서의 중요도 (OVR 가중치 / 평균 가중치) — 약점이어도 OVR에 거의 안 들어가는 능력치만 올리지 않게
  const ow = CONFIG.ovrWeights[weak.pos], mean = avg(STAT_KEYS.map(k => ow[k]));
  const gapW = Object.fromEntries(STAT_KEYS.map(k => [k, A().weakLow * (ow[k] / mean) ** A().impPow]));
  weak.top.slice(0, 2).forEach(x => { gapW[x.k] = (ow[x.k] / mean) ** A().impPow; });
  const sat = A().gainSat, v = g => g / (1 + g / sat);     // 같은 능력치만 계속 올리면 가치가 줄어듦
  const snapshot = P => ({
    g: STAT_KEYS.reduce((a, k) => a + gapW[k] * v((plan.ignoreTired ? P.gainRaw : P.gain)[k]), 0),
    m: Object.entries(P.mgain).reduce((a, [c, v]) => a + v * (meta && c === meta.champ ? 1 : 0.2), 0),
    mental: P.mental, trust: P.trust, scrim: P.scrim, fatigue: P.fatigue,
  });
  const LW = CONFIG.lineup.w, over = f => Math.max(0, f - plan.comfort);
  return {
    snapshot,
    // 한 날의 점수 증가분 (이전 스냅샷 → 지금, 부상 확률)
    day(before, P, hazard) {
      const s = snapshot(P);
      return W.growth * (s.g - before.g) + W.mastery * (s.m - before.m) + W.mental * (s.mental - before.mental)
        + W.gauge * (LW.trust * (s.trust - before.trust) + LW.scrim * (s.scrim - before.scrim)) - W.injury * hazard - W.fat * over(s.fatigue);
    },
    matchDay(fatigueBefore, condBefore) { return W.matchCond * condBefore - W.short * Math.max(0, fatigueBefore - plan.fatigueTarget); },
    end(P) { return -W.endFatigue * over(P.fatigue); },
  };
}

// ---------- 후보와 탐색 ----------
const FATIGUE_OF = (P, a, day) => {
  const S = D();
  const mult = S.ACTIVITY_DAY_MULTIPLIER * (a === 'rest' && day.recovery ? S.recoveryDay.restMult : 1);
  return S.fatigue[a] * mult * (S.fatigue[a] > 0 ? staminaMult(P.stats.stamina) : 1);
};
function candidates(P, ctx, day, plan, mandatory) {
  if (mandatory) return { list: [{ tag: mandatory.tag, act: mandatory.act }], guarded: false };
  const out = [];
  const push = (act, tag) => out.push({ act, tag });
  if (P.injDays > 0) { push({ a: 'rest' }, 'injury'); push({ a: 'replay' }, 'injury'); }
  else if (day.pre) {
    // 경기 전날: 컨디션 관리형은 항상 휴식, 균형형은 피로가 preRestAbove를 넘을 때만 휴식(아니면 가벼운 리플레이), 성장 집중형은 리플레이
    if (P.fatigue > plan.preRestAbove) push({ a: 'rest' }, 'pre');
    if (plan.preRestAbove >= 0) push({ a: 'replay' }, 'pre');
  }
  else {
    push({ a: 'scrim' }, 'scrim');
    ctx.weak.top.forEach((w, i) => push({ a: 'train', stat: w.k }, 'weak'));
    if (ctx.meta && (P.practiceN || 0) < A().maxPractice) push({ a: 'practice', champ: ctx.meta.champ }, 'meta');
    push({ a: 'solo' }, 'solo'); push({ a: 'replay' }, 'replay'); push({ a: 'rest' }, 'rest');
  }
  // 피로 상한: 이 활동 뒤 피로가 restAbove를 넘으면 후보에서 뺀다 (회복 활동은 항상 가능)
  const cap = plan.restAbove ?? A().restAbove;
  const dayStart = day.recovery ? P.fatigue - D().recoveryDay.fatigue : P.fatigue;
  const okF = out.filter(c => FATIGUE_OF(P, c.act.a, day) <= 0 || dayStart + FATIGUE_OF(P, c.act.a, day) <= cap);
  const guarded = okF.length < out.length;
  // 같은 훈련 연속 효과 감소를 피한다 (대안이 있으면)
  const fresh = okF.filter(c => streakFactorP(P, c.act) >= 1);
  const list = fresh.length ? fresh : okF;
  return { list: list.length ? list : [{ act: { a: 'rest' }, tag: 'guard' }], guarded };
}

function search(state, plan, kind) {
  const days = schedule(state), me = state.players[state.user.pid];
  const weak = weaknesses(state), meta = metaCandidate(state);
  const ctx = { weak, meta, top1: topChamps(me, 1)[0], top4: topChamps(me, 4), top5: topChamps(me, 5) };
  const P0 = startState(state);
  const scorer = makeScorer(plan, weak, meta);
  // 필수 배치: 케미가 낮은 팀원이 있으면 팀원과 시간, 자금·팬이 부족하면 개인 방송 (각각 주 1회)
  const free = days.filter(d => !d.match && !d.pre);
  const must = {};
  // softEvery: 이 주수마다 한 번만 (성장 집중형은 팀원과 시간·방송을 2주에 한 번으로 줄여 훈련일을 늘린다)
  const softWeek = (plan.softEvery || 1) <= 1 || Math.floor(dateDiff(A().epoch, state.date) / 7) % plan.softEvery === 0;
  const lowMate = softWeek ? Object.entries(P0.chem).filter(([, c]) => c < A().chemLow).sort((a, b) => a[1] - b[1])[0] : null;
  const fansT = A().fansTarget[me.squad === 'academy' ? 'academy' : 'main'];
  const needStream = softWeek && (P0.money < A().moneyLow || P0.fans < fansT);
  const slots = free.filter(d => !d.recovery);
  const pool = slots.length >= 2 ? slots : free;
  if (lowMate && pool.length) must[pool[Math.floor(pool.length / 3)].i] = { tag: 'chem', act: { a: 'bond', mate: lowMate[0] }, mate: lowMate };
  if (needStream && pool.length) {
    let j = Math.floor(2 * pool.length / 3);
    if (must[pool[j].i]) j = pool.findIndex(d => !must[d.i]);
    if (j >= 0) must[pool[j].i] = { tag: 'money', act: { a: 'stream' } };
  }
  let beam = [{ P: P0, path: [] }];
  for (const day of days) {
    const next = [];
    for (const node of beam) {
      if (day.match) {
        const P = cloneP(node.P), f = P.fatigue, c = cond(P);
        dayStep(P, ctx, day, { a: 'rest' }); night(P);
        P.J += scorer.matchDay(f, c);
        next.push({ P, path: [...node.path, { act: null, tag: 'match' }] });
        continue;
      }
      const { list, guarded } = candidates(node.P, ctx, day, plan, must[day.i]);
      for (const c of list) {
        const P = cloneP(node.P), before = scorer.snapshot(P);
        const r = dayStep(P, ctx, day, c.act);
        night(P);
        P.J += scorer.day(before, P, r.hazard);
        const tag = c.tag === 'rest' && guarded ? 'guard' : c.tag;
        next.push({ P, path: [...node.path, { act: r.act, tag, factor: r.factor }] });
      }
    }
    next.sort((a, b) => b.P.J - a.P.J);
    beam = next.slice(0, A().beam);
  }
  for (const n of beam) n.P.J += scorer.end(n.P);
  beam.sort((a, b) => b.P.J - a.P.J);
  return { best: beam[0], days, ctx, weak, meta, must, P0 };
}

// ---------- 결과 요약 ----------
function summarize(state, run) {
  const { best, days, weak, P0 } = run;
  const P = best.P, me = state.players[state.user.pid];
  const u = state.user;
  // 콜업 게이지 / 주전 점수 차 (주전 점수 = lineupScore)
  let gauge = null;
  const rid = competitorOf(state);
  if (rid && state.teams[me.teamId].squadOf[rid] === 'main') {
    const rp = rivalProfile(state, rid), cur = userProfile(state);
    const base = lineupScore({ ...cur, condition: conditionOf(P0.fatigue0, P0.mental0, !!u.injury) }) - lineupScore(rp);
    const proj = lineupScore({ trust: P.trust, rating: cur.rating, condition: conditionOf(P.fatigue, P.mental, P.injDays > 0), scrim: P.scrim, ovr: ovrExact(me.pos, fracStats(P)) }) - lineupScore(rp);
    gauge = { now: base, after: proj, delta: proj - base, need: me.squad === 'academy' ? CONFIG.lineup.callupMargin * 10 : null, rival: state.players[rid].nick };
  }
  const salary = days.some(d => d.date.endsWith('-25')) && me.contract ? Math.round(me.contract.salary / 12 / 10000) * 10000 : 0;
  return {
    stats: P.gain, ovrGain: ovrExact(me.pos, fracStats(P)) - P.ovr0,
    fatigue: { from: P.fatigue0, to: P.fatigue, peak: P.peak },
    mental: { from: P.mental0, to: P.mental },
    trust: { from: P.trust0, to: P.trust },
    gauge,
    money: { stream: P.moneyGain, salary, total: P.moneyGain + salary }, fans: P.fansGain,
    chem: P.chemGain, injuryRisk: 1 - P.noInj,
    matchCond: P.matchCond, mastery: P.mgain,
    score: P.J,
  };
}

// 받침이 있으면 a, 없으면 b
const josa = (w, a, b) => { const c = w.charCodeAt(w.length - 1) - 0xac00; return c >= 0 && c % 28 !== 0 ? a : b; };
// 이유 (카드에 1~2줄)
function reasonsOf(state, run, kind, summary, planDays) {
  const { weak, meta } = run, out = [];
  const w = weak.top.filter(x => x.gap > 0).slice(0, 2);
  if (w.length) out.push(w.map(x => `${STAT_KO[x.k]}${josa(STAT_KO[x.k], '이', '가')} ${weak.ref.short}보다 ${Math.round(x.gap)} 낮아요`).join(' · '));
  const m = planDays.find(d => d.match);
  const pre = planDays.find(d => d.tag === 'pre');
  if (m && pre) out.push(`${WEEKDAY_KO[m.wd]}요일 경기라 ${WEEKDAY_KO[pre.wd]}요일은 ${pre.act && pre.act.a === 'rest' ? '휴식' : '가벼운 활동'}`);
  const g = planDays.find(d => d.tag === 'guard');
  if (g) out.push(`피로가 ${CONFIG.advisor.plans[kind].restAbove}을 넘을 것 같아 ${WEEKDAY_KO[g.wd]}요일 휴식을 넣었어요`);
  if (meta && planDays.some(d => d.tag === 'meta')) out.push(`이번 패치 ${meta.tier === 'OP' ? 'OP' : '1티어'} ${champName(meta.champ)} 숙련도 ${meta.mastery}라 챔피언 연습`);
  if (kind === 'growth') out.push(`피로 최고 ${Math.round(summary.fatigue.peak)} · 부상 위험 ${Math.round(summary.injuryRisk * 100)}%`);
  if (kind === 'condition' && summary.matchCond.length) out.push(`경기 당일 컨디션 ${Math.round(summary.matchCond[0])} 예상`);
  return out;
}

function dayReason(state, d, run) {
  const w = run.weak;
  switch (d.tag) {
    case 'match': return '경기일 — 활동 없이 경기만';
    case 'pre': return d.act.a === 'rest' ? '내일 경기 — 푹 쉬기' : '내일 경기 — 가벼운 활동';
    case 'injury': return '부상 중 — 쉬는 활동만';
    case 'guard': return '피로 상한 — 휴식 삽입';
    case 'chem': return `케미 낮은 팀원 ${state.players[d.act.mate] ? state.players[d.act.mate].nick : ''}`;
    case 'money': return '자금·팬 보충';
    case 'meta': return `메타 챔피언 ${champName(d.act.champ)}`;
    case 'weak': { const x = w.gaps.find(g => g.k === d.act.stat); return `${STAT_KO[d.act.stat]} 약점 (${x ? (x.gap >= 0 ? '−' : '+') + Math.abs(x.gap).toFixed(0) : ''})`; }
    case 'scrim': return '한타·판단 + 스크림 점수';
    case 'solo': return '피지컬·숙련도 + LP';
    case 'replay': return '판단·시야, 피로 적음';
    case 'rest': return '피로 회복';
    default: return '';
  }
}

// ---------- 공개 API ----------
export function recommend(state, kind) {
  const plan = A().plans[kind];
  const run = search(state, plan, kind);
  const summary = summarize(state, run);
  const planDays = run.days.map((d, i) => {
    const p = run.best.path[i];
    const day = { date: d.date, wd: d.wd, match: d.match, act: p.act, tag: p.tag, factor: p.factor };
    if (p.tag === 'chem' && run.must[d.i]) day.mate = run.must[d.i].mate;
    return day;
  });
  planDays.forEach(d => { d.reason = dayReason(state, d, run); });
  return { kind, name: plan.name, icon: plan.icon, desc: plan.desc, startDate: state.date, days: planDays, summary, reasons: reasonsOf(state, run, kind, summary, planDays), weakness: run.weak.top, refLabel: run.weak.ref.label };
}
export const recommendAll = state => PLAN_KINDS.map(k => recommend(state, k));

// 정해진 7일 활동(acts[i] = 활동 또는 null)을 같은 계산으로 평가 (직접 고친 루틴의 예상 결과, 검증용)
export function evaluate(state, acts) {
  const days = schedule(state), me = state.players[state.user.pid];
  const ctx = { weak: weaknesses(state), meta: metaCandidate(state), top1: topChamps(me, 1)[0], top4: topChamps(me, 4), top5: topChamps(me, 5) };
  const P = startState(state);
  days.forEach((d, i) => { dayStep(P, ctx, d, acts[i] || { a: 'rest' }); night(P); });
  return summarize(state, { best: { P }, days, weak: ctx.weak, P0: startState(state) });
}

// 추천 적용: 요일별 루틴(0=일~6=토)에 채운다. 경기일 칸은 건드리지 않는다. 적용 전 루틴은 되돌리기용으로 남긴다
export function applyPlan(state, plan, { keepBackup = true } = {}) {
  const u = state.user;
  if (keepBackup) u.routineBackup = { routine: u.routine.map(x => ({ ...x })), label: plan.name, date: state.date };
  for (const d of plan.days) if (d.act && !d.match) u.routine[d.wd] = { ...d.act };
  // 요일별 추천 이유 (편집 화면에서 그 칸을 직접 바꾸면 사라진다)
  u.routinePlan = { kind: plan.kind, name: plan.name, date: state.date, days: Object.fromEntries(plan.days.filter(d => d.act && !d.match).map(d => [d.wd, { key: actKey(d.act), reason: d.reason }])) };
  return plan;
}
export function undoPlan(state) {
  const u = state.user;
  if (!u.routineBackup) return false;
  u.routine = u.routineBackup.routine.map(x => ({ ...x }));
  u.routineBackup = null; u.routinePlan = null;
  return true;
}
// 매주 자동 추천 (설정): 그 주 상황으로 새로 계산해 쓴다
export function autoApply(state, kind = 'balance') {
  const plan = recommend(state, kind);
  applyPlan(state, plan, { keepBackup: false });
  state.user.routinePlan = { ...state.user.routinePlan, auto: true };
  return plan;
}
