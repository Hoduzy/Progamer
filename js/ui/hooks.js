// 일상·경기 흐름에 끼어드는 연출: 랜덤 이벤트, 인터뷰, 커뮤니티, 시상
import { App, go, modal, toast } from './app.js';
import { esc, avg, POS_KO } from '../core/util.js';
import { rollEvent, resolveEvent } from '../engine/events.js';
import { generatePosts, interviewQuestion, applyInterview, seriesPostInfo, communityReact, toneText } from '../engine/community.js';
import { teamInfo } from '../engine/roster.js';
import { champName } from '../../data/champions.js';
import { teamLogo, champIcon } from './assets.js';

// 하루 행동 뒤 랜덤 이벤트 (선택지 모달)
export async function afterActivities(state, rng, opts) {
  const ev = rollEvent(state, rng);
  if (!ev) return [];
  const idx = await modal({
    title: `📢 ${esc(ev.title)}`,
    body: `<div style="font-size:16px;line-height:1.7">${esc(ev.text)}</div><div class="small muted" style="margin-top:8px">${state.date}</div>`,
    buttons: ev.choices.map((c, i) => ({ label: esc(c), value: i, primary: i === 0 })),
  });
  const res = resolveEvent(state, rng, ev, idx ?? 0);
  if (ev.id === 'controversy') communityReact(state, 'controversy');
  await modal({
    title: esc(ev.title),
    body: `<div style="font-size:16px">${esc(res.text)}</div>${res.lines.length ? `<div class="small gold" style="margin-top:8px">${res.lines.map(esc).join(' · ')}</div>` : ''}`,
    buttons: [{ label: '확인', primary: true }],
  });
  return [`📢 ${ev.title}: ${res.text}`];
}

export async function afterDayEnd(state, rng) {
  await showPendingAwards(state);
}

async function showPendingAwards(state) {
  const us = state.user;
  if (us.pendingAwards && us.pendingAwards.length) {
    const list = us.pendingAwards.slice();
    us.pendingAwards = [];
    await modal({ title: '🏅 수상!', body: `<div style="font-size:20px;line-height:1.8;text-align:center">${list.map(n => `<div class="gold bold">${esc(n)}</div>`).join('')}</div><div class="small muted" style="text-align:center;margin-top:8px">팬 +3,000 · 인기도 +4 · 감독 신뢰 +4</div>`, buttons: [{ label: '감사합니다!', primary: true }] });
  }
  if (state.season.ceremony && !state.season.ceremonyShown) {
    state.season.ceremonyShown = true;
    await modal({ title: `🏆 ${state.year} LCK 어워드`, body: `<div class="small" style="line-height:1.8;columns:2">${state.season.ceremony.map(esc).join('<br>')}</div>`, buttons: [{ label: '확인', primary: true }], wide: true });
  }
}

// 시리즈 종료 후: 인터뷰 → 커뮤니티 → 시상
export async function afterSeries(state, rng, match, info) {
  const u = state.players[state.user.pid];
  const comp = state.season.comps[match.compId];
  const myRef = match.teams.find(t => t.replace(':A', '') === u.teamId);
  const scenes = info.scenes || [];
  const ext = scenes.filter(s => s.tier === 'crit' || s.tier === 'fumble').sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0] || scenes[0];
  const pinfo = seriesPostInfo(state, match, { played: info.played, moment: ext ? ext.text : null });
  const { played, win, rating } = pinfo;
  // 인터뷰 (승리 + 출전)
  if (played && win && (comp.league !== 'CL' || rng.chance(0.5))) {
    const q = interviewQuestion(state, rng, pinfo);
    const kind = await modal({
      title: '🎤 승리 인터뷰',
      body: `<div class="row" style="gap:10px">${teamLogo(teamInfo(state, myRef), 36)}<div><b>${esc(u.nick)}</b><div class="small muted">${esc(comp.name)} · 평점 ${rating != null ? rating.toFixed(1) : '-'}</div></div></div><p style="font-size:17px;margin-top:12px">기자: "${esc(q)}"</p>`,
      buttons: [{ label: '겸손하게', value: 'humble' }, { label: '도발하기', value: 'provoke' }, { label: '팀원 칭찬', value: 'team', primary: true }],
    });
    const r = applyInterview(state, rng, kind || 'humble', pinfo);
    await modal({ title: '인터뷰 반응', body: `<p style="font-size:16px">"${esc(r.answer)}"</p><div class="small gold">${r.lines.map(esc).join('<br>')}</div>`, buttons: [{ label: '확인', primary: true }] });
  }
  // 커뮤니티
  const posts = generatePosts(state, rng, pinfo);
  if (posts.length) toast(`💬 커뮤니티에 새 글 ${posts.length}개: "${esc(toneText(posts[0].title, App.settings.communityTone))}"`, 3500);
  await showPendingAwards(state);
}

export async function onSeasonEnd(state, rng) {
  const u = state.players[state.user.pid];
  const S = u.season;
  const C = state.season.comps;
  const champs = ['lckCup', 'fs', 'msi', 'lckpo', 'worlds'].map(id => C[id].result ? `${C[id].name}: <b>${esc(teamInfo(state, C[id].result.champion).name)}</b>` : '').filter(Boolean);
  await modal({
    title: `${state.year} 시즌 종료`,
    body: `<div class="grid2"><div><div class="gold bold">올해의 우승 팀</div><div class="small" style="line-height:1.8">${champs.join('<br>')}</div></div>
      <div><div class="gold bold">나의 시즌</div><div class="small" style="line-height:1.8">${S.games}경기 ${S.wins}승 · KDA ${S.k}/${S.d}/${S.a}<br>평균 평점 ${S.games ? (S.ratingSum / S.games).toFixed(2) : '-'} · POG ${S.pogs}<br>수상: ${(state.user.awards || []).filter(a => a.year === state.year).map(a => esc(a.name)).join(', ') || '없음'}<br>트로피: ${state.user.trophies.filter(t => t.year === state.year).map(t => esc(t.name)).join(', ') || '없음'}</div></div></div>
      <p class="small muted">FA 기간(${state.season.faStart.slice(5).replace('-', '/')}~)이 열리면 계약 상황을 확인하세요.</p>`,
    buttons: [{ label: '확인', primary: true }], wide: true,
  });
}

export function shouldStop(state) { return false; }
