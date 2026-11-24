// 서비스 워커 등록 + "업데이트가 있어요" 알림
// 로컬 서버(localhost)에서는 개발 중 캐시가 헷갈리지 않게 등록하지 않는다 (?sw=1 이면 등록).
export function initPWA() {
  if (!('serviceWorker' in navigator)) return;
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  if (local && !/[?&]sw=1/.test(location.search)) return;
  if (location.protocol !== 'https:' && !local) return;

  // 처음 접속할 때도 서비스 워커가 자리를 잡으면서 controllerchange가 온다.
  // 그때 새로고침하면 진행 중인 화면이 날아가므로, 사용자가 "새로고침"을 누른 경우에만 다시 불러온다.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!userAsked || reloading) return;
    reloading = true;
    location.reload();
  });

  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
    const offer = w => { if (w && navigator.serviceWorker.controller) showUpdate(w); };
    if (reg.waiting) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (!w) return;
      w.addEventListener('statechange', () => { if (w.state === 'installed') offer(w); });
    });
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
  el.innerHTML = `<span>업데이트가 있어요</span><button class="btn sm primary" data-act="reload">새로고침</button><button class="btn sm ghost" data-act="later" aria-label="닫기">✕</button>`;
  root.appendChild(el);
  el.querySelector('[data-act=reload]').addEventListener('click', () => {
    el.querySelector('span').textContent = '업데이트 중…';
    userAsked = true;
    worker.postMessage('SKIP_WAITING');
    // 혹시 controllerchange가 오지 않으면 그냥 새로고침
    setTimeout(() => { if (!reloading) { reloading = true; location.reload(); } }, 3000);
  });
  el.querySelector('[data-act=later]').addEventListener('click', () => el.remove());
}
