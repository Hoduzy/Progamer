// 앱 셸: 화면 전환, 배율 조정, 모달, 토스트
import { initAssets, DD } from './assets.js';
import { esc } from '../core/util.js';
import { initPWA } from './pwa.js';
import { initImageLoader, setImgDebug } from './imgLoader.js';

const screens = {};
export function registerScreen(name, mod) { screens[name] = mod; }

export const App = {
  state: null,        // GameState (진행 중인 게임)
  current: null,
  params: null,
  settings: loadSettings(),
};

function loadSettings() {
  const def = { showBigEvents: true, defaultSpeed: 1, autoSkipBigEvents: false, debugMatch: false, moveTrails: false, autoRoutine: false, communityTone: 'spicy' };
  try { return { ...def, ...JSON.parse(localStorage.getItem('lckc.settings') || '{}') }; } catch { return def; }
}
export function saveSettings() { try { localStorage.setItem('lckc.settings', JSON.stringify(App.settings)); } catch { } }

let cleanup = null;
export function go(name, params = {}) {
  if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
  closeModal();
  App.current = name; App.params = params;
  const root = document.getElementById('app');
  root.innerHTML = '';
  const mod = screens[name];
  if (!mod) { root.innerHTML = `<div class="boot">화면 없음: ${esc(name)}</div>`; return; }
  const r = mod.render(root, params);
  if (typeof r === 'function') cleanup = r;
  fit();
}
export function rerender() { go(App.current, App.params); }

// ---------- 모달 ----------
export function modal({ title = '', body = '', buttons = [{ label: '확인', primary: true }], wide = false, onOpen = null, dismiss = false }) {
  return new Promise(resolve => {
    const root = document.getElementById('modal-root');
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal ${wide ? 'wide' : ''}">
      ${title ? `<div class="modal-head">${title}</div>` : ''}
      <div class="modal-body">${body}</div>
      ${buttons.length ? `<div class="modal-foot">${buttons.map((b, i) => `<button class="btn ${b.primary ? 'primary' : ''} ${b.danger ? 'danger' : ''}" data-i="${i}" ${b.disabled ? 'disabled' : ''}>${b.label}</button>`).join('')}</div>` : ''}
    </div>`;
    root.appendChild(bg);
    const close = v => { bg.remove(); resolve(v); };
    bg.querySelectorAll('.modal-foot .btn').forEach(btn => btn.addEventListener('click', () => {
      const b = buttons[Number(btn.dataset.i)];
      const v = b.value !== undefined ? b.value : Number(btn.dataset.i);
      if (b.onClick) { const keep = b.onClick(bg); if (keep === false) return; }
      close(v);
    }));
    if (dismiss) bg.addEventListener('click', e => { if (e.target === bg) close(null); });
    bg._close = close;
    if (onOpen) onOpen(bg, close);
  });
}
export function closeModal() {
  const root = document.getElementById('modal-root');
  if (root) root.querySelectorAll('.modal-bg').forEach(m => (m._close ? m._close(null) : m.remove()));
}
export function toast(msg, ms = 2200) {
  const root = document.getElementById('toast-root');
  const t = document.createElement('div');
  t.className = 'toast'; t.innerHTML = msg;
  root.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

// ---------- 배율 / 화면 모드 ----------
// 태블릿·PC: 1180×820 기준 화면을 통째로 배율 조정 (기존 방식)
// 폰: 배율을 줄이면 글자가 너무 작아지므로 화면 크기 그대로 쓰는 반응형 배치
//   html.ph + .pt(세로) / .pl(가로), #stage 에 --W --H 와 경기 화면 배치 변수
export function fit() {
  const vp = document.getElementById('viewport');
  const st = document.getElementById('stage');
  if (!vp || !st) return;
  const cs = getComputedStyle(vp);
  const W = vp.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const H = vp.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const s = Math.min(W / 1180, H / 820);
  const phone = s < 0.6;
  const de = document.documentElement;
  de.classList.toggle('ph', phone);
  de.classList.toggle('pt', phone && H >= W);
  de.classList.toggle('pl', phone && H < W);
  if (!phone) {
    st.style.cssText = `transform:scale(${s})`;
    return;
  }
  const v = { W, H };
  // 경기 화면 배치 (세로: 스코어보드 → 선수 아이콘 줄 → 미니맵 → 자막 → 버튼 → 맞대결 패널)
  const m = document.querySelector('.match');
  const bpOpen = !(m && m.classList.contains('bp-closed'));
  if (H >= W) {
    const sbH = 50, rowH = 50, capH = 32, ctlH = 48;
    const bpH = bpOpen ? 160 : 34;
    const mmTop = sbH + rowH + 4;
    const mm = Math.max(180, Math.min(W - 12, H - mmTop - capH - ctlH - bpH - 12));
    Object.assign(v, { mm, mmTop, mmLeft: (W - mm) / 2, capTop: mmTop + mm + 4, ctlTop: mmTop + mm + capH + 8, bpH });
  } else {
    // 가로: 왼쪽 미니맵, 오른쪽에 스코어보드·아이콘 줄·자막·버튼·패널
    const mm = Math.max(180, Math.min(H - 8, W * 0.46));
    const colL = mm + 10;
    const bpH = bpOpen ? Math.max(90, H - 50 - 50 - 32 - 48 - 16) : 34;
    Object.assign(v, { mm, mmTop: (H - mm) / 2, mmLeft: 4, colL, capTop: 104, ctlTop: 140, bpH });
  }
  v.mms = v.mm / 520;
  st.style.cssText = Object.entries(v).map(([k, x]) => `--${k}:${Math.round(x * 1000) / 1000}${k === 'mms' ? '' : 'px'}`).join(';');
}
window.addEventListener('resize', fit);
window.addEventListener('orientationchange', () => setTimeout(fit, 250));

// ---------- 시작 ----------
async function boot() {
  fit();
  const mods = await Promise.all([
    import('./screens/title.js'),
    import('./matchScreen.js'),
    import('./screens/testMatch.js'),
    import('./draftScreen.js'),
    import('./screens/create.js'),
    import('./screens/offers.js'),
    import('./screens/hub.js'),
    import('./screens/pages.js'),
    import('./screens/standings.js'),
    import('./screens/community.js'),
    import('./screens/intlStandings.js'),
    import('./screens/contract.js'),
  ]);
  for (const m of mods) if (m.register) m.register(registerScreen);
  initImageLoader();
  await initAssets();
  setImgDebug(!!App.settings.debugMatch);
  window.__DD = DD;
  window.__app = { App, go };
  go('title');
  initPWA();
}
window.addEventListener('error', e => console.error('[error]', e.message));
boot();
