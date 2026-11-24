// 하루 진행 / 경기일까지 자동 진행 / 사용자 경기 처리
import { App, go, modal, toast } from './app.js';
import { CONFIG } from '../config.js';
import { esc, fmtDate, weekday, POS_KO, fmtTime } from '../core/util.js';
import { beginDay, endDay, userMatchOn, simulateMatch, buildSeries, recordSeries, simOtherMatches } from '../engine/season.js';
import { runActivity, ACTIVITIES, computeCondition } from '../engine/daily.js';
import { decideStarter, teamInfo } from '../engine/roster.js';
import { playSeries } from './seriesFlow.js';
import { saveTo } from './save.js';
import { teamLogo } from './assets.js';
import { STAT_KO } from '../core/util.js';
import { champName } from '../../data/champions.js';
import * as hooks from './hooks.js';
import { seasonTick, newSeason } from '../engine/career.js';
import { generateTopicPosts } from '../engine/community.js';

export function todaySlots(state) {
  const u = state.user;
  if (u.daySlots && u.daySlots.date === state.date) return u.daySlots.slots;
  return u.routine[weekday(state.date)].map(s => ({ ...s }));
}
export function setTodaySlot(state, i, slot) {
  const slots = todaySlots(state).map(s => ({ ...s }));
  slots[i] = slot;
  state.user.daySlots = { date: state.date, slots };
}
export function slotLabel(state, s) {
  const a = ACTIVITIES[s.a];
  if (!a) return '?';
  let extra = '';
  if (s.a === 'train' && s.stat) extra = ` · ${STAT_KO[s.stat]}`;
  if ((s.a === 'practice' || s.a === 'solo') && s.champ) extra = ` · ${champName(s.champ)}`;
  if (s.a === 'bond' && s.mate && state.players[s.mate]) extra = ` · ${state.players[s.mate].nick}`;
  return `${a.icon} ${a.name}${extra}`;
}

function autosave() { saveTo('auto', App.state, App.rng); }

// ---------------- 하루 진행 ----------------
export async function runDay() {
  const st = App.state, rng = App.rng;
  beginDay(st, rng);
  const match = userMatchOn(st, st.date);
  const slots = todaySlots(st);
  const n = match ? 2 : 3;
  const logs = [];
  for (let i = 0; i < n; i++) logs.push({ slot: CONFIG.daily.slots[i], res: runActivity(st, rng, slots[i]) });
  const evs = await hooks.afterActivities(st, rng, { manual: true });
  await modal({
    title: `${fmtDate(st.date)} 하루 기록`,
    body: `<div class="day-log">${logs.map(l => `<div class="dl-h">${l.slot} · ${ACTIVITIES[l.res.act].icon} ${ACTIVITIES[l.res.act].name}</div>${l.res.lines.map(x => `<div>${esc(x)}</div>`).join('')}`).join('')}
      ${evs.length ? `<div class="dl-h">이벤트</div>${evs.map(x => `<div>${esc(x)}</div>`).join('')}` : ''}
      <div class="dl-h">상태</div><div>컨디션 ${Math.round(st.user.condition)} · 피로 ${Math.round(st.user.fatigue)} · 멘탈 ${Math.round(st.user.mental)}</div>
      ${match ? `<div class="dl-h">저녁</div><div>경기가 있습니다: <b>${esc(teamInfo(st, match.teams[0]).name)} vs ${esc(teamInfo(st, match.teams[1]).name)}</b></div>` : ''}</div>`,
    buttons: [{ label: match ? '경기 준비 ▶' : '하루 마무리', primary: true }],
  });
  if (match) playUserMatch(match, () => finishDay());
  else finishDay();
}

