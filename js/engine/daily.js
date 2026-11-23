// 하루 3칸 행동: 스크림 / 개인 훈련 / 챔피언 연습 / 솔로 랭크 / 리플레이 분석 / 휴식 / 개인 방송 / 팀원과 시간
import { CONFIG } from '../config.js';
import { clamp, avg, STAT_KO, POS } from '../core/util.js';
import { growStat, growMastery, ovr, topChamps, potentialGrade } from './players.js';
import { CHAMPIONS, champName } from '../../data/champions.js';
import { addMsg } from './state.js';
import { lineup } from './roster.js';

export const ACTIVITIES = {
  scrim: { name: '스크림', desc: '팀 스크림. 한타·판단력 소폭 성장, 스크림 성적(주전 경쟁)·케미 상승', icon: '⚔' },
  train: { name: '개인 훈련', desc: '선택한 능력치를 집중 훈련', icon: '💪', param: 'stat' },
  practice: { name: '챔피언 연습', desc: '선택한 챔피언 숙련도 상승', icon: '🎯', param: 'champ' },
  solo: { name: '솔로 랭크', desc: '랭크 게임. LP 변동, 숙련도·피지컬 소폭 성장', icon: '🏆', param: 'champOpt' },
  replay: { name: '리플레이 분석', desc: '판단력·시야 성장, 피로 적음', icon: '📼' },
  rest: { name: '휴식', desc: '피로 크게 감소, 멘탈 회복', icon: '🛌' },
  stream: { name: '개인 방송', desc: '팬·수입 증가, 피로 증가. 가끔 논란', icon: '🎥' },
  bond: { name: '팀원과 시간', desc: '선택한 팀원과 케미 상승, 멘탈 회복', icon: '🤝', param: 'mate' },
};
export const TRAINABLE = ['laning', 'teamfight', 'mechanics', 'decision', 'vision', 'mental', 'pool', 'stamina'];

const TIERS = ['아이언', '브론즈', '실버', '골드', '플래티넘', '에메랄드', '다이아몬드', '마스터', '그랜드마스터', '챌린저'];
export function soloRankLabel(sr) {
  if (sr.tier === '챌린저') return `챌린저 ${sr.lp}LP · ${sr.rank || '-'}위`;
  return `${sr.tier} ${sr.lp}LP`;
}
function updateSoloTier(sr) {
  // 마스터 이상: LP 누적. 0 미만이면 다이아몬드
  if (sr.lp < 0 && sr.tier === '마스터') { sr.tier = '다이아몬드'; sr.lp = 75; }
  else if (sr.tier === '다이아몬드' && sr.lp >= 100) { sr.tier = '마스터'; sr.lp = 0; }
  if (sr.tier === '마스터' || sr.tier === '그랜드마스터' || sr.tier === '챌린저') {
    sr.tier = sr.lp >= 900 ? '챌린저' : sr.lp >= 450 ? '그랜드마스터' : '마스터';
  }
  sr.rank = sr.tier === '챌린저' ? Math.max(1, Math.round(300 - (sr.lp - 900) / 4)) : null;
}

export function computeCondition(state) {
  const u = state.user;
  const C = CONFIG.condition;
  return clamp(Math.round(C.base + 10 - u.fatigue * C.fatigueWeight + (u.mental - 60) * C.mentalWeight + (u.injury ? -25 : 0)), 5, 100);
}

function addFatigue(state, v, rng) {
  const u = state.user;
  const me = state.players[u.pid];
  const staminaMult = v > 0 ? clamp(1.25 - me.stats.stamina / 200, 0.7, 1.2) : 1;
  u.fatigue = clamp(u.fatigue + v * staminaMult, 0, 100);
  // 부상 체크
  const I = CONFIG.injury;
  if (v > 0 && !u.injury && u.fatigue > I.threshold && rng.chance((u.fatigue - I.threshold) * I.perPoint)) {
    const days = rng.int(...I.days);
    u.injury = { type: rng.pick(I.types), days, total: days };
    return { injury: u.injury };
  }
  return null;
}

