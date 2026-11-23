import { go } from '../app.js';
import { DD, teamLogo } from '../assets.js';
import { LCK_TEAMS } from '../../../data/teams.js';

export function register(reg) { reg('title', { render }); }

function render(root) {
  root.innerHTML = `<div class="title-screen">
    <div class="title-logo">
      <div class="t1">LEAGUE OF LEGENDS</div>
      <div class="t2">프로게이머 커리어</div>
      <div class="t3">2군 연습생에서 월즈 챔피언까지</div>
    </div>
    <div class="title-teams">${LCK_TEAMS.map(t => teamLogo(t, 44)).join('')}</div>
    <div class="title-menu">
      <button class="btn primary" data-go="testMatch">테스트 경기</button>
    </div>
    <div class="net-badge">Data Dragon: ${DD.online ? '연결됨 (' + DD.version + ', ' + DD.source + ')' : '오프라인 — 대체 그래픽 사용'}</div>
  </div>`;
  root.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.go)));
}
