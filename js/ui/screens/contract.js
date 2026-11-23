// 계약·FA·이적 요청·은퇴·명예의 전당
import { App, go, modal, toast } from '../app.js';
import { shell } from '../layout.js';
import { CONFIG } from '../../config.js';
import { esc, fmtWon, fmtDate, POS_KO, dateDiff } from '../../core/util.js';
import { ovr, marketValue, potentialGrade } from '../../engine/players.js';
import { userEval, negotiate, acceptOffer, requestTransfer, careerSummary, retireUser } from '../../engine/career.js';
import { teamLogo, champIcon, playerPhoto } from '../assets.js';
import { champName } from '../../../data/champions.js';
import { saveTo } from '../save.js';

export function register(reg) { reg('contract', { render }); reg('retire', { render: retirePage }); reg('hof', { render: hofPage }); }

const PH = { season: '시즌 진행 중', offseason: '시즌 종료 (FA 대기)', fa: 'FA 기간', faClosed: 'FA 마감' };

function render(root) {
  const st = App.state;
  const u = st.players[st.user.pid];
  const team = u.teamId ? st.teams[u.teamId] : null;
  const phase = st.season.phase;
  const fa = st.fa;
  const ev = userEval(st);
  const mv = marketValue(u, st.user.popularity);
  let faHTML = '';
  if (phase === 'fa' || phase === 'faClosed') {
    if (fa.status === 'signed') {
      const o = fa.signed, t = st.teams[o.teamId];
      faHTML = `<div class="panel"><h3>계약 완료</h3><div class="row">${teamLogo(t, 48)}<div><b style="font-size:20px">${esc(t.name)}</b><div class="muted">${o.squad === 'main' ? '1군' : '2군'} · ${o.years}년 · 연봉 ${fmtWon(o.salary)}${o.starter ? ' · 주전 보장' : ''}</div></div></div>
        <div class="small muted" style="margin-top:8px">새 시즌(1월)부터 새 계약이 적용됩니다.</div></div>`;
    } else if (fa.status === 'free' || fa.status === 'transfer') {
      const open = fa.offers.filter(o => o.status === 'open');
      faHTML = `<div class="panel"><h3>받은 제안 (${open.length})</h3>
        <div class="small muted" style="margin-bottom:8px">${fa.status === 'transfer' ? '이적 요청이 받아들여졌습니다. 새 팀은 바이아웃 금액을 부담합니다.' : '계약이 만료됐습니다.'} 협상 시 인상 요구가 클수록 거절·철회 위험이 커집니다.</div>
        <table class="tbl"><tr><th>팀</th><th>지역</th><th>전력</th><th>스쿼드</th><th>연봉</th><th>기간</th><th>주전 보장</th><th>상태</th><th></th></tr>
        ${fa.offers.map(o => { const t = st.teams[o.teamId]; return `<tr class="${o.own ? 'hl' : ''}"><td><span class="row" style="gap:6px">${teamLogo(t, 26)}<b>${esc(t.name)}</b>${o.own ? ' <span class="chip gold">원 소속팀</span>' : ''}</span></td><td>${t.region}</td><td>${o.strength} (${t.tier})</td><td>${o.squad === 'main' ? '1군' : '2군'}</td><td><b>${fmtWon(o.salary)}</b></td><td>${o.years}년</td><td>${o.starter ? '<span class="chip green">보장</span>' : '-'}</td>
          <td>${o.status === 'open' ? '제안 중' : o.status === 'withdrawn' ? '<span class="neg">철회</span>' : o.status === 'declined' ? '거절' : ''}</td>
          <td>${o.status === 'open' ? `<div class="row"><button class="btn sm primary" data-acc="${o.id}">수락</button><button class="btn sm" data-neg="${o.id}">협상</button></div>` : ''}</td></tr>`; }).join('')}</table></div>`;
    } else {
      faHTML = `<div class="panel"><h3>FA 기간</h3><div>계약이 ${u.contract.endSeason} 시즌까지 남아 있습니다.</div>
        <div class="row wrap" style="margin-top:10px"><button class="btn" id="req" ${fa.requested ? 'disabled' : ''}>구단에 이적 요청</button>${fa.requested ? '<span class="small muted">구단이 이적 요청을 거절했습니다.</span>' : ''}</div>
        <div class="small muted" style="margin-top:6px">요청이 받아들여지면 바이아웃(${fmtWon(u.contract.buyout)})을 낼 수 있는 팀들이 제안을 보냅니다. 거절되면 감독 신뢰와 멘탈이 떨어집니다.</div></div>`;
    }
  } else {
    faHTML = `<div class="panel"><h3>FA 일정</h3><div>${PH[phase]} · FA 기간: ${fmtDate(st.season.faStart)} ~ ${fmtDate(st.season.faEnd)}</div>
      <div class="small muted" style="margin-top:6px">시즌 중에는 이적할 수 없습니다. 월즈가 끝나면 FA 기간이 열립니다.${st.season.phase === 'season' ? ` (FA까지 ${Math.max(0, dateDiff(st.date, st.season.faStart))}일)` : ''}</div></div>`;
  }
  const html = `<div class="grid2" style="grid-template-columns:1fr 1.3fr;align-items:start">
    <div class="col" style="gap:12px">
      <div class="panel"><h3>현재 계약</h3>
        ${team ? `<div class="row" style="margin-bottom:8px">${teamLogo(team, 44)}<div><b style="font-size:18px">${esc(team.name)}</b><div class="muted small">${u.squad === 'main' ? '1군' : '2군'} · ${team.region}</div></div></div>` : '<div>무소속</div>'}
        <div class="kv-row"><span>연봉</span><b>${u.contract ? fmtWon(u.contract.salary) : '-'}</b></div>
        <div class="kv-row"><span>계약 만료</span><b>${u.contract ? u.contract.endSeason + ' 시즌 종료' : '-'}</b></div>
        <div class="kv-row"><span>바이아웃</span><b>${u.contract ? fmtWon(u.contract.buyout) : '-'}</b></div>
        <div class="kv-row"><span>주전 보장</span><b>${u.contract && u.contract.starter ? '예' : '아니오'}</b></div>
        <div class="kv-row"><span>시장 가치 (추정)</span><b>${fmtWon(mv)}</b></div>
        <div class="kv-row"><span>평가 점수</span><b>${ev}</b></div>
        <div class="kv-row"><span>보유 자금</span><b>${fmtWon(st.user.money)}</b></div>
      </div>
      <div class="panel"><h3>연봉 변화</h3>${st.user.salaryHistory.map(s => `<div class="kv-row"><span>${s.year}</span><b>${esc(st.teams[s.team] ? st.teams[s.team].name : s.team)} · ${fmtWon(s.salary)}</b></div>`).join('')}</div>
      <div class="panel"><h3>은퇴</h3><div class="small muted">은퇴하면 커리어가 끝나고 총정리 화면과 명예의 전당이 나옵니다. (되돌릴 수 없음)</div><button class="btn danger" id="retire" style="margin-top:8px">은퇴 선언</button></div>
    </div>
    <div class="col" style="gap:12px">${faHTML}</div></div>`;
  const c = shell(root, 'contract', html);
  c.querySelectorAll('[data-acc]').forEach(b => b.addEventListener('click', async () => {
    const o = st.fa.offers.find(x => x.id === Number(b.dataset.acc));
    const t = st.teams[o.teamId];
    const v = await modal({ title: '계약 확인', body: `<b>${esc(t.name)}</b> ${o.squad === 'main' ? '1군' : '2군'}, ${o.years}년, 연봉 ${fmtWon(o.salary)}${o.starter ? ', 주전 보장' : ''}.<br>이 제안을 수락할까요? 다른 제안은 모두 거절됩니다.`, buttons: [{ label: '취소', value: false }, { label: '수락', primary: true, value: true }] });
    if (!v) return;
    acceptOffer(st, App.rng, o.id);
    saveTo('auto', st, App.rng);
    toast(`${t.name}와(과) 계약했습니다!`);
    go('contract');
  }));
  c.querySelectorAll('[data-neg]').forEach(b => b.addEventListener('click', async () => {
    const id = Number(b.dataset.neg);
    const N = CONFIG.salary.negotiate;
    const lv = await modal({ title: '연봉 협상', body: '얼마나 올려 달라고 할까요?', buttons: [{ label: `+${N.small.raise * 100}% (무난)`, value: 'small' }, { label: `+${N.mid.raise * 100}% (강하게)`, value: 'mid' }, { label: `+${N.big.raise * 100}% (도박)`, value: 'big' }, { label: '취소', value: null }] });
    if (!lv) return;
    const r = negotiate(st, App.rng, id, lv);
    await modal({ title: '협상 결과', body: r.ok ? `구단이 수락했습니다! 새 연봉: <b class="gold">${fmtWon(r.offer.salary)}</b>${r.offer.starter ? ' (주전 보장)' : ''}` : r.withdrawn ? '<span class="neg">구단이 불쾌해하며 제안을 철회했습니다.</span>' : '구단이 인상을 거절했습니다. 기존 조건은 유효합니다.', buttons: [{ label: '확인', primary: true }] });
    go('contract');
  }));
  const req = c.querySelector('#req');
  if (req) req.addEventListener('click', async () => {
    const r = requestTransfer(st, App.rng);
    await modal({ title: '이적 요청', body: r.ok ? '구단이 이적 요청을 받아들였습니다. 다른 팀들의 제안을 확인하세요.' : '구단이 이적 요청을 거절했습니다. (감독 신뢰 -8, 멘탈 -6)', buttons: [{ label: '확인', primary: true }] });
    go('contract');
  });
  c.querySelector('#retire').addEventListener('click', async () => {
    const v = await modal({ title: '은퇴 선언', body: `정말 은퇴할까요? <b>${esc(u.nick)}</b>의 커리어가 여기서 끝납니다.`, buttons: [{ label: '취소', value: false }, { label: '은퇴합니다', danger: true, value: true }] });
    if (!v) return;
    const sum = retireUser(st);
    addHof(sum);
    saveTo('auto', st, App.rng);
    go('retire', { sum });
  });
}

