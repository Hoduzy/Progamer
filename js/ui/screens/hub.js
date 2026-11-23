// 메인 허브
import { App, go, modal, toast } from '../app.js';
import { shell } from '../layout.js';
import { CONFIG } from '../../config.js';
import { esc, fmtDate, dateDiff, POS_KO, STAT_KO, avg, weekday, WEEKDAY_KO } from '../../core/util.js';
import { userMatchOn, nextUserMatch, userRef } from '../../engine/season.js';
import { teamInfo, rivalProfile, userProfile } from '../../engine/roster.js';
import { competitorOf } from '../../engine/state.js';
import { ACTIVITIES, TRAINABLE, computeCondition, soloRankLabel } from '../../engine/daily.js';
import { ovr, topChamps } from '../../engine/players.js';
import { champIcon, teamLogo } from '../assets.js';
import { champName, CHAMPIONS } from '../../../data/champions.js';
import { todaySlots, setTodaySlot, slotLabel, runDay, autoAdvance } from '../dayFlow.js';

export function register(reg) { reg('hub', { render }); }

function bar(label, v, cls = '', max = 100) {
  return `<div class="statbar ${cls}"><span>${label}</span><div class="bar"><i style="width:${Math.max(0, Math.min(100, v / max * 100))}%"></i></div><b>${Math.round(v)}</b></div>`;
}

