// 커뮤니티 (6단계에서 게시판 추가) · 뉴스 피드
import { App, go } from '../app.js';
import { shell } from '../layout.js';
import { esc } from '../../core/util.js';

export function register(reg) { reg('community', { render }); reg('records', { render: records }); }

function render(root) {
  const st = App.state;
  const html = `<div class="panel"><h3>뉴스 피드</h3>${st.news.slice(0, 80).map(n => `<div class="news-item"><span class="nd">${n.date.slice(5).replace('-', '/')}</span><span>${esc(n.text)}</span></div>`).join('') || '<div class="muted">뉴스 없음</div>'}</div>`;
  shell(root, 'community', html);
}
function records(root) {
  const st = App.state;
  const html = `<div class="panel"><h3>커리어</h3>${st.user.career.map(c => `<div class="news-item"><span class="nd">${c.year}</span><span>${esc(c.compName)} · ${c.rank}위 (${esc(st.teams[c.team].name)})</span></div>`).join('') || '<div class="muted">기록 없음</div>'}</div>`;
  shell(root, 'records', html);
}
