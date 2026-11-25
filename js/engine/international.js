// 포스트시즌·국제 대회: First Stand, Road to MSI, MSI, LCK 플레이오프, CL 플레이오프, Worlds(스위스)
import { CONFIG } from '../config.js';
import { avg, clamp } from '../core/util.js';
import { REGIONS } from '../../data/teams.js';
import { ovr } from '../stats.js';
import { sortStandings } from './tournament.js';

const BASIC = ['lckCup', 'lck12', 'lck34', 'cl12', 'cl34'];
const PREREQ = { fs: ['lckCup'], rtm: ['lck12'], msi: ['rtm', 'fs'], lckpo: ['lck34'], clpo: ['cl34'], worlds: ['lckpo', 'msi'] };

export function ready(state, comp) {
  if (BASIC.includes(comp.id)) return true;
  return (PREREQ[comp.id] || []).every(id => state.season.comps[id].done);
}

// 지역 대표 선발: 전력 + 노이즈
export function regionReps(state, rng, key, region, n) {
  const R = state.season.regionReps;
  R[key] = R[key] || {};
  if (R[key][region]) return R[key][region];
  const teams = Object.values(state.teams).filter(t => t.region === region);
  const str = t => avg(Object.keys(t.squadOf).filter(id => t.squadOf[id] === 'main' && state.players[id]).map(id => ovr(state.players[id])));
  const scored = teams.map(t => [t.id, str(t) + rng.normal(0, CONFIG.competitions.regionNoise)]).sort((a, b) => b[1] - a[1]);
  R[key][region] = scored.slice(0, n).map(x => x[0]);
  return R[key][region];
}

const regionOf = (state, ref) => (state.teams[ref.replace(':A', '')] || {}).region;