function render(root) {
  const st = App.state;
  const u = st.players[st.user.pid];
  st.user.condition = computeCondition(st);
  const team = u.teamId ? st.teams[u.teamId] : null;
  const todayMatch = userMatchOn(st, st.date);
  const next = nextUserMatch(st);
  const slots = todaySlots(st);
  const comp = next ? st.season.comps[next.compId] : null;
  st.user.competitorId = competitorOf(st);
  const rivalId = st.user.competitorId && st.players[st.user.competitorId] ? st.user.competitorId : null;
  const rp = rivalId ? rivalProfile(st, rivalId) : null, up = userProfile(st);
  const status = !team ? 'FA' : u.squad === 'academy' ? '2군 (LCK CL)' : (st.user.benchStreak > 0 ? '1군 (최근 벤치)' : '1군');
  const notes = [
    ...st.inbox.filter(m => !m.read).slice(0, 3).map(m => ({ d: m.date, t: `✉ ${m.from}: ${m.title}`, k: 'msg' })),
    ...st.news.slice(0, 7).map(n => ({ d: n.date, t: n.text, k: n.kind })),
  ].slice(0, 8);
  const phase = st.season.phase;
  const faBanner = phase !== 'season' ? `<div class="panel row" style="margin-bottom:12px;border-color:var(--gold-dim)"><b class="gold">📄 ${phase === 'offseason' ? '시즌 종료 — FA 기간을 기다리는 중' : phase === 'fa' ? 'FA 기간 진행 중' : 'FA 마감 — 새 시즌 준비'}</b><span class="small muted">${st.fa && st.fa.status === 'free' ? '계약이 만료됐습니다. 제안을 확인하세요.' : st.fa && st.fa.status === 'signed' ? '계약 완료. 새 시즌을 기다립니다.' : ''}</span><div class="grow"></div><button class="btn sm primary" data-nav2="contract">계약·FA 화면</button></div>` : '';
  const html = `${faBanner}
  <div class="grid2" style="grid-template-columns:1.6fr 1fr;align-items:start">
    <div class="panel">
      <h3>오늘 일정 <span class="small muted" style="font-weight:400">${fmtDate(st.date)}</span></h3>
      <div class="grid3">${[0, 1, 2].map(i => {
        if (i === 2 && todayMatch) {
          const a = teamInfo(st, todayMatch.teams[0]), b = teamInfo(st, todayMatch.teams[1]);
          return `<div class="slot-card mslot"><span class="sl">${CONFIG.daily.slots[i]}</span><div class="sa">⚔ 경기</div><div class="row small">${teamLogo(a, 22)} ${esc(a.code)} vs ${esc(b.code)} ${teamLogo(b, 22)}</div><span class="tiny muted">${esc(st.season.comps[todayMatch.compId].short)} · Bo${todayMatch.bo}</span></div>`;
        }
        return `<div class="slot-card" data-slot="${i}"><span class="sl">${CONFIG.daily.slots[i]}</span><div class="sa">${esc(slotLabel(st, slots[i]))}</div><span class="tiny muted">${esc(ACTIVITIES[slots[i].a].desc)}</span><span class="tiny gold">눌러서 변경</span></div>`;
      }).join('')}</div>
      <div class="row wrap" style="margin-top:12px">
        <button class="btn primary" id="day" style="min-width:170px;height:52px;font-size:17px">${todayMatch ? '하루 진행 · 경기 ▶' : '하루 진행 ▶'}</button>
        <button class="btn" id="auto">⏩ 경기일까지 자동 진행</button>
        <button class="btn sm" id="saveRoutine">오늘 구성을 ${WEEKDAY_KO[weekday(st.date)]}요일 루틴으로</button>
        <button class="btn sm" id="editRoutine">주간 루틴 편집</button>
      </div>
      ${st.user.injury ? `<div class="warn small" style="margin-top:8px">🚑 부상: ${esc(st.user.injury.type)} — ${st.user.injury.days}일 남음 (훈련 대신 휴식, 경기 결장)</div>` : ''}
      ${st.user.fatigue > CONFIG.injury.threshold ? `<div class="warn small" style="margin-top:4px">⚠ 피로가 매우 높습니다. 부상 위험이 있습니다.</div>` : ''}
    </div>
    <div class="panel">
      <h3>다음 경기</h3>
      ${next ? (() => {
        const a = teamInfo(st, next.teams[0]), b = teamInfo(st, next.teams[1]);
        const dd = dateDiff(st.date, next.date);
        return `<div class="next-match"><div class="tm">${teamLogo(a, 56)}<span>${esc(a.code)}</span></div><div class="col" style="align-items:center;gap:2px"><span class="vs">VS</span><span class="tiny muted">Bo${next.bo}</span></div><div class="tm">${teamLogo(b, 56)}<span>${esc(b.code)}</span></div></div>
          <div class="kv-row"><span>대회</span><b>${esc(comp.name)}${next.label ? ' · ' + esc(next.label) : ''}</b></div>
          <div class="kv-row"><span>날짜</span><b>${fmtDate(next.date)} ${dd === 0 ? '<span class="gold">오늘</span>' : `D-${dd}`}</b></div>
          <div class="kv-row"><span>내 위치</span><b>${status}</b></div>`;
      })() : '<div class="muted small">예정된 경기가 없습니다.</div>'}
    </div>
  </div>
  <div class="grid3" style="margin-top:12px;grid-template-columns:1fr 1fr 1.25fr;align-items:start">
    <div class="panel"><h3>상태</h3>
      ${bar('컨디션', st.user.condition, st.user.condition >= 70 ? 'good' : st.user.condition < 50 ? 'warn' : '')}
      ${bar('피로', st.user.fatigue, st.user.fatigue > 60 ? 'warn' : 'blue')}
      ${bar('멘탈', st.user.mental, 'blue')}
      ${bar('감독 신뢰도', st.user.trust)}
      ${bar('스크림 점수', st.user.scrimScore)}
      <div class="kv-row"><span>팀 케미 평균</span><b>${Math.round(avg(Object.values(st.user.chem)) || 0)}</b></div>
      <div class="kv-row"><span>솔로 랭크</span><b>${esc(soloRankLabel(st.user.soloRank))}</b></div>
    </div>
    <div class="panel"><h3>주전 경쟁</h3>
      ${rp ? `<table class="tbl"><tr><th></th><th>나</th><th>${esc(rp.nick)}</th></tr>
        <tr><td>스쿼드</td><td>${u.squad === 'main' ? '1군' : '2군'}</td><td>${team && team.squadOf[rivalId] === 'main' ? '1군' : '2군'}</td></tr>
        <tr><td>종합</td><td>${Math.round(up.ovr)}</td><td>${Math.round(rp.ovr)}</td></tr>
        <tr><td>최근 평점</td><td>${up.rating.toFixed(1)}</td><td>${rp.rating.toFixed(1)}</td></tr>
        <tr><td>감독 신뢰</td><td>${Math.round(up.trust)}</td><td>${Math.round(rp.trust)}</td></tr>
        <tr><td>스크림</td><td>${Math.round(up.scrim)}</td><td>${Math.round(rp.scrim)}</td></tr></table>
        <div class="tiny muted" style="margin-top:6px">${u.squad === 'academy' ? '2군에서 꾸준히 좋은 평점을 내면 주간 평가에서 1군으로 콜업됩니다.' : '경기 전 감독이 신뢰도·평점·컨디션·스크림·능력치로 주전을 정합니다.'}</div>` : '<div class="muted small">경쟁자 없음</div>'}
    </div>
    <div class="panel"><h3>알림</h3>
      ${notes.map(n => `<div class="news-item"><span class="nd">${n.d.slice(5).replace('-', '/')}</span><span>${esc(n.t)}</span></div>`).join('') || '<div class="muted small">알림 없음</div>'}
    </div>
  </div>`;
  const c = shell(root, 'hub', html);
  c.querySelectorAll('[data-slot]').forEach(el => el.addEventListener('click', () => editSlot(Number(el.dataset.slot))));
  c.querySelector('#day').addEventListener('click', () => runDay());
  c.querySelectorAll('[data-nav2]').forEach(b => b.addEventListener('click', () => go(b.dataset.nav2)));
  c.querySelector('#auto').addEventListener('click', () => autoAdvance());
  c.querySelector('#saveRoutine').addEventListener('click', () => { st.user.routine[weekday(st.date)] = todaySlots(st).map(s => ({ ...s })); toast(`${WEEKDAY_KO[weekday(st.date)]}요일 루틴으로 저장했습니다.`); });
  c.querySelector('#editRoutine').addEventListener('click', () => editRoutine());
}

