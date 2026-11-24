// 커뮤니티 게시판 · 뉴스 피드 · 기록실
import { App, go, saveSettings } from '../app.js';
import { CONFIG } from '../../config.js';
import { toneText, fixedUserList } from '../../engine/community.js';
import { shell } from '../layout.js';
import { esc, fmtWon, POS_KO, fmtDate } from '../../core/util.js';
import { teamInfo } from '../../engine/roster.js';
import { careerSummary } from '../../engine/career.js';
import { ovr } from '../../engine/players.js';
import { champIcon, teamLogo } from '../assets.js';
import { champName } from '../../../data/champions.js';

export function register(reg) { reg('community', { render }); reg('records', { render: records }); }

const TONES = [['mild', '순한맛'], ['normal', '보통'], ['spicy', '매운맛']];
const ROLE_KO = { anti: '안티', fan: '팬', teamFan: '다른 팀 팬', analyst: '분석충', joker: '드립충', asker: '질문충', neutral: '중립' };

function render(root, params) {
  const st = App.state;
  const tab = params.tab || 'board';
  const open = params.open ?? 0;
  const tone = App.settings.communityTone || CONFIG.community.defaultTone;
  const T = t => esc(toneText(t, tone));
  const nick = (who, uid) => uid ? `<b class="gold" title="고정 유저">${esc(who)}</b>` : `<b style="color:var(--txt2)">${esc(who)}</b>`;
  let body = '';
  if (tab === 'board') {
    const posts = st.community || [];
    const p = posts[open];
    const ncom = q => q.comments.length + q.comments.reduce((a, c) => a + (c.replies ? c.replies.length : 0), 0);
    body = posts.length ? `<div class="grid2" style="grid-template-columns:400px 1fr;align-items:start">
      <div class="panel scroll" style="max-height:640px;padding:6px">${posts.map((q, i) => `<div class="news-item" data-open="${i}" style="cursor:pointer;padding:8px;border-radius:6px;${i === open ? 'background:rgba(212,175,55,.1)' : ''}"><div class="grow"><div class="bold" style="white-space:normal">${q.story ? '<span class="chip gold">고닉</span> ' : ''}${T(q.title)} <span class="gold small">[${ncom(q)}]</span></div><div class="tiny dim">${esc(q.who)} · ${q.date.slice(5)} · 조회 ${q.views.toLocaleString()} · 추천 ${q.up}</div></div></div>`).join('')}</div>
      ${p ? `<div class="panel"><div class="tiny dim">${nick(p.who, p.uid)} · ${fmtDate(p.date)} · 조회 ${p.views.toLocaleString()}</div>
        <h3 style="margin-top:6px;font-size:19px">${T(p.title)}</h3><div style="line-height:1.7;margin-bottom:12px">${T(p.body)}</div>
        <div class="row" style="margin-bottom:10px"><span class="chip gold">추천 ${p.up}</span><span class="tiny dim">댓글 ${ncom(p)}</span></div>
        ${p.comments.map(c => `<div class="cm"><div class="row" style="gap:8px;align-items:flex-start"><span class="cm-who">${nick(c.who, c.uid)}</span><span class="grow">${T(c.text)}</span><span class="tiny dim" style="flex:none">👍 ${c.up}</span></div>
          ${(c.replies || []).map(r => `<div class="cm-re row" style="gap:8px;align-items:flex-start"><span class="dim">ㄴ</span><span class="cm-who">${nick(r.who, r.uid)}</span><span class="grow">${T(r.text)}</span><span class="tiny dim" style="flex:none">👍 ${r.up}</span></div>`).join('')}</div>`).join('')}</div>` : ''}</div>`
      : '<div class="panel muted">아직 글이 없습니다. 경기를 치르면 커뮤니티 반응이 올라옵니다.</div>';
  } else if (tab === 'users') {
    const list = fixedUserList(st);
    const bar = f => `<div class="bar" style="width:120px;height:8px;position:relative;background:#0a0f22"><i style="position:absolute;top:0;bottom:0;${f >= 0 ? `left:50%;width:${f / 2}%` : `right:50%;width:${-f / 2}%`};background:${f >= 0 ? 'var(--green)' : 'var(--red)'}"></i></div>`;
    body = `<div class="panel"><h3>고정 유저 (고닉)</h3><div class="small muted" style="margin-bottom:8px">내 경기력·인터뷰·논란에 따라 호감도가 천천히 바뀝니다. 호감도 ${CONFIG.community.fanAt} 이상이면 팬처럼, ${CONFIG.community.antiAt} 이하면 안티처럼 행동합니다.</div>
      <div class="grid3" style="grid-template-columns:1fr 1fr 1fr">${list.sort((a, b) => b.favor - a.favor).map(u => `<div class="panel" style="padding:10px"><div class="row between"><b>${esc(u.nick)}</b>${u.now === 'fan' ? '<span class="chip green">팬</span>' : u.now === 'anti' ? '<span class="chip red">안티</span>' : `<span class="chip">${esc(ROLE_KO[u.now] || u.now)}</span>`}</div>
        <div class="tiny dim" style="margin:2px 0 6px">원래 ${ROLE_KO[u.role] || u.role}${u.team ? ' · ' + esc(u.team) + ' 팬' : ''}</div>
        <div class="row" style="gap:6px">${bar(u.favor)}<b class="small">${Math.round(u.favor)}</b></div>
        <div class="small muted" style="margin-top:6px;line-height:1.45">${esc(u.desc)}</div></div>`).join('')}</div></div>`;
  } else {
    body = `<div class="panel">${st.news.slice(0, 120).map(n => `<div class="news-item"><span class="nd">${n.date.slice(5).replace('-', '/')}</span><span>${esc(n.text)}</span></div>`).join('') || '<div class="muted">뉴스 없음</div>'}</div>`;
  }
  const html = `<div class="tabs"><button class="btn sm ${tab === 'board' ? 'active' : ''}" data-tab="board">💬 게시판</button><button class="btn sm ${tab === 'users' ? 'active' : ''}" data-tab="users">🧑‍🤝‍🧑 고닉</button><button class="btn sm ${tab === 'news' ? 'active' : ''}" data-tab="news">📰 뉴스 피드</button>
    <div class="grow"></div><span class="small muted" style="align-self:center">수위</span>${TONES.map(([k, l]) => `<button class="btn sm ${tone === k ? 'active' : ''}" data-tone="${k}">${l}</button>`).join('')}</div>${body}`;
  const c = shell(root, 'community', html);
  c.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => go('community', { tab: b.dataset.tab })));
  c.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => go('community', { tab, open: Number(b.dataset.open) })));
  c.querySelectorAll('[data-tone]').forEach(b => b.addEventListener('click', () => { App.settings.communityTone = b.dataset.tone; saveSettings(); go('community', { tab, open }); }));
}