export function startComp(state, rng, comp, H) {
  const C = CONFIG.competitions;
  const S = C.regionSlots;
  const comps = state.season.comps;
  comp.started = true;
  // 선행 대회가 늦게 끝났으면 오늘부터 일정 시작
  if (comp.start < state.date) comp.start = state.date;
  comp.cursor = comp.start;
  switch (comp.id) {
    case 'fs': {
      const lck = comps.lckCup.result.placements.slice(0, C.lckCup.toFirstStand);
      const r = reg => regionReps(state, rng, 'fs', reg, S[reg].fs);
      const lpl = r('LPL'), lec = r('LEC'), lcs = r('LCS'), cb = r('CBLOL'), lcp = r('LCP');
      comp.teams = [...lck, ...lpl, ...lec, ...lcs, ...cb, ...lcp];
      comp.groupsDef = { A: [lck[0], lpl[1] || lpl[0], lec[0], cb[0]], B: [lpl[0], lck[1], lcs[0], lcp[0]] };
      comp.stage = 'groups';
      comp.gsl = {};
      const ms = [];
      for (const g of ['A', 'B']) {
        comp.gsl[g] = H.newBracket('GSL', comp.groupsDef[g], C.firstStand.bo, `${g}조`);
        comp.gsl[g].key = 'gsl' + g;
        ms.push(...advanceBracketRaw(comp, comp.gsl[g], { stage: 'groups', group: g }));
      }
      comp.cursor = H.scheduleSequential(ms, comp.start, H.ALL_DAYS, 2);
      H.addNews(state, `🌎 First Stand (${comp.city}) 개막! 참가: ${comp.teams.map(id => state.teams[id].code).join(', ')}`, 'comp');
      break;
    }
    case 'rtm': {
      const seeds = comps.lck12.result.placements.slice(0, 6);
      comp.stage = 'bracket';
      comp.bracket = H.newBracket('DE6', seeds, C.roadToMsi.bo);
      const ms = advanceBracketRaw(comp, comp.bracket, { stage: 'bracket' });
      comp.cursor = H.scheduleSequential(ms, comp.start, H.LCK_DAYS(), 1);
      H.addNews(state, `Road to MSI 시작: ${seeds.map(id => state.teams[id].code).join(', ')}`, 'comp');
      break;
    }
    case 'msi': {
      const lck = comps.rtm.result.placements.slice(0, C.roadToMsi.toMsi);
      const reps = { LCK: lck };
      for (const reg of REGIONS) if (reg !== 'LCK') reps[reg] = regionReps(state, rng, 'msi', reg, S[reg].msi);
      const fsChamp = comps.fs.result ? comps.fs.result.champion : null;
      const fsRegion = fsChamp ? regionOf(state, fsChamp) : 'LCK';
      comp.fsRegion = fsRegion;
      const direct = [];
      for (const reg of Object.keys(C.msiDirect)) direct.push(...(reps[reg] || []).slice(0, C.msiDirect[reg]));
      // First Stand 우승 지역 추가 시드
      const bonus = (reps[fsRegion] || []).find(id => !direct.includes(id));
      if (bonus) direct.push(bonus);
      const all = REGIONS.flatMap(reg => reps[reg] || []);
      const playin = all.filter(id => !direct.includes(id));
      comp.teams = all; comp.direct = direct;
      comp.stage = 'playin';
      comp.gauntlet = H.newGauntlet(playin, 8 - direct.length, C.msi.bo);
      const ms = H.advanceGauntlet(comp, comp.gauntlet, { stage: 'playin' });
      comp.cursor = H.scheduleSequential(ms, comp.start, H.ALL_DAYS, 2);
      H.addNews(state, `🌎 MSI (${comp.city}) 개막! First Stand 우승 지역 ${fsRegion} 시드 혜택. 브래킷 직행: ${direct.map(id => state.teams[id].code).join(', ')}`, 'comp');
      break;
    }
    case 'lckpo': {
      const order = lckRegular(state);
      comp.regOrder = order;
      comp.direct = order.slice(0, 4);
      comp.stage = 'playin';
      comp.gauntlet = H.newGauntlet(order.slice(4, 8), 2, C.lckPlayoffs.bo);
      const ms = H.advanceGauntlet(comp, comp.gauntlet, { stage: 'playin' });
      comp.cursor = H.scheduleSequential(ms, comp.start, H.LCK_DAYS(), 1);
      break;
    }
    case 'clpo': {
      const order = comps.cl34.result.placements;
      comp.stage = 'bracket';
      comp.bracket = H.newBracket('DE6', order.slice(0, 6), 5);
      const ms = advanceBracketRaw(comp, comp.bracket, { stage: 'bracket' });
      comp.cursor = H.scheduleSequential(ms, comp.start, H.CL_DAYS, 1);
      break;
    }
    case 'worlds': {
      const nL = C.lckPlayoffs.toWorlds;
      const reps = { LCK: comps.lckpo.result.placements.slice(0, nL) };
      for (const reg of REGIONS) if (reg !== 'LCK') reps[reg] = regionReps(state, rng, 'worlds', reg, S[reg].worlds);
      const direct = [];
      for (const reg of REGIONS) direct.push(...(reps[reg] || []).slice(0, C.worldsDirect[reg] || 0));
      const all = REGIONS.flatMap(reg => reps[reg] || []);
      const playin = all.filter(id => !direct.includes(id));
      comp.teams = all; comp.direct = direct; comp.reps = reps;
      const slots = Math.max(0, 16 - direct.length);
      comp.stage = 'playin';
      comp.gauntlet = H.newGauntlet(playin, slots, 5);
      const ms = H.advanceGauntlet(comp, comp.gauntlet, { stage: 'playin' });
      comp.cursor = H.scheduleSequential(ms, comp.start, H.ALL_DAYS, 2);
      if (!ms.length) updateComp(state, rng, comp, H);
      H.addNews(state, `🌎 월드 챔피언십 (${comp.city}) 개막! LCK 대표: ${reps.LCK.map(id => state.teams[id].name).join(', ')}`, 'comp');
      break;
    }
  }
}

function lckRegular(state) {
  const st = {};
  const ms = [];
  for (const id of ['lck12', 'lck34']) for (const m of state.season.comps[id].matches) if (m.done) {
    for (const t of m.teams) st[t] = st[t] || { w: 0, l: 0, gw: 0, gl: 0 };
    st[m.winner].w++; st[m.loser].l++;
    st[m.teams[0]].gw += m.wins[0]; st[m.teams[0]].gl += m.wins[1];
    st[m.teams[1]].gw += m.wins[1]; st[m.teams[1]].gl += m.wins[0];
    ms.push(m);
  }
  return sortStandings(st, ms);
}

// 스케줄 없이 브래킷 경기 생성 (tournament.advanceBracket 래핑)
import { advanceBracket } from './tournament.js';
function advanceBracketRaw(comp, br, extra) { return advanceBracket(comp, br, extra); }

