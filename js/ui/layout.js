// 허브 계열 공용 레이아웃: 왼쪽 메뉴 + 상단 상태 바
import { App, go } from './app.js';
import { teamLogo, playerPhoto } from './assets.js';
import { fmtDate, fmtWon, esc } from '../core/util.js';

export const NAV = [
  ['hub', '🏠', '홈'],
  ['calendar', '📅', '캘린더'],
  ['team', '👥', '팀'],
  ['me', '⭐', '내 선수'],
  ['contract', '📄', '계약·FA'],
  ['standings', '🏆', '순위·대진'],
  ['patch', '📝', '패치 노트'],
  ['community', '💬', '커뮤니티'],
  ['inbox', '✉', '메시지함'],
  ['records', '📚', '기록실'],
  ['settings', '⚙', '설정·저장'],
];

export function shell(root, active, contentHTML, opts = {}) {
  const st = App.state;
  const u = st.players[st.user.pid];
  const team = u.teamId ? st.teams[u.teamId] : null;
  const unread = st.inbox.filter(m => !m.read).length;
  root.innerHTML = `<div class="shell">
    <nav class="nav">
      <div class="nav-brand"><div class="b1">PRO CAREER</div><div class="b2">LCK 커리어</div></div>
      ${NAV.filter(n => !(opts.hide || []).includes(n[0])).map(([id, ic, label]) => `<button class="nav-item ${active === id ? 'active' : ''}" data-nav="${id}"><span class="ni">${ic}</span>${label}${id === 'inbox' && unread ? `<span class="badge">${unread}</span>` : ''}</button>`).join('')}
      <div class="nav-foot">시드 ${esc(String(st.seed))}<br>패치 ${esc(st.meta.version)}</div>
    </nav>
    <div class="main">
      <div class="topbar">
        ${playerPhoto(true, u.nick, team ? team.color : '#555', 38)}
        <div class="col" style="gap:0"><b style="font-size:16px">${esc(u.nick)}</b><span class="tiny dim">${team ? esc(team.name) + (u.squad === 'academy' ? ' 2군' : ' 1군') : 'FA'}</span></div>
        ${team ? teamLogo(team, 32) : ''}
        <div class="sep"></div>
        <div class="date">${fmtDate(st.date)}</div>
        <div class="grow"></div>
        <div class="kv">보유 자금<b>${fmtWon(st.user.money)}</b></div>
        <div class="kv">팬<b>${st.user.fans.toLocaleString()}</b></div>
        <div class="kv">인기도<b>${Math.round(st.user.popularity)}</b></div>
      </div>
      <div class="content ${opts.noscroll ? 'noscroll' : ''}" id="content">${contentHTML}</div>
    </div>
  </div>`;
  root.querySelectorAll('[data-nav]').forEach(b => b.addEventListener('click', () => go(b.dataset.nav)));
  return root.querySelector('#content');
}
