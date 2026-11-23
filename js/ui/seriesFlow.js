// 시리즈 진행: 퍼스트 셀렉션 → 밴픽 → 경기 → 다음 세트
import { go, modal } from './app.js';
import { aiFirstSelection, aiRemaining, resolveSelection, recordGame, simGame } from '../engine/series.js';
import { draftToMatchInput } from '../engine/draft.js';
import { teamLogo } from './assets.js';
import { esc } from '../core/util.js';

/*
 opts = { series, userTeamIdx, userPid, meta, rng, getUserState(), onGameEnd(result, info), onSeriesEnd(series) }
*/
export function playSeries(opts) {
  nextGame(opts);
}

async function nextGame(opts) {
  const s = opts.series;
  if (s.over) return opts.onSeriesEnd && opts.onSeriesEnd(s);
  const ut = opts.userTeamIdx;
  const gameNo = s.games.length + 1;
  const T = s.teams;
  const head = `${teamLogo(T[0].team, 30)} <b>${esc(T[0].team.code)}</b> ${s.wins[0]} : ${s.wins[1]} <b>${esc(T[1].team.code)}</b> ${teamLogo(T[1].team, 30)}`;
  let choice, remaining;
  const selIsUser = s.selector === ut;
  const sideBtns = [{ label: '블루 진영', value: { kind: 'side', side: 'blue' } }, { label: '레드 진영', value: { kind: 'side', side: 'red' } }];
  const orderBtns = [{ label: '선픽', value: { kind: 'order', order: 'first' } }, { label: '후픽', value: { kind: 'order', order: 'second' } }];
  const auto = { label: '이 세트 자동 진행', value: 'auto' };
  if (selIsUser) {
    const v = await modal({
      title: `${esc(s.label)} · ${gameNo}세트 — 퍼스트 셀렉션`,
      body: `<div class="row center" style="font-size:18px;gap:10px;margin-bottom:10px">${head}</div>
        우리 팀이 <b class="gold">퍼스트 셀렉션</b>을 가졌습니다. <b>진영</b> 또는 <b>픽 순서</b> 중 하나를 고르면 상대가 나머지를 정합니다.<br>
        <span class="small muted">블루 진영은 미세한 맵 이점, 선픽은 OP 챔피언 선점 기회가 있습니다.</span>`,
      buttons: [...sideBtns, ...orderBtns, auto],
    });
    if (v === 'auto') return autoGame(opts);
    choice = v; remaining = aiRemaining(opts.rng, choice);
  } else {
    choice = aiFirstSelection(opts.rng);
    const desc = choice.kind === 'side' ? `${choice.side === 'blue' ? '블루' : '레드'} 진영` : `${choice.order === 'first' ? '선픽' : '후픽'}`;
    const v = await modal({
      title: `${esc(s.label)} · ${gameNo}세트 — 퍼스트 셀렉션`,
      body: `<div class="row center" style="font-size:18px;gap:10px;margin-bottom:10px">${head}</div>
        상대 <b>${esc(T[s.selector].team.name)}</b>이(가) <b class="gold">${desc}</b>을(를) 선택했습니다.<br>우리 팀이 나머지를 정합니다.`,
      buttons: [...(choice.kind === 'side' ? orderBtns : sideBtns), auto],
    });
    if (v === 'auto') return autoGame(opts);
    remaining = v;
  }
  const { blueIdx, firstIdx } = resolveSelection(s.selector, choice, remaining);
  go('draft', {
    teams: T, blueIdx, firstIdx, unavailable: s.used, meta: opts.meta, userPid: opts.userPid, rng: opts.rng,
    series: { label: s.label, wins: s.wins, gameNo, bo: s.bo },
    onDone: d => {
      const input = draftToMatchInput(d);
      const blueWins = s.wins[blueIdx], redWins = s.wins[1 - blueIdx];
      go('match', {
        input, seed: opts.rng.int(1, 2 ** 30), meta: opts.meta, userPid: opts.userPid,
        userState: opts.getUserState ? opts.getUserState() : undefined,
        series: { label: `${s.label} ${gameNo}세트`, blueWins, redWins, gameNo, bo: s.bo },
        onEnd: result => {
          recordGame(s, { blueIdx, firstIdx, picks: d.picks, bans: d.bans, result });
          afterGame(opts, result, { gameNo, blueIdx, picks: d.picks });
        },
      });
    },
  });
}

function autoGame(opts) {
  const s = opts.series;
  const gameNo = s.games.length + 1;
  const result = simGame(s, opts.rng, opts.meta);
  const g = s.games[s.games.length - 1];
  afterGame(opts, result, { gameNo, blueIdx: g.blueIdx, picks: g.picks, auto: true });
}

async function afterGame(opts, result, info) {
  const s = opts.series;
  if (opts.onGameEnd) opts.onGameEnd(result, info);
  const last = s.games[s.games.length - 1];
  const won = last.winnerIdx === opts.userTeamIdx;
  if (!s.over) {
    await modal({
      title: `${info.gameNo}세트 ${won ? '승리' : '패배'}${info.auto ? ' (자동 진행)' : ''}`,
      body: `<div class="row center" style="font-size:22px;gap:12px">${teamLogo(s.teams[0].team, 40)}<b>${esc(s.teams[0].team.code)} ${s.wins[0]} : ${s.wins[1]} ${esc(s.teams[1].team.code)}</b>${teamLogo(s.teams[1].team, 40)}</div>
        <p class="small muted" style="text-align:center">피어리스 드래프트: 지금까지 사용된 챔피언 ${s.used.length}개는 이번 시리즈에서 다시 쓸 수 없습니다.</p>`,
      buttons: [{ label: `${info.gameNo + 1}세트로 ▶`, primary: true }],
    });
  }
  nextGame(opts);
}
