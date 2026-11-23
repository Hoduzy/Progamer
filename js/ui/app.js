// 앱 셸: 화면 전환, 배율 조정, 모달, 토스트
import { initAssets, DD } from './assets.js';
import { esc } from '../core/util.js';

const screens = {};
export function registerScreen(name, mod) { screens[name] = mod; }

export const App = {
  state: null,        // GameState (진행 중인 게임)
  current: null,
  params: null,
  settings: loadSettings(),
};

function loadSettings() {
  const def = { showBigEvents: true, defaultSpeed: 1, autoSkipBigEvents: false, debugMatch: false };
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

// ---------- 배율 ----------
function fit() {
  const st = document.getElementById('stage');
  const s = Math.min(window.innerWidth / 1180, window.innerHeight / 820);
  st.style.transform = `scale(${s})`;
}
window.addEventListener('resize', fit);

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
  await initAssets();
  window.__DD = DD;
  window.__app = { App, go };
  go('title');
}
window.addEventListener('error', e => console.error('[error]', e.message));
boot();