// 칸 행동 고르기 (공용)
export function pickActivity(st, current) {
  const u = st.players[st.user.pid];
  return new Promise(resolve => {
    let sel = { ...current };
    const draw = bg => {
      const body = bg.querySelector('.modal-body');
      const a = ACTIVITIES[sel.a];
      let param = '';
      if (sel.a === 'train') param = `<div class="small muted" style="margin:10px 0 6px">훈련할 능력치</div><div class="opt-row">${TRAINABLE.map(k => `<button class="btn sm ${sel.stat === k ? 'active' : ''}" data-stat="${k}">${STAT_KO[k]} ${u.stats[k]}</button>`).join('')}</div>`;
      if (sel.a === 'practice' || sel.a === 'solo') {
        const list = Object.keys(CHAMPIONS).filter(id => CHAMPIONS[id].pos.includes(u.pos)).sort((x, y) => (u.champs[y] || 0) - (u.champs[x] || 0));
        param = `<div class="small muted" style="margin:10px 0 6px">${sel.a === 'solo' ? '주로 할 챔피언 (선택 안 하면 주력 중 무작위)' : '연습할 챔피언'} · 메타 티어 표시</div><div class="pick-grid">${list.map(id => `<div class="pick-item ${sel.champ === id ? 'sel' : ''}" data-champ="${id}">${champIcon(id, 28)}<span>${esc(CHAMPIONS[id].name)}<br><span class="tiny dim">숙련 ${Math.round(u.champs[id] || 0)} · ${st.meta.tiers[id] === 'OP' ? 'OP' : st.meta.tiers[id] + '티어'}</span></span></div>`).join('')}</div>`;
      }
      if (sel.a === 'bond') {
        const team = st.teams[u.teamId];
        const mates = team ? Object.keys(team.squadOf).filter(id => id !== u.id) : [];
        param = `<div class="small muted" style="margin:10px 0 6px">함께할 팀원 (케미)</div><div class="pick-grid">${mates.map(id => `<div class="pick-item ${sel.mate === id ? 'sel' : ''}" data-mate="${id}"><b>${esc(st.players[id].nick)}</b><span class="tiny dim">${POS_KO[st.players[id].pos]} ${team.squadOf[id] === 'main' ? '1군' : '2군'} · ${Math.round(st.user.chem[id] || 0)}</span></div>`).join('')}</div>`;
      }
      body.innerHTML = `<div class="act-grid">${Object.entries(ACTIVITIES).map(([k, v]) => `<button class="act-btn ${sel.a === k ? 'sel' : ''}" data-a="${k}"><span class="an">${v.icon} ${v.name}</span><span class="ad">${v.desc}<br>피로 ${CONFIG.daily.fatigue[k] > 0 ? '+' : ''}${CONFIG.daily.fatigue[k]}</span></button>`).join('')}</div>${param}`;
      body.querySelectorAll('[data-a]').forEach(b => b.addEventListener('click', () => { sel = { a: b.dataset.a }; if (sel.a === 'train') sel.stat = current.stat || 'laning'; draw(bg); }));
      body.querySelectorAll('[data-stat]').forEach(b => b.addEventListener('click', () => { sel.stat = b.dataset.stat; draw(bg); }));
      body.querySelectorAll('[data-champ]').forEach(b => b.addEventListener('click', () => { sel.champ = sel.champ === b.dataset.champ && sel.a === 'solo' ? undefined : b.dataset.champ; draw(bg); }));
      body.querySelectorAll('[data-mate]').forEach(b => b.addEventListener('click', () => { sel.mate = b.dataset.mate; draw(bg); }));
    };
    modal({
      title: '행동 선택', body: '', wide: true,
      buttons: [{ label: '취소', value: null }, { label: '확정', primary: true, value: 'ok' }],
      onOpen: bg => draw(bg),
    }).then(v => {
      if (v !== 'ok') return resolve(null);
      if (sel.a === 'practice' && !sel.champ) sel.champ = topChamps(u, 1)[0];
      resolve(sel);
    });
  });
}

