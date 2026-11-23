// 랜덤 이벤트 실행
import { CONFIG } from '../config.js';
import { clamp, avg, fill, dateDiff, STAT_KO } from '../core/util.js';
import { EVENTS } from '../../data/events.js';
import { growMastery, topChamps, growStat } from './players.js';
import { competitorOf } from './state.js';
import { nextUserMatch } from './season.js';
import { teamInfo } from './roster.js';
import { champName, CHAMPIONS } from '../../data/champions.js';

const LEGENDS = ['Monolith', 'Old Hawk', 'Aurelius', 'Silverline', 'Kingsguard'];

function buildCtx(state, rng) {
  const us = state.user, u = state.players[us.pid];
  const team = u.teamId ? state.teams[u.teamId] : null;
  const rivalId = competitorOf(state);
  const rival = rivalId ? state.players[rivalId] : null;
  const mates = team ? Object.keys(team.squadOf).filter(id => id !== u.id && team.squadOf[id] === u.squad && state.players[id]) : [];
  const sh = rng.shuffle(mates);
  const metaChamp = Object.keys(CHAMPIONS).find(id => CHAMPIONS[id].pos.includes(u.pos) && state.meta.tiers[id] === 'OP' && (u.champs[id] || 0) < 60) || null;
  const nm = nextUserMatch(state);
  const oppRef = nm ? nm.teams.find(t => t.replace(':A', '') !== u.teamId) : null;
  const overseas = rng.pick(Object.values(state.teams).filter(t => t.region !== 'LCK'));
  return {
    st: state, u, us, team, rival, mates: sh, mateA: sh[0] ? state.players[sh[0]] : null, mateB: sh[1] ? state.players[sh[1]] : null,
    metaChamp, recentAvg: us.recentRatings.length >= 3 ? avg(us.recentRatings.slice(-5)) : null,
    oppTeam: oppRef ? teamInfo(state, oppRef).name : null, overseas,
  };
}

export function rollEvent(state, rng) {
  const us = state.user;
  if (us.retired) return null;
  if (us.lastEventDate && dateDiff(us.lastEventDate, state.date) < CONFIG.events.cooldownDays) return null;
  if (!rng.chance(CONFIG.events.dailyChance)) return null;
  const ctx = buildCtx(state, rng);
  const recent = (us.eventHistory || []).slice(-8);
  const pool = EVENTS.filter(e => (!e.cond || e.cond(ctx)) && !recent.includes(e.id));
  if (!pool.length) return null;
  const ev = rng.weighted(pool.map(e => [e, e.weight * CONFIG.eventWeightMult]));
  us.lastEventDate = state.date;
  us.eventHistory = recent.concat([ev.id]);
  const team = ctx.team;
  const vars = {
    coach: team ? team.coach.nick : '감독', rival: ctx.rival ? ctx.rival.nick : '경쟁자',
    mateA: ctx.mateA ? ctx.mateA.nick : '팀원', mateB: ctx.mateB ? ctx.mateB.nick : '팀원',
    metaChamp: ctx.metaChamp ? champName(ctx.metaChamp) : '', oppTeam: ctx.oppTeam || '상대 팀',
    overseas: ctx.overseas.name, legend: rng.pick(LEGENDS),
    money: `${Math.round((2000 + us.popularity * 150) / 100) * 100}만 원`,
  };
  return { id: ev.id, title: fill(ev.title, vars), text: fill(ev.text, vars), choices: ev.choices.map(c => fill(c.label, vars)), vars, ctxIds: { rival: ctx.rival && ctx.rival.id, mateA: ctx.mateA && ctx.mateA.id, mateB: ctx.mateB && ctx.mateB.id, metaChamp: ctx.metaChamp } };
}

export function resolveEvent(state, rng, inst, choiceIdx) {
  const ev = EVENTS.find(e => e.id === inst.id);
  const ch = ev.choices[choiceIdx];
  let r = rng.next(), out = ch.outcomes[ch.outcomes.length - 1];
  for (const o of ch.outcomes) { if (r < o.p) { out = o; break; } r -= o.p; }
  const lines = applyEventEffects(state, rng, out.eff, inst);
  const text = fill(out.text, inst.vars);
  state.eventLog.unshift({ date: state.date, title: inst.title, choice: fill(ch.label, inst.vars), result: text });
  if (state.eventLog.length > 60) state.eventLog.length = 60;
  return { text, lines };
}

