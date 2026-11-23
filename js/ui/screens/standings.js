// 순위표 · 브래킷 · 일정/결과
import { App, go, modal } from '../app.js';
import { shell } from '../layout.js';
import { esc, fmtDate, fmtTime } from '../../core/util.js';
import { sortStandings, BRACKETS } from '../../engine/tournament.js';
import { teamInfo } from '../../engine/roster.js';
import { lckRegularStandings, userRef } from '../../engine/season.js';
import { teamLogo } from '../assets.js';
import { seriesResultHTML } from '../dayFlow.js';

export function register(reg) { reg('standings', { render }); }

function formDots(state, comp, id) {
  const ms = comp.matches.filter(m => m.done && m.teams.includes(id)).slice(-5);
  return `<span class="form-dots">${ms.map(m => `<i class="${m.winner === id ? 'w' : 'l'}"></i>`).join('')}</span>`;
}

export function tableHTML(state, comp, st, ids = null, opts = {}) {
  const order = (ids ? ids : sortStandings(st, comp ? comp.matches : []));
  const myTeam = state.players[state.user.pid].teamId;
  return `<table class="tbl"><tr><th>#</th><th>팀</th><th>승</th><th>패</th><th>세트</th><th>득실</th>${comp ? '<th>최근</th>' : ''}</tr>
    ${order.map((id, i) => { const t = teamInfo(state, id); const s = st[id]; const cut = opts.cut && opts.cut.includes(i + 1);
      return `<tr class="${id.replace(':A', '') === myTeam ? 'me' : ''}" style="${cut ? 'border-bottom:2px solid var(--gold-dim)' : ''}"><td class="rank-num">${i + 1}</td><td><span class="row" style="gap:6px">${teamLogo(t, 24)}<b>${esc(t.name)}</b></span></td><td><b>${s.w}</b></td><td>${s.l}</td><td>${s.gw}-${s.gl}</td><td class="${s.gw - s.gl > 0 ? 'pos' : s.gw - s.gl < 0 ? 'neg' : ''}">${s.gw - s.gl > 0 ? '+' : ''}${s.gw - s.gl}</td>${comp ? `<td>${formDots(state, comp, id)}</td>` : ''}</tr>`; }).join('')}</table>`;
}

function matchBox(state, m, ref) {
  if (!m) return `<div class="bk-m"><div class="bt l">미정</div><div class="bt l">미정</div></div>`;
  const mine = ref && m.teams.includes(ref);
  const line = i => {
    const id = m.teams[i];
    if (!id) return `<div class="bt l">미정</div>`;
    const t = teamInfo(state, id);
    const cls = m.done ? (m.winner === id ? 'w' : 'l') : '';
    return `<div class="bt ${cls}">${teamLogo(t, 20)}<span>${esc(t.code)}</span><span class="sc">${m.done || m.wins[i] ? m.wins[i] : ''}</span></div>`;
  };
  return `<div class="bk-m ${mine ? 'mine' : ''} clickable" data-m="${m.id}">${line(0)}${line(1)}<div class="bd">${m.date ? m.date.slice(5).replace('-', '/') : ''} · Bo${m.bo}${m.label ? ' · ' + esc(m.label) : ''}</div></div>`;
}

export function bracketHTML(state, comp, br) {
  if (!br) return '';
  const def = BRACKETS[br.type];
  const ref = userRef(state);
  const rounds = [...new Set(def.nodes.map(n => n.round))].sort((a, b) => a - b);
  return `<div class="bk">${rounds.map(r => {
    const nodes = def.nodes.filter(n => n.round === r);
    return `<div class="bk-col"><div class="bk-title">${esc(nodes[0].label)}${nodes.length > 1 && nodes.some(n => n.label !== nodes[0].label) ? ' 외' : ''}</div>${nodes.map(n => {
      const m = br.nodes[n.id] ? comp.matches.find(x => x.id === br.nodes[n.id]) : null;
      return `<div><div class="tiny dim" style="margin-bottom:2px">${esc(n.label)}</div>${matchBox(state, m, ref)}</div>`;
    }).join('')}</div>`;
  }).join('')}</div>`;
}

function listHTML(state, ms) {
  const ref = userRef(state);
  return `<div class="grid3" style="grid-template-columns:repeat(4,1fr);gap:8px">${ms.map(m => matchBox(state, m, ref)).join('')}</div>`;
}