async function editSlot(i) {
  const st = App.state;
  const cur = todaySlots(st)[i];
  const v = await pickActivity(st, cur);
  if (!v) return;
  setTodaySlot(st, i, v);
  go('hub');
}

async function editRoutine() {
  const st = App.state;
  const order = [1, 2, 3, 4, 5, 6, 0];
  const draw = bg => {
    bg.querySelector('.modal-body').innerHTML = `<table class="tbl"><tr><th>요일</th>${CONFIG.daily.slots.map(s => `<th>${s}</th>`).join('')}</tr>
      ${order.map(d => `<tr><td><b>${WEEKDAY_KO[d]}</b></td>${[0, 1, 2].map(i => `<td><button class="btn sm" data-d="${d}" data-i="${i}" style="width:100%;justify-content:flex-start">${esc(slotLabel(st, st.user.routine[d][i]))}</button></td>`).join('')}</tr>`).join('')}</table>
      <div class="small muted" style="margin-top:8px">"경기일까지 자동 진행"은 이 루틴대로 하루를 보냅니다. 경기일 저녁은 자동으로 경기입니다.</div>`;
    bg.querySelectorAll('[data-d]').forEach(b => b.addEventListener('click', async () => {
      const d = Number(b.dataset.d), i = Number(b.dataset.i);
      const v = await pickActivity(st, st.user.routine[d][i]);
      if (v) { st.user.routine[d][i] = v; draw(bg); }
    }));
  };
  await modal({ title: '주간 루틴', body: '', wide: true, buttons: [{ label: '닫기', primary: true }], onOpen: bg => draw(bg) });
  go('hub');
}
