// 입단 테스트 결과: 2~3팀 2군 계약 제안
import { App, go } from '../app.js';
import { CONFIG } from '../../config.js';
import { esc, fmtWon, POS_KO } from '../../core/util.js';
import { teamLogo } from '../assets.js';
import { ovr } from '../../engine/players.js';
import { signUserToTeam, addMsg, addNews } from '../../engine/state.js';
import { createSeason } from '../../engine/season.js';
import { saveTo } from '../save.js';

export function register(reg) { reg('offers', { render }); }

function makeOffers(state, rng) {
  const u = state.players[state.user.pid];
  const ids = rng.shuffle(Object.values(state.teams).filter(t => t.region === 'LCK').map(t => t.id));
  const n = rng.int(2, 3);
  return ids.slice(0, n).map(id => {
    const t = state.teams[id];
    const tierMult = { S: 1.25, A: 1.12, B: 1.0, C: 0.92, D: 0.85 }[t.tier];
    const salary = Math.round(rng.int(25, 45) * tierMult) * 1e6;
    const years = rng.int(1, 3);
    const mainId = t.depth[u.pos].find(pid => t.squadOf[pid] === 'main');
    const rival = state.players[mainId];
    const notes = [];
    if (t.tier === 'S') notes.push('우승 경쟁 팀. 1군 진입은 어렵지만 배울 게 많다.');
    if (t.tier === 'C') notes.push('리빌딩 중. 콜업 기회가 상대적으로 빠를 수 있다.');
    if (rival && rival.age >= 25) notes.push(`주전 ${rival.nick}이(가) 베테랑(${rival.age}세)이다.`);
    if (rng.chance(0.4)) notes.push(`감독 ${t.coach.nick}(${t.coach.style})이 직접 테스트를 지켜봤다.`);
    return { teamId: id, salary, years, buyout: Math.round(salary * rng.float(2, 4) / 1e6) * 1e6, rivalId: mainId, notes };
  });
}

function render(root) {
  const state = App.state, rng = App.rng;
  if (!state.pendingOffers) state.pendingOffers = makeOffers(state, rng);
  const u = state.players[state.user.pid];
  const offers = state.pendingOffers;
  root.innerHTML = `<div class="create">
    <h1>입단 테스트 결과</h1>
    <div class="muted">${esc(u.nick)} (${POS_KO[u.pos]}, ${u.age}세) — ${offers.length}개 팀이 2군(LCK CL) 계약을 제안했습니다. 한 팀을 골라 커리어를 시작하세요.</div>
    <div class="grid3" style="grid-template-columns:repeat(${offers.length},1fr);margin-top:6px">${offers.map((o, i) => {
      const t = state.teams[o.teamId];
      const r = state.players[o.rivalId];
      return `<div class="offer" data-i="${i}">
        <div class="row">${teamLogo(t, 56)}<div><div class="on" style="color:${t.color}">${esc(t.name)}</div><span class="chip gold">전력 ${t.tier}티어</span></div></div>
        <div class="kv-row"><span>연봉</span><b>${fmtWon(o.salary)}</b></div>
        <div class="kv-row"><span>계약 기간</span><b>${o.years}년 (${state.year + o.years - 1} 시즌까지)</b></div>
        <div class="kv-row"><span>바이아웃</span><b>${fmtWon(o.buyout)}</b></div>
        <div class="kv-row"><span>1군 주전 ${POS_KO[u.pos]}</span><b>${r ? esc(r.nick) + ' (' + r.age + '세, OVR ' + Math.round(ovr(r)) + ')' : '-'}</b></div>
        <div class="kv-row"><span>감독</span><b>${esc(t.coach.nick)} · ${t.coach.style}</b></div>
        <div class="small muted" style="min-height:40px">${o.notes.map(esc).join('<br>')}</div>
        <button class="btn primary">이 팀과 계약</button></div>`;
    }).join('')}</div></div>`;
  root.querySelectorAll('.offer').forEach(el => el.addEventListener('click', () => {
    const o = offers[Number(el.dataset.i)];
    const t = state.teams[o.teamId];
    signUserToTeam(state, rng, o.teamId, 'academy', { salary: o.salary, endSeason: state.year + o.years - 1, buyout: o.buyout, starter: false });
    delete state.pendingOffers;
    createSeason(state, rng);
    addMsg(state, `감독 ${t.coach.nick}`, '입단을 환영한다', `${u.nick}, ${t.name}에 온 걸 환영한다. 처음엔 2군(LCK CL)에서 시작하지만, 실력만 증명하면 언제든 1군으로 올린다. 주전 ${state.players[o.rivalId].nick}을(를) 넘어서 봐라.`);
    addMsg(state, '에이전트', '계약 완료', `${t.name}와(과) ${o.years}년 계약을 마쳤습니다. 연봉은 ${fmtWon(o.salary)}입니다. 컨디션 관리 잘 하시고, 필요한 일 있으면 언제든 연락 주세요.`);
    addMsg(state, '팀 매니저', '일정 안내', '하루는 오전/오후/저녁 3칸입니다. 칸마다 스크림·훈련·솔로 랭크 등을 고르세요. 경기가 있는 날 저녁은 경기입니다. 피로가 쌓이면 부상 위험이 생깁니다.');
    addNews(state, `[오피셜] ${t.name}, 신인 ${u.nick}(${POS_KO[u.pos]}) 2군 영입`, 'roster');
    App.state = state;
    saveTo('auto', state, rng);
    go('hub');
  }));
}
