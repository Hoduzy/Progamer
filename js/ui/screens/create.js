// 캐릭터 생성
import { App, go, toast } from '../app.js';
import { CONFIG } from '../../config.js';
import { POS, POS_KO, esc } from '../../core/util.js';
import { champsForPos, CHAMPIONS } from '../../../data/champions.js';
import { isBlocked, suggestNick } from '../../../data/names.js';
import { champIcon } from '../assets.js';
import { newWorld, createUserPlayer } from '../../engine/state.js';

export function register(reg) { reg('create', { render }); }

const STYLE_DESC = {
  '라인전 괴물': '라인전·피지컬이 또래보다 확실히 강함',
  '한타 장인': '한타 포지셔닝·판단이 또래보다 확실히 강함',
  '운영형': '판단력·시야가 또래보다 확실히 강함',
  '캐리형': '피지컬·라인전이 또래보다 확실히 강함',
  '헌신형': '시야·한타 희생이 또래보다 확실히 강함',
};
const DIFF_DESC = { easy: '2군 에이스급에서 시작', normal: '2군 평균 정도에서 시작', hard: '2군 하위권에서 시작' };

function render(root) {
  const f = { nick: suggestNick(), pos: 'MID', age: 18, style: '캐리형', mains: [], seed: '', difficulty: 'normal' };
  const draw = () => {
    const champs = champsForPos(f.pos).filter(id => CHAMPIONS[id].pos[0] === f.pos).concat(champsForPos(f.pos).filter(id => CHAMPIONS[id].pos[0] !== f.pos));
    root.innerHTML = `<div class="create">
      <div class="row between"><h1>선수 등록</h1><button class="btn ghost" id="back">← 타이틀</button></div>
      <div class="grid2" style="gap:18px">
        <div class="col" style="gap:14px">
          <div class="field"><label>닉네임 (중계 화면처럼 영문 권장 · 실존 프로 선수 이름은 사용할 수 없음)</label><div class="row" style="gap:8px"><input class="inp grow" id="nick" maxlength="14" placeholder="예: Starling" value="${esc(f.nick)}"><button class="btn" id="nick-roll" title="다른 이름 추천" style="flex:none">🎲 추천</button></div></div>
          <div class="field"><label>포지션</label><div class="opt-row">${POS.map(p => `<button class="btn ${f.pos === p ? 'active' : ''}" data-pos="${p}" style="width:82px">${POS_KO[p]}</button>`).join('')}</div></div>
          <div class="field"><label>나이</label><div class="opt-row">${[17, 18, 19, 20].map(a => `<button class="btn ${f.age === a ? 'active' : ''}" data-age="${a}" style="width:82px">${a}세</button>`).join('')}</div></div>
          <div class="field"><label>난이도</label><div class="opt-row">${Object.entries(CONFIG.difficultyNames).map(([k, n]) => `<button class="btn ${f.difficulty === k ? 'active' : ''}" data-diff="${k}" style="min-width:96px;height:auto;min-height:46px;flex-direction:column;padding:4px 10px"><b>${n}</b><span class="small muted">OVR ${CONFIG.userStart.ovr[k]} 안팎</span></button>`).join('')}</div><div class="small muted" style="margin-top:4px">${DIFF_DESC[f.difficulty]} · 2군 평균 ${CONFIG.academy.mean}, 2군 에이스 ${CONFIG.academy.aces.r[0]}~${CONFIG.academy.aces.r[1]}</div></div>
          <div class="field"><label>플레이스타일 (강점 능력치 1~2개가 시작 기준보다 +5~10)</label><div class="col" style="gap:6px">${Object.keys(CONFIG.playstyles).map(s => `<button class="btn ${f.style === s ? 'active' : ''}" data-style="${s}" style="justify-content:flex-start;height:auto;min-height:46px;padding:6px 14px"><b>${s}</b><span class="small muted" style="margin-left:8px;white-space:normal;text-align:left">${STYLE_DESC[s]}</span></button>`).join('')}</div></div>
        </div>
        <div class="col" style="gap:10px">
          <div class="field"><label>주력 챔피언 3개 (${f.mains.length}/3)</label>
            <div class="pick-grid" style="max-height:420px">${champs.map(id => `<div class="pick-item ${f.mains.includes(id) ? 'sel' : ''}" data-c="${id}">${champIcon(id, 30)}<span>${esc(CHAMPIONS[id].name)}${f.mains.includes(id) ? ` <b class="gold">${f.mains.indexOf(id) + 1}</b>` : ''}</span></div>`).join('')}</div></div>
          <div class="field"><label>시드 (비워두면 무작위)</label><input class="inp" id="seed" style="font-size:15px;height:44px" placeholder="숫자 또는 문자" value="${esc(f.seed)}"></div>
          <div class="small muted">모든 선수와 같은 기준(포지션별 가중치)으로 만듭니다. 시작 OVR은 난이도에 따라 정해집니다. 잠재력·성장 속도·기복은 숨겨져 있고, 시간이 지나면 코치 평가로 알 수 있습니다.</div>
          <button class="btn primary" id="go" style="height:56px;font-size:18px">입단 테스트 보러 가기 ▶</button>
        </div>
      </div></div>`;
    const nick = root.querySelector('#nick');
    nick.addEventListener('input', () => { f.nick = nick.value; });
    root.querySelector('#nick-roll').addEventListener('click', () => { f.nick = suggestNick(); nick.value = f.nick; });
    root.querySelector('#seed').addEventListener('input', e => { f.seed = e.target.value; });
    root.querySelectorAll('[data-pos]').forEach(b => b.addEventListener('click', () => { if (f.pos !== b.dataset.pos) f.mains = []; f.pos = b.dataset.pos; draw(); }));
    root.querySelectorAll('[data-age]').forEach(b => b.addEventListener('click', () => { f.age = Number(b.dataset.age); draw(); }));
    root.querySelectorAll('[data-diff]').forEach(b => b.addEventListener('click', () => { f.difficulty = b.dataset.diff; draw(); }));
    root.querySelectorAll('[data-style]').forEach(b => b.addEventListener('click', () => { f.style = b.dataset.style; draw(); }));
    root.querySelectorAll('[data-c]').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.c;
      if (f.mains.includes(id)) f.mains = f.mains.filter(x => x !== id); else if (f.mains.length < 3) f.mains.push(id);
      draw();
    }));
    root.querySelector('#back').addEventListener('click', () => go('title'));
    root.querySelector('#go').addEventListener('click', () => {
      const n = f.nick.trim();
      if (n.length < 2) return toast('닉네임을 2자 이상 입력하세요.');
      if (isBlocked(n)) return toast('실존 프로 선수 닉네임은 사용할 수 없습니다.');
      if (f.mains.length < 3) return toast('주력 챔피언 3개를 고르세요.');
      const seed = f.seed.trim() || String(Date.now() % 1000000000);
      const { state, rng } = newWorld(seed);
      createUserPlayer(state, rng, { nick: n, pos: f.pos, age: f.age, style: f.style, mains: f.mains, difficulty: f.difficulty });
      App.state = state; App.rng = rng;
      go('offers');
    });
  };
  draw();
}