function applyEventEffects(state, rng, eff, inst) {
  const us = state.user, u = state.players[us.pid];
  const lines = [];
  const add = (k, v, label, min = 0, max = 100) => { us[k] = clamp(us[k] + v, min, max); lines.push(`${label} ${v > 0 ? '+' : ''}${Math.round(v)}`); };
  if (eff.mental) add('mental', eff.mental, '멘탈');
  if (eff.trust) add('trust', eff.trust, '감독 신뢰');
  if (eff.fatigue) add('fatigue', eff.fatigue, '피로');
  if (eff.scrim) add('scrimScore', eff.scrim, '스크림 점수');
  if (eff.popularity) add('popularity', eff.popularity, '인기도');
  if (eff.fans) { us.fans = Math.max(0, us.fans + eff.fans); lines.push(`팬 ${eff.fans > 0 ? '+' : ''}${eff.fans.toLocaleString()}`); }
  if (eff.money) { us.money += eff.money; lines.push(`자금 ${eff.money > 0 ? '+' : ''}${Math.round(eff.money / 10000).toLocaleString()}만 원`); }
  if (eff.moneyX) { const m = Math.round((2000 + us.popularity * 150) * 10000 * eff.moneyX / 1e6) * 1e6; us.money += m; lines.push(`자금 +${Math.round(m / 10000).toLocaleString()}만 원`); }
  if (eff.stat) for (const [k, v] of Object.entries(eff.stat)) { u.stats[k] = clamp(u.stats[k] + v, 1, 99); lines.push(`${STAT_KO[k]} +${v}`); }
  if (eff.form) { u.form = clamp((u.form || 0) + eff.form * 1.5, -10, 10); lines.push(`폼 ${eff.form > 0 ? '상승' : '하락'}`); }
  const chem = (pid, v) => { if (pid) us.chem[pid] = clamp((us.chem[pid] || 0) + v, 0, 100); };
  if (eff.chemAll) { const team = state.teams[u.teamId]; if (team) for (const pid of Object.keys(team.squadOf)) if (pid !== u.id) chem(pid, eff.chemAll); lines.push(`팀 케미 ${eff.chemAll > 0 ? '+' : ''}${eff.chemAll}`); }
  if (eff.chemRival) { chem(inst.ctxIds.rival, eff.chemRival); lines.push(`${inst.vars.rival}와 케미 ${eff.chemRival > 0 ? '+' : ''}${eff.chemRival}`); }
  if (eff.chemMateA) { chem(inst.ctxIds.mateA, eff.chemMateA); lines.push(`${inst.vars.mateA}와 케미 ${eff.chemMateA > 0 ? '+' : ''}${eff.chemMateA}`); }
  if (eff.chemMateB) { chem(inst.ctxIds.mateB, eff.chemMateB); lines.push(`${inst.vars.mateB}와 케미 ${eff.chemMateB > 0 ? '+' : ''}${eff.chemMateB}`); }
  if (eff.rivalForm && inst.ctxIds.rival) { const r = state.players[inst.ctxIds.rival]; r.form = clamp((r.form || 0) + eff.rivalForm * 3, -10, 10); lines.push(`${inst.vars.rival} 폼 ${eff.rivalForm > 0 ? '상승' : '하락'}`); }
  if (eff.masteryMeta && inst.ctxIds.metaChamp) { growMastery(u, inst.ctxIds.metaChamp, eff.masteryMeta); lines.push(`${inst.vars.metaChamp} 숙련도 상승`); }
  if (eff.masteryTop) { const c = topChamps(u, 1)[0]; if (c) { growMastery(u, c, eff.masteryTop); lines.push(`${champName(c)} 숙련도 상승`); } }
  if (eff.soloLp) { us.soloRank.lp += eff.soloLp; lines.push(`솔랭 ${eff.soloLp > 0 ? '+' : ''}${eff.soloLp}LP`); }
  if (eff.injuryDays && !us.injury) { us.injury = { type: '손목 염증', days: eff.injuryDays, total: eff.injuryDays }; lines.push(`🚑 ${eff.injuryDays}일 결장`); }
  return lines;
}
