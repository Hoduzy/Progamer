// 캘린더 · 팀 · 내 선수 · 패치 노트 · 메시지함 · 설정
import { App, go, modal, toast, saveSettings } from '../app.js';
import { shell } from '../layout.js';
import { CONFIG } from '../../config.js';
import { esc, fmtDate, fmtWon, dateAdd, dateDiff, weekday, WEEKDAY_KO, POS, POS_KO, STAT_KO, STAT_KEYS, avg } from '../../core/util.js';
import { allMatches, userRef, lckRegularStandings } from '../../engine/season.js';
import { teamInfo, rivalProfile } from '../../engine/roster.js';
import { ovr, topChamps } from '../../engine/players.js';
import { coachEvaluation, soloRankLabel } from '../../engine/daily.js';
import { TIER_ORDER, TIER_LABEL } from '../../engine/meta.js';
import { champIcon, teamLogo, playerPhoto } from '../assets.js';
import { CHAMPIONS, champName } from '../../../data/champions.js';
import { REGIONS } from '../../../data/teams.js';
import { SLOT_KEYS, SLOT_NAMES, slotInfo, saveTo, loadFrom, deleteSlot, exportJSON, importJSON, describeSlot } from '../save.js';
import { startLoaded } from './title.js';
import { copyCodeFlow, pasteCodeFlow, importFile } from '../saveTransfer.js';
import { setImgDebug } from '../imgLoader.js';

export function register(reg) {
  reg('calendar', { render: calendar });
  reg('team', { render: teamPage });
  reg('me', { render: mePage });
  reg('patch', { render: patchPage });
  reg('inbox', { render: inboxPage });
  reg('settings', { render: settingsPage });
}

// ---------------- 캘린더 ----------------
function calendar(root, params) {
  const st = App.state;
  const month = params.month || st.date.slice(0, 7);
  const first = month + '-01';
  const startPad = weekday(first);
  const ref = userRef(st);
  const myTeam = st.players[st.user.pid].teamId;
  const byDate = {};
  for (const m of allMatches(st)) if (m.date && m.date.startsWith(month)) (byDate[m.date] = byDate[m.date] || []).push(m);
  const patchBase = `${st.year}-01-07`;
  const compStarts = {};
  for (const c of Object.values(st.season.comps)) (compStarts[c.start] = compStarts[c.start] || []).push(c.short);
  const cells = [];
  for (let i = 0; i < startPad; i++) cells.push('<div class="cal-d out"></div>');
  for (let d = 1; d <= 31; d++) {
    const date = `${month}-${String(d).padStart(2, '0')}`;
    if (date.slice(0, 7) !== month || isNaN(new Date(date).getTime()) || new Date(date + 'T00:00:00Z').getUTCMonth() + 1 !== Number(month.slice(5))) break;
    const ms = byDate[date] || [];
    const mine = ms.filter(m => m.teams.some(t => t && t.replace(':A', '') === myTeam));
    const evs = [];
    for (const m of mine) {
      const myIdx = m.teams.findIndex(t => t.replace(':A', '') === myTeam);
      const opp = teamInfo(st, m.teams[1 - myIdx]);
      const cls = m.done ? (m.winner === m.teams[myIdx] ? 'win' : 'lose') : 'mine';
      evs.push(`<div class="cal-ev ${cls}" title="${esc(st.season.comps[m.compId].name)}">${m.teams[myIdx].endsWith(':A') ? 'CL ' : ''}vs ${esc(opp.code)}${m.done ? ` ${m.wins[myIdx]}:${m.wins[1 - myIdx]}` : ''}</div>`);
    }
    const others = ms.length - mine.length;
    if (others) {
      const comps = [...new Set(ms.filter(m => !mine.includes(m)).map(m => st.season.comps[m.compId].short))];
      evs.push(`<div class="cal-ev">${esc(comps.join('·'))} ${others}경기</div>`);
    }
    if (dateDiff(patchBase, date) >= 0 && dateDiff(patchBase, date) % CONFIG.patch.everyDays === 0) evs.push('<div class="cal-ev patch">패치</div>');
    if (compStarts[date]) evs.push(`<div class="cal-ev comp">${esc(compStarts[date].join(', '))} 개막</div>`);
    if (date === st.season.faStart) evs.push('<div class="cal-ev comp">FA 시작</div>');
    cells.push(`<div class="cal-d ${date === st.date ? 'today' : ''}"><span class="dn">${d}</span>${evs.join('')}</div>`);
  }
  const prev = dateAdd(first, -1).slice(0, 7), next = dateAdd(first, 32).slice(0, 7);
  const html = `<div class="row between" style="margin-bottom:10px"><button class="btn sm" id="prev">◀ ${prev.slice(5)}월</button><b style="font-size:20px">${month.slice(0, 4)}년 ${Number(month.slice(5))}월</b><button class="btn sm" id="next">${next.slice(5)}월 ▶</button></div>
    <div class="cal">${WEEKDAY_KO.map(w => `<div class="cal-h">${w}</div>`).join('')}${cells.join('')}</div>
    <div class="small muted" style="margin-top:8px">노란색: 우리 팀 경기 · 초록/빨강: 승/패 · 파랑: 패치 · 보라: 대회 개막</div>`;
  const c = shell(root, 'calendar', html);
  c.querySelector('#prev').addEventListener('click', () => go('calendar', { month: prev }));
  c.querySelector('#next').addEventListener('click', () => go('calendar', { month: next }));
}

