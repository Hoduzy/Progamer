// 테스트 경기: 세이브 없이 한 경기를 바로 플레이
import { go, App } from '../app.js';
import { RNG } from '../../core/rng.js';
import { POS, POS_KO, esc } from '../../core/util.js';
import { makePlayer } from '../../engine/players.js';
import { newMeta } from '../../engine/meta.js';
import { createDraft, autoDraft, draftToMatchInput } from '../../engine/draft.js';
import { LCK_TEAMS } from '../../../data/teams.js';
import { makeNamePool } from '../../../data/names.js';
import { CONFIG } from '../../config.js';

export function register(reg) { reg('testMatch', { render }); }

export function buildTestTeams(rng, userPos, blueCode = 'GEN', redCode = 'T1') {
  const names = makeNamePool(rng, 20);
  const mk = (code, isUserTeam) => {
    const t = LCK_TEAMS.find(x => x.code === code);
    const team = { id: t.code, code: t.code, name: t.name, color: t.color };
    const players = POS.map((pos, i) => makePlayer(rng, { nick: names.pop(), pos, age: 21, target: CONFIG.tierOvr[t.tier] + rng.int(-3, 3) }));
    if (isUserTeam) {
      const u = players[POS.indexOf(userPos)];
      u.nick = '나'; u.isUser = true;
    }
    return { team, players };
  };
  return [mk(blueCode, true), mk(redCode, false)];
}

function render(root, params) {
  if (params.pos) {
    const rng = new RNG(params.seed || Date.now());
    const meta = newMeta(rng, 2026);
    const teams = buildTestTeams(rng, params.pos);
    const user = teams[0].players.find(p => p.isUser);
    const d = createDraft({ teams, blueIdx: 0, firstIdx: 0, meta, userPid: user.id });
    autoDraft(d, rng);
    const input = draftToMatchInput(d);
    go('match', {
      input, seed: rng.int(1, 1e9), meta, userPid: user.id,
      userState: { condition: 78, mental: 70, fatigue: 20 },
      series: { label: '테스트 경기', blueWins: 0, redWins: 0, gameNo: 1, bo: 1 },
      onEnd: () => go('title'),
    });
    return;
  }
  root.innerHTML = `<div class="title-screen">
    <div class="title-logo"><div class="t2" style="font-size:40px">테스트 경기</div><div class="t3">포지션을 골라 한 경기를 바로 플레이합니다 (저장되지 않음)</div></div>
    <div class="row">${POS.map(p => `<button class="btn" style="width:120px;height:64px;font-size:18px" data-pos="${p}">${POS_KO[p]}</button>`).join('')}</div>
    <button class="btn ghost" id="back">← 돌아가기</button></div>`;
  root.querySelectorAll('[data-pos]').forEach(b => b.addEventListener('click', () => go('testMatch', { pos: b.dataset.pos })));
  root.querySelector('#back').addEventListener('click', () => go('title'));
}