// ---------------- 명예의 전당 ----------------
const HOF_KEY = CONFIG.storagePrefix + '.hof';
export function loadHof() { try { return JSON.parse(localStorage.getItem(HOF_KEY) || '[]'); } catch { return []; } }
export function addHof(sum) {
  const list = loadHof();
  const score = Math.round((sum.trophies.length * 30 + sum.awards.length * 15 + (sum.avgRating || 6) * 10 + sum.totals.g * 0.2 + sum.peakOvr) * 10) / 10;
  list.push({ nick: sum.nick, pos: sum.pos, years: sum.years, trophies: sum.trophies.map(t => `${t.year} ${t.name}`), awards: sum.awards.map(a => `${a.year} ${a.name}`), avgRating: sum.avgRating, games: sum.totals.g, peakOvr: sum.peakOvr, teams: sum.teams, score, date: new Date().toISOString().slice(0, 10) });
  list.sort((a, b) => b.score - a.score);
  try { localStorage.setItem(HOF_KEY, JSON.stringify(list.slice(0, 50))); } catch { }
}

function retirePage(root, params) {
  const st = App.state;
  const sum = params.sum || careerSummary(st);
  const t = sum.totals;
  root.innerHTML = `<div class="create scroll" style="overflow-y:auto">
    <div class="row" style="gap:16px">${playerPhoto(true, sum.nick, '#5a4a12', 90)}<div><div class="muted">커리어 총정리</div><h1 style="font-size:40px">${esc(sum.nick)}</h1><div class="muted">${POS_KO[sum.pos]} · ${sum.age}세 은퇴 · ${sum.years}시즌</div></div><div class="grow"></div>
      <button class="btn" id="hof">명예의 전당</button><button class="btn primary" id="title">타이틀로</button></div>
    <div class="grid3" style="grid-template-columns:repeat(5,1fr)">
      ${[['통산 경기', t.g], ['승률', t.g ? Math.round(t.w / t.g * 100) + '%' : '-'], ['평균 평점', sum.avgRating ?? '-'], ['KDA', `${t.k}/${t.d}/${t.a}`], ['POG', t.pog], ['트로피', sum.trophies.length], ['수상', sum.awards.length], ['최고 종합', sum.peakOvr], ['팬', sum.fans.toLocaleString()], ['자산', fmtWon(sum.money)]].map(([k, v]) => `<div class="panel" style="text-align:center"><div class="tiny dim">${k}</div><div style="font-size:24px;font-weight:900" class="gold">${v}</div></div>`).join('')}
    </div>
    <div class="grid2" style="align-items:start">
      <div class="panel"><h3>시즌별 기록</h3><table class="tbl"><tr><th>시즌</th><th>팀</th><th>경기</th><th>평점</th><th>KDA</th><th>주력</th><th>연봉</th><th>성과</th></tr>
        ${sum.seasons.map(s => `<tr><td>${s.year}</td><td>${s.team ? esc(st.teams[s.team] ? st.teams[s.team].code : s.team) : '-'} ${s.squad === 'academy' ? '(2군)' : ''}</td><td>${s.games}</td><td>${s.rating ?? '-'}</td><td>${s.k}/${s.d}/${s.a}</td><td>${s.topChamp ? champIcon(s.topChamp, 22) : ''}</td><td>${fmtWon(s.salary)}</td><td class="small">${[...s.trophies, ...s.awards].map(esc).join(', ')}</td></tr>`).join('')}</table></div>
      <div class="panel"><h3>트로피·수상</h3>${[...sum.trophies.map(x => `🏆 ${x.year} ${esc(x.name)}${x.played ? '' : ' (벤치)'}`), ...sum.awards.map(x => `🏅 ${x.year} ${esc(x.name)}`)].join('<br>') || '<span class="muted">없음</span>'}</div>
    </div></div>`;
  root.querySelector('#title').addEventListener('click', () => go('title'));
  root.querySelector('#hof').addEventListener('click', () => go('hof'));
}

