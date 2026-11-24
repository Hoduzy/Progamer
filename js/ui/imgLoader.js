// 이미지 로더: 챔피언·아이템·주문 아이콘을 줄 세워 불러온다
//  - 동시에 최대 N개 (아이패드 사파리에서 한꺼번에 요청하면 일부가 실패함)
//  - 화면에 보이는 칸부터 (IntersectionObserver), 스크롤하면 나머지
//  - 실패하면 1초·3초·8초 뒤 다시 시도, 그래도 안 되면 Community Dragon에서 한 번, 그래도 안 되면 이니셜
//  - 실패 기록은 어디에도 저장하지 않는다 (화면을 다시 열면 새 <img>라서 처음부터 다시 시도)
//  화면 코드는 <img class="lz" data-k="champ|item|spell" data-id="..."> 만 그리면 된다 (assets.js imgOr)
import { CONFIG } from '../config.js';

const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
export const IMG_STATS = { ok: 0, retrying: new Map(), failed: new Map(), inflight: 0, queued: 0 };
// 이번 세션에 성공한 주소 (성공만 기억 — 다시 그릴 때 깜빡이지 않게 바로 그린다)
const loaded = new Map();
export function loadedUrl(kind, id) { return loaded.get(kind + ':' + id) || null; }
// 같은 이미지를 기다리는 다른 칸들 (요청은 하나만 보내고 결과를 나눠 씀)
const active = new Map();    // key → [ { el?, onDone? } ]
function settle(key, url) {
  const ws = active.get(key) || [];
  active.delete(key);
  for (const w of ws) {
    if (w.el && w.el.isConnected) {
      if (url) { w.el.crossOrigin = 'anonymous'; w.el.src = url; w.el.classList.remove('lz'); w.el.classList.add('ld'); }
      else if (window.__fb) window.__fb(w.el);
    }
    if (w.onDone) w.onDone(!!url);
  }
}
// key 에 대한 요청이 이미 진행 중이면 기다리는 쪽에 붙이고 true
function joinActive(key, w) {
  if (!active.has(key)) { active.set(key, []); return false; }
  active.get(key).push(w);
  return true;
}

let resolver = null;          // (kind, id) → { urls: [주 주소, 예비 주소…] } — assets.js가 Data Dragon 준비 후 설정
let readyResolve;
const ready = new Promise(r => { readyResolve = r; });
export function setResolver(fn) { resolver = fn; readyResolve(); }

const C = () => CONFIG.ui.images;
const queue = [];             // { el?, urls, ui (현재 주소 번호), tries, onDone? }
let io = null;

// ---------- 줄 세우기 ----------
function enqueue(job, front = false) {
  if (front) queue.unshift(job); else queue.push(job);
  IMG_STATS.queued = queue.length;
  pump();
}
function pump() {
  while (IMG_STATS.inflight < C().concurrency && queue.length) {
    const job = queue.shift();
    IMG_STATS.queued = queue.length;
    if (job.el && !job.el.isConnected) {            // 화면이 바뀌어 사라진 칸 → 같은 이미지를 기다리는 다른 칸이 이어받음
      const ws = job.key ? active.get(job.key) || [] : [];
      const i = ws.findIndex(w => w.el && w.el.isConnected);
      if (i >= 0) job.el = ws.splice(i, 1)[0].el;
      else if (ws.some(w => w.onDone)) job.el = null;
      else { if (job.key) active.delete(job.key); continue; }
    }
    start(job);
  }
}
function attemptUrl(job) {
  const u = job.urls[job.ui];
  return job.tries > 0 ? u + (u.includes('?') ? '&' : '?') + 'r=' + job.tries : u;   // 다시 시도할 땐 주소를 살짝 바꿔 브라우저 메모리 캐시를 피함
}
function start(job) {
  IMG_STATS.inflight++;
  const url = attemptUrl(job);
  const img = job.el || new Image();
  let done = false;
  const finish = ok => {
    if (done) return; done = true;
    IMG_STATS.inflight--;
    img.onload = img.onerror = null;
    if (ok) {
      IMG_STATS.ok++;
      IMG_STATS.retrying.delete(job.urls[0]);
      if (job.key) loaded.set(job.key, url);
      if (job.el) { job.el.classList.remove('lz'); job.el.classList.add('ld'); }
      if (job.onDone) job.onDone(true);
      if (job.key) settle(job.key, url);
    } else fail(job, url);
    pump();
  };
  img.onload = () => finish(img.naturalWidth > 0);
  img.onerror = () => finish(false);
  img.crossOrigin = 'anonymous';
  img.src = url;
}
function fail(job, url) {
  console.warn(`[img] 불러오기 실패: ${url} (주소 ${job.ui + 1}/${job.urls.length}, 시도 ${job.tries + 1})`);
  const delays = C().retryDelays;
  if (job.ui === 0 && job.tries < delays.length) {
    IMG_STATS.retrying.set(job.urls[0], job.tries + 1);
    const wait = delays[job.tries];
    job.tries++;
    setTimeout(() => enqueue(job, true), wait);
    return;
  }
  if (job.ui + 1 < job.urls.length) {           // 예비 서버 (Community Dragon) 한 번
    job.ui++; job.tries = 0;
    enqueue(job, true);
    return;
  }
  IMG_STATS.retrying.delete(job.urls[0]);
  IMG_STATS.failed.set(job.urls[0], job.urls.slice());
  if (job.el && job.el.isConnected && window.__fb) window.__fb(job.el);
  if (job.onDone) job.onDone(false);
  if (job.key) settle(job.key, null);
}