// 한 칸 실행. 반환: { text, details[] }
export function runActivity(state, rng, slot) {
  const u = state.user;
  const me = state.players[u.pid];
  const G = CONFIG.growth, D = CONFIG.daily;
  const out = { act: slot.a, lines: [] };
  if (u.injury && !['rest', 'replay', 'stream'].includes(slot.a)) {
    out.lines.push(`부상(${u.injury.type}) 때문에 ${ACTIVITIES[slot.a].name} 대신 휴식했다.`);
    slot = { a: 'rest' };
  }
  const st = (k, base) => { const up = growStat(me, k, base, u.fatigue); if (up) out.lines.push(`${STAT_KO[k]} +${up}`); return up; };
  let inj = null;
  switch (slot.a) {
    case 'scrim': {
      const team = state.teams[me.teamId];
      const myOvr = team ? avg(lineup(state, me.squad === 'academy' ? team.id + ':A' : team.id).filter(Boolean).map(ovr)) : 65;
      const oppOvr = myOvr + rng.normal(0, 4);
      const perf = (ovr(me) - 65) * 0.06 + (u.condition - 70) * 0.04 + rng.normal(0, 1.5);
      const win = rng.chance(clamp(0.5 + (myOvr - oppOvr) * 0.03 + perf * 0.04, 0.15, 0.85));
      const games = rng.int(2, 4); let w = 0;
      for (let i = 0; i < games; i++) if (rng.chance(win ? 0.65 : 0.35)) w++;
      u.scrimScore = clamp(u.scrimScore + (w * 2 - games) * 1.6 + perf * 0.8, 0, 100);
      u.rivalScrim = clamp((u.rivalScrim ?? 50) + rng.normal(0.2, 1.6), 0, 100);
      out.lines.push(`스크림 ${w}승 ${games - w}패 · 스크림 점수 ${Math.round(u.scrimScore)}`);
      st('teamfight', G.baseGain.scrim); st('decision', G.baseGain.scrim);
      const tc = topChamps(me, 4); if (tc.length) growMastery(me, rng.pick(tc), G.masteryGain.scrim);
      if (team) for (const pid of Object.keys(team.squadOf)) if (pid !== me.id && team.squadOf[pid] === me.squad) u.chem[pid] = clamp((u.chem[pid] || 0) + 0.6, 0, 100);
      u.trust = clamp(u.trust + (w * 2 - games) * 0.4, 0, 100);
      inj = addFatigue(state, D.fatigue.scrim, rng);
      break;
    }
    case 'train': {
      const k = slot.stat || 'laning';
      const up = st(k, G.baseGain.train);
      if (!up) out.lines.push(`${STAT_KO[k]} 훈련 (성장 진행 중)`);
      inj = addFatigue(state, D.fatigue.train, rng);
      break;
    }
    case 'practice': {
      const c = slot.champ || topChamps(me, 1)[0];
      const before = me.champs[c] || 0;
      growMastery(me, c, G.masteryGain.practice);
      out.lines.push(`${champName(c)} 숙련도 ${Math.round(before)} → ${Math.round(me.champs[c])}`);
      if (rng.chance(0.25)) st('pool', 0.3);
      inj = addFatigue(state, D.fatigue.practice, rng);
      break;
    }
    case 'solo': {
      const sr = u.soloRank;
      const c = slot.champ || rng.pick(topChamps(me, 5));
      const games = rng.int(3, 5); let w = 0, lp = 0;
      const p = clamp(D.soloWinBase + (ovr(me) - 65) * 0.006 + (u.condition - 70) * 0.003 - (sr.lp / 4000), 0.3, 0.72);
      for (let i = 0; i < games; i++) {
        if (rng.chance(p)) { w++; lp += rng.int(...D.soloLpWin); } else lp -= rng.int(...D.soloLpLoss);
      }
      sr.lp += lp; sr.games += games; sr.wins += w;
      updateSoloTier(sr);
      growMastery(me, c, G.masteryGain.solo);
      st('mechanics', G.baseGain.solo); st('laning', G.baseGain.solo * 0.7);
      out.lines.push(`솔로 랭크 ${w}승 ${games - w}패 (${lp >= 0 ? '+' : ''}${lp}LP) · ${soloRankLabel(sr)} · ${champName(c)}`);
      if (sr.tier === '챌린저' && sr.rank <= 10 && rng.chance(0.3)) { u.fans += 200; out.lines.push('챌린저 상위권! 팬 +200'); }
      inj = addFatigue(state, D.fatigue.solo, rng);
      break;
    }
    case 'replay':
      st('decision', G.baseGain.replay); st('vision', G.baseGain.replay * 0.7);
      out.lines.push('리플레이 분석: 운영과 시야 이해도가 높아졌다.');
      inj = addFatigue(state, D.fatigue.replay, rng);
      break;
    case 'rest':
      addFatigue(state, D.fatigue.rest, rng);
      u.mental = clamp(u.mental + D.mental.rest, 0, 100);
      out.lines.push(`휴식 · 피로 ${Math.round(u.fatigue)}`);
      break;
    case 'stream': {
      const fans = Math.round(rng.int(...D.streamFans) * (1 + u.popularity / 50));
      const money = Math.round(rng.int(...D.streamMoney) * (1 + u.popularity / 40) / 10000) * 10000;
      u.fans += fans; u.money += money; u.popularity = clamp(u.popularity + 0.3, 0, 100);
      u.mental = clamp(u.mental + D.mental.stream, 0, 100);
      out.lines.push(`개인 방송 · 팬 +${fans.toLocaleString()} · 수입 +${(money / 10000).toLocaleString()}만 원`);
      if (rng.chance(D.streamControversy)) {
        u.popularity = clamp(u.popularity - 2, 0, 100); u.mental = clamp(u.mental - 6, 0, 100); u.trust = clamp(u.trust - 3, 0, 100);
        out.lines.push('⚠ 방송 중 발언이 논란이 됐다. 커뮤니티가 시끄럽다. (멘탈 -6, 감독 신뢰 -3)');
        out.controversy = true;
      }
      inj = addFatigue(state, D.fatigue.stream, rng);
      break;
    }
    case 'bond': {
      const team = state.teams[me.teamId];
      let mate = slot.mate;
      if (!mate || !state.players[mate]) {
        const mates = team ? Object.keys(team.squadOf).filter(id => id !== me.id) : [];
        mate = mates.length ? rng.pick(mates) : null;
      }
      if (mate) {
        const v = rng.int(...D.bondChem);
        u.chem[mate] = clamp((u.chem[mate] || 0) + v, 0, 100);
        out.lines.push(`${state.players[mate].nick}와(과) 시간을 보냈다 · 케미 +${v}`);
      }
      u.mental = clamp(u.mental + D.mental.bond, 0, 100);
      addFatigue(state, D.fatigue.bond, rng);
      break;
    }
  }
  if (inj && inj.injury) { out.lines.push(`🚑 ${inj.injury.type}! ${inj.injury.days}일간 결장`); out.injury = inj.injury; }
  u.condition = computeCondition(state);
  return out;
}