// ---------------- 팀 ----------------
function teamPage(root, params) {
  const st = App.state;
  const u = st.players[st.user.pid];
  const tid = params.team || u.teamId || 'GEN';
  const team = st.teams[tid];
  const lckIds = Object.values(st.teams).filter(t => t.region === 'LCK').map(t => t.id);
  const ovIds = Object.values(st.teams).filter(t => t.region !== 'LCK').map(t => t.id);
  const row = (pid) => {
    const p = st.players[pid];
    const isMe = p.isUser;
    return `<tr class="${isMe ? 'me' : ''} clickable" data-p="${pid}"><td>${POS_KO[p.pos]}</td><td><b>${isMe ? '★ ' : ''}${esc(p.nick)}</b></td><td>${p.age}</td><td><b>${Math.round(ovr(p))}</b></td>
      ${['laning', 'teamfight', 'mechanics', 'decision'].map(k => `<td>${p.stats[k]}</td>`).join('')}
      <td>${topChamps(p, 3).map(c => champIcon(c, 22)).join('')}</td>
      <td>${p.contract ? `${p.contract.endSeason}년` : '-'}</td><td>${p.contract ? fmtWon(p.contract.salary) : '-'}</td>
      <td>${tid === u.teamId && !isMe ? Math.round(st.user.chem[pid] || 0) : ''}</td><td>${p.season.games ? (p.season.ratingSum / p.season.games).toFixed(1) : '-'}</td></tr>`;
  };
  const squad = sq => POS.flatMap(pos => team.depth[pos].filter(id => team.squadOf[id] === sq && st.players[id]));
  const head = `<tr><th>포지션</th><th>선수</th><th>나이</th><th>종합</th><th>라인</th><th>한타</th><th>피지컬</th><th>판단</th><th>주력</th><th>계약</th><th>연봉</th><th>케미</th><th>평점</th></tr>`;
  const html = `<div class="row wrap" style="margin-bottom:8px">${lckIds.map(id => `<button class="btn sm ${id === tid ? 'active' : ''}" data-t="${id}">${esc(st.teams[id].code)}</button>`).join('')}
      <select class="inp" id="ov" style="height:44px;font-size:13px;width:auto"><option value="">해외 팀…</option>${ovIds.map(id => `<option value="${id}" ${id === tid ? 'selected' : ''}>[${st.teams[id].region}] ${esc(st.teams[id].name)}</option>`).join('')}</select></div>
    <div class="panel" style="margin-bottom:12px"><div class="row">${teamLogo(team, 64)}<div><div style="font-size:24px;font-weight:900;color:${team.color}">${esc(team.name)}</div>
      <div class="muted small">${team.region} · 전력 ${team.tier}티어 · 1군 평균 ${Math.round(avg(squad('main').map(id => ovr(st.players[id]))))}</div></div><div class="grow"></div>
      <div class="col" style="gap:2px;text-align:right"><span class="tiny dim">감독</span><b>${esc(team.coach.nick)}</b><span class="small muted">${team.coach.style} · 엄격함 ${Math.round(team.coach.strictness * 100)}</span></div></div></div>
    <div class="panel" style="margin-bottom:12px"><h3>1군</h3><table class="tbl">${head}${squad('main').map(row).join('')}</table></div>
    ${team.region === 'LCK' ? `<div class="panel"><h3>2군 (LCK CL)</h3><table class="tbl">${head}${squad('academy').map(row).join('')}</table></div>` : ''}`;
  const c = shell(root, 'team', html);
  c.querySelectorAll('[data-t]').forEach(b => b.addEventListener('click', () => go('team', { team: b.dataset.t })));
  c.querySelector('#ov').addEventListener('change', e => { if (e.target.value) go('team', { team: e.target.value }); });
  c.querySelectorAll('[data-p]').forEach(r => r.addEventListener('click', () => playerModal(r.dataset.p)));
}

