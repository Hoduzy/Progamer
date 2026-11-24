// 서비스 워커 등록 + "업데이트가 있어요" 알림
// 로컬 서버(localhost)에서는 개발 중 캐시가 헷갈리지 않게 등록하지 않는다 (?sw=1 이면 등록).
export function initPWA() {
  if (!('serviceWorker' in navigator)) return;
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  if (local && !/[?&]sw=1/.test(location.search)) return;
  if (location.protocol !== 'https:' && !local) return;

  // 새 서비스 워커는 설치되자마자 바로 적용된다(skipWaiting + clients.claim).
  // 처음 접속 때도 controllerchange가 오는데, 그때 새로고침하면 진행 중인 화면이 날아가므로
  // 원래 관리하던 서비스 워커가 있었을 때(= 업데이트)만 "새 버전 적용됨 · 새로고침" 알림을 띄운다.
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    if (userAsked) { reloading = true; location.reload(); return; }
    if (hadController) showUpdate(null);
  });

  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
    // 앱을 오래 켜 두거나 홈 화면 앱으로 다시 돌아올 때도 새 버전 확인
    const check = () => reg.update().catch(() => { });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    setInterval(check, 30 * 60 * 1000);
  }).catch(e => console.warn('서비스 워커 등록 실패', e));
}

let userAsked = false, reloading = false;
function showUpdate(worker) {
  const root = document.getElementById('update-root');
  if (!root || root.querySelector('.upd')) return;
  const el = document.createElement('div');
  el.className = 'upd';
  el.innerHTML = `<span>${worker ? '업데이트가 있어요' : '새 버전이 적용됐어요'}</span><button class="btn sm primary" data-act="reload">새로고침</button><button class="btn sm ghost" data-act="later" aria-label="닫기">✕</button>`;
  root.appendChild(el);
  el.querySelector('[data-act=reload]').addEventListener('click', () => {
    el.querySelector('span').textContent = '업데이트 중…';
    userAsked = true;
    if (!worker) { reloading = true; location.reload(); return; }
    worker.postMessage('SKIP_WAITING');
    // 혹시 controllerchange가 오지 않으면 그냥 새로고침
    setTimeout(() => { if (!reloading) { reloading = true; location.reload(); } }, 3000);
  });
  el.querySelector('[data-act=later]').addEventListener('click', () => el.remove());
}

// 캐시 초기화: 서비스 워커 캐시·Data Dragon 데이터 캐시만 지우고 새로고침 (세이브·설정은 그대로)
export async function resetCaches() {
  try { if (window.caches) for (const k of await caches.keys()) if (k.startsWith('lckc-')) await caches.delete(k); } catch (e) { console.warn(e); }
  try { localStorage.removeItem('lckc.ddragon'); } catch { }
  try {
    if (navigator.serviceWorker) for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  } catch (e) { console.warn(e); }
  location.reload();
}