export function nightRecovery(state, rng) {
  const u = state.user;
  u.fatigue = clamp(u.fatigue - CONFIG.daily.nightRecovery, 0, 100);
  if (u.injury) {
    u.injury.days--;
    if (u.injury.days <= 0) { u.injury = null; addMsg(state, '팀 닥터', '부상 회복', '부상에서 완전히 회복했습니다. 오늘부터 정상 훈련이 가능합니다.'); }
  }
  // 폼 변동
  const me = state.players[u.pid];
  me.form = clamp((me.form || 0) * 0.92 + rng.normal(0, 0.6), -10, 10);
  u.mental = clamp(u.mental + (65 - u.mental) * 0.04, 0, 100);
  u.trust = clamp(u.trust + (50 - u.trust) * 0.012, 0, 100);
  // 인기도는 팬 수 기반 기준값으로 천천히 수렴
  const base = clamp(Math.log10(u.fans + 1) * 9 - 20, 0, 70);
  u.popularity = clamp(u.popularity + (base - u.popularity) * 0.01, 0, 100);
  u.condition = computeCondition(state);
}

// 코치 평가 (숨은 능력치)
export function coachEvaluation(state) {
  const u = state.user;
  const me = state.players[u.pid];
  const days = Math.max(0, Math.round((new Date(state.date) - new Date(u.joinedDate)) / 86400000));
  const lvl = days >= 150 ? 3 : days >= 70 ? 2 : days >= 25 ? 1 : 0;
  if (lvl === 0) return { level: 0, text: '아직 평가하기 이르다. 한 달 정도 지켜보자.' };
  const pg = potentialGrade(me.hidden.potential);
  const grades = ['D', 'C', 'B', 'A', 'S'];
  let shown = pg;
  if (lvl === 1) { const i = grades.indexOf(pg); const off = (me.id.charCodeAt(1) % 3) - 1; shown = grades[clamp(i + off, 0, 4)]; }
  const growth = me.hidden.growth >= 1.15 ? '성장 속도가 매우 빠르다' : me.hidden.growth >= 0.95 ? '꾸준히 성장하는 타입이다' : '성장은 느린 편이지만 성실하다';
  const vari = me.hidden.variance <= 3 ? '기복이 거의 없다' : me.hidden.variance <= 7 ? '경기력에 약간의 기복이 있다' : '컨디션에 따라 경기력 차이가 크다';
  const txt = lvl === 1 ? `${shown}급 잠재력으로 보입니다 (확실하지 않음).` : lvl === 2 ? `${shown}급 잠재력으로 보입니다. ${growth}.` : `${shown}급 잠재력입니다. ${growth}, ${vari}.`;
  return { level: lvl, text: txt, grade: shown };
}
