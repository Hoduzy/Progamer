// 메인 허브
import { App, go, modal, toast } from '../app.js';
import { shell } from '../layout.js';
import { CONFIG } from '../../config.js';
import { esc, fmtDate, dateDiff, POS_KO, STAT_KO, STAT_KEYS, avg, weekday, WEEKDAY_KO } from '../../core/util.js';
import { saveTo } from '../save.js';
import { userMatchOn, nextUserMatch, userRef } from '../../engine/season.js';
import { teamInfo, rivalProfile, userProfile } from '../../engine/roster.js';
import { competitorOf } from '../../engine/state.js';
import { ACTIVITIES, TRAINABLE, actKey, computeCondition, soloRankLabel, activityPreview, fatigueWarning, isRecoveryDay } from '../../engine/daily.js';
import { topChamps } from '../../engine/players.js';
import { ovr } from '../../stats.js';
import { champIcon, teamLogo } from '../assets.js';
import { champName, CHAMPIONS } from '../../../data/champions.js';
import { todayAct, actLabel, runDay, autoAdvance } from '../dayFlow.js';
import { recommendAll, applyPlan, undoPlan } from '../../routine-advisor.js';

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
  const plan = todayAct(st);
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
      <h3>오늘 할 일 <span class="small muted" style="font-weight:400">${fmtDate(st.date)} · ${WEEKDAY_KO[weekday(st.date)]}요일</span></h3>
      ${todayMatch ? (() => {
        const a = teamInfo(st, todayMatch.teams[0]), b = teamInfo(st, todayMatch.teams[1]);
        return `<div class="slot-card mslot"><span class="sl">경기일 — 오늘은 다른 활동 없이 경기만</span><div class="sa">⚔ 경기</div><div class="row small">${teamLogo(a, 22)} ${esc(a.code)} vs ${esc(b.code)} ${teamLogo(b, 22)}</div><span class="tiny muted">${esc(st.season.comps[todayMatch.compId].short)} · Bo${todayMatch.bo} · 내일은 회복일</span></div>`;
      })() : `
      ${isRecoveryDay(st) ? `<div class="note-line">🛌 회복일 (어제 경기): 피로 -${CONFIG.daily.recoveryDay.fatigue} · 멘탈 +${CONFIG.daily.recoveryDay.mental}이 자동으로 들어가고, 휴식 효과가 ${Math.round((CONFIG.daily.recoveryDay.restMult - 1) * 100)}% 더 큽니다.</div>` : ''}
      ${fatigueWarning(st) ? `<div class="warn small" style="margin-bottom:8px">⚠ ${esc(fatigueWarning(st))}</div>` : ''}
      <div class="day-acts">${Object.keys(ACTIVITIES).map(k => actCardHTML(st, k, plan)).join('')}</div>
      <div class="tiny muted" style="margin-top:6px">하루에 활동 하나. 카드를 누르면 그 활동으로 하루를 보냅니다. ${ACTIVITIES[plan.a] ? `오늘 루틴: <b>${esc(actLabel(st, plan))}</b>` : ''}</div>`}
      <div class="row wrap" style="margin-top:12px">
        <button class="btn primary" id="day" style="min-width:170px;height:52px;font-size:17px">${todayMatch ? '경기 준비 ▶' : '루틴대로 하루 ▶'}</button>
        <button class="btn" id="week">⏩ 일주일 넘기기</button>
        <button class="btn" id="auto">⏭ 다음 경기까지</button>
        <button class="btn sm" id="editRoutine">주간 루틴 편집</button>
      </div>
      ${st.user.injury ? `<div class="warn small" style="margin-top:8px">🚑 부상: ${esc(st.user.injury.type)} — ${st.user.injury.days}일 남음 (훈련 대신 휴식, 경기 결장)</div>` : ''}
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
  c.querySelectorAll('[data-act]').forEach(el => el.addEventListener('click', () => chooseToday(el.dataset.act)));
  c.querySelector('#day').addEventListener('click', () => runDay());
  c.querySelectorAll('[data-nav2]').forEach(b => b.addEventListener('click', () => go(b.dataset.nav2)));
  c.querySelector('#week').addEventListener('click', () => autoAdvance(7, '일주일 넘기기', { advise: true }));
  c.querySelector('#auto').addEventListener('click', () => autoAdvance(60, '다음 경기까지'));
  c.querySelector('#editRoutine').addEventListener('click', () => editRoutine());
  // 능력치 기준 보정 알림 (옛 세이브를 처음 불러왔을 때 한 번)
  const fx = st.user.statFix;
  if (fx && !fx.shown) {
    fx.shown = true;
    saveTo('auto', st, App.rng);
    const rows = STAT_KEYS.map(k => { const d = fx.after[k] - fx.before[k]; return `<tr><td>${STAT_KO[k]}</td><td>${fx.before[k]}</td><td><b>${fx.after[k]}</b></td><td class="${d > 0 ? 'pos' : d < 0 ? 'neg' : ''}">${d > 0 ? '+' : ''}${d}</td></tr>`; }).join('');
    modal({
      title: '능력치 기준 보정',
      body: `<p>예전 버전에서는 내 선수만 다른 기준(시작 OVR 55)으로 만들어져 2군 평균보다 10 정도 낮았습니다. 이제 모든 선수가 같은 기준을 씁니다.</p>
        <p class="small muted">시작 시점 기준 차이만 고쳤고, 지금까지 훈련·경기로 올린 능력치는 그대로 남았습니다. 보정 전 세이브는 백업 슬롯(능력치 기준 보정 전)에 있습니다.</p>
        <table class="tbl"><tr><th>능력치</th><th>보정 전</th><th>보정 후</th><th>차이</th></tr>${rows}
        <tr><td><b>OVR</b></td><td>${fx.ovrBefore.toFixed(1)}</td><td><b class="gold">${fx.ovrAfter.toFixed(1)}</b></td><td class="pos">+${(fx.ovrAfter - fx.ovrBefore).toFixed(1)}</td></tr></table>`,
      buttons: [{ label: '확인', primary: true }],
    });
  }
}

