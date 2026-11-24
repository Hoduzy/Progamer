// 서비스 워커: 게임 파일은 버전별로 미리 캐시, Data Dragon 데이터·이미지는 한 번 받으면 보관
// 새 버전이 배포되면 새 워커가 "대기" 상태가 되고, 화면에 "업데이트가 있어요" 알림이 뜬다.
// 알림의 새로고침을 누르면 SKIP_WAITING → 새 버전으로 바뀐 뒤 페이지를 다시 불러온다.

// BUILD:BEGIN (node tools/build-pages.mjs 가 채움)
const VERSION = '1cfb9c6c20ba';
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
  "data/community/bodies.js",
  "data/community/comments.js",
  "data/community/index.js",
  "data/community/interview.js",
  "data/community/replies.js",
  "data/community/titles.js",
  "data/community/users.js",
  "data/community/words.js",
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
  "js/ui/imgLoader.js",
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
// v2: 예전 캐시에는 실패한 응답(opaque)까지 저장돼 있을 수 있어 이름을 바꿔 한 번 비운다
const DD_CACHE = 'lckc-img-v2';
const DD_MAX = 900;           // 이미지·데이터 항목 최대 개수 (오래된 것부터 지움)
const IMG_HOSTS = ['ddragon.leagueoflegends.com', 'raw.communitydragon.org'];

self.addEventListener('install', e => {
  // cache: 'reload' — 브라우저 HTTP 캐시(Pages 기본 10분)를 건너뛰고 서버에서 새로 받는다
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) {
      if (k.startsWith('lckc-app-') && k !== CACHE) await caches.delete(k);
      if ((k === 'lckc-ddragon' || k.startsWith('lckc-img-')) && k !== DD_CACHE) await caches.delete(k);
    }
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

// 캐시 키: 다시 시도용 ?r=n 은 떼고 저장 (같은 이미지)
function keyOf(url) { const u = new URL(url); u.searchParams.delete('r'); return u.toString(); }

async function fromDD(req, url, e) {
  const cache = await caches.open(DD_CACHE);
  // 버전 목록은 새 패치를 알기 위해 네트워크 먼저
  if (url.pathname.endsWith('/api/versions.json')) {
    try {
      const res = await fetch(req);
      if (res.status === 200 && res.type !== 'opaque') cache.put(req, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(req);
      if (hit) return hit;
      throw err;
    }
  }
  // 나머지(버전이 들어간 주소)는 바뀌지 않으므로 캐시 먼저
  const key = keyOf(req.url);
  const hit = await cache.match(key);
  if (hit) return hit;
  const res = await fetch(req);   // 실패하면 그대로 실패 → 화면의 이미지 로더가 1·3·8초 뒤 다시 시도
  // 성공(200)만 저장. 상태를 알 수 없는 opaque 응답이나 오류 응답은 저장하지 않는다
  if (res.status === 200 && res.type !== 'opaque') {
    e.waitUntil(cache.put(key, res.clone()).then(() => trimDD(cache)).catch(() => { }));
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
  } else if (IMG_HOSTS.includes(url.hostname)) {
    e.respondWith(fromDD(req, url, e));
  }
});