export function updateComp(state, rng, comp, H) {
  const C = CONFIG.competitions;
  if (comp.done) return;
  const days = comp.id === 'rtm' || comp.id === 'lckpo' ? H.LCK_DAYS() : comp.id === 'clpo' ? H.CL_DAYS : H.ALL_DAYS;
  const perDay = comp.id === 'rtm' || comp.id === 'lckpo' || comp.id === 'clpo' ? 1 : comp.id === 'worlds' && comp.stage === 'swiss' ? 4 : 2;
  switch (comp.id) {
    case 'fs': {
      if (comp.stage === 'groups') {
        for (const g of ['A', 'B']) H.advanceBracketScheduled(comp, comp.gsl[g], days, 2, { stage: 'groups', group: g });
        if (comp.gsl.A.done && comp.gsl.B.done) {
          const A = comp.gsl.A.placements, B = comp.gsl.B.placements;
          comp.stage = 'knockout';
          comp.bracket = H.newBracket('SE4', [A[0], B[0], A[1], B[1]], C.firstStand.bo);
          // SE4: s1 = 1 vs 4 → A1 vs B2, s2 = 2 vs 3 → B1 vs A2
          comp.bracket.seeds = [A[0], B[0], A[1], B[1]];
          comp.bracket.seeds = [A[0], B[0], A[1], B[1]];
          H.advanceBracketScheduled(comp, comp.bracket, days, 2, { stage: 'knockout' });
        }
      } else if (comp.stage === 'knockout') {
        H.advanceBracketScheduled(comp, comp.bracket, days, 1, { stage: 'knockout' });
        if (comp.bracket.done) {
          const pl = comp.bracket.placements;
          const rest = [...comp.gsl.A.placements.slice(2), ...comp.gsl.B.placements.slice(2)];
          H.finishComp(state, comp, [...pl, ...rest]);
          H.addNews(state, `${regionOf(state, pl[0])} 지역이 First Stand 우승으로 MSI 시드 혜택을 받습니다.`, 'comp');
        }
      }
      break;
    }
    case 'rtm': case 'clpo': {
      H.advanceBracketScheduled(comp, comp.bracket, days, perDay, { stage: 'bracket' });
      if (comp.bracket.done) {
        H.finishComp(state, comp, comp.bracket.placements);
        if (comp.id === 'rtm') H.addNews(state, `MSI 진출: ${comp.bracket.placements.slice(0, C.roadToMsi.toMsi).map(id => state.teams[id].name).join(', ')}`, 'comp');
      }
      break;
    }
    case 'msi': case 'lckpo': {
      if (comp.stage === 'playin') {
        const ms = H.advanceGauntlet(comp, comp.gauntlet, { stage: 'playin' });
        if (ms.length) comp.cursor = H.scheduleSequential(ms, H.nextDay(comp.cursor, days), days, perDay);
        if (comp.gauntlet.done) {
          comp.stage = 'bracket';
          const seeds = [...comp.direct, ...comp.gauntlet.qualified];
          comp.bracket = H.newBracket(comp.id === 'msi' ? 'DE8' : 'DE6', seeds, 5);
          H.advanceBracketScheduled(comp, comp.bracket, days, perDay, { stage: 'bracket' });
        }
      } else if (comp.stage === 'bracket') {
        H.advanceBracketScheduled(comp, comp.bracket, days, perDay, { stage: 'bracket' });
        if (comp.bracket.done) {
          const pl = comp.bracket.placements.concat(comp.gauntlet.eliminated);
          H.finishComp(state, comp, pl);
          if (comp.id === 'lckpo') H.addNews(state, `월드 챔피언십 진출: ${pl.slice(0, C.lckPlayoffs.toWorlds).map(id => state.teams[id].name).join(', ')}`, 'comp');
        }
      }
      break;
    }
    case 'worlds': {
      if (comp.stage === 'playin') {
        const ms = H.advanceGauntlet(comp, comp.gauntlet, { stage: 'playin' });
        if (ms.length) comp.cursor = H.scheduleSequential(ms, H.nextDay(comp.cursor, days), days, 2);
        if (comp.gauntlet.done) {
          comp.stage = 'swiss';
          const teams = [...comp.direct, ...comp.gauntlet.qualified].slice(0, 16);
          comp.swiss = { teams, rec: Object.fromEntries(teams.map(t => [t, { w: 0, l: 0 }])), opp: Object.fromEntries(teams.map(t => [t, []])), rounds: [], advanced: [], eliminated: [] };
          comp.standings = H.newStandings(teams);
          swissRound(state, rng, comp, H);
        }
      } else if (comp.stage === 'swiss') {
        const last = comp.swiss.rounds[comp.swiss.rounds.length - 1];
        const ms = last.map(id => comp.matches.find(m => m.id === id));
        if (ms.every(m => m.done)) {
          for (const m of ms) {
            comp.swiss.rec[m.winner].w++; comp.swiss.rec[m.loser].l++;
            comp.swiss.opp[m.winner].push(m.loser); comp.swiss.opp[m.loser].push(m.winner);
          }
          for (const t of comp.swiss.teams) {
            const r = comp.swiss.rec[t];
            if (r.w >= 3 && !comp.swiss.advanced.includes(t)) comp.swiss.advanced.push(t);
            if (r.l >= 3 && !comp.swiss.eliminated.includes(t)) comp.swiss.eliminated.push(t);
          }
          if (comp.swiss.advanced.length >= 8 || comp.swiss.teams.every(t => comp.swiss.rec[t].w >= 3 || comp.swiss.rec[t].l >= 3)) {
            comp.stage = 'knockout';
            const adv = comp.swiss.advanced.slice(0, 8).sort((a, b) => comp.swiss.rec[a].l - comp.swiss.rec[b].l || comp.swiss.teams.indexOf(a) - comp.swiss.teams.indexOf(b));
            comp.bracket = H.newBracket('SE8', adv, 5);
            const nm = advanceBracket(comp, comp.bracket, { stage: 'knockout' });
            comp.cursor = H.scheduleSequential(nm, H.nextDay(comp.cursor, days, 3), days, 2);
            H.addNews(state, `월즈 스위스 스테이지 종료 · 8강 진출: ${adv.map(id => state.teams[id].code).join(', ')}`, 'comp');
          } else swissRound(state, rng, comp, H);
        }
      } else if (comp.stage === 'knockout') {
        const nm = advanceBracket(comp, comp.bracket, { stage: 'knockout' });
        if (nm.length) {
          const lastDate = comp.matches.filter(m => m.done).map(m => m.date).sort().pop();
          const isFinal = nm.some(m => m.node === 'f');
          if (isFinal) for (const m of nm) m.label = `결승전 (${CONFIG.competitions.worlds.finalCity})`;
          comp.cursor = H.scheduleSequential(nm, H.nextDay(lastDate, days, isFinal ? 6 : 3), days, isFinal ? 1 : 2);
        }
        if (comp.bracket.done) {
          const sw = comp.swiss;
          const out = sw.teams.filter(t => !comp.bracket.placements.includes(t)).sort((a, b) => sw.rec[b].w - sw.rec[a].w);
          H.finishComp(state, comp, [...comp.bracket.placements, ...out, ...comp.gauntlet.eliminated]);
        }
      }
      break;
    }
  }
}