// 시즌 단계 전환 처리 (시즌 종료 / FA 시작 / FA 마감 / 새 시즌)
export async function handleSeasonEvents(evs) {
  const st = App.state, rng = App.rng;
  let navigated = false;
  for (const e of evs) {
    if (e.type === 'seasonEnd') {
      await hooks.onSeasonEnd(st, rng);
    } else if (e.type === 'faStart') {
      autosave();
      go('contract'); navigated = true;
      const free = st.fa && st.fa.status === 'free';
      await modal({ title: 'FA 기간 시작', body: free ? `계약이 만료되어 FA가 됐습니다. <b>${st.fa.offers.filter(o => o.status === 'open').length}개</b>의 제안이 도착했습니다. 계약·FA 화면에서 확인하세요.` : '계약 기간이 남아 있습니다. 원한다면 구단에 이적을 요청할 수 있습니다.', buttons: [{ label: '확인', primary: true }] });
    } else if (e.type === 'faEnd') {
      if (st.fa && (st.fa.status === 'free' || st.fa.status === 'transfer') && !st.fa.signed) {
        const best = st.fa.offers.filter(o => o.status === 'open').sort((a, b) => b.salary - a.salary)[0];
        if (best) {
          const { acceptOffer } = await import('../engine/career.js');
          acceptOffer(st, rng, best.id);
          await modal({ title: 'FA 마감', body: `FA 기간이 끝나 가장 좋은 제안(<b>${esc(st.teams[best.teamId].name)}</b>, ${fmtWonS(best.salary)})과 자동으로 계약했습니다.`, buttons: [{ label: '확인', primary: true }] });
        }
      }
    } else if (e.type === 'newSeasonReady') {
      newSeason(st, rng);
      autosave();
      go('hub'); navigated = true;
      await modal({ title: `${st.year} 시즌 개막`, body: `새 시즌이 시작됩니다! ${esc(st.players[st.user.pid].nick)} (${st.players[st.user.pid].age}세) · ${esc(st.teams[st.players[st.user.pid].teamId].name)} ${st.players[st.user.pid].squad === 'main' ? '1군' : '2군'}<br><span class="small muted">지난 시즌 기록은 기록실에서 볼 수 있습니다.</span>`, buttons: [{ label: '시작!', primary: true }] });
    }
  }
  return navigated;
}
const fmtWonS = w => (w >= 1e8 ? `${Math.floor(w / 1e8)}억 ${Math.round((w % 1e8) / 1e4).toLocaleString()}만 원` : `${Math.round(w / 1e4).toLocaleString()}만 원`);

export async function finishDay(extraLines = []) {
  const st = App.state, rng = App.rng;
  const r = endDay(st, rng);
  const sevs = seasonTick(st, rng);
  autosave();
  const lines = [...extraLines];
  if (r.patch) { lines.push(`📝 패치 ${r.patch}가 적용됐습니다. 메타가 바뀌었습니다.`); generateTopicPosts(st, rng, 'patch'); }
  if (r.review && r.review.type === 'callup') lines.push('🎉 1군으로 콜업됐습니다!');
  if (r.review && r.review.type === 'demote') lines.push('⬇ 2군으로 내려갔습니다.');
  go('hub');
  if (lines.length) await modal({ title: '알림', body: lines.map(esc).join('<br>'), buttons: [{ label: '확인', primary: true }] });
  await hooks.afterDayEnd(st, rng);
  if (sevs.length) await handleSeasonEvents(sevs);
}

// ---------------- 경기일까지 자동 진행 ----------------
export async function autoAdvance(maxDays = 60) {
  const st = App.state, rng = App.rng;
  if (userMatchOn(st, st.date)) { toast('오늘은 경기일입니다. "하루 진행"으로 경기를 준비하세요.'); return; }
  const notes = [];
  let days = 0, stopReason = '';
  while (days < maxDays) {
    beginDay(st, rng);
    if (userMatchOn(st, st.date)) { stopReason = '경기일'; break; }
    const slots = todaySlots(st);
    const before = { inj: st.user.injury };
    for (let i = 0; i < 3; i++) {
      const res = runActivity(st, rng, slots[i]);
      if (res.injury) notes.push(`${st.date} 🚑 ${res.injury.type} (${res.injury.days}일 결장)`);
      if (res.controversy) notes.push(`${st.date} ⚠ 방송 논란`);
    }
    const evs = await hooks.afterActivities(st, rng, { manual: false });
    for (const e of evs) notes.push(`${st.date} ${e}`);
    const r = endDay(st, rng);
    const sevs = seasonTick(st, rng);
    days++;
    if (sevs.length) { autosave(); await handleSeasonEvents(sevs); if (sevs.some(e => e.type !== 'seasonEnd')) return; stopReason = '시즌 종료'; break; }
    if (r.patch) { notes.push(`${st.date} 📝 패치 ${r.patch}`); generateTopicPosts(st, rng, 'patch'); }
    if (r.review) { notes.push(`${st.date} ${r.review.type === 'callup' ? '🎉 1군 콜업!' : '⬇ 2군 이동'}`); stopReason = '로스터 변동'; break; }
    if (!before.inj && st.user.injury) { stopReason = '부상'; break; }
    if (hooks.shouldStop(st)) { stopReason = '중요 일정'; break; }
    if (userMatchOn(st, st.date)) { stopReason = '경기일'; break; }
  }
  autosave();
  go('hub');
  await modal({
    title: `자동 진행 ${days}일`,
    body: `<div>현재: <b>${fmtDate(st.date)}</b>${stopReason ? ` · 정지 사유: <b class="gold">${stopReason}</b>` : ''}</div>
      <div class="small" style="margin-top:8px;max-height:360px;overflow:auto">${notes.length ? notes.map(esc).join('<br>') : '특별한 일 없이 훈련에 집중했습니다.'}</div>
      <div class="small muted" style="margin-top:8px">컨디션 ${Math.round(st.user.condition)} · 피로 ${Math.round(st.user.fatigue)} · 멘탈 ${Math.round(st.user.mental)}</div>`,
    buttons: [{ label: '확인', primary: true }],
  });
}