function compBody(state, comp) {
  let h = '';
  if (!comp.started) return `<div class="muted">${fmtDate(comp.start)} 개막 예정${comp.city ? ' · ' + esc(comp.city) : ''}. 참가 팀은 이전 대회 결과에 따라 정해집니다.</div>`;
  if (comp.id === 'lckCup') {
    const st = comp.standings;
    const g = comp.groups;
    const sub = ids => { const s = {}; for (const id of ids) s[id] = st[id]; return s; };
    const tot = ids => ids.reduce((a, id) => a + st[id].w, 0);
    h += `<div class="grid2"><div class="panel"><h3>바론 그룹 · 합계 ${tot(g.baron)}승</h3>${tableHTML(state, comp, sub(g.baron))}</div><div class="panel"><h3>장로 그룹 · 합계 ${tot(g.elder)}승</h3>${tableHTML(state, comp, sub(g.elder))}</div></div>`;
    if (comp.groupResult) h += `<div class="small muted" style="margin:8px 0">${comp.groupResult.winGroup === 'baron' ? '바론' : '장로'} 그룹 승리 → 1·2위 플레이오프 직행 (상대 그룹은 1위만 직행). 나머지 상위 팀은 플레이-인.</div>`;
    if (comp.gauntlet) h += `<div class="panel" style="margin-top:10px"><h3>플레이-인</h3>${listHTML(state, comp.matches.filter(m => m.stage === 'playin'))}</div>`;
    if (comp.bracket) h += `<div class="panel" style="margin-top:10px"><h3>플레이오프 (더블 엘리미네이션 Bo5)</h3>${bracketHTML(state, comp, comp.bracket)}</div>`;
  } else if (comp.stage === 'league') {
    const cut = comp.id === 'lck12' ? [2, 6] : comp.id === 'lck34' ? [4, 8] : [];
    h += `<div class="panel">${tableHTML(state, comp, comp.standings, null, { cut })}</div>`;
    if (comp.id === 'lck12') h += `<div class="small muted" style="margin-top:6px">상위 6팀 Road to MSI 진출</div>`;
  } else {
    h += extraBody(state, comp);
  }
  if (comp.result) h += `<div class="panel" style="margin-top:10px"><h3>최종 순위</h3>${comp.result.placements.slice(0, 8).map((id, i) => `<span class="row" style="display:inline-flex;margin-right:14px">${i + 1}. ${teamLogo(teamInfo(state, id), 22)} <b>${esc(teamInfo(state, id).name)}</b></span>`).join('')}</div>`;
  return h;
}

// 4단계 대회용 (international에서 확장)
export let extraBody = (state, comp) => {
  let h = '';
  if (comp.bracket) h += `<div class="panel">${bracketHTML(state, comp, comp.bracket)}</div>`;
  return h;
};
export function setExtraBody(fn) { extraBody = fn; }

function render(root, params) {
  const st = App.state;
  const comps = st.season.order.map(id => st.season.comps[id]);
  const cur = params.comp || (comps.filter(c => c.started && !c.done && c.league !== 'CL')[0] || comps.find(c => c.started) || comps[0]).id;
  const view = params.view || 'table';
  let body;
  if (cur === 'lckreg') {
    const { standings } = lckRegularStandings(st);
    body = `<div class="panel"><h3>LCK 정규 시즌 통합 순위 (1~4라운드)</h3>${tableHTML(st, null, standings, null, { cut: [4, 8] })}<div class="small muted" style="margin-top:6px">1~4위 플레이오프 직행 · 5~8위 플레이-인</div></div>`;
  } else {
    const comp = st.season.comps[cur];
    if (view === 'matches') {
      const ms = comp.matches.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
      body = `<div class="panel"><h3>${esc(comp.name)} 일정·결과</h3>${listHTML(st, ms)}</div>`;
    } else body = compBody(st, comp);
  }
  const html = `<div class="tabs">${comps.map(c => `<button class="btn sm ${c.id === cur ? 'active' : ''}" data-c="${c.id}">${esc(c.short)}${c.done ? ' ✓' : c.started ? ' •' : ''}</button>`).join('')}<button class="btn sm ${cur === 'lckreg' ? 'active' : ''}" data-c="lckreg">LCK 정규 통합</button></div>
    ${cur !== 'lckreg' ? `<div class="tabs"><button class="btn sm ${view === 'table' ? 'active' : ''}" data-v="table">순위·대진</button><button class="btn sm ${view === 'matches' ? 'active' : ''}" data-v="matches">일정·결과</button></div>` : ''}
    ${body}`;
  const c = shell(root, 'standings', html);
  c.querySelectorAll('[data-c]').forEach(b => b.addEventListener('click', () => go('standings', { comp: b.dataset.c })));
  c.querySelectorAll('[data-v]').forEach(b => b.addEventListener('click', () => go('standings', { comp: cur, view: b.dataset.v })));
  c.querySelectorAll('[data-m]').forEach(b => b.addEventListener('click', () => {
    const comp = st.season.comps[b.dataset.m.split('#')[0]];
    const m = comp.matches.find(x => x.id === b.dataset.m);
    if (m && m.done) modal({ title: `${esc(comp.name)} ${esc(m.label || '')}`, body: seriesResultHTML(st, m), buttons: [{ label: '닫기', primary: true }], dismiss: true });
  }));
}