function records(root, params) {
  const st = App.state;
  const tab = params.tab || 'career';
  const u = st.players[st.user.pid];
  const sum = careerSummary(st);
  const t = sum.totals;
  let body = '';
  if (tab === 'career') {
    body = `<div class="grid3" style="grid-template-columns:repeat(6,1fr);margin-bottom:12px">
      ${[['통산 경기', t.g], ['승률', t.g ? Math.round(t.w / t.g * 100) + '%' : '-'], ['평균 평점', sum.avgRating ?? '-'], ['통산 KDA', `${t.k}/${t.d}/${t.a}`], ['트로피', sum.trophies.length], ['수상', sum.awards.length]].map(([k, v]) => `<div class="panel" style="text-align:center;padding:10px"><div class="tiny dim">${k}</div><div style="font-size:22px;font-weight:900" class="gold">${v}</div></div>`).join('')}</div>
      <div class="panel" style="margin-bottom:12px"><h3>시즌별 기록</h3><table class="tbl"><tr><th>시즌</th><th>팀</th><th>경기</th><th>승</th><th>평점</th><th>KDA</th><th>POG</th><th>최다 챔피언</th><th>연봉</th><th>종합</th><th>트로피·수상</th></tr>
        ${sum.seasons.map(s => `<tr><td>${s.year}${s.partial ? ' (진행 중)' : ''}</td><td>${s.team ? `<span class="row" style="gap:4px">${teamLogo(st.teams[s.team] || { code: s.team }, 20)}${esc(st.teams[s.team] ? st.teams[s.team].code : s.team)}</span>` : '-'} ${s.squad === 'academy' ? '<span class="tiny dim">2군</span>' : ''}</td><td>${s.games}</td><td>${s.wins}</td><td><b>${s.rating ?? '-'}</b></td><td>${s.k}/${s.d}/${s.a}</td><td>${s.pogs || 0}</td><td>${s.topChamp ? champIcon(s.topChamp, 22) + ' ' + esc(champName(s.topChamp)) : '-'}</td><td>${fmtWon(s.salary)}</td><td>${s.ovr || '-'}</td><td class="small" style="white-space:normal">${[...(s.trophies || []), ...(s.awards || [])].map(esc).join(', ')}</td></tr>`).join('') || '<tr><td colspan="11" class="muted">아직 기록이 없습니다.</td></tr>'}</table></div>
      <div class="grid2" style="align-items:start"><div class="panel"><h3>트로피</h3>${st.user.trophies.map(x => `<div class="news-item">🏆 ${x.year} ${esc(x.name)} · ${esc(st.teams[x.team] ? st.teams[x.team].name : x.team)}${x.played ? '' : ' <span class="dim">(벤치)</span>'}</div>`).join('') || '<div class="muted small">없음</div>'}</div>
      <div class="panel"><h3>개인 수상</h3>${(st.user.awards || []).map(x => `<div class="news-item">🏅 ${x.year} ${esc(x.name)}</div>`).join('') || '<div class="muted small">없음</div>'}</div></div>`;
  } else if (tab === 'champs') {
    const cs = Object.entries(st.user.champStats || {}).sort((a, b) => b[1].g - a[1].g);
    body = `<div class="panel"><h3>챔피언별 기록</h3><table class="tbl"><tr><th>챔피언</th><th>경기</th><th>승률</th><th>KDA</th><th>평균 평점</th><th>숙련도</th></tr>
      ${cs.map(([c, s]) => `<tr><td>${champIcon(c, 26)} <b>${esc(champName(c))}</b></td><td>${s.g}</td><td>${Math.round(s.w / s.g * 100)}%</td><td>${(s.k / s.g).toFixed(1)}/${(s.d / s.g).toFixed(1)}/${(s.a / s.g).toFixed(1)}</td><td><b>${(s.r / s.g).toFixed(2)}</b></td><td>${Math.round(u.champs[c] || 0)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">기록 없음</td></tr>'}</table></div>`;
  } else if (tab === 'log') {
    body = `<div class="panel"><h3>경기 기록 (최근 80경기)</h3><table class="tbl"><tr><th>날짜</th><th>대회</th><th>상대</th><th>결과</th><th>챔피언</th><th>KDA</th><th>CS</th><th>시간</th><th>평점</th></tr>
      ${st.user.matchLog.map(m => `<tr><td>${m.date}</td><td>${esc(m.compName)}</td><td>${esc(m.opp ? (st.teams[m.opp] ? st.teams[m.opp].code : m.opp) : '')}</td><td class="${m.win ? 'pos' : 'neg'}">${m.win ? '승' : '패'}</td><td>${champIcon(m.champ, 22)} ${esc(champName(m.champ))}</td><td>${m.k}/${m.d}/${m.a}</td><td>${m.cs}</td><td>${Math.floor(m.dur / 60)}분</td><td><b>${m.rating.toFixed(1)}</b>${m.pog ? ' <span class="chip gold">POG</span>' : ''}</td></tr>`).join('') || '<tr><td colspan="9" class="muted">기록 없음</td></tr>'}</table></div>`;
  } else if (tab === 'awards') {
    const years = [...new Set(st.awards.map(a => a.year))].sort((a, b) => b - a);
    body = years.map(y => `<div class="panel" style="margin-bottom:10px"><h3>${y} 시상</h3><div class="grid3">${st.awards.filter(a => a.year === y).map(a => `<div class="news-item ${a.pid === u.id ? 'gold' : ''}"><span class="grow"><b>${esc(a.name)}</b><br><span class="small">${esc(a.nick)} · ${esc(a.team ? (st.teams[a.team] ? st.teams[a.team].code : a.team) : '')} ${a.extra ? '· ' + esc(a.extra) : ''}</span></span></div>`).join('')}</div></div>`).join('') || '<div class="panel muted">아직 시상 기록이 없습니다.</div>';
  } else if (tab === 'events') {
    body = `<div class="panel"><h3>이벤트 기록</h3>${st.eventLog.map(e => `<div class="news-item"><span class="nd">${e.date.slice(5)}</span><span><b>${esc(e.title)}</b> — ${esc(e.choice)} → ${esc(e.result)}</span></div>`).join('') || '<div class="muted small">없음</div>'}</div>`;
  } else if (tab === 'history') {
    body = `<div class="panel"><h3>역대 우승</h3><table class="tbl"><tr><th>시즌</th><th>LCK컵</th><th>First Stand</th><th>MSI</th><th>LCK</th><th>Worlds</th></tr>
      ${st.records.seasons.map(s => `<tr><td>${s.year}</td>${['lckCup', 'fs', 'msi', 'lckpo', 'worlds'].map(k => `<td>${s.comps && s.comps[k] && s.comps[k].champion ? esc(teamInfo(st, s.comps[k].champion).code) : '-'}</td>`).join('')}</tr>`).join('') || '<tr><td colspan="6" class="muted">첫 시즌 진행 중</td></tr>'}</table></div>`;
  }
  const tabs = [['career', '커리어'], ['champs', '챔피언'], ['log', '경기 기록'], ['awards', '시상'], ['events', '이벤트'], ['history', '역대 우승']];
  const html = `<div class="tabs">${tabs.map(([k, l]) => `<button class="btn sm ${tab === k ? 'active' : ''}" data-tab="${k}">${l}</button>`).join('')}<div class="grow"></div><button class="btn sm" id="hof">명예의 전당</button></div>${body}`;
  const c = shell(root, 'records', html);
  c.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => go('records', { tab: b.dataset.tab })));
  c.querySelector('#hof').addEventListener('click', () => go('hof'));
}
