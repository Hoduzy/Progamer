// 국제 대회·포스트시즌 대진 화면
import { setExtraBody, bracketHTML } from './standings.js';
import { teamInfo } from '../../engine/roster.js';
import { userRef } from '../../engine/season.js';
import { teamLogo } from '../assets.js';
import { esc } from '../../core/util.js';

export function register() { setExtraBody(body); }

function mBox(state, m) {
  const ref = userRef(state);
  const line = i => { const t = teamInfo(state, m.teams[i]); const cls = m.done ? (m.winner === m.teams[i] ? 'w' : 'l') : ''; return `<div class="bt ${cls}">${teamLogo(t, 20)}<span>${esc(t.code)}</span><span class="tiny dim">${esc(t.region || state.teams[m.teams[i].replace(':A', '')].region)}</span><span class="sc">${m.done ? m.wins[i] : ''}</span></div>`; };
  return `<div class="bk-m ${m.teams.includes(ref) ? 'mine' : ''} clickable" data-m="${m.id}">${line(0)}${line(1)}<div class="bd">${m.date ? m.date.slice(5).replace('-', '/') : ''} · Bo${m.bo}${m.label ? ' · ' + esc(m.label) : ''}</div></div>`;
}
const list = (state, ms) => `<div class="grid3" style="grid-template-columns:repeat(4,1fr);gap:8px">${ms.map(m => mBox(state, m)).join('')}</div>`;

function body(state, comp) {
  let h = comp.city ? `<div class="small muted" style="margin-bottom:8px">개최지: ${esc(comp.city)}${comp.id === 'worlds' ? ' (결승: 뉴욕)' : ''}${comp.fsRegion ? ` · First Stand 우승 지역 시드 혜택: ${esc(comp.fsRegion)}` : ''}</div>` : '';
  if (comp.id === 'fs') {
    h += `<div class="col" style="gap:10px">${['A', 'B'].map(g => `<div class="panel"><h3>${g}조 (GSL, Bo5)</h3>${comp.gsl && comp.gsl[g] ? bracketHTML(state, comp, comp.gsl[g]) : ''}</div>`).join('')}</div>`;
    if (comp.bracket) h += `<div class="panel" style="margin-top:10px"><h3>녹아웃 (Bo5)</h3>${bracketHTML(state, comp, comp.bracket)}</div>`;
    return h;
  }
  if (comp.gauntlet) {
    const pm = comp.matches.filter(m => m.stage === 'playin');
    h += `<div class="panel" style="margin-bottom:10px"><h3>플레이-인</h3>${pm.length ? list(state, pm) : '<span class="muted small">플레이-인 없음</span>'}
      ${comp.direct ? `<div class="small muted" style="margin-top:8px">직행: ${comp.direct.map(id => esc(teamInfo(state, id).code)).join(', ')}${comp.gauntlet.done ? ` · 플레이-인 통과: ${comp.gauntlet.qualified.map(id => esc(teamInfo(state, id).code)).join(', ')}` : ''}</div>` : ''}</div>`;
  }
  if (comp.swiss) {
    const sw = comp.swiss;
    const order = sw.teams.slice().sort((a, b) => (sw.rec[b].w - sw.rec[b].l) - (sw.rec[a].w - sw.rec[a].l) || sw.rec[b].w - sw.rec[a].w);
    h += `<div class="grid2" style="grid-template-columns:340px 1fr;align-items:start;margin-bottom:10px"><div class="panel"><h3>스위스 스테이지</h3><table class="tbl"><tr><th>팀</th><th>지역</th><th>전적</th><th>상태</th></tr>
      ${order.map(id => { const t = teamInfo(state, id); const r = sw.rec[id]; return `<tr class="${id === userRef(state) ? 'me' : ''}"><td><span class="row" style="gap:6px">${teamLogo(t, 22)}<b>${esc(t.code)}</b></span></td><td>${esc(state.teams[id].region)}</td><td><b>${r.w}-${r.l}</b></td><td>${r.w >= 3 ? '<span class="chip green">진출</span>' : r.l >= 3 ? '<span class="chip red">탈락</span>' : ''}</td></tr>`; }).join('')}</table>
      <div class="tiny dim" style="margin-top:6px">3승 진출 · 3패 탈락 · 진출/탈락 결정전 Bo3, 나머지 Bo1</div></div>
      <div class="panel"><h3>라운드별 경기</h3>${sw.rounds.map((ids, i) => `<div class="gold small bold" style="margin:6px 0">${i + 1}라운드</div>${list(state, ids.map(id => comp.matches.find(m => m.id === id)))}`).join('')}</div></div>`;
  }
  if (comp.bracket) h += `<div class="panel"><h3>${comp.id === 'worlds' ? '녹아웃 스테이지 (Bo5)' : '브래킷 (더블 엘리미네이션 Bo5)'}</h3>${bracketHTML(state, comp, comp.bracket)}</div>`;
  return h;
}