function swissRound(state, rng, comp, H) {
  const sw = comp.swiss;
  const active = sw.teams.filter(t => sw.rec[t].w < 3 && sw.rec[t].l < 3);
  const groups = {};
  for (const t of active) { const k = `${sw.rec[t].w}-${sw.rec[t].l}`; (groups[k] = groups[k] || []).push(t); }
  const rn = sw.rounds.length + 1;
  const pairs = [];
  const keys = Object.keys(groups).sort((a, b) => b.split('-')[0] - a.split('-')[0]);
  let carry = null;
  for (const k of keys) {
    let pool = groups[k].slice().sort((a, b) => sw.teams.indexOf(a) - sw.teams.indexOf(b));
    if (carry) { pool.unshift(carry); carry = null; }
    if (rn === 1) {
      // 1라운드: 상위 시드 vs 하위 시드, 같은 지역 회피
      const top = pool.slice(0, pool.length / 2), bot = rng.shuffle(pool.slice(pool.length / 2));
      for (const a of top) {
        let i = bot.findIndex(b => regionOf(state, b) !== regionOf(state, a));
        if (i < 0) i = 0;
        pairs.push([a, bot.splice(i, 1)[0]]);
      }
      continue;
    }
    while (pool.length >= 2) {
      const a = pool.shift();
      let i = pool.findIndex(b => !sw.opp[a].includes(b));
      if (i < 0) i = 0;
      pairs.push([a, pool.splice(i, 1)[0]]);
    }
    if (pool.length) carry = pool[0];
  }
  const ms = pairs.map(([a, b]) => {
    const r = sw.rec[a];
    const decisive = r.w === 2 || r.l === 2;
    return H.mkMatch(comp, a, b, decisive ? 3 : 1, { label: `스위스 ${rn}라운드 (${r.w}-${r.l})${decisive ? (r.w === 2 ? ' 진출전' : ' 탈락전') : ''}`, round: rn, stage: 'swiss' });
  });
  sw.rounds.push(ms.map(m => m.id));
  const start = sw.rounds.length === 1 ? H.nextDay(comp.cursor, H.ALL_DAYS, 2) : H.nextDay(comp.cursor, H.ALL_DAYS, 1);
  comp.cursor = H.scheduleSequential(ms, start, H.ALL_DAYS, 4);
}