// ---------------- 사용자 팀 경기 ----------------
export async function playUserMatch(match, done) {
  const st = App.state, rng = App.rng;
  const u = st.players[st.user.pid];
  const comp = st.season.comps[match.compId];
  st.user.condition = computeCondition(st);
  let plays = true;
  if (u.squad === 'main' && comp.league !== 'CL') {
    const dec = decideStarter(st, rng);
    if (!dec.solo) {
      plays = dec.starter === u.id;
      const rows = dec.reasons && dec.reasons.length && dec.user ? dec.reasons.map(r => `<tr><td>${r.k}</td><td class="${r.user > r.rival ? 'better' : ''}">${fmtV(r.user)}</td><td class="${r.rival > r.user ? 'better' : ''}">${fmtV(r.rival)}</td></tr>`).join('') : '';
      await modal({
        title: `감독 ${esc(st.teams[u.teamId].coach.nick)}의 결정`,
        body: `${dec.injured ? '<p>부상으로 이번 경기는 출전하지 않습니다.</p>' : `<p style="font-size:18px">이번 경기 주전 ${POS_KO[u.pos]}: <b class="${plays ? 'gold' : 'neg'}">${esc(st.players[dec.starter].nick)}</b></p>`}
          ${rows ? `<table class="tbl lineup-tbl"><tr><th>항목</th><th>나 (${esc(u.nick)})</th><th>${esc(dec.rival.nick)}</th></tr>${rows}</table>
          <p class="small muted">가장 크게 작용한 요인: <b>${esc(dec.reasons[0].k)}</b>${dec.reasons[1] ? `, ${esc(dec.reasons[1].k)}` : ''}</p>` : ''}
          ${!plays && !dec.injured ? `<p class="small">벤치에서 경기를 지켜봅니다. (연속 벤치 ${st.user.benchStreak}회)</p>` : ''}`,
        buttons: [{ label: plays ? '출전 준비 ▶' : '경기 결과 보기', primary: true }],
      });
    }
  } else if (st.user.injury) plays = false;
  if (!plays) {
    const s = simulateMatch(st, rng, match);
    st.user.lineupOverride = null;
    const mine = match.teams.findIndex(t => t.replace(':A', '') === u.teamId);
    await modal({
      title: `${comp.short} 경기 결과`,
      body: seriesResultHTML(st, match, mine),
      buttons: [{ label: '확인', primary: true }],
    });
    await hooks.afterSeries(st, rng, match, { played: false });
    return done();
  }
  const s = buildSeries(st, match);
  const ut = s.teams.findIndex(t => t.players.some(p => p && p.id === u.id));
  if (ut < 0) { simulateMatch(st, rng, match); return done(); }
  const scenes = [];
  playSeries({
    series: s, userTeamIdx: ut, userPid: u.id, meta: st.meta, rng,
    getUserState: () => ({ condition: st.user.condition, mental: st.user.mental, fatigue: st.user.fatigue }),
    onGameEnd: result => { st.user.fatigue = Math.min(100, st.user.fatigue + CONFIG.daily.fatigue.match / s.bo); if (result.sceneLog) scenes.push(...result.sceneLog); },
    onSeriesEnd: async ser => {
      recordSeries(st, rng, match, ser);
      st.user.lineupOverride = null;
      go('hub');
      await modal({ title: `${comp.short} 시리즈 종료`, body: seriesResultHTML(st, match, ut), buttons: [{ label: '확인', primary: true }] });
      await hooks.afterSeries(st, rng, match, { played: true, series: ser, userTeamIdx: ut, scenes });
      done();
    },
  });
}
const fmtV = v => (typeof v === 'number' ? (v % 1 ? v.toFixed(1) : String(Math.round(v))) : v);

export function seriesResultHTML(st, match, mineIdx = -1) {
  const a = teamInfo(st, match.teams[0]), b = teamInfo(st, match.teams[1]);
  const win = mineIdx >= 0 ? match.winner === match.teams[mineIdx] : null;
  return `<div class="row center" style="gap:14px;font-size:24px;margin-bottom:10px">${teamLogo(a, 48)}<b>${esc(a.code)} ${match.wins[0]} : ${match.wins[1]} ${esc(b.code)}</b>${teamLogo(b, 48)}</div>
    ${win !== null ? `<div style="text-align:center;font-size:20px;font-weight:900" class="${win ? 'gold' : 'neg'}">${win ? '승리!' : '패배'}</div>` : ''}
    <table class="tbl" style="margin-top:8px"><tr><th>세트</th><th>승리</th><th>시간</th><th>킬</th><th>POG</th></tr>
    ${match.games.map((gm, i) => `<tr><td>${i + 1}세트</td><td>${esc(teamInfo(st, gm.w).code)}</td><td>${fmtTime(gm.d)}</td><td>${gm.k[0]}:${gm.k[1]}</td><td>${gm.pog && st.players[gm.pog] ? esc(st.players[gm.pog].nick) : '-'}</td></tr>`).join('')}</table>`;
}