// 활동 카드: 예상 효과 (경험치·피로·멘탈, 연속 감소)
function previewText(st, act) {
  const p = activityPreview(st, act);
  const bits = [...p.parts, `피로 ${p.fatigue > 0 ? '+' : ''}${p.fatigue}`];
  if (p.mental) bits.push(`멘탈 ${p.mental > 0 ? '+' : ''}${p.mental}`);
  return { text: bits.join(' / '), note: p.note };
}
function actCardHTML(st, k, plan) {
  const a = ACTIVITIES[k];
  const act = plan.a === k ? plan : defaultParam(st, k);
  const pv = previewText(st, act);
  return `<button class="act-card ${plan.a === k ? 'sel' : ''}" data-act="${k}"><span class="an">${a.icon} ${a.name}</span><span class="ap">${esc(pv.text)}</span>${pv.note ? `<span class="aw">🔁 ${esc(pv.note)}</span>` : ''}${plan.a === k ? '<span class="tiny gold">오늘 루틴</span>' : ''}</button>`;
}
function defaultParam(st, k) {
  const u = st.players[st.user.pid];
  if (k === 'train') return { a: k, stat: 'laning' };
  if (k === 'practice') return { a: k, champ: topChamps(u, 1)[0] };
  return { a: k };
}
// 카드 선택 → (능력치·챔피언·팀원 고르기) → 그 활동으로 하루 진행
async function chooseToday(k) {
  const st = App.state;
  const plan = todayAct(st);
  let act = plan.a === k ? plan : defaultParam(st, k);
  if (ACTIVITIES[k].param) {
    act = await pickActivity(st, act, { fixed: true });
    if (!act) return;
  }
  runDay(act);
}

// 활동 고르기 (공용). fixed: 활동 종류는 고정하고 능력치·챔피언·팀원만 고름

export function pickActivity(st, current, opts = {}) {
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
      const warn = fatigueWarning(st);
      const pv = previewText(st, sel);
      body.innerHTML = `${warn ? `<div class="warn small" style="margin-bottom:8px">⚠ ${esc(warn)}</div>` : ''}
        ${opts.fixed ? `<div class="act-head"><b>${a.icon} ${a.name}</b><span class="small muted">${esc(pv.text)}</span>${pv.note ? `<span class="small gold">🔁 ${esc(pv.note)}</span>` : ''}</div>`
          : `<div class="act-grid">${Object.entries(ACTIVITIES).map(([k, v]) => { const p = previewText(st, sel.a === k ? sel : defaultParam(st, k)); return `<button class="act-btn ${sel.a === k ? 'sel' : ''}" data-a="${k}"><span class="an">${v.icon} ${v.name}</span><span class="ad">${esc(p.text)}</span></button>`; }).join('')}</div>`}${param}`;
      body.querySelectorAll('[data-a]').forEach(b => b.addEventListener('click', () => { sel = { a: b.dataset.a }; if (sel.a === 'train') sel.stat = current.stat || 'laning'; draw(bg); }));
      body.querySelectorAll('[data-stat]').forEach(b => b.addEventListener('click', () => { sel.stat = b.dataset.stat; draw(bg); }));
      body.querySelectorAll('[data-champ]').forEach(b => b.addEventListener('click', () => { sel.champ = sel.champ === b.dataset.champ && sel.a === 'solo' ? undefined : b.dataset.champ; draw(bg); }));
      body.querySelectorAll('[data-mate]').forEach(b => b.addEventListener('click', () => { sel.mate = b.dataset.mate; draw(bg); }));
    };
    modal({
      title: opts.fixed ? '활동 세부 선택' : '활동 선택', body: '', wide: true,
      buttons: [{ label: '취소', value: null }, { label: opts.fixed ? '이 활동으로 하루 보내기 ▶' : '확정', primary: true, value: 'ok' }],
      onOpen: bg => draw(bg),
    }).then(v => {
      if (v !== 'ok') return resolve(null);
      if (sel.a === 'practice' && !sel.champ) sel.champ = topChamps(u, 1)[0];
      resolve(sel);
    });
  });
}