export function playerModal(pid) {
  const st = App.state;
  const p = st.players[pid];
  const S = p.season;
  modal({
    title: `${esc(p.nick)} <span class="small muted">${POS_KO[p.pos]} · ${p.age}세 · ${p.teamId ? esc(st.teams[p.teamId].name) : 'FA'}</span>`,
    body: `<div class="grid2"><div>${STAT_KEYS.map(k => `<div class="statbar"><span>${STAT_KO[k]}</span><div class="bar"><i style="width:${p.stats[k]}%"></i></div><b>${p.stats[k]}</b></div>`).join('')}</div>
      <div><div class="kv-row"><span>종합</span><b>${Math.round(ovr(p))}</b></div>
      <div class="kv-row"><span>시즌 경기</span><b>${S.games}전 ${S.wins}승</b></div>
      <div class="kv-row"><span>KDA</span><b>${S.k}/${S.d}/${S.a}</b></div>
      <div class="kv-row"><span>평균 평점</span><b>${S.games ? (S.ratingSum / S.games).toFixed(2) : '-'}</b></div>
      <div class="kv-row"><span>POG</span><b>${S.pogs}</b></div>
      <div style="margin-top:8px" class="row wrap">${topChamps(p, 6).map(cid => `<span class="row" style="gap:4px">${champIcon(cid, 26)}<span class="tiny">${Math.round(p.champs[cid])}</span></span>`).join('')}</div></div></div>`,
    buttons: [{ label: '닫기', primary: true }], dismiss: true,
  });
}