// ---------- 화면의 <img class="lz"> 찾기 ----------
function register(el) {
  if (el.dataset.lzq) return;
  el.dataset.lzq = '1';
  if (io) io.observe(el); else ready.then(() => queueEl(el));
}
function queueEl(el, front = false) {
  if (!resolver || !el.isConnected) return;
  const r = resolver(el.dataset.k, el.dataset.id);
  if (!r || !r.urls.length) { if (window.__fb) window.__fb(el); return; }
  const key = el.dataset.k + ':' + el.dataset.id;
  const done = loaded.get(key);
  if (done) { el.crossOrigin = 'anonymous'; el.src = done; el.classList.remove('lz'); el.classList.add('ld'); return; }
  if (joinActive(key, { el })) {
    // 미리 받기 줄에 뒤처져 있던 같은 이미지라면 앞으로 당긴다
    const i = queue.findIndex(j => j.key === key && !j.el);
    if (i > 0) queue.unshift(queue.splice(i, 1)[0]);
    return;
  }
  enqueue({ el, key, urls: r.urls, ui: 0, tries: 0 }, front);
}
function scan(root) {
  if (root.nodeType !== 1) return;
  if (root.matches && root.matches('img.lz')) register(root);
  if (root.querySelectorAll) root.querySelectorAll('img.lz').forEach(register);
}
export function initImageLoader() {
  if (typeof IntersectionObserver !== 'undefined') {
    io = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        const el = e.target;
        ready.then(() => queueEl(el, true));     // 보이는 칸은 미리 받기보다 먼저
      }
    }, { rootMargin: '150px' });
  }
  new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) scan(n); }).observe(document.body, { childList: true, subtree: true });
  scan(document.body);
}

// ---------- 챔피언 아이콘 미리 받기 (게임 시작 화면) ----------
let preloadState = null;
export function preloadIcons(list, onProgress) {
  if (preloadState) { preloadState.cb = onProgress; onProgress(preloadState.done, preloadState.total, preloadState.fail); return; }
  preloadState = { done: 0, total: list.length, fail: 0, cb: onProgress };
  ready.then(() => {
    for (const [kind, id] of list) {
      const r = resolver(kind, id);
      const key = kind + ':' + id;
      if (!r || !r.urls.length || loaded.has(key)) { preloadState.done++; continue; }
      const onDone = ok => { preloadState.done++; if (!ok) preloadState.fail++; if (preloadState.cb) preloadState.cb(preloadState.done, preloadState.total, preloadState.fail); };
      if (joinActive(key, { onDone })) continue;
      enqueue({ key, urls: r.urls, ui: 0, tries: 0, onDone });
    }
    if (preloadState.cb) preloadState.cb(preloadState.done, preloadState.total, preloadState.fail);
  });
}
export const BLANK_SRC = BLANK;

// ---------- 디버그: 이미지 상태 패널 ----------
let dbgTimer = null;
export function setImgDebug(on) {
  let btn = document.getElementById('img-dbg-btn');
  if (!on) { if (btn) btn.remove(); const p = document.getElementById('img-dbg'); if (p) p.remove(); clearInterval(dbgTimer); return; }
  if (btn) return;
  btn = document.createElement('button');
  btn.id = 'img-dbg-btn'; btn.className = 'btn sm'; btn.textContent = '🖼 이미지';
  document.body.appendChild(btn);
  btn.addEventListener('click', () => {
    let p = document.getElementById('img-dbg');
    if (p) { p.remove(); clearInterval(dbgTimer); return; }
    p = document.createElement('div'); p.id = 'img-dbg';
    document.body.appendChild(p);
    const draw = () => {
      const S = IMG_STATS;
      p.innerHTML = `<div class="row between"><b>이미지 상태</b><span class="tiny dim">동시 ${S.inflight}/${C().concurrency} · 대기 ${S.queued}</span></div>
        <div class="small" style="margin:4px 0">성공 <b class="pos">${S.ok}</b> · 재시도 중 <b class="warn">${S.retrying.size}</b> · 실패 <b class="neg">${S.failed.size}</b></div>
        ${S.retrying.size ? `<div class="tiny dim">재시도 중</div>${[...S.retrying].slice(0, 10).map(([u, n]) => `<div class="tiny mono">${n}회 · ${u.replace(/^https:\/\//, '')}</div>`).join('')}` : ''}
        ${S.failed.size ? `<div class="tiny neg" style="margin-top:4px">실패 (주 주소 → 예비 주소까지 모두)</div>${[...S.failed.values()].slice(0, 30).map(us => `<div class="tiny mono">${us.map(u => u.replace(/^https:\/\//, '')).join(' → ')}</div>`).join('')}` : ''}`;
    };
    draw(); clearInterval(dbgTimer); dbgTimer = setInterval(draw, 1000);
  });
}