// ---------- 주간 루틴 편집 + 추천 루틴 ----------
const fmtMan = w => `${w >= 0 ? '+' : '−'}${Math.round(Math.abs(w) / 1e4).toLocaleString()}만 원`;
const signed = (v, d = 1) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}`;
function planCardHTML(st, plan, idx) {
  const S = plan.summary, order = [1, 2, 3, 4, 5, 6, 0];
  const byWd = Object.fromEntries(plan.days.map(d => [d.wd, d]));
  const rows = order.map(wd => {
    const d = byWd[wd];
    const label = d.match ? '<span class="gold">⚔ 경기</span>' : esc(actLabel(st, d.act));
    return `<div class="rc-row${d.date === st.date ? ' today' : ''}"><b>${WEEKDAY_KO[wd]}</b><span class="rc-act">${label}</span><span class="rc-why">${esc(d.reason)}</span></div>`;
  }).join('');
  const gains = Object.entries(S.stats).filter(([, v]) => v >= 0.05).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${STAT_KO[k]} +${v.toFixed(1)}`).join(' · ') || '거의 없음';
  const risk = Math.round(S.injuryRisk * 100);
  const gauge = S.gauge
    ? (S.gauge.need !== null
      ? `<div class="kv-row"><span>콜업 게이지</span><b>${signed(S.gauge.delta)} <span class="tiny dim">(${S.gauge.now.toFixed(1)} → ${S.gauge.after.toFixed(1)}, 기준 +${S.gauge.need})</span></b></div>`
      : `<div class="kv-row"><span>주전 점수 차</span><b>${signed(S.gauge.delta)} <span class="tiny dim">(${S.gauge.now.toFixed(1)} → ${S.gauge.after.toFixed(1)})</span></b></div>`)
    : '';
  return `<div class="rec-card" data-rec="${idx}" tabindex="0" role="button">
    <div class="rc-head"><span class="rc-name">${plan.icon} ${esc(plan.name)}</span>${plan.kind === 'growth' ? `<span class="chip ${risk >= 10 ? 'red' : 'gold'}">피로·부상 위험 ${risk}%</span>` : ''}</div>
    <div class="small muted">${esc(plan.desc)}</div>
    <div class="rc-days">${rows}</div>
    <div class="rc-sum">
      <div class="kv-row"><span>능력치 경험치</span><b>${gains} <span class="tiny dim">(OVR ${signed(S.ovrGain, 2)})</span></b></div>
      <div class="kv-row"><span>피로</span><b>${Math.round(S.fatigue.from)} → ${Math.round(S.fatigue.to)} <span class="tiny dim">(최고 ${Math.round(S.fatigue.peak)}${S.fatigue.peak > CONFIG.injury.threshold ? ' ⚠' : ''})</span></b></div>
      <div class="kv-row"><span>멘탈</span><b>${Math.round(S.mental.from)} → ${Math.round(S.mental.to)}</b></div>
      ${gauge}
      <div class="kv-row"><span>감독 신뢰</span><b>${S.trust.from.toFixed(1)} → ${S.trust.to.toFixed(1)}</b></div>
      <div class="kv-row"><span>수입</span><b>${fmtMan(S.money.total)} <span class="tiny dim">${S.money.stream ? `(방송 ${fmtMan(S.money.stream)}${S.money.salary ? ' + 월급' : ''})` : S.money.salary ? '(월급)' : ''}</span></b></div>
      ${S.matchCond.length ? `<div class="kv-row"><span>경기 당일 컨디션</span><b>${S.matchCond.map(Math.round).join(' / ')}</b></div>` : ''}
    </div>
    <div class="rc-why-list">${plan.reasons.slice(0, 2).map(r => `<div>💡 ${esc(r)}</div>`).join('')}</div>
    <button class="btn sm primary rc-apply" data-rec="${idx}">이 루틴 적용</button>
  </div>`;
}