// ---------------- 내 선수 ----------------
function mePage(root) {
  const st = App.state;
  const u = st.players[st.user.pid];
  const ev = coachEvaluation(st);
  const S = u.season;
  const team = u.teamId ? st.teams[u.teamId] : null;
  const champs = Object.keys(u.champs).sort((a, b) => u.champs[b] - u.champs[a]).slice(0, 18);
  const html = `<div class="grid2" style="grid-template-columns:1.1fr 1fr;align-items:start">
    <div class="panel">
      <div class="row" style="margin-bottom:10px">${playerPhoto(true, u.nick, team ? team.color : '#555', 76)}
        <div><div style="font-size:26px;font-weight:900">${esc(u.nick)}</div><div class="muted">${POS_KO[u.pos]} · ${u.age}세 · ${esc(u.style || '')}</div>
        <div class="row" style="margin-top:4px"><span class="chip gold">종합 ${Math.round(ovr(u))}</span><span class="chip">${team ? esc(team.name) + (u.squad === 'academy' ? ' 2군' : ' 1군') : 'FA'}</span></div></div></div>
      <h3>능력치</h3>
      ${STAT_KEYS.map(k => `<div class="statbar"><span>${STAT_KO[k]}</span><div class="bar"><i style="width:${u.stats[k]}%"></i></div><b>${u.stats[k]}</b></div>`).join('')}
      <h3 style="margin-top:12px">코치 평가 (숨은 능력치)</h3>
      <div class="small" style="line-height:1.6">${esc(ev.text)}</div>
    </div>
    <div class="col" style="gap:12px">
      <div class="panel"><h3>챔피언 숙련도</h3><div class="pick-grid" style="grid-template-columns:repeat(3,1fr);max-height:260px">
        ${champs.map(id => `<div class="pick-item" style="cursor:default">${champIcon(id, 30)}<div class="grow"><div class="row between"><b class="small">${esc(champName(id))}</b><span class="tiny dim">${st.meta.tiers[id] === 'OP' ? 'OP' : st.meta.tiers[id] + 'T'}</span></div><div class="bar" style="height:5px"><i style="display:block;height:100%;width:${u.champs[id]}%;background:var(--gold)"></i></div><span class="tiny">${Math.round(u.champs[id])}${u.mains && u.mains.includes(id) ? ' · 주력' : ''}</span></div></div>`).join('')}</div></div>
      <div class="panel"><h3>계약·시즌</h3>
        <div class="kv-row"><span>연봉</span><b>${u.contract ? fmtWon(u.contract.salary) : '-'}</b></div>
        <div class="kv-row"><span>계약 만료</span><b>${u.contract ? u.contract.endSeason + ' 시즌 종료' : '-'}</b></div>
        <div class="kv-row"><span>바이아웃</span><b>${u.contract ? fmtWon(u.contract.buyout) : '-'}</b></div>
        <div class="kv-row"><span>솔로 랭크</span><b>${esc(soloRankLabel(st.user.soloRank))} (${st.user.soloRank.wins}승 ${st.user.soloRank.games - st.user.soloRank.wins}패)</b></div>
        <div class="kv-row"><span>시즌 기록</span><b>${S.games}전 ${S.wins}승 · KDA ${S.k}/${S.d}/${S.a} · 평점 ${S.games ? (S.ratingSum / S.games).toFixed(2) : '-'} · POG ${S.pogs}</b></div>
      </div>
      <div class="panel"><h3>최근 경기</h3><table class="tbl"><tr><th>날짜</th><th>대회</th><th>상대</th><th>결과</th><th>챔피언</th><th>KDA</th><th>평점</th></tr>
        ${st.user.matchLog.slice(0, 8).map(m => `<tr><td>${m.date.slice(5)}</td><td>${esc(m.compName)}</td><td>${esc(m.opp ? teamInfo(st, m.opp).code : '')}</td><td class="${m.win ? 'pos' : 'neg'}">${m.win ? '승' : '패'}</td><td>${champIcon(m.champ, 22)} ${esc(champName(m.champ))}</td><td>${m.k}/${m.d}/${m.a}</td><td><b>${m.rating.toFixed(1)}</b>${m.pog ? ' <span class="chip gold">POG</span>' : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">아직 경기 기록이 없습니다.</td></tr>'}</table></div>
    </div></div>`;
  shell(root, 'me', html);
}

// ---------------- 패치 노트 ----------------
function patchPage(root, params) {
  const st = App.state;
  const m = st.meta;
  const tab = params.pos || 'TOP';
  const hist = m.history.length ? m.history : [{ version: m.version, notes: m.notes }];
  const list = Object.keys(CHAMPIONS).filter(id => CHAMPIONS[id].pos[0] === tab).sort((a, b) => TIER_ORDER.indexOf(m.tiers[a]) - TIER_ORDER.indexOf(m.tiers[b]) || m.power[b] - m.power[a]);
  const html = `<div class="grid2" style="grid-template-columns:1.1fr 1fr;align-items:start">
    <div class="panel"><h3>패치 ${esc(m.version)} 노트</h3>
      ${hist.slice(0, 4).map((h, hi) => `<div style="margin-bottom:12px"><div class="gold bold" style="margin-bottom:4px">${hi === 0 ? '최신' : '이전'} · ${esc(h.version)}</div>
        ${h.notes.length ? h.notes.map(n => `<div class="row" style="align-items:flex-start;padding:6px 0;border-bottom:1px solid var(--line)">${champIcon(n.champ, 34)}<div class="grow"><div class="row"><b>${esc(champName(n.champ))}</b><span class="chip ${n.type === 'buff' ? 'green' : 'red'}">${n.type === 'buff' ? '상향' : '하향'}</span>${n.from ? `<span class="tiny dim">${TIER_LABEL[n.from]} → <b>${TIER_LABEL[n.to]}</b></span>` : ''}</div>${n.lines.map(l => `<div class="small muted">${esc(l)}</div>`).join('')}</div></div>`).join('') : '<div class="muted small">시즌 첫 패치 — 변경 사항 없음</div>'}</div>`).join('')}
    </div>
    <div class="panel"><h3>메타 티어</h3><div class="tabs">${POS.map(p => `<button class="btn sm ${tab === p ? 'active' : ''}" data-pos="${p}">${POS_KO[p]}</button>`).join('')}</div>
      ${TIER_ORDER.map(t => `<div class="row" style="align-items:flex-start;margin-bottom:8px"><span class="chip ${t === 'OP' ? 'red' : t === '1' ? 'gold' : ''}" style="width:52px;justify-content:center">${TIER_LABEL[t]}</span><div class="row wrap" style="gap:4px">${list.filter(id => m.tiers[id] === t).map(id => `<span title="${esc(champName(id))}">${champIcon(id, 34)}</span>`).join('')}</div></div>`).join('')}
      <div class="small muted">메타 챔피언은 경기에서 더 강하고 밴 확률도 높습니다. 패치는 ${CONFIG.patch.everyDays}일마다 적용됩니다.</div></div></div>`;
  const c = shell(root, 'patch', html);
  c.querySelectorAll('[data-pos]').forEach(b => b.addEventListener('click', () => go('patch', { pos: b.dataset.pos })));
}

// ---------------- 메시지함 ----------------
function inboxPage(root, params) {
  const st = App.state;
  const sel = params.id ? st.inbox.find(m => m.id === params.id) : st.inbox[0];
  if (sel) sel.read = true;
  const html = `<div class="grid2" style="grid-template-columns:360px 1fr;align-items:start;height:100%">
    <div class="panel scroll" style="max-height:700px;padding:6px">${st.inbox.map(m => `<div class="news-item clickable" data-id="${m.id}" style="cursor:pointer;padding:8px;border-radius:6px;${sel && m.id === sel.id ? 'background:rgba(212,175,55,.1)' : ''}"><div class="grow"><div class="row between"><b class="${m.read ? 'muted' : ''}">${esc(m.from)}</b><span class="tiny dim">${m.date.slice(5)}</span></div><div class="small ${m.read ? 'dim' : ''}">${m.read ? '' : '● '}${esc(m.title)}</div></div></div>`).join('') || '<div class="muted">메시지 없음</div>'}</div>
    <div class="panel">${sel ? `<div class="tiny dim">${fmtDate(sel.date)}</div><h3 style="margin-top:6px">${esc(sel.title)}</h3><div class="muted small" style="margin-bottom:10px">보낸 사람: ${esc(sel.from)}</div><div style="line-height:1.8;white-space:pre-line">${esc(sel.body)}</div>` : ''}</div></div>`;
  const c = shell(root, 'inbox', html);
  c.querySelectorAll('[data-id]').forEach(el => el.addEventListener('click', () => go('inbox', { id: Number(el.dataset.id) })));
}

// ---------------- 설정·저장 ----------------
function settingsPage(root) {
  const st = App.state;
  const html = `<div class="grid2" style="align-items:start">
    <div class="panel"><h3>세이브 슬롯</h3>
      ${SLOT_KEYS.map(k => { const i = slotInfo(k); return `<div class="row between" style="padding:8px 0;border-bottom:1px solid var(--line)"><div><b>${SLOT_NAMES[k]}</b><div class="small muted">${esc(describeSlot(i))}${i ? ` · ${(i.size / 1024).toFixed(0)}KB` : ''}</div></div>
        <div class="row">${k !== 'auto' ? `<button class="btn sm" data-save="${k}">저장</button>` : ''}<button class="btn sm" data-load="${k}" ${i ? '' : 'disabled'}>불러오기</button>${k !== 'auto' && i ? `<button class="btn sm danger" data-del="${k}">삭제</button>` : ''}</div></div>`; }).join('')}
      <h3 style="margin-top:16px">다른 기기로 옮기기</h3>
      <div class="row wrap"><button class="btn primary" id="code-copy">📋 세이브 코드 복사</button><button class="btn" id="code-paste">세이브 코드 붙여넣기</button></div>
      <div class="row wrap" style="margin-top:8px"><button class="btn" id="export">JSON 파일로 내보내기</button><label class="btn" style="cursor:pointer">JSON 불러오기<input type="file" id="file" accept=".json,application/json" style="display:none"></label></div>
      <div class="small muted" style="margin-top:6px">세이브 코드는 지금 진행 상황을 압축한 글자입니다. 복사해서 메모·메신저로 다른 기기에 보내고, 그 기기에서 붙여넣으면 그대로 이어집니다.</div>
      <div class="small muted" style="margin-top:8px">자동 저장: 경기가 끝날 때, 하루가 지날 때. 시드: ${esc(String(st.seed))}</div>
    </div>
    <div class="panel"><h3>연출·진행</h3>
      <label class="row" style="min-height:44px"><input type="checkbox" id="big" ${App.settings.showBigEvents ? 'checked' : ''} style="width:24px;height:24px"> 큰 장면(바론·장로·대규모 한타·다른 라인 솔로킬) 연출 보기</label>
      <label class="row" style="min-height:44px"><input type="checkbox" id="debugMatch" ${App.settings.debugMatch ? 'checked' : ''} style="width:24px;height:24px"> 디버그 모드 (경기 미니맵에 선수별 계획·목표 화살표·팀 계획·오브젝트 처치 게이지 표시, 화면 왼쪽 아래 🖼 이미지 상태 패널)</label>
      <label class="row" style="min-height:44px"><input type="checkbox" id="fastDraft" ${App.settings.fastDraft ? 'checked' : ''} style="width:24px;height:24px"> AI 밴픽 빠르게</label>
      <div class="row wrap" style="min-height:44px">커뮤니티 수위 ${[['mild', '순한맛'], ['normal', '보통'], ['spicy', '매운맛']].map(([k, l]) => `<button class="btn sm ${(App.settings.communityTone || 'spicy') === k ? 'active' : ''}" data-tone="${k}">${l}</button>`).join('')}</div>
      <div class="small muted">순한맛: 욕을 ㅇㅇ 처리하거나 빼고 순하게 · 보통: 센 욕만 가림 · 매운맛: 실제 커뮤니티처럼</div>
      <div class="row" style="min-height:44px">기본 경기 속도 ${CONFIG.ui.speeds.map(s => `<button class="btn sm ${App.settings.defaultSpeed === s ? 'active' : ''}" data-spd="${s}">${s}배</button>`).join('')}</div>
      <div class="small muted">수치(확률·성장·연봉 등)는 js/config.js에서 조정합니다.</div>
      <div style="margin-top:20px"><button class="btn danger" id="title">타이틀로 (자동 저장 후)</button></div>
    </div></div>`;
  const c = shell(root, 'settings', html);
  c.querySelectorAll('[data-save]').forEach(b => b.addEventListener('click', () => { if (saveTo(b.dataset.save, App.state, App.rng)) toast(`${SLOT_NAMES[b.dataset.save]}에 저장했습니다.`); else toast('저장 실패 (저장 공간 부족?)'); go('settings'); }));
  c.querySelectorAll('[data-load]').forEach(b => b.addEventListener('click', () => { const r = loadFrom(b.dataset.load); if (r) { startLoaded(r); toast('불러왔습니다.'); } }));
  c.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => { if (confirm('이 슬롯을 삭제할까요?')) { deleteSlot(b.dataset.del); go('settings'); } }));
  c.querySelector('#export').addEventListener('click', () => exportJSON(App.state, App.rng));
  c.querySelector('#file').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) importFile(f); });
  c.querySelector('#code-copy').addEventListener('click', () => copyCodeFlow());
  c.querySelector('#code-paste').addEventListener('click', () => pasteCodeFlow());
  c.querySelector('#big').addEventListener('change', e => { App.settings.showBigEvents = e.target.checked; saveSettings(); });
  c.querySelector('#debugMatch').addEventListener('change', e => { App.settings.debugMatch = e.target.checked; saveSettings(); setImgDebug(e.target.checked); });
  c.querySelector('#fastDraft').addEventListener('change', e => { App.settings.fastDraft = e.target.checked; saveSettings(); });
  c.querySelectorAll('[data-tone]').forEach(b => b.addEventListener('click', () => { App.settings.communityTone = b.dataset.tone; saveSettings(); go('settings'); }));
  c.querySelectorAll('[data-spd]').forEach(b => b.addEventListener('click', () => { App.settings.defaultSpeed = Number(b.dataset.spd); saveSettings(); go('settings'); }));
  c.querySelector('#title').addEventListener('click', () => { saveTo('auto', App.state, App.rng); go('title'); });
}
