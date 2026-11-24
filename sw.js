// 서비스 워커: 게임 파일은 버전별로 미리 캐시, Data Dragon 데이터·이미지는 한 번 받으면 보관
// 새 버전이 배포되면 새 워커가 "대기" 상태가 되고, 화면에 "업데이트가 있어요" 알림이 뜬다.
// 알림의 새로고침을 누르면 SKIP_WAITING → 새 버전으로 바뀐 뒤 페이지를 다시 불러온다.

// BUILD:BEGIN (node tools/build-pages.mjs 가 채움)
const VERSION = 'bc347f886cf9';
const FILES = [
  "./",
  "assets/teams/BFX.png",
  "assets/teams/BRO.png",
  "assets/teams/DK.png",
  "assets/teams/DNS.png",
  "assets/teams/DRX.png",
  "assets/teams/GEN.png",
  "assets/teams/HLE.png",
  "assets/teams/KT.png",
  "assets/teams/NS.png",
  "assets/teams/T1.png",
  "css/style.css",
  "data/champions.js",
  "data/commentary.js",
  "data/community.js",
  "data/events.js",
  "data/items.js",
  "data/map.js",
  "data/names.js",
  "data/scenarios.js",
  "data/sceneNeeds.js",
  "data/teams.js",
  "icons/icon-180.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "index.html",
  "js/assetList.js",
  "js/config.js",
  "js/core/rng.js",
  "js/core/util.js",
  "js/engine/awards.js",
  "js/engine/career.js",
  "js/engine/choices.js",
  "js/engine/combat.js",
  "js/engine/commentary.js",
  "js/engine/community.js",
  "js/engine/daily.js",
  "js/engine/draft.js",
  "js/engine/events.js",
  "js/engine/international.js",
  "js/engine/mapgeo.js",
  "js/engine/match.js",
  "js/engine/matchcore.js",
  "js/engine/meta.js",
  "js/engine/players.js",
  "js/engine/rating.js",
  "js/engine/roster.js",
  "js/engine/season.js",
  "js/engine/series.js",
  "js/engine/state.js",
  "js/engine/teamai.js",
  "js/engine/tournament.js",
  "js/engine/world.js",
  "js/ui/app.js",
  "js/ui/assets.js",
  "js/ui/dayFlow.js",
  "js/ui/draftScreen.js",
  "js/ui/hooks.js",
  "js/ui/layout.js",
  "js/ui/matchScreen.js",
  "js/ui/pwa.js",
  "js/ui/save.js",
  "js/ui/saveTransfer.js",
  "js/ui/screens/community.js",
  "js/ui/screens/contract.js",
  "js/ui/screens/create.js",
  "js/ui/screens/hub.js",
  "js/ui/screens/intlStandings.js",
  "js/ui/screens/offers.js",
  "js/ui/screens/pages.js",
  "js/ui/screens/standings.js",
  "js/ui/screens/testMatch.js",
  "js/ui/screens/title.js",
  "js/ui/seriesFlow.js",
  "manifest.json",
];
// BUILD:END

const CACHE = 'lckc-app-' + VERSION;
const DD_CACHE = 'lckc-ddragon';
const DD_MAX = 700;           // Data Dragon 항목 최대 개수 (오래된 것부터 지움)
const DD_HOST = 'ddragon.leagueoflegends.com';

self.addEventListener('install', e => {
  // cache: 'reload' — 브라우저 HTTP 캐시(Pages 기본 10분)를 건너뛰고 서버에서 새로 받는다
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('lckc-app-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
  if (e.data === 'VERSION' && e.source) e.source.postMessage({ type: 'VERSION', version: VERSION });
});

async function trimDD(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - DD_MAX; i++) await cache.delete(keys[i]);
}

async function fromApp(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  if (req.mode === 'navigate') {
    const idx = await cache.match('./') || await cache.match('index.html');
    if (idx) return idx;
  }
  return fetch(req);
}

// 네트워크가 잠깐 끊겨도 한 번 더 시도
async function fetchRetry(req) {
  try { return await fetch(req); } catch (err) { await new Promise(r => setTimeout(r, 400)); return fetch(req); }
}

async function fromDD(req, url, e) {
  const cache = await caches.open(DD_CACHE);
  // 버전 목록은 새 패치를 알기 위해 네트워크 먼저
  if (url.pathname.endsWith('/api/versions.json')) {
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(req);
      if (hit) return hit;
      throw err;
    }
  }
  // 나머지(버전이 들어간 주소)는 바뀌지 않으므로 캐시 먼저
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetchRetry(req);
  if (res.ok || res.type === 'opaque') {
    // 응답은 바로 돌려주고 저장은 뒤에서
    e.waitUntil(cache.put(req, res.clone()).then(() => trimDD(cache)).catch(() => { }));
  }
  return res;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (VERSION === 'dev') return;
    e.respondWith(fromApp(req));
  } else if (url.hostname === DD_HOST) {
    e.respondWith(fromDD(req, url, e));
  }
});