async function editRoutine() {
  const st = App.state, u = st.user;
  const order = [1, 2, 3, 4, 5, 6, 0];
  let view = 'edit', plans = null, banner = '';
  const draw = bg => {
    const body = bg.querySelector('.modal-body');
    const foot = bg.querySelector('.modal-foot .btn');
    if (view === 'rec') {
      body.innerHTML = `<div class="row between" style="margin-bottom:8px"><div class="small muted">앞으로 7일 일정·상태·약점·메타를 보고 실제 공식의 기댓값으로 계산한 추천안입니다. 카드를 누르면 편집 화면에 채워지고, 그 뒤 하루씩 바꿀 수 있습니다.</div><button class="btn sm" id="rec-back">← 편집으로</button></div>
        <div class="rec-grid">${plans.map((p, i) => planCardHTML(st, p, i)).join('')}</div>`;
      if (foot) foot.textContent = '닫기';
      const pick = i => {
        const plan = plans[i];
        applyPlan(st, plan);
        banner = `${plan.icon} ${plan.name} 추천을 적용했습니다. 칸을 눌러 하루씩 바꿀 수 있고, "되돌리기"로 적용 전 루틴을 복구할 수 있습니다.`;
        view = 'edit'; draw(bg);
      };
      body.querySelectorAll('.rec-card').forEach(c => {
        c.addEventListener('click', () => pick(Number(c.dataset.rec)));
        c.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(Number(c.dataset.rec)); } });
      });
      body.querySelector('#rec-back').addEventListener('click', () => { view = 'edit'; draw(bg); });
      return;
    }
    if (foot) foot.textContent = '닫기';
    const planInfo = u.routinePlan;
    body.innerHTML = `<div class="row wrap" style="gap:8px;margin-bottom:10px">
        <button class="btn primary" id="rec-open">✨ 추천 루틴</button>
        ${u.routineBackup ? `<button class="btn" id="rec-undo">↩ 되돌리기 <span class="tiny dim">(${esc(u.routineBackup.label)} 적용 전)</span></button>` : ''}
        ${planInfo ? `<span class="chip gold">${esc(planInfo.name)}${planInfo.auto ? ' · 자동' : ''} 적용 중</span>` : ''}
      </div>
      ${banner ? `<div class="small gold" style="margin-bottom:8px">${esc(banner)}</div>` : ''}
      <table class="tbl"><tr><th>요일</th><th>활동 (하루 1개)</th></tr>
      ${order.map(d => { const r = planInfo && planInfo.days && planInfo.days[d], same = r && r.key === actKey(u.routine[d]); return `<tr><td><b>${WEEKDAY_KO[d]}</b></td><td><button class="btn sm" data-d="${d}" style="width:100%;justify-content:flex-start">${esc(actLabel(st, u.routine[d]))}${same ? ` <span class="tiny dim" style="margin-left:8px;white-space:normal">· ${esc(r.reason)}</span>` : ''}</button></td></tr>`; }).join('')}</table>
      <div class="small muted" style="margin-top:8px">"루틴대로 하루", "일주일 넘기기", "다음 경기까지"는 이 루틴대로 하루를 보냅니다. 경기일은 활동 없이 경기만 합니다. 같은 훈련을 3일 넘게 이어 하면 효과가 줄어듭니다.${App.settings.autoRoutine ? '<br><b class="gold">설정의 "매주 자동으로 균형형 추천 적용"이 켜져 있어 "일주일 넘기기" 때 이 루틴이 새로 계산됩니다.</b>' : ''}</div>`;
    body.querySelector('#rec-open').addEventListener('click', () => { plans = recommendAll(st); view = 'rec'; banner = ''; draw(bg); body.scrollTop = 0; });
    const undo = body.querySelector('#rec-undo');
    if (undo) undo.addEventListener('click', () => { undoPlan(st); banner = '추천 적용 전 루틴으로 되돌렸습니다.'; draw(bg); });
    body.querySelectorAll('[data-d]').forEach(b => b.addEventListener('click', async () => {
      const d = Number(b.dataset.d);
      const v = await pickActivity(st, u.routine[d]);
      if (v) { u.routine[d] = v; draw(bg); }
    }));
  };
  await modal({ title: '주간 루틴', body: '', wide: true, buttons: [{ label: '닫기', primary: true }], onOpen: bg => draw(bg) });
  go('hub');
}