function hofPage(root) {
  const list = loadHof();
  root.innerHTML = `<div class="create"><div class="row between"><h1>명예의 전당</h1><button class="btn" id="back">← 타이틀</button></div>
    <div class="panel scroll" style="flex:1"><table class="tbl"><tr><th>#</th><th>선수</th><th>포지션</th><th>시즌</th><th>경기</th><th>평점</th><th>최고 종합</th><th>트로피</th><th>수상</th><th>점수</th></tr>
    ${list.map((h, i) => `<tr><td class="rank-num">${i + 1}</td><td><b>${esc(h.nick)}</b><div class="tiny dim">${esc(h.date)} · ${esc((h.teams || []).join(' → '))}</div></td><td>${POS_KO[h.pos]}</td><td>${h.years}</td><td>${h.games}</td><td>${h.avgRating ?? '-'}</td><td>${h.peakOvr}</td><td class="small" style="white-space:normal;max-width:220px">${h.trophies.map(esc).join(', ') || '-'}</td><td class="small" style="white-space:normal;max-width:200px">${h.awards.map(esc).join(', ') || '-'}</td><td><b class="gold">${h.score}</b></td></tr>`).join('') || '<tr><td colspan="10" class="muted">아직 은퇴한 선수가 없습니다.</td></tr>'}</table></div></div>`;
  root.querySelector('#back').addEventListener('click', () => go(App.state && App.state.user && !App.state.user.retired ? 'records' : 'title'));
}
