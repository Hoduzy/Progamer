// ============================================================
//  길찾기: 미니맵 이동 그래프(data/navgraph.js) 위 A* → 직선 당기기 → Catmull-Rom 곡선
//  걸을 수 있는 격자(MASK)로 벽 판정. 경로의 모든 점·구간은 벽을 지나지 않는다.
//  DOM 의존 없음
// ============================================================
import { MASK, MASK_N, NODES, EDGES } from '../../data/navgraph.js';

const N = MASK_N;
// ---------- 격자 ----------
export const grid = (() => {
  const raw = typeof atob === 'function' ? Uint8Array.from(atob(MASK), c => c.charCodeAt(0)) : Uint8Array.from(Buffer.from(MASK, 'base64'));
  const out = new Uint8Array(N * N);
  let i = 0, v = 0;
  for (const r of raw) { if (v) out.fill(1, i, i + r); i += r; v ^= 1; }
  return out;
})();
// 벽까지 거리(칸)
const clear = (() => {
  const c = new Int16Array(N * N).fill(999), q = [];
  for (let i = 0; i < N * N; i++) if (!grid[i]) { c[i] = 0; q.push(i); }
  for (let h = 0; h < q.length; h++) {
    const i = q[h], x = i % N, y = (i / N) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const j = ny * N + nx;
      if (c[j] > c[i] + 1) { c[j] = c[i] + 1; q.push(j); }
    }
  }
  return c;
})();
const ci = (x, y) => Math.min(N - 1, Math.max(0, Math.floor(y * N))) * N + Math.min(N - 1, Math.max(0, Math.floor(x * N)));
export const walkable = (x, y) => x > 0 && y > 0 && x < 1 && y < 1 && grid[ci(x, y)] === 1;
export const clearance = (x, y) => (x > 0 && y > 0 && x < 1 && y < 1 ? clear[ci(x, y)] : 0);
// 두 점 사이 직선이 길 위인가 (need: 벽에서 떨어진 칸 수)
// 반 칸 간격으로 본다 (clearance를 풀어 쓴 것 — 같은 점을 보고 같은 결과)
export function segWalkable(ax, ay, bx, by, need = 1) {
  const d = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(d * N * 2));
  const dx = bx - ax, dy = by - ay;
  for (let k = 0; k <= n; k++) {
    const x = ax + dx * k / n, y = ay + dy * k / n;
    if (!(x > 0 && y > 0 && x < 1 && y < 1)) { if (need > 0) return false; continue; }
    const cx = Math.floor(x * N), cy = Math.floor(y * N);
    if (clear[(cy < N ? cy : N - 1) * N + (cx < N ? cx : N - 1)] < need) return false;
  }
  return true;
}
// 가장 가까운 걸을 수 있는 지점 (벽에서 need칸)
export function snap(x, y, need = 2) {
  if (clearance(x, y) >= need) return [x, y];
  const cx = Math.min(N - 1, Math.max(0, Math.floor(x * N))), cy = Math.min(N - 1, Math.max(0, Math.floor(y * N)));
  for (let r = 1; r < 48; r++) {
    let best = null, bd = Infinity;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const gx = cx + dx, gy = cy + dy;
      if (gx < 0 || gy < 0 || gx >= N || gy >= N || clear[gy * N + gx] < need) continue;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = [(gx + 0.5) / N, (gy + 0.5) / N]; }
    }
    if (best) return best;
  }
  return [x, y];
}

// ---------- 그래프 ----------
export const nodes = NODES;
const adj = NODES.map(() => []);
for (const [a, b] of EDGES) {
  const d = Math.hypot(NODES[a][0] - NODES[b][0], NODES[a][1] - NODES[b][1]);
  adj[a].push([b, d]); adj[b].push([a, d]);
}
// 노드 공간 해시 (16×16)
const B = 16, bucket = Array.from({ length: B * B }, () => []);
NODES.forEach((n, i) => bucket[Math.min(B - 1, Math.floor(n[1] * B)) * B + Math.min(B - 1, Math.floor(n[0] * B))].push(i));
function nearNodes(x, y, k = 6) {
  const bx = Math.floor(x * B), by = Math.floor(y * B), out = [];
  for (let r = 0; r < B && out.length < k * 3; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const gx = bx + dx, gy = by + dy;
      if (gx < 0 || gy < 0 || gx >= B || gy >= B) continue;
      for (const i of bucket[gy * B + gx]) out.push([Math.hypot(NODES[i][0] - x, NODES[i][1] - y), i]);
    }
  }
  out.sort((a, b) => a[0] - b[0]);
  const vis = [];
  for (const [d, i] of out) { if (segWalkable(x, y, NODES[i][0], NODES[i][1], 1)) vis.push([d, i]); if (vis.length >= k) break; }
  return vis.length ? vis : out.slice(0, 1);
}
export function nodesOfType(type) { return NODES.map((n, i) => [n, i]).filter(([n]) => n[2] === type); }

