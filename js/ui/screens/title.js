import { App, go, modal, toast } from '../app.js';
import { DD, teamLogo } from '../assets.js';
import { LCK_TEAMS } from '../../../data/teams.js';
import { SLOT_KEYS, SLOT_NAMES, slotInfo, loadFrom, importJSON, describeSlot } from '../save.js';
import { esc } from '../../core/util.js';
import { pasteCodeFlow, importFile } from '../saveTransfer.js';

export function register(reg) { reg('title', { render }); }

export function startLoaded({ state, rng }) {
  App.state = state; App.rng = rng;
  if (state.user && state.user.retired) return go('retire', {});
  go(state.user && state.players[state.user.pid].teamId ? 'hub' : 'title');
}

function render(root) {
  const auto = slotInfo('auto');
  root.innerHTML = `<div class="title-screen">
    <div class="title-logo">
      <div class="t1">LEAGUE OF LEGENDS</div>
      <div class="t2">프로게이머 커리어</div>
      <div class="t3">2군 연습생에서 월즈 챔피언까지</div>
    </div>
    <div class="title-teams">${LCK_TEAMS.map(t => teamLogo(t, 44)).join('')}</div>
    <div class="title-menu">
      ${auto ? `<button class="btn primary" id="cont">이어하기<span class="small" style="opacity:.75;margin-left:6px">${esc(auto.nick)} · ${esc(auto.date)}</span></button>` : ''}
      <button class="btn ${auto ? '' : 'primary'}" id="new">새 게임</button>
      <button class="btn" id="load">불러오기</button>
      <button class="btn ghost" id="hof">명예의 전당</button>
      <button class="btn ghost" data-go="testMatch">테스트 경기</button>
    </div>
    <div class="net-badge">Data Dragon: ${DD.online ? '연결됨 (' + DD.version + ', ' + DD.source + ')' : '오프라인 — 대체 그래픽 사용'}</div>
  </div>`;
  root.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.go)));
  root.querySelector('#new').addEventListener('click', () => go('create'));
  const c = root.querySelector('#cont');
  if (c) c.addEventListener('click', () => { const r = loadFrom('auto'); if (r) startLoaded(r); });
  root.querySelector('#load').addEventListener('click', () => loadDialog());
  root.querySelector('#hof').addEventListener('click', () => go('hof'));
}

export async function loadDialog() {
  const rows = SLOT_KEYS.map(k => { const i = slotInfo(k); return `<div class="row between" style="padding:8px 0;border-bottom:1px solid var(--line)"><div><b>${SLOT_NAMES[k]}</b><div class="small muted">${esc(describeSlot(i))}</div></div><button class="btn sm" data-k="${k}" ${i ? '' : 'disabled'}>불러오기</button></div>`; }).join('');
  modal({
    title: '불러오기',
    body: `${rows}<div class="small muted" style="margin-top:14px">다른 기기에서 가져오기</div><div class="row wrap" style="margin-top:6px"><button class="btn sm primary" id="code-paste">세이브 코드 붙여넣기</button><label class="btn sm" style="cursor:pointer">JSON 파일 불러오기<input type="file" id="file" accept=".json,application/json" style="display:none"></label></div>`,
    buttons: [{ label: '닫기' }],
    onOpen: (bg, close) => {
      bg.querySelectorAll('[data-k]').forEach(b => b.addEventListener('click', () => { const r = loadFrom(b.dataset.k); close(); if (r) startLoaded(r); }));
      bg.querySelector('#file').addEventListener('change', e => {
        const f = e.target.files[0]; e.target.value = ''; if (!f) return;
        close(); importFile(f);
      });
      bg.querySelector('#code-paste').addEventListener('click', () => { close(); pasteCodeFlow(); });
    },
  });
}
