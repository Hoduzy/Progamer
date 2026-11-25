// 서비스 워커: 게임 파일은 버전별로 미리 캐시, Data Dragon 데이터·이미지는 한 번 받으면 보관
// 새 버전이 배포되면 새 워커가 "대기" 상태가 되고, 화면에 "업데이트가 있어요" 알림이 뜬다.
// 알림의 새로고침을 누르면 SKIP_WAITING → 새 버전으로 바뀐 뒤 페이지를 다시 불러온다.

// BUILD:BEGIN (node tools/build-pages.mjs 가 채움)
const VERSION = '06cb0efbce43';
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
  "data/navgraph.js",
  "data/objScenes.js",
  "data/rosters.js",
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
  "js/engine/behavior.js",
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
  "js/engine/nav.js",
  "js/engine/objScenes.js",
  "js/engine/players.js",
  "js/engine/rating.js",
  "js/engine/roster.js",
  "js/engine/season.js",
  "js/engine/series.js",
  "js/engine/state.js",
  "js/engine/teamai.js",
  "js/engine/tournament.js",
  "js/engine/world.js",
  "js/stats.js",
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
// v3: 사파리에서 이미지 응답이 실패로 처리되던 서비스 워커를 교체하면서 이미지 캐시도 새로 시작
const DD_CACHE = 'lckc-img-v3';
const DD_MAX = 900;           // 이미지·데이터 항목 최대 개수 (오래된 것부터 지움)
const IMG_HOSTS = ['ddragon.leagueoflegends.com', 'raw.communitydragon.org'];

self.addEventListener('install', e => {
  // cache: 'reload' — 브라우저 HTTP 캐시(Pages 기본 10분)를 건너뛰고 서버에서 새로 받는다
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))));
  self.skipWaiting();   // 새 서비스 워커를 기다리지 않고 바로 적용
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
  if (e.data === 'VERSION' && e.source) e.source.postMessage({ type: 'VERSION', version: VERSION, imgCache: DD_CACHE });
});

async function trimDD(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - DD_MAX; i++) await cache.delete(keys[i]);
}
// 캐시 저장은 응답과 따로 (사파리는 응답을 돌려준 뒤 e.waitUntil()을 부르면 오류를 던져 응답 전체가 실패한다)
function store(cacheName, key, res) {
  caches.open(cacheName).then(c => c.put(key, res).then(() => (cacheName === DD_CACHE ? trimDD(c) : null))).catch(() => { });
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

// 다른 도메인(Data Dragon·Community Dragon): 네트워크 먼저, 실패하면 캐시. 둘 다 실패할 때만 에러를 넘긴다.
async function fromRemote(req, url) {
  const key = keyOf(req.url);
  const isImg = /\.(png|jpe?g|webp|gif)$/i.test(url.pathname) || req.destination === 'image';
  let res = null;
  try { res = await fetch(req); } catch (err) { res = null; }
  // 저장 조건: 이미지는 200 또는 불투명 응답(no-cors로 받은 이미지), 데이터는 200만
  if (res && (res.status === 200 || (isImg && res.type === 'opaque'))) {
    store(DD_CACHE, key, res.clone());
    return res;
  }
  const hit = await caches.open(DD_CACHE).then(c => c.match(key)).catch(() => null);
  if (hit) return hit;
  if (res) return res;                       // 404 등은 그대로 (화면의 로더가 다시 시도)
  return Response.error();
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (VERSION === 'dev') return;
    e.respondWith(fromApp(req));
  } else if (IMG_HOSTS.includes(url.hostname)) {
    e.respondWith(fromRemote(req, url));
  }
});