// A*: 시작점 → 근처 노드들 → … → 목표 근처 노드들 → 목표
// 탐색 상태는 미리 만든 배열을 세대 번호로 다시 쓴다 (탐색마다 Map·배열을 새로 만들지 않게)
const NN = NODES.length;
const gArr = new Float64Array(NN), cameArr = new Int32Array(NN), goalArr = new Float64Array(NN);
const seenGen = new Uint32Array(NN), closedGen = new Uint32Array(NN), goalGen = new Uint32Array(NN);
const hx = Float64Array.from(NODES, n => n[0]), hy = Float64Array.from(NODES, n => n[1]);
const adjTo = adj.map(l => Int32Array.from(l, e => e[0])), adjD = adj.map(l => Float64Array.from(l, e => e[1]));
let gen = 0;
const heapF = new Float64Array(NN * 8), heapV = new Int32Array(NN * 8);
function astar(sx, sy, tx, ty, heading) {
  if (++gen >= 0xffffffff) { gen = 1; seenGen.fill(0); closedGen.fill(0); goalGen.fill(0); }
  const starts = nearNodes(sx, sy);
  for (const [d, i] of nearNodes(tx, ty)) { goalGen[i] = gen; goalArr[i] = d; }
  let hn = 0;
  const push = (f, v) => {
    let i = hn++;
    while (i > 0) { const pa = (i - 1) >> 1; if (heapF[pa] <= f) break; heapF[i] = heapF[pa]; heapV[i] = heapV[pa]; i = pa; }
    heapF[i] = f; heapV[i] = v;
  };
  const pop = () => {
    const v = heapV[0], lf = heapF[--hn], lv = heapV[hn];
    let i = 0;
    for (;;) {
      const l = 2 * i + 1; if (l >= hn) break;
      const r = l + 1, m = r < hn && heapF[r] < heapF[l] ? r : l;
      if (heapF[m] >= lf) break;
      heapF[i] = heapF[m]; heapV[i] = heapV[m]; i = m;
    }
    heapF[i] = lf; heapV[i] = lv;
    return v;
  };
  for (let [d, i] of starts) {
    // 지금 가던 방향 뒤쪽 노드로 시작하면 비용을 더한다 (갈림길에서 경로를 다시 찾을 때 되돌아가지 않게)
    if (heading) { const dx = hx[i] - sx, dy = hy[i] - sy, l = Math.hypot(dx, dy) || 1; if ((dx * heading[0] + dy * heading[1]) / l < -0.2) d += 0.12; }
    if (seenGen[i] === gen && gArr[i] <= d) continue;
    seenGen[i] = gen; gArr[i] = d; cameArr[i] = -1;
    push(d + Math.hypot(hx[i] - tx, hy[i] - ty), i);
  }
  let best = -1, bestCost = Infinity;
  while (hn > 0) {
    const f = heapF[0], v = pop();
    if (f >= bestCost) break;
    if (closedGen[v] === gen) continue;
    closedGen[v] = gen;
    const gv = gArr[v];
    if (goalGen[v] === gen) { const c = gv + goalArr[v]; if (c < bestCost) { bestCost = c; best = v; } }
    const to = adjTo[v], dd = adjD[v];
    for (let k = 0; k < to.length; k++) {
      const u = to[k], ng = gv + dd[k];
      if (seenGen[u] !== gen || ng < gArr[u]) {
        seenGen[u] = gen; gArr[u] = ng; cameArr[u] = v;
        if (hn < heapF.length) push(ng + Math.hypot(hx[u] - tx, hy[u] - ty), u);
      }
    }
  }
  if (best < 0) return null;
  const path = [];
  for (let v = best; v >= 0; v = cameArr[v]) path.push([hx[v], hy[v]]);
  return path.reverse();
}

// 경로: 점 목록 (시작 제외, 목표 포함). 직선으로 갈 수 있으면 바로
export function findPath(sx, sy, tx, ty, heading = null) {
  [tx, ty] = snap(tx, ty, 1);
  if (segWalkable(sx, sy, tx, ty, 1)) return [[tx, ty]];
  const mid = astar(sx, sy, tx, ty, heading);
  if (!mid) return [[tx, ty]];
  let pts = [[sx, sy], ...mid, [tx, ty]];
  // 직선 당기기: 보이는 가장 먼 점으로
  const pulled = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !segWalkable(pts[i][0], pts[i][1], pts[j][0], pts[j][1], 2)) j--;
    pulled.push(pts[j]); i = j;
  }
  return smooth(pulled).slice(1);
}
// Catmull-Rom 곡선 (꺾이는 곳을 둥글게). 곡선 조각이 벽에 닿으면 그 구간은 직선 그대로
function smooth(pts) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.max(1, Math.round(len / 0.012));
    const seg = [];
    for (let k = 1; k <= n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      seg.push([0, 1].map(d => 0.5 * ((2 * p1[d]) + (-p0[d] + p2[d]) * t + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t2 + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * t3)));
    }
    let ok = true, prev = p1;
    for (const q of seg) { if (!segWalkable(prev[0], prev[1], q[0], q[1], 1)) { ok = false; break; } prev = q; }
    if (ok) out.push(...seg); else out.push(p2);
  }
  return out;
}
