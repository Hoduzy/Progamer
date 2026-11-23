// 경기 화면: 미니맵 + 방송 HUD + 선택 장면 + 결과
import { CONFIG } from '../config.js';
import { App } from './app.js';
import { createMatch, step, summary, goldDiff, teamGold, ultReady, flashReady, allPlayers } from '../engine/match.js';
import { buildScene, resolveScene } from '../engine/choices.js';
import { describe, render as renderLine } from '../engine/commentary.js';
import { TASK_KO } from '../engine/teamai.js';
import { computeRatings, pickPOG } from '../engine/rating.js';
import * as geo from '../engine/mapgeo.js';
const geoRegion = r => geo.regionKo(r);
import { champIcon, itemIcon, spellIcon, teamLogo, splashStyle, mapUrl, fallbackMapSVG } from './assets.js';
import { champName } from '../../data/champions.js';
import { fmtTime, fmtGold, esc, fill, POS, POS_KO, clamp } from '../core/util.js';

export function register(reg) { reg('match', { render }); }

const LANE_KO = { TOP: '탑', MID: '미드', BOT: '바텀' };
const OBJ_LABEL = { dragon: '용', baron: '바', herald: '전', grubs: '유', elder: '장', atakhan: '아' };

/*
 params = {
   input: { blue:{team, players, picks, ...}, red:{...} }, seed, meta, userPid,
   userState: { condition, mental, fatigue }, series: { label, blueWins, redWins, gameNo, bo },
   onEnd(result)
 }
*/
function render(root, params) {
  const S = CONFIG.scene;
  const userState = params.userState || { condition: 75, mental: 65, fatigue: 25 };
  const g = createMatch({
    blue: params.input.blue, red: params.input.red, seed: params.seed, meta: params.meta,
    userPid: params.userPid, visual: true, userMods: userState, gameNo: params.series ? params.series.gameNo : 1, keepInput: true,
  });
  const ui = { speed: App.settings.defaultSpeed || 1, paused: false, mode: 'play', timer: null, lastBigT: -999, captionSpk: 0, bigQueue: [], feedEls: [], destroyed: false, lastGoldLine: 0 };
  const T = [g.sides[0].team, g.sides[1].team];
  const pById = {};
  for (const p of allPlayers(g)) pById[p.pid] = p;
  const series = params.series || { label: '테스트 경기', blueWins: 0, redWins: 0, gameNo: 1, bo: 1 };
  // 미니맵 테두리: 팀 색 (두 팀 색이 비슷하면 블루/레드)
  const hex = c => { const m = /^#?([0-9a-f]{6})$/i.exec(c || ''); if (!m) return null; const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  const ca = hex(T[0].color), cb = hex(T[1].color);
  const dist = ca && cb ? Math.hypot(ca[0] - cb[0], ca[1] - cb[1], ca[2] - cb[2]) : 0;
  const lum = c => c ? (c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11) : 0;
  const useTeam = dist > 120 && lum(ca) > 40 && lum(cb) > 40;
  const sideColor = [useTeam ? T[0].color : '#3d8bff', useTeam ? T[1].color : '#ff4d5e'];

  root.innerHTML = `
  <div class="match" id="match">
    <div class="sb">
      <div class="sb-side blue">${teamLogo(T[0], 38)}<div class="sb-code" style="color:${T[0].color}">${esc(T[0].code)}</div>
        <div class="sb-stats"><span>골드 <b id="sb-g0">2.5K</b></span><span>포탑 <b id="sb-t0">0</b></span></div>
        <div class="sb-kills" id="sb-k0">0</div><div class="sb-drakes" id="sb-d0"></div></div>
      <div class="sb-mid"><div class="sb-time" id="sb-time">00:00</div><div class="sb-series">${esc(series.label || '')} · ${series.blueWins}-${series.redWins}</div></div>
      <div class="sb-side red">${teamLogo(T[1], 38)}<div class="sb-code" style="color:${T[1].color}">${esc(T[1].code)}</div>
        <div class="sb-stats"><span>골드 <b id="sb-g1">2.5K</b></span><span>포탑 <b id="sb-t1">0</b></span></div>
        <div class="sb-kills" id="sb-k1">0</div><div class="sb-drakes" id="sb-d1"></div></div>
    </div>
    <div class="buff-badges blue" id="bb0"></div><div class="buff-badges red" id="bb1"></div>
    <div class="mc-left">
      <button class="btn sm" data-act="pause" id="btn-pause">⏸</button>
      ${CONFIG.ui.speeds.map(s => `<button class="btn sm spd" data-spd="${s}">${s}배</button>`).join('')}
      <button class="btn sm wide" data-act="skip" title="다음 주요 장면까지">⏭ 다음 장면</button>
    </div>
    <div class="mc-right">
      <button class="btn sm wide" data-act="big" id="btn-big">큰 장면 연출 ${App.settings.showBigEvents ? 'ON' : 'OFF'}</button>
      <button class="btn sm wide" data-act="auto" title="남은 경기를 자동으로 진행">⏩ 끝까지 자동</button>
      <button class="btn sm wide" data-act="bug" title="시드·최근 30초 상태·이벤트 로그를 JSON으로 저장">🐞 버그 신고</button>
    </div>
    <div class="pcol blue" id="pc0"></div><div class="pcol red" id="pc1"></div>
    <div class="mm-wrap" id="mmw"><div class="mm" id="mm">
      ${mapUrl() ? `<img class="mm-bg" src="${mapUrl()}" draggable="false" onerror="this.outerHTML=window.__mmfb()">` : fallbackMapSVG()}
      <div class="mm-layer" id="mm-wards"></div>
      <div class="mm-layer" id="mm-struct"></div>
      <div class="mm-layer" id="mm-minions"></div>
      <div class="mm-layer" id="mm-objs"></div>
      <div class="mm-layer" id="mm-fx"></div>
      <div class="mm-layer" id="mm-dbg"></div>
      <div class="mm-layer" id="mm-scene"></div>
      <div class="mm-layer" id="mm-champs"></div>
      <div class="mm-dbg-plans hidden" id="mm-plans"></div>
    </div></div>
    <div class="killfeed" id="kf"></div>
    <div id="banner-slot"></div>
    <div class="caption" id="cap"><span class="spk">캐스터</span><span class="ln">경기 시작을 기다리고 있습니다.</span></div>
    <div class="bpanel">
      <div class="bp-tabs"><button class="bp-tab active" data-tab="mu">라인 맞대결</button><button class="bp-tab" data-tab="gg">골드 차이 그래프</button>
        <div class="grow"></div><span class="tiny dim" style="align-self:center">${esc(params.meta ? '패치 ' + params.meta.version : '')}</span></div>
      <div class="bp-body" id="bp"></div>
    </div>
    <div id="scene-slot"></div>
  </div>`;
  window.__mmfb = () => fallbackMapSVG();

  const $ = id => root.querySelector('#' + id);
  const mmw = $('mmw');

  // ---------- 고정 요소 생성 ----------
  function buildPlayerCards() {
    for (const s of g.sides) {
      $('pc' + s.idx).innerHTML = s.players.map(p => `
        <div class="pcard ${p.isUser ? 'me' : ''}" id="pcard-${p.pid}">
          <div class="pc-icon">${champIcon(p.champ, 52, 'sq')}<span class="pc-lvl" id="lv-${p.pid}">1</span><span class="pc-ult" id="ul-${p.pid}"></span><div class="pc-dead hidden" id="rd-${p.pid}"></div></div>
          <div class="pc-name">${p.isUser ? '★ ' : ''}${esc(p.nick)}</div>
          <div class="pc-sub">${POS_KO[p.pos]} · ${esc(champName(p.champ))}</div>
          <div class="pc-bars"><div class="bar hp"><i id="hp-${p.pid}" style="width:100%"></i></div><div class="bar mp"><i id="mp-${p.pid}" style="width:100%"></i></div></div>
          <div class="pc-foot">${spellIcon(p.spells[0], 18, '')}<span id="fl-${p.pid}" style="display:contents"></span>${spellIcon(p.spells[1], 18)}<span class="pc-kda" id="kda-${p.pid}">0/0/0</span></div>
        </div>`).join('');
    }
  }
  function buildStructures() {
    let h = '';
    for (const s of [0, 1]) {
      const cls = s === 0 ? 'blue' : 'red';
      for (const l of ['TOP', 'MID', 'BOT']) {
        for (let i = 0; i < 3; i++) { const [x, y] = geo.towerPos(s, l, i); h += `<div class="mm-ent mm-tower ${cls}" id="tw-${s}-${l}-${i}" style="left:${x * 100}%;top:${y * 100}%"></div>`; }
        const [x, y] = geo.inhibPos(s, l); h += `<div class="mm-ent mm-inhib ${cls}" id="ih-${s}-${l}" style="left:${x * 100}%;top:${y * 100}%"></div>`;
      }
      for (let i = 0; i < 2; i++) { const [x, y] = geo.nexusTowerPos(s, i); h += `<div class="mm-ent mm-tower ${cls}" id="nt-${s}-${i}" style="left:${x * 100}%;top:${y * 100}%"></div>`; }
      const [x, y] = geo.nexusPos(s); h += `<div class="mm-ent mm-nexus ${cls}" id="nx-${s}" style="left:${x * 100}%;top:${y * 100}%"></div>`;
    }
    $('mm-struct').innerHTML = h;
    $('mm-champs').innerHTML = allPlayers(g).map(p => `<div class="mm-ent mm-champ ${p.side === 0 ? 'blue' : 'red'} ${p.isUser ? 'me' : ''}" id="mc-${p.pid}" style="left:${p.x * 100}%;top:${p.y * 100}%;${p.isUser ? '' : `border-color:${sideColor[p.side]}`}">${champIcon(p.champ, 28)}<span class="rt" id="mrt-${p.pid}"></span></div>`).join('');
  }
  buildPlayerCards();
  buildStructures();

  // ---------- 갱신 ----------
  function updateScoreboard() {
    for (const s of g.sides) {
      $('sb-k' + s.idx).textContent = s.kills;
      $('sb-g' + s.idx).textContent = fmtGold(teamGold(s));
      $('sb-t' + s.idx).textContent = s.towersDestroyed;
      $('sb-d' + s.idx).innerHTML = s.dragons.map(d => `<span class="drake d-${d} ${s.soul ? 'soul' : ''}" title="${d} 드래곤"></span>`).join('');
      let b = '';
      if (s.baronUntil > g.t) b += `<span class="buff">바론 ${fmtTime(s.baronUntil - g.t)}</span>`;
      if (s.elderUntil > g.t) b += `<span class="buff elder">장로 ${fmtTime(s.elderUntil - g.t)}</span>`;
      if (s.soul) b += `<span class="buff" style="background:#2a2a10;border-color:#d4af37;color:#ffe9a0">${s.soul} 영혼</span>`;
      $('bb' + s.idx).innerHTML = b;
    }
    $('sb-time').textContent = fmtTime(g.t);
  }
  function updateCards() {
    for (const p of allPlayers(g)) {
      $('lv-' + p.pid).textContent = p.level;
      $('hp-' + p.pid).style.width = (p.alive ? p.hp * 100 : 0) + '%';
      $('mp-' + p.pid).style.width = (p.alive ? p.mana * 100 : 0) + '%';
      $('ul-' + p.pid).classList.toggle('ready', ultReady(g, p) && p.alive);
      $('kda-' + p.pid).textContent = `${p.k}/${p.d}/${p.a}`;
      const card = $('pcard-' + p.pid);
      card.classList.toggle('dead', !p.alive);
      const rd = $('rd-' + p.pid);
      if (!p.alive) { rd.classList.remove('hidden'); rd.textContent = Math.ceil(p.respawnAt - g.t); } else rd.classList.add('hidden');
      const fl = card.querySelector('.pc-foot > :first-child');
      if (fl) fl.classList.toggle('cd', !flashReady(g, p));
    }
  }
  function updateMinimap() {
    const dur = Math.max(120, tickMs() * 0.95);
    for (const p of allPlayers(g)) {
      const el = $('mc-' + p.pid);
      el.style.transitionDuration = `${dur}ms, ${dur}ms`;
      el.style.left = (p.x * 100) + '%'; el.style.top = (p.y * 100) + '%';
      el.classList.toggle('dead', !p.alive);
      $('mrt-' + p.pid).textContent = p.alive ? '' : Math.ceil(p.respawnAt - g.t);
    }
    for (const s of [0, 1]) {
      const side = g.sides[s];
      for (const l of ['TOP', 'MID', 'BOT']) {
        for (let i = 0; i < 3; i++) $(`tw-${s}-${l}-${i}`).classList.toggle('dead', !side.towers[l][i]);
        $(`ih-${s}-${l}`).classList.toggle('dead', !side.inhibs[l].alive);
      }
      for (let i = 0; i < 2; i++) $(`nt-${s}-${i}`).classList.toggle('dead', side.nexusTowers <= i);
      $(`nx-${s}`).classList.toggle('dead', !side.nexus);
    }
    // 오브젝트 (처치 진행 중이면 게이지)
    let oh = '';
    for (const k of ['dragon', 'elder', 'baron', 'herald', 'grubs', 'atakhan']) {
      const o = g.obj[k];
      if (!o.alive) continue;
      const [x, y] = geo.OBJ_POS[k];
      const style = k === 'dragon' ? `background:${dragonColor(o.type)}` : '';
      const gauge = o.prog ? `<div class="mm-gauge ${o.prog.side === 0 ? 'blue' : 'red'}"><i style="width:${Math.min(100, o.prog.val * 100).toFixed(0)}%"></i></div>` : '';
      oh += `<div class="mm-ent mm-obj ${k}" style="left:${x * 100}%;top:${y * 100}%;${style}" title="${k}">${OBJ_LABEL[k]}${gauge}</div>`;
    }
    if (g.heraldUnit) oh += `<div class="mm-ent mm-obj herald unit ${g.heraldUnit.side === 0 ? 'blue' : 'red'}" style="left:${g.heraldUnit.x * 100}%;top:${g.heraldUnit.y * 100}%">전</div>`;
    $('mm-objs').innerHTML = oh;
    // 와드
    $('mm-wards').innerHTML = g.sides.map(s => s.wards.map(w => `<div class="mm-ent mm-ward ${s.idx === 0 ? 'blue' : 'red'}" style="left:${w.x * 100}%;top:${w.y * 100}%"></div>`).join('')).join('');
    // 미니언 웨이브: 엔진의 웨이브 위치(g.waves)를 그대로 그린다
    let mh = '';
    for (const l of ['TOP', 'MID', 'BOT']) {
      const front = g.waves[l].s;
      for (let i = 0; i < 4; i++) {
        const [bx, by] = geo.pointOnLane(l, front - 0.008 - i * 0.008);
        const [rx, ry] = geo.pointOnLane(l, front + 0.008 + i * 0.008);
        mh += `<div class="mm-ent mm-minion blue" style="left:${bx * 100}%;top:${by * 100}%"></div><div class="mm-ent mm-minion red" style="left:${rx * 100}%;top:${ry * 100}%"></div>`;
      }
    }
    $('mm-minions').innerHTML = g.t > 65 ? mh : '';
    updateDebug();
  }
  // 디버그: 선수별 임무, 목표 화살표, 팀 계획
  function updateDebug() {
    const on = !!App.settings.debugMatch;
    $('mm-plans').classList.toggle('hidden', !on);
    if (!on) { $('mm-dbg').innerHTML = ''; return; }
    let svg = '<svg class="mm-dbg-svg" viewBox="0 0 100 100" preserveAspectRatio="none"><defs><marker id="ah" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="4" markerHeight="4" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#ffe066"/></marker></defs>';
    let lbl = '';
    for (const p of allPlayers(g)) {
      if (!p.alive || !p.task) continue;
      const [tx, ty] = p.task.target;
      if (Math.hypot(tx - p.x, ty - p.y) > 0.01) svg += `<line x1="${p.x * 100}" y1="${p.y * 100}" x2="${tx * 100}" y2="${ty * 100}" stroke="${p.side === 0 ? '#8ab8ff' : '#ff9aa5'}" stroke-width=".35" stroke-dasharray="1 .6" marker-end="url(#ah)"/>`;
      const task = p.chan ? (p.chan.kind === 'recall' ? '귀환 중' : '텔레포트 중') : p.task.label || TASK_KO[p.task.kind] || p.task.kind;
      const extra = p.task.key ? ` ${({ dragon: '용', baron: '바론', herald: '전령', grubs: '유충', elder: '장로' })[p.task.key] || ''}` : p.task.lane && (p.task.kind === 'side' || p.task.kind === 'gank') ? ` ${LANE_KO[p.task.lane]}` : '';
      lbl += `<div class="mm-ent mm-dbg-lbl ${p.side === 0 ? 'blue' : 'red'}" style="left:${p.x * 100}%;top:${p.y * 100}%">${esc(task + extra)}</div>`;
    }
    svg += '</svg>';
    $('mm-dbg').innerHTML = svg + lbl;
    $('mm-plans').innerHTML = g.sides.map(s => `<div class="${s.idx === 0 ? 'blue' : 'red'}"><b>${esc(T[s.idx].code)}</b> ${esc(s.planLabel || '-')}${s.sideLaners && s.sideLaners.length ? ` · 사이드 ${s.sideLaners.length}명` : ''}</div>`).join('')
      + Object.entries(g.obj).filter(([, o]) => o.prog).map(([k, o]) => `<div>${esc(k)} 처치 ${(o.prog.val * 100).toFixed(0)}% (${o.prog.n}명, ${Math.round(o.prog.need)}초)</div>`).join('');
  }
  function fx(x, y, kind = 'burst') {
    const el = document.createElement('div');
    el.className = 'mm-ent ' + (kind === 'clash' ? 'mm-clash' : 'mm-burst');
    el.style.left = (x * 100) + '%'; el.style.top = (y * 100) + '%';
    if (kind === 'clash') el.textContent = '⚔';
    $('mm-fx').appendChild(el);
    setTimeout(() => el.remove(), 950);
  }
  let bpTab = 'mu';
  function updateBottom() {
    if (bpTab === 'gg') { $('bp').innerHTML = goldGraphSVG(g.goldHist.concat([{ t: g.t, diff: goldDiff(g) }]), 760, 150); return; }
    const rows = POS.map((pos, i) => {
      const a = g.sides[0].players[i], b = g.sides[1].players[i];
      const gd = Math.round(a.gold - b.gold);
      const items = (p, r) => `<div class="items ${r ? 'r' : ''}">${[0, 1, 2, 3, 4, 5].map(k => p.items[k] ? itemIcon(p.items[k], 20) : '<span class="empty"></span>').join('')}</div>`;
      return `<div class="mu ${a.isUser || b.isUser ? 'me' : ''}">
        ${champIcon(a.champ, 24, 'sq')}${items(a)}<span class="kda">${a.k}/${a.d}/${a.a}</span><span class="cs">${a.cs}</span>
        <span class="gd ${gd >= 50 ? 'pos' : gd <= -50 ? 'neg' : ''}">${POS_KO[pos]} ${gd >= 50 ? '◀ +' + fmtGold(gd) : gd <= -50 ? '+' + fmtGold(-gd) + ' ▶' : '='}</span>
        <span class="cs">${b.cs}</span><span class="kda">${b.k}/${b.d}/${b.a}</span>${items(b, true)}${champIcon(b.champ, 24, 'sq')}</div>`;
    });
    $('bp').innerHTML = rows.join('');
  }
  function updateAll() { updateScoreboard(); updateCards(); updateMinimap(); updateBottom(); }

  // ---------- 이벤트 처리 ----------
  // 문장은 엔진(commentary.js)이 이벤트 데이터로 고른다. 화면은 위치를 따로 만들지 않는다.
  const tName = i => T[i].name;
  const lineFor = (key, vars) => renderLine({ key, vars: { blue: T[0].name, red: T[1].name, ...vars } });
  function caption(text) {
    if (!text) return;
    const spk = ui.captionSpk++ % 2;
    $('cap').innerHTML = `<span class="spk ${spk ? 'a' : ''}">${spk ? '해설' : '캐스터'}</span><span class="ln">${esc(text)}</span>`;
  }
  function banner(text, side) {
    const slot = $('banner-slot');
    slot.innerHTML = `<div class="objbanner ${side === 0 ? 'blue' : side === 1 ? 'red' : ''}">${esc(text)}</div>`;
    clearTimeout(ui.bannerT);
    ui.bannerT = setTimeout(() => { slot.innerHTML = ''; }, 2600);
  }
  function feedKill(ev) {
    const k = ev.killer ? pById[ev.killer] : null, v = pById[ev.victim];
    const el = document.createElement('div');
    el.className = `kf ${ev.side === 1 ? 'red' : ''} ${(k && k.isUser) || v.isUser ? 'me' : ''}`;
    el.innerHTML = `${k ? champIcon(k.champ, 26, 'sq') : '<span class="fb sq" style="width:26px;height:26px;background:#444;font-size:10px">처형</span>'}<span class="sw">⚔</span>${champIcon(v.champ, 26, 'sq')}<span class="tiny ${ev.shutdown ? 'gold' : 'dim'}">${ev.firstBlood ? '선취점' : ev.shutdown ? '셧다운' : ''}</span>`;
    const kf = $('kf');
    kf.prepend(el);
    while (kf.children.length > 6) kf.lastChild.remove();
    setTimeout(() => el.remove(), 9000);
    fx(ev.pos[0], ev.pos[1]);
  }
  const BIG_TITLE = { soloKill: ev => `${LANE_KO[ev.lane] || ''} 솔로킬!`, teamfight: () => '대규모 한타!', ace: () => '에이스!', soul: ev => `${ev.dragon} 드래곤의 영혼`, elder: () => '장로 드래곤 처치!', baron: ev => (ev.stolen ? '바론 스틸!!!' : '내셔 남작 처치!'), multi: ev => ['', '', '더블 킬', '트리플 킬!', '쿼드라 킬!!', '펜타킬!!!'][Math.min(5, ev.n)] };
  function handleEvents(evs) {
    let best = null, bestPri = -1;
    for (const ev of evs) {
      if (ev.type === 'kill') feedKill(ev);
      if (['teamfight', 'skirmish', 'baron', 'dragon', 'elder', 'herald', 'grubs'].includes(ev.type) && ev.pos) fx(ev.pos[0], ev.pos[1], 'clash');
      const d = describe(g, ev);
      if (!d) continue;
      const text = renderLine(d);
      if (d.pri > bestPri) { bestPri = d.pri; best = text; }
      if (d.banner) banner(d.banner, ev.side);
      if (d.big) {
        const champ = ev.type === 'soloKill' ? (pById[(ev.partsBySide[ev.winner] || [])[0]] || {}).champ
          : ev.pid ? pById[ev.pid].champ : g.sides[ev.side >= 0 ? ev.side : 0].players[ev.type === 'teamfight' ? 3 : 1].champ;
        // 내가 직접 관여한 솔로킬은 연출 생략 (이미 장면으로 봄)
        const mine = ev.parts && ev.parts.some(pid => pById[pid] && pById[pid].isUser);
        if (!(ev.type === 'soloKill' && mine)) queueBig({ kind: d.big, title: (BIG_TITLE[ev.type] || BIG_TITLE[d.big] || (() => ''))(ev), side: ev.side >= 0 ? ev.side : ev.winner, champ, text, pos: ev.pos });
      }
    }
    if (g.t === CONFIG.match.laningEnd) { const gd = goldDiff(g); const tx = lineFor('laningEnd', { gold: fmtGold(Math.abs(gd)), team: tName(gd >= 0 ? 0 : 1) }); if (3 > bestPri) { bestPri = 3; best = tx; } }
    if (g.t - ui.lastGoldLine >= 300 && Math.abs(goldDiff(g)) > 4000) {
      const gd = goldDiff(g); ui.lastGoldLine = g.t;
      const tx = lineFor('goldLead', { gold: fmtGold(Math.abs(gd)), team: tName(gd >= 0 ? 0 : 1), enemy: tName(gd >= 0 ? 1 : 0) });
      if (2.5 > bestPri) { bestPri = 2.5; best = tx; }
    }
    if (best) caption(best);
  }
  function queueBig(b) {
    if (!App.settings.showBigEvents) return;
    if (g.t - ui.lastBigT < 40) return;
    ui.lastBigT = g.t;
    ui.bigQueue.push(b);
  }

  // ---------- 루프 ----------
  const tickMs = () => CONFIG.ui.msPerGameMinute / (60 / CONFIG.match.tickSec) / ui.speed;
  function schedule() {
    clearTimeout(ui.timer);
    if (ui.destroyed || ui.paused || ui.mode !== 'play') return;
    ui.timer = setTimeout(tick, tickMs());
  }
  function tick() {
    if (ui.destroyed || ui.paused || ui.mode !== 'play') return;
    const r = step(g);
    handleEvents(r.events);
    updateAll();
    if (r.over) return finish();
    if (r.sceneDue) { const sc = buildScene(g, userState); if (sc) return openScene(sc); }
    if (ui.bigQueue.length) return showBig(ui.bigQueue.shift());
    schedule();
  }
  function skipToScene(noScenes = false) {
    if (ui.mode !== 'play') return;
    let n = 0, sc = null, lastEvs = [];
    const saveBig = App.settings.showBigEvents;
    while (!g.over && n++ < 1000) {
      const r = step(g);
      lastEvs = r.events;
      if (r.sceneDue) {
        const s = buildScene(g, userState);
        if (s) { if (noScenes) { resolveScene(g, s, s.safest, userState); continue; } sc = s; break; }
      }
    }
    $('kf').innerHTML = '';
    App.settings.showBigEvents = false;
    handleEvents(lastEvs);      // 마지막 틱 문자중계·배너만 표시
    App.settings.showBigEvents = saveBig;
    ui.bigQueue = [];
    updateAll();
    if (g.over) return finish();
    if (sc) return openScene(sc);
    schedule();
  }

  // ---------- 주요 장면 ----------
  function shrink(on) { mmw.classList.toggle('mini', on); }
  // 장면 카드: 장면이 만들어진 틱의 엔진 상태(sc.cards)를 그대로 보여 준다
  function whoCard(p, c) {
    const enemy = g.userSide >= 0 && p.side !== g.userSide;
    return `<div class="who ${enemy ? 'enemy' : ''}">${champIcon(p.champ, 42, 'sq')}
      <div class="col" style="gap:3px"><div class="row" style="gap:6px"><b>${esc(p.nick)}</b><span class="tiny dim">${esc(champName(p.champ))} · Lv.${c.level}</span></div>
      <div class="bar hp"><i style="width:${c.hp * 100}%"></i></div>
      <div class="flags"><span class="flag ${c.ult ? 'on' : ''}">궁 ${c.ult ? '준비' : '대기'}</span><span class="flag ${c.flash ? 'on' : ''}">점멸 ${c.flash ? '있음' : '없음'}</span></div></div></div>`;
  }
  function sceneMarker(sc) {
    if (!sc) { $('mm-scene').innerHTML = ''; root.querySelectorAll('.mm-champ.hl').forEach(e => e.classList.remove('hl')); return; }
    $('mm-scene').innerHTML = `<div class="mm-ent mm-scene-ring" style="left:${sc.loc[0] * 100}%;top:${sc.loc[1] * 100}%;width:${CONFIG.match.sim.sceneRadius * 200}%;height:${CONFIG.match.sim.sceneRadius * 200}%"></div>`;
    for (const pid of sc.involved) { const el = $('mc-' + pid); if (el) el.classList.add('hl'); }
  }
  function probText(o) { return o.exact ? `${o.p}%` : `${o.lo}~${o.hi}%`; }
  function breakdownText(o) {
    if (o.exact) return o.parts.map((x, i) => i === 0 ? `${x.label} ${x.v}%` : `${x.label} ${x.v >= 0 ? '+' : ''}${x.v}%`).join(' / ') + ` = ${o.p}%`;
    return o.parts.map((x, i) => i === 0 ? `${x.label} ${x.v}%` : `${x.label} ${x.v >= 0 ? '↑' : '↓'}`).join(' / ') + ` ≈ ${o.lo}~${o.hi}% (판단력이 낮아 정확히 알 수 없음)`;
  }
  const RISK_KO = { low: '안전', mid: '보통', high: '위험' };
  function openScene(sc) {
    ui.mode = 'scene';
    clearTimeout(ui.timer);
    sceneMarker(sc);
    shrink(true);
    const slot = $('scene-slot');
    setTimeout(() => {
      if (ui.destroyed) return;
      slot.innerHTML = `<div class="scene" id="scene">
        <div class="scene-bg ${splashStyle(sc.splash) ? '' : 'fbbg'}" id="scene-bg" style="${splashStyle(sc.splash)}"></div><div class="scene-shade"></div>
        <div class="scene-inner">
          <div class="scene-time">${fmtTime(sc.t)} · ${esc(geoRegion(sc.region))} · 내 선택</div>
          <div class="scene-title">${esc(sc.title)}</div>
          <div class="scene-desc">${esc(sc.desc)}</div>
          <div class="scene-who">${sc.involved.slice(0, 6).map(pid => whoCard(pById[pid], sc.cards[pid])).join('')}${sc.involved.length > 6 ? `<span class="tiny dim">외 ${sc.involved.length - 6}명</span>` : ''}</div>
          <div class="scene-opts" id="sopts">${sc.options.map(o => `
            <button class="sopt ${o.idx === sc.safest ? 'safe' : ''}" data-opt="${o.idx}">
              <div class="lb">${esc(o.label)} <span class="risk ${o.risk}">${RISK_KO[o.risk]}</span></div>
              <div class="pr">${probText(o)}</div>
              <div class="pv"><span class="pos">성공</span> ${esc(o.prevS)} &nbsp;·&nbsp; <span class="neg">실패</span> ${esc(o.prevF)}</div>
              <div class="bd">${esc(breakdownText(o))}</div>
            </button>`).join('')}</div>
          <div class="scene-timer"><i id="stimer" style="width:100%"></i></div>
        </div></div>`;
      const timerEl = $('stimer');
      requestAnimationFrame(() => { timerEl.style.transition = `width ${S.timeLimitSec}s linear`; timerEl.style.width = '0%'; });
      ui.sceneTimeout = setTimeout(() => choose(sc, sc.safest, true), S.timeLimitSec * 1000);
      slot.querySelectorAll('.sopt').forEach(b => b.addEventListener('click', () => choose(sc, Number(b.dataset.opt), false)));
    }, CONFIG.ui.sceneShrinkMs);
  }
  function choose(sc, idx, timeout) {
    if (ui.mode !== 'scene') return;
    ui.mode = 'judge';
    clearTimeout(ui.sceneTimeout);
    const opt = sc.options[idx];
    const res = resolveScene(g, sc, idx, userState);
    const optsEl = $('sopts');
    const cs = S.critShare[opt.risk], fs = S.fumbleShare[opt.risk];
    const p = opt.p;
    optsEl.outerHTML = `<div class="judge" id="judge">
      <div class="row between"><b>${timeout ? '⏱ 시간 초과 — ' : ''}${esc(opt.label)}</b><span class="gold bold">성공 확률 ${p}%</span></div>
      <div class="jbar" style="margin-top:8px">
        <div class="zs" style="width:${p}%"></div><div class="zc" style="width:${p * cs}%"></div><div class="zf" style="width:${(100 - p) * fs}%"></div>
        <div class="lbls"><span>대성공</span><span>성공 | 실패</span><span>대실패</span></div>
        <div class="needle" id="needle" style="left:50%"></div>
      </div>
      <div id="jout"></div></div>`;
    const tm = root.querySelector('.scene-timer'); if (tm) tm.remove();
    const needle = $('needle');
    const t0 = performance.now(), dur = 1500;
    const anim = now => {
      if (ui.destroyed) return;
      const k = Math.min(1, (now - t0) / dur);
      const amp = (1 - k) * 45;
      const pos = k >= 1 ? res.roll : clamp(res.roll + Math.sin(now / 55) * amp + Math.sin(now / 23) * amp * 0.3, 0, 100);
      needle.style.left = pos + '%';
      if (k < 1) requestAnimationFrame(anim); else showOutcome(sc, res);
    };
    requestAnimationFrame(anim);
    updateAll();
  }
  const TIER_KO = { crit: '대성공!', succ: '성공', fail: '실패', fumble: '대실패…' };
  function showOutcome(sc, res) {
    const out = $('jout');
    const me = g.sides[g.userSide].players.find(p => p.isUser);
    let kb = '';
    const myKill = res.kills.find(k => k.killer === me.pid);
    const myDeath = res.kills.find(k => k.victim === me.pid);
    if (myKill) {
      const n = res.kills.filter(k => k.killer === me.pid).length;
      kb = `<div class="killbanner">${champIcon(me.champ, 54)}<span class="sw">⚔</span><span class="v">${champIcon(pById[myKill.victim].champ, 54)}</span><span class="kt">${n >= 2 ? ['', '', '더블 킬', '트리플 킬', '쿼드라 킬', '펜타킬'][Math.min(5, n)] : myKill.firstBlood ? '선취점!' : '처치!'}</span></div>`;
    } else if (myDeath) {
      const k = myDeath.killer ? pById[myDeath.killer] : null;
      kb = `<div class="killbanner" style="border-color:#7a2b3a">${k ? champIcon(k.champ, 54) : ''}<span class="sw">⚔</span><span class="v">${champIcon(me.champ, 54)}</span><span class="kt" style="color:#ff9aa5">처치당함</span></div>`;
    }
    out.innerHTML = `<div class="jres ${res.tier}">${TIER_KO[res.tier]} ${esc(res.text)}</div>
      <div class="jsub">판정 ${res.roll} / 성공 기준 ${res.p} 미만 · 평점 ${res.delta >= 0 ? '+' : ''}${res.delta.toFixed(2)}</div>${kb}
      <div class="scene-foot"><button class="btn primary" id="scont">계속 ▶</button></div>`;
    const bg = $('scene-bg'); if (bg) bg.classList.add('zoom');
    handleEvents(res.events);
    updateAll();
    ui.mode = 'outcome';
    const cont = () => { if (ui.mode !== 'outcome') return; closeScene(); };
    $('scont').addEventListener('click', cont);
    ui.contTimer = setTimeout(cont, S.autoContinueSec * 1000);
  }
  function closeScene() {
    clearTimeout(ui.contTimer);
    $('scene-slot').innerHTML = '';
    sceneMarker(null);
    shrink(false);
    ui.mode = 'resume';
    setTimeout(() => {
      if (ui.destroyed) return;
      ui.mode = 'play';
      if (g.over) return finish();
      schedule();
    }, CONFIG.ui.sceneShrinkMs);
  }
  function showBig(b) {
    ui.mode = 'big';
    if (b.pos) sceneMarker({ loc: b.pos, involved: [] });
    shrink(true);
    setTimeout(() => {
      if (ui.destroyed) return;
      $('scene-slot').innerHTML = `<div class="scene big"><div class="scene-bg zoom ${splashStyle(b.champ) ? '' : 'fbbg'}" style="${splashStyle(b.champ)}"></div><div class="scene-shade"></div>
        <div class="scene-inner"><div class="scene-time">${fmtTime(g.t)} · ${esc(tName(b.side))}</div>
        <div class="scene-title" style="color:${b.side === 0 ? '#9cc4ff' : '#ffa2ac'}">${esc(b.title)}</div>
        <div class="scene-desc">${esc(b.text || '')}</div>
        <div class="scene-foot" style="margin-top:auto"><button class="btn sm" id="bigskip">건너뛰기</button></div></div></div>`;
      const done = () => { if (ui.mode !== 'big') return; ui.mode = 'outcome'; closeScene(); };
      $('bigskip').addEventListener('click', done);
      ui.contTimer = setTimeout(done, S.bigEventShowSec * 1000);
    }, CONFIG.ui.sceneShrinkMs);
  }

  // ---------- 버그 신고: 같은 장면을 재현할 수 있는 JSON ----------
  function bugReport() {
    const wasPaused = ui.paused;
    ui.paused = true; clearTimeout(ui.timer);
    const note = prompt('무엇이 이상했나요? (비워 둬도 됩니다)', '') || '';
    const report = {
      kind: 'lckc-bug-report', version: 1, createdAt: new Date().toISOString(), note,
      seed: g.seed, gameT: g.t, gameTime: fmtTime(g.t),
      input: g.input,                                           // createMatch 입력 그대로 (재현용)
      choices: g.sceneLog.map(x => ({ t: x.t, id: x.id, opt: x.opt })), // 내 선택 기록 (재현용)
      recent: g.history,                                        // 최근 30초 선수 상태
      events: g.feed.filter(e => e.t >= g.t - 30),               // 최근 30초 이벤트
      plans: g.sides.map(s => ({ plan: s.plan, label: s.planLabel })),
      objectives: g.obj, waves: g.waves,
      structures: g.sides.map(s => ({ towers: s.towers, inhibs: s.inhibs, nexusTowerHp: s.nexusTowerHp, nexusHp: s.nexusHp })),
    };
    const blob = new Blob([JSON.stringify(report, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `bug-${g.seed}-${fmtTime(g.t).replace(':', '')}.json`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    ui.paused = wasPaused;
    if (!ui.paused) schedule();
  }

  // ---------- 종료 ----------
  function finish() {
    ui.mode = 'end';
    clearTimeout(ui.timer);
    const sum = summary(g);
    const up = g.userSide >= 0 ? g.sides[g.userSide].players.find(p => p.isUser) : null;
    const ratings = computeRatings(sum, up ? { pid: up.pid, score: g.choiceScore } : null);
    const pog = pickPOG(sum, ratings);
    const result = { summary: sum, ratings, pog, sceneLog: g.sceneLog.slice(), userSide: g.userSide, userPid: up ? up.pid : null, winnerTeamId: T[sum.winner].id, blueTeamId: T[0].id, redTeamId: T[1].id };
    setTimeout(() => showResult(result), 1600);
  }
  function showResult(result) {
    if (ui.destroyed) return;
    const sum = result.summary;
    const win = result.userSide >= 0 ? sum.winner === result.userSide : null;
    const pogP = pById[result.pog];
    const myR = result.userPid ? result.ratings[result.userPid].rating : null;
    const rcls = r => r >= 8 ? 'hi' : r < 5.5 ? 'lo' : '';
    const rowsFor = si => sum.sides[si].players.map(p => {
      const r = result.ratings[p.pid];
      return `<tr class="${pById[p.pid].isUser ? 'me' : ''} ${p.pos === 'SUP' && si === 0 ? 'sep' : ''}">
        <td>${champIcon(p.champ, 26, 'sq')}</td><td><b>${esc(p.nick)}</b> ${p.pid === result.pog ? '<span class="chip gold">POG</span>' : ''}<div class="tiny dim">${POS_KO[p.pos]} · ${esc(champName(p.champ))}</div></td>
        <td>${p.level}</td><td><b>${p.k}/${p.d}/${p.a}</b></td><td>${p.cs}</td><td>${fmtGold(p.gold)}</td><td>${(r.dmgShare * 100).toFixed(0)}%</td><td>${p.vision}</td>
        <td><div class="row" style="gap:2px">${p.items.map(i => itemIcon(i, 20)).join('')}</div></td><td><span class="rating ${rcls(r.rating)}">${r.rating.toFixed(1)}</span></td></tr>`;
    }).join('');
    root.querySelector('#match').innerHTML = `<div class="result">
      <div class="res-head">
        <div class="res-wl ${win === false ? 'lose' : 'win'}">${win === null ? `${esc(T[sum.winner].code)} 승리` : win ? '승리' : '패배'}</div>
        <div class="col" style="gap:2px"><div class="row">${teamLogo(T[0], 30)}<b style="font-size:20px">${esc(T[0].code)} ${sum.sides[0].kills} : ${sum.sides[1].kills} ${esc(T[1].code)}</b>${teamLogo(T[1], 30)}</div>
          <div class="muted small">경기 시간 ${fmtTime(sum.duration)} · 골드 ${fmtGold(sum.sides[0].gold)} vs ${fmtGold(sum.sides[1].gold)} · 포탑 ${sum.sides[0].towers} vs ${sum.sides[1].towers} · 바론 ${sum.sides[0].barons}-${sum.sides[1].barons} · 드래곤 ${sum.sides[0].dragons.length}-${sum.sides[1].dragons.length}</div></div>
        <div class="grow"></div>
        ${pogP ? `<div class="panel row" style="padding:8px 12px">${champIcon(pogP.champ, 44)}<div><div class="tiny gold bold">PLAYER OF THE GAME</div><b style="font-size:18px">${esc(pogP.nick)}</b></div></div>` : ''}
        ${myR !== null ? `<div class="panel" style="padding:8px 14px;text-align:center"><div class="tiny gold bold">내 평점</div><div style="font-size:30px;font-weight:900" class="${myR >= 7.5 ? 'gold' : myR < 5.5 ? 'neg' : ''}">${myR.toFixed(1)}</div></div>` : ''}
      </div>
      <div class="row" style="gap:12px;align-items:stretch">
        <div class="panel" style="flex:1"><h3>골드 차이 (블루 기준)</h3>${goldGraphSVG(sum.goldHist, 560, 120)}</div>
        <div class="panel" style="width:520px"><h3>내 선택 기록</h3><div class="scroll small" style="max-height:130px">${result.sceneLog.length ? result.sceneLog.map(s => `<div class="row" style="gap:6px;padding:2px 0"><span class="dim">${fmtTime(s.t)}</span><span class="chip ${s.tier === 'crit' ? 'gold' : s.tier === 'succ' ? 'green' : 'red'}">${TIER_KO[s.tier]}</span><span class="grow" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(s.label)} — ${esc(s.text)}</span><span class="${s.delta >= 0 ? 'pos' : 'neg'}">${s.delta >= 0 ? '+' : ''}${s.delta.toFixed(2)}</span></div>`).join('') : '<span class="dim">선택 장면 없음</span>'}</div></div>
      </div>
      <div class="panel scroll" style="flex:1;padding:8px 12px">
        <table class="stbl"><thead><tr><th></th><th>선수</th><th>Lv</th><th>KDA</th><th>CS</th><th>골드</th><th>딜 비중</th><th>시야</th><th>아이템</th><th>평점</th></tr></thead>
        <tbody>${rowsFor(0)}${rowsFor(1)}</tbody></table>
      </div>
      <div class="row" style="justify-content:flex-end"><button class="btn primary" id="res-cont" style="min-width:180px">계속 ▶</button></div>
    </div>`;
    root.querySelector('#res-cont').addEventListener('click', () => params.onEnd && params.onEnd(result));
  }

  // ---------- 컨트롤 ----------
  function setSpeed(s) {
    ui.speed = s; App.settings.defaultSpeed = s;
    root.querySelectorAll('.spd').forEach(b => b.classList.toggle('active', Number(b.dataset.spd) === s));
  }
  setSpeed(ui.speed);
  root.querySelectorAll('.spd').forEach(b => b.addEventListener('click', () => { setSpeed(Number(b.dataset.spd)); if (!ui.paused) schedule(); }));
  root.querySelector('[data-act=pause]').addEventListener('click', () => {
    ui.paused = !ui.paused;
    $('btn-pause').textContent = ui.paused ? '▶' : '⏸';
    $('btn-pause').classList.toggle('active', ui.paused);
    if (!ui.paused) schedule();
  });
  root.querySelector('[data-act=skip]').addEventListener('click', () => skipToScene(false));
  root.querySelector('[data-act=auto]').addEventListener('click', () => { if (ui.mode === 'play' && confirm('남은 경기를 자동으로 진행할까요? (선택 장면은 가장 안전한 선택지로 처리)')) skipToScene(true); });
  root.querySelector('[data-act=bug]').addEventListener('click', () => bugReport());
  root.querySelector('[data-act=big]').addEventListener('click', () => {
    App.settings.showBigEvents = !App.settings.showBigEvents;
    $('btn-big').textContent = `큰 장면 연출 ${App.settings.showBigEvents ? 'ON' : 'OFF'}`;
  });
  root.querySelectorAll('.bp-tab').forEach(b => b.addEventListener('click', () => {
    bpTab = b.dataset.tab;
    root.querySelectorAll('.bp-tab').forEach(x => x.classList.toggle('active', x === b));
    updateBottom();
  }));

  updateAll();
  caption(lineFor('gameStart', {}));
  schedule();
  return () => { ui.destroyed = true; clearTimeout(ui.timer); clearTimeout(ui.sceneTimeout); clearTimeout(ui.contTimer); };
}

function dragonColor(t) {
  return { '화염': '#ff6a2b', '대지': '#b07a3c', '바다': '#2ec4d6', '바람': '#9fc4e8', '화학공학': '#61d14a', '마법공학': '#3fa0ff' }[t] || '#888';
}

export function goldGraphSVG(hist, w = 600, h = 140) {
  if (!hist || hist.length < 2) return `<svg width="${w}" height="${h}"></svg>`;
  const maxT = hist[hist.length - 1].t || 1;
  const maxD = Math.max(2000, ...hist.map(p => Math.abs(p.diff)));
  const x = t => (t / maxT) * (w - 40) + 34, y = d => h / 2 - (d / maxD) * (h / 2 - 10);
  const pts = hist.map(p => `${x(p.t).toFixed(1)},${y(p.diff).toFixed(1)}`).join(' ');
  const area = `${x(0)},${h / 2} ${pts} ${x(maxT)},${h / 2}`;
  const k = Math.round(maxD / 1000);
  return `<svg class="ggraph" viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none">
    <defs><clipPath id="gtop"><rect x="0" y="0" width="${w}" height="${h / 2}"/></clipPath><clipPath id="gbot"><rect x="0" y="${h / 2}" width="${w}" height="${h / 2}"/></clipPath></defs>
    <line x1="34" x2="${w - 6}" y1="${h / 2}" y2="${h / 2}" stroke="#33487f" stroke-dasharray="3 3"/>
    <polygon points="${area}" fill="rgba(61,139,255,.35)" clip-path="url(#gtop)"/>
    <polygon points="${area}" fill="rgba(255,77,94,.35)" clip-path="url(#gbot)"/>
    <polyline points="${pts}" fill="none" stroke="#e8ecf8" stroke-width="1.6"/>
    <text x="2" y="14" fill="#8ab8ff" font-size="11">+${k}K</text><text x="2" y="${h - 4}" fill="#ff9aa5" font-size="11">-${k}K</text>
    <text x="${w - 40}" y="${h - 4}" fill="#6f7ca6" font-size="11">${Math.round(maxT / 60)}분</text>
  </svg>`;
}
