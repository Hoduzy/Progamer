// 밴픽 화면 (피어리스 드래프트)
import { App, modal } from './app.js';
import { createDraft, currentTurn, aiDecide, applyDecision, isTaken, userTeamIdx, recommend, matchup, matchupLabel, compBars, DRAFT_ORDER } from '../engine/draft.js';
import { champIcon, teamLogo, splashStyle } from './assets.js';
import { CHAMPIONS, CHAMP_IDS, TRAIT_KO } from '../../data/champions.js';
import { TIER_LABEL } from '../engine/meta.js';
import { POS, POS_KO, esc } from '../core/util.js';

export function register(reg) { reg('draft', { render }); }

/*
 params = { teams:[{team, players}, …], blueIdx, firstIdx, unavailable:[], meta, userPid, rng,
            series:{label, wins:[a,b], gameNo, bo}, onDone(d) }
*/
function render(root, params) {
  const { teams, meta, rng } = params;
  const d = createDraft({ teams, blueIdx: params.blueIdx, firstIdx: params.firstIdx, unavailable: params.unavailable || [], meta, userPid: params.userPid });
  const uti = userTeamIdx(d);
  const uPos = uti >= 0 ? teams[uti].players.find(p => p.id === params.userPid).pos : null;
  const user = uti >= 0 ? teams[uti].players.find(p => p.id === params.userPid) : null;
  const ui = { fast: !!App.settings.fastDraft, waitingUser: false, selected: null, filter: uPos || 'ALL', sort: 'mastery', timer: null, destroyed: false, search: '' };
  const sideOf = ti => (ti === d.blueIdx ? 'blue' : 'red');
  const L = d.blueIdx, R = 1 - d.blueIdx; // 왼쪽 = 블루

  root.innerHTML = `<div class="draft">
    <div class="dr-head">
      <div class="row">${teamLogo(teams[L].team, 34)}<b class="dr-tname" style="color:${teams[L].team.color}">${esc(teams[L].team.name)}</b><span class="chip blue">블루</span>${d.firstIdx === L ? '<span class="chip gold">선픽</span>' : ''}</div>
      <div class="dr-mid"><div class="dr-series">${esc(params.series ? params.series.label : '')} · ${params.series ? `${params.series.gameNo}세트 (${params.series.wins[L]}-${params.series.wins[R]})` : ''}</div><div class="dr-turn" id="turn"></div></div>
      <div class="row" style="justify-content:flex-end">${d.firstIdx === R ? '<span class="chip gold">선픽</span>' : ''}<span class="chip red">레드</span><b class="dr-tname" style="color:${teams[R].team.color}">${esc(teams[R].team.name)}</b>${teamLogo(teams[R].team, 34)}</div>
    </div>
    <div class="dr-col left" id="col-${L}"></div>
    <div class="dr-col right" id="col-${R}"></div>
    <div class="dr-center" id="center"></div>
  </div>`;
  const $ = id => root.querySelector('#' + id);

  function colHTML(ti) {
    const t = teams[ti];
    const bans = d.bans[ti];
    const banSlots = [0, 1, 2, 3, 4].map(i => bans[i] ? `<div class="dr-ban">${champIcon(bans[i], 38, 'sq')}</div>` : `<div class="dr-ban empty"></div>`).join('');
    const turn = currentTurn(d);
    const picks = POS.map((pos, i) => {
      const p = t.players[i];
      const c = d.picks[ti][pos];
      const active = turn && turn.type === 'pick' && turn.teamIdx === ti && ui.waitingUser && p.id === params.userPid;
      const preview = active && ui.selected ? ui.selected : null;
      const show = c || preview;
      return `<div class="dr-pick ${p.id === params.userPid ? 'me' : ''} ${active ? 'active' : ''} ${c ? 'done' : ''}" style="${show ? splashStyle(show) : ''}">
        <div class="dr-pick-shade"></div>
        <div class="dr-pick-in">${show ? champIcon(show, 54, 'sq') : `<span class="dr-pos">${POS_KO[pos]}</span>`}
          <div class="col" style="gap:1px;min-width:0"><span class="tiny dim">${POS_KO[pos]}</span><b class="dr-nick">${p.id === params.userPid ? '★ ' : ''}${esc(p.nick)}</b>
          <span class="small">${show ? esc(CHAMPIONS[show].name) + (preview && !c ? ' (선택 중)' : '') : ''}</span></div></div></div>`;
    }).join('');
    return `<div class="dr-bans">${banSlots}</div>${picks}`;
  }
  function renderCols() { $('col-' + L).innerHTML = colHTML(L); $('col-' + R).innerHTML = colHTML(R); }

  function turnText() {
    const turn = currentTurn(d);
    if (!turn) return '밴픽 완료';
    const o = DRAFT_ORDER[d.step];
    const side = sideOf(turn.teamIdx) === 'blue' ? '블루' : '레드';
    const phase = d.step < 6 ? '1차 밴' : d.step < 12 ? '1차 픽' : d.step < 16 ? '2차 밴' : '2차 픽';
    return `<span class="${sideOf(turn.teamIdx) === 'blue' ? 'tb' : 'tr'}">${side} ${o.t === 'ban' ? '밴' : '픽'}</span> · ${phase} (${d.step + 1}/20)${ui.waitingUser ? ' — <b class="gold">내 차례!</b>' : ''}`;
  }

  function cardHTML(id) {
    const c = CHAMPIONS[id];
    const taken = isTaken(d, id);
    const fearless = d.unavailable.has(id);
    const m = user ? Math.round(user.champs[id] || 0) : 0;
    const tier = meta ? meta.tiers[id] : '3';
    let mu = '';
    if (uti >= 0 && uPos) { const opp = d.picks[1 - uti][uPos]; if (opp && c.pos.includes(uPos)) { const v = matchup(id, opp); mu = `<span class="cc-mu ${v >= 1.5 ? 'pos' : v <= -1.5 ? 'neg' : 'dim'}">vs ${esc(CHAMPIONS[opp].name)} ${matchupLabel(v)}</span>`; } }
    const lbl = fearless ? '피어리스' : taken ? (d.bans[0].includes(id) || d.bans[1].includes(id) ? '밴' : '픽') : '';
    return `<button class="cc ${taken ? 'off' : ''} ${ui.selected === id ? 'sel' : ''}" data-id="${id}" ${taken ? 'disabled' : ''}>
      ${champIcon(id, 52, 'sq')}<span class="cc-tier t${tier}">${tier === 'OP' ? 'OP' : tier}</span>
      <span class="cc-name">${esc(c.name)}</span>
      ${user ? `<span class="cc-m"><i style="width:${m}%"></i></span><span class="cc-mv">${m}</span>` : ''}
      ${mu}${lbl ? `<span class="cc-off">${lbl}</span>` : ''}</button>`;
  }

  function renderCenter() {
    if (d.done) return renderSummary();
    const recs = ui.waitingUser ? recommend(d, uti, uPos, null, 3) : [];
    let list = CHAMP_IDS.filter(id => ui.filter === 'ALL' || CHAMPIONS[id].pos.includes(ui.filter));
    if (ui.search) list = list.filter(id => CHAMPIONS[id].name.includes(ui.search));
    if (ui.sort === 'mastery' && user) list.sort((a, b) => (user.champs[b] || 0) - (user.champs[a] || 0));
    else if (ui.sort === 'tier' && meta) { const o = { OP: 0, '1': 1, '2': 2, '3': 3, '4': 4 }; list.sort((a, b) => o[meta.tiers[a]] - o[meta.tiers[b]]); }
    else list.sort((a, b) => CHAMPIONS[a].name.localeCompare(CHAMPIONS[b].name, 'ko'));
    list.sort((a, b) => isTaken(d, a) - isTaken(d, b));
    sheet();
    $('center').innerHTML = `${sheetHandle()}
      ${ui.waitingUser ? `<div class="dr-recs"><span class="tiny gold bold">감독 추천</span>${recs.map(r => `<button class="dr-rec ${ui.selected === r.champ ? 'sel' : ''}" data-id="${r.champ}">${champIcon(r.champ, 36, 'sq')}<div class="col" style="gap:0;align-items:flex-start"><b>${esc(CHAMPIONS[r.champ].name)}</b><span class="tiny muted">${r.reasons.map(esc).join(' · ')}</span></div></button>`).join('')}</div>` : `<div class="dr-recs dim small">${ui.fast ? '빠른 진행 중…' : 'AI가 밴픽을 진행하고 있습니다…'} 내 포지션(${POS_KO[uPos] || '-'}) 픽 차례가 되면 직접 고릅니다.</div>`}
      <div class="dr-filter">
        ${['ALL', ...POS].map(p => `<button class="btn sm ${ui.filter === p ? 'active' : ''}" data-f="${p}">${p === 'ALL' ? '전체' : POS_KO[p]}</button>`).join('')}
        <div class="grow"></div>
        <button class="btn sm ${ui.sort === 'mastery' ? 'active' : ''}" data-s="mastery">숙련도순</button>
        <button class="btn sm ${ui.sort === 'tier' ? 'active' : ''}" data-s="tier">메타순</button>
        <button class="btn sm ${ui.sort === 'name' ? 'active' : ''}" data-s="name">가나다</button>
      </div>
      <div class="dr-grid scroll" id="grid">${list.map(cardHTML).join('')}</div>
      <div class="dr-foot">
        <label class="row small muted"><input type="checkbox" id="fast" ${ui.fast ? 'checked' : ''} style="width:22px;height:22px"> AI 밴픽 빠르게</label>
        <div class="grow"></div>
        ${ui.waitingUser ? `<span class="small muted">${ui.selected ? esc(CHAMPIONS[ui.selected].name) + ' 선택' : '챔피언을 고르세요'}</span><button class="btn primary" id="lock" ${ui.selected ? '' : 'disabled'} style="min-width:160px">선택 확정 (락인)</button>` : ''}
      </div>`;
    $('center').querySelectorAll('[data-f]').forEach(b => b.addEventListener('click', () => { ui.filter = b.dataset.f; renderCenter(); }));
    $('center').querySelectorAll('[data-s]').forEach(b => b.addEventListener('click', () => { ui.sort = b.dataset.s; renderCenter(); }));
    $('center').querySelectorAll('.cc, .dr-rec').forEach(b => b.addEventListener('click', () => {
      if (!ui.waitingUser) return;
      const id = b.dataset.id;
      if (isTaken(d, id)) return;
      if (!CHAMPIONS[id].pos.includes(uPos)) { if (!confirm(`${CHAMPIONS[id].name}은(는) ${POS_KO[uPos]} 챔피언이 아닙니다. 그래도 고를까요?`)) return; }
      ui.selected = id; renderCenter(); renderCols();
    }));
    bindSheet();
    $('fast').addEventListener('change', e => { ui.fast = e.target.checked; App.settings.fastDraft = ui.fast; });
    const lock = $('lock');
    if (lock) lock.addEventListener('click', () => {
      if (!ui.selected) return;
      applyDecision(d, { type: 'pick', champ: ui.selected, pos: uPos });
      ui.waitingUser = false; ui.selected = null; ui.sheet = null;
      refresh(); next();
    });
  }

  // 폰: 챔피언 목록은 아래쪽 시트 (내 차례면 자동으로 열림, 손잡이로 접기·펼치기)
  function sheetOpen() { return ui.sheet !== undefined && ui.sheet !== null ? ui.sheet : ui.waitingUser || d.done; }
  function sheet() { $('center').classList.toggle('collapsed', !sheetOpen()); }
  function sheetHandle() { return `<button class="dr-sheet-h" id="sheet-h">${d.done ? '조합 평가' : ui.waitingUser ? '챔피언 고르기' : '챔피언 목록'} <span>${sheetOpen() ? '▼' : '▲'}</span></button>`; }
  function bindSheet() {
    $('sheet-h').addEventListener('click', () => { ui.sheet = !sheetOpen(); sheet(); $('sheet-h').querySelector('span').textContent = sheetOpen() ? '▼' : '▲'; });
  }

  function bars(a, b) {
    const ka = compBars(d.picks[a]), kb = compBars(d.picks[b]);
    return ['early', 'late', 'teamfight', 'engage', 'split'].map(k => {
      const va = ka[k], vb = kb[k];
      return `<div class="cmp-row"><span class="cmp-v">${va.toFixed(1)}</span>
        <div class="cmp-bar l"><i style="width:${va * 10}%;${va > vb ? 'background:#4d9bff' : ''}"></i></div>
        <span class="cmp-k">${TRAIT_KO[k]}</span>
        <div class="cmp-bar r"><i style="width:${vb * 10}%;${vb > va ? 'background:#ff5f6f' : ''}"></i></div><span class="cmp-v">${vb.toFixed(1)}</span></div>`;
    }).join('');
  }
  function renderSummary() {
    ui.sheet = true; sheet();
    $('center').innerHTML = `${sheetHandle()}<div class="dr-sum">
      <div class="dr-sum-title">조합 평가</div>
      <div class="row between" style="margin:0 6px 10px"><b style="color:#8ab8ff">${esc(teams[L].team.code)} (블루)</b><b style="color:#ff9aa5">(레드) ${esc(teams[R].team.code)}</b></div>
      ${bars(L, R)}
      <div class="dr-sum-note small muted">${compNote(L)}<br>${compNote(R)}</div>
      <button class="btn primary" id="start" style="min-width:240px;height:56px;font-size:18px;margin-top:16px">경기 시작 ▶</button></div>`;
    bindSheet();
    $('start').addEventListener('click', () => params.onDone && params.onDone(d));
  }
  function compNote(ti) {
    const b = compBars(d.picks[ti]);
    const top = Object.entries(b).sort((x, y) => y[1] - x[1])[0][0];
    const desc = { early: '초반에 굴려야 하는', late: '후반을 바라보는', teamfight: '한타에 강한', engage: '이니시에 특화된', split: '스플릿 운영형' }[top];
    return `<b>${esc(teams[ti].team.code)}</b>: ${desc} 조합`;
  }

  function refresh() { $('turn').innerHTML = turnText(); renderCols(); renderCenter(); }

  function next() {
    if (ui.destroyed) return;
    if (d.done) { refresh(); return; }
    const dec = aiDecide(d, rng);
    if (dec.needUser) {
      ui.waitingUser = true; ui.filter = uPos; ui.selected = null; ui.sheet = null;
      refresh();
      return;
    }
    ui.timer = setTimeout(() => {
      if (ui.destroyed) return;
      applyDecision(d, dec);
      refresh();
      next();
    }, ui.fast ? 120 : 650);
  }

  refresh();
  next();
  return () => { ui.destroyed = true; clearTimeout(ui.timer); };
}
