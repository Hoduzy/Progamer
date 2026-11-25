// 미니맵 이동 그래프 만들기: 소환사의 협곡 미니맵 이미지(map11.png)에서 걸을 수 있는 곳(밝은 픽셀)을 읽어
// 256×256 격자(MASK)와 노드·간선(NODES·EDGES)을 data/navgraph.js 로 쓴다.
// 사용: node tools/build-navgraph.mjs [지도 PNG=frames/.map11.png]
//   노드 = 이름 붙은 지점(라인·강·캠프·둥지 입구·기지 출입구·포탑 앞·부쉬·시야 지점) + 정글 통로를 채우는 점
//   간선 = 두 노드 사이 직선이 벽에서 1칸 이상 떨어져 걸을 수 있을 때만
import { readFileSync, writeFileSync } from 'fs';
import { inflateSync } from 'zlib';
import * as M from '../data/map.js';

const FILE = process.argv[2] || 'frames/.map11.png';
const N = 256;                       // 격자 크기
const THR = 45;                      // 밝기 기준 (이보다 어두우면 벽)

function decodePNG(buf) {
  let pos = 8, w, h, ct; const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString('ascii', pos + 4, pos + 8), data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; }
    if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = ct === 6 ? 4 : 3, stride = w * bpp, out = Buffer.alloc(w * h * bpp);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0, b = y ? out[(y - 1) * stride + x] : 0, c = x >= bpp && y ? out[(y - 1) * stride + x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[y * stride + x] = v & 255;
    }
  }
  return { w, h, bpp, px: out };
}

// ---------- 1) 걸을 수 있는 격자 ----------
const img = decodePNG(readFileSync(FILE));
const cs = img.w / N;
const grid = new Uint8Array(N * N);
for (let gy = 0; gy < N; gy++) for (let gx = 0; gx < N; gx++) {
  let ok = 0, tot = 0;
  for (let y = gy * cs; y < (gy + 1) * cs; y++) for (let x = gx * cs; x < (gx + 1) * cs; x++) {
    const i = (y * img.w + x) * img.bpp;
    if ((img.px[i] + img.px[i + 1] + img.px[i + 2]) / 3 > THR) ok++;
    tot++;
  }
  grid[gy * N + gx] = ok * 2 >= tot ? 1 : 0;
}
// 가장자리 1칸은 벽 (맵 밖으로 나가지 않게)
for (let i = 0; i < N; i++) { grid[i] = grid[(N - 1) * N + i] = grid[i * N] = grid[i * N + N - 1] = 0; }
// 벽까지 거리 (칸, 체비쇼프 근사)
const clear = new Int16Array(N * N).fill(999);
const q = [];
for (let i = 0; i < N * N; i++) if (!grid[i]) { clear[i] = 0; q.push(i); }
for (let h = 0; h < q.length; h++) {
  const i = q[h], x = i % N, y = (i / N) | 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
    const j = ny * N + nx;
    if (clear[j] > clear[i] + 1) { clear[j] = clear[i] + 1; q.push(j); }
  }
}
const cell = (x, y) => [Math.min(N - 1, Math.max(0, Math.floor(x * N))), Math.min(N - 1, Math.max(0, Math.floor(y * N)))];
const clearAt = (x, y) => { const [cx, cy] = cell(x, y); return clear[cy * N + cx]; };
const segClear = (a, b, need = 1) => {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(2, Math.ceil(d * N * 2));
  for (let k = 0; k <= n; k++) if (clearAt(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n) < need) return false;
  return true;
};
// 가장 가까운 걸을 수 있는 지점 (벽에서 need칸 이상)
function snap(p, need = 2) {
  if (clearAt(p[0], p[1]) >= need) return p;
  const [cx, cy] = cell(p[0], p[1]);
  for (let r = 1; r < 40; r++) {
    let best = null, bd = Infinity;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= N || y >= N || clear[y * N + x] < need) continue;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = [(x + 0.5) / N, (y + 0.5) / N]; }
    }
    if (best) return best;
  }
  return p;
}

// ---------- 2) 이름 붙은 지점 ----------
const nodes = [];      // [x, y, type, name]
const add = (p, type, name, need = 2) => {
  const s = snap(p, need);
  if (nodes.some(n => Math.hypot(n[0] - s[0], n[1] - s[1]) < 0.012)) return;
  nodes.push([+s[0].toFixed(4), +s[1].toFixed(4), type, name]);
};
const mir = M.mir;
const both = (p, type, name) => { add(p, type, 'B_' + name); add(mir(p), type, 'R_' + name); };
// 기지 출입구·우물·넥서스
both(M.BLUE.fountain, 'base', 'fountain');
both(M.BLUE.nexus, 'base', 'nexus');
for (const l of ['TOP', 'MID', 'BOT']) both(M.BLUE.inhibs[l], 'baseExit', 'inhib_' + l);
both([0.17, 0.80], 'base', 'base_mid');
// 포탑 앞
for (const l of ['TOP', 'MID', 'BOT']) M.BLUE.towers[l].forEach((t, i) => both(t, 'tower', `tower_${l}${i}`));
// 정글 캠프 (캠프 자리 + 입구)
for (const [k, c] of Object.entries(M.BLUE.camps)) both(c, 'camp', 'camp_' + k);
// 둥지 + 입구 (강 쪽 두 곳, 정글 쪽 한 곳)
for (const [k, p] of Object.entries(M.PITS)) {
  if (k === 'center') continue;
  add(p, 'pit', 'pit_' + k);
  for (const [dx, dy, nm] of [[-0.06, -0.06, 'riverA'], [0.06, 0.06, 'riverB'], [-0.065, 0.045, 'side1'], [0.045, -0.065, 'side2']]) add([p[0] + dx, p[1] + dy], 'pitEntrance', `pit_${k}_${nm}`);
}
// 바위게
add(M.SCUTTLE.top, 'river', 'scuttle_top'); add(M.SCUTTLE.bot, 'river', 'scuttle_bot');
// 부쉬 (블루 쪽 기준, 레드는 대칭)
const BUSH = {
  topTri: [0.14, 0.22], topRiver: [0.21, 0.14], topLane: [0.085, 0.40], baronSide: [0.26, 0.36],
  midLeft: [0.40, 0.47], midRight: [0.44, 0.42], midRiver: [0.42, 0.53],
  botTri: [0.78, 0.86], botRiver: [0.86, 0.79], botLane: [0.60, 0.915], dragonSide: [0.60, 0.70],
  raptorBush: [0.43, 0.67], redBuffBush: [0.56, 0.69], blueBuffBush: [0.22, 0.42], wolvesBush: [0.31, 0.58],
};
for (const [k, p] of Object.entries(BUSH)) both(p, 'bush', 'bush_' + k);
// 시야 지점
for (const [k, list] of Object.entries(M.VISION)) list.forEach((p, i) => add(p, 'vision', `vision_${k}_${i}`));

// 라인 (경로를 0.03 간격으로)
for (const l of ['TOP', 'MID', 'BOT']) {
  const P = M.LANE_PATH[l];
  for (let i = 0; i < P.length - 1; i++) {
    const [a, b] = [P[i], P[i + 1]], d = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(d / 0.03));
    for (let k = 0; k < n; k++) add([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n], 'lane', `${l}_${i}_${k}`);
  }
}
// 강 중심선
for (let i = 0; i < M.RIVER.length - 1; i++) {
  const [a, b] = [M.RIVER[i], M.RIVER[i + 1]], d = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(d / 0.03));
  for (let k = 0; k <= n; k++) add([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n], 'river', `river_${i}_${k}`);
}
// ---------- 3) 정글 통로 채우기 (빈 곳을 0.035 간격으로) ----------
const named = nodes.length;
for (let gy = 2; gy < N - 2; gy += 2) for (let gx = 2; gx < N - 2; gx += 2) {
  if (clear[gy * N + gx] < 3) continue;
  const p = [(gx + 0.5) / N, (gy + 0.5) / N];
  if (nodes.some(n => Math.hypot(n[0] - p[0], n[1] - p[1]) < 0.034)) continue;
  nodes.push([+p[0].toFixed(4), +p[1].toFixed(4), 'path', 'p' + nodes.length]);
}
// 좁은 통로(바위 옆·벽 사이)도 비지 않게: 벽에서 2칸 이상이고 0.02 안에 노드가 없으면 추가
for (let gy = 2; gy < N - 2; gy += 2) for (let gx = 2; gx < N - 2; gx += 2) {
  if (clear[gy * N + gx] < 2) continue;
  const p = [(gx + 0.5) / N, (gy + 0.5) / N];
  if (nodes.some(n => Math.hypot(n[0] - p[0], n[1] - p[1]) < 0.02)) continue;
  nodes.push([+p[0].toFixed(4), +p[1].toFixed(4), 'path', 'p' + nodes.length]);
}

// ---------- 4) 간선 ----------
const edges = new Set();
const R = 0.075;
for (let i = 0; i < nodes.length; i++) {
  const near = [];
  for (let j = 0; j < nodes.length; j++) {
    if (i === j) continue;
    const d = Math.hypot(nodes[i][0] - nodes[j][0], nodes[i][1] - nodes[j][1]);
    if (d <= R) near.push([d, j]);
  }
  near.sort((a, b) => a[0] - b[0]);
  let k = 0;
  for (const [, j] of near) {
    if (k >= 10) break;
    if (!segClear(nodes[i], nodes[j], 1)) continue;
    edges.add(i < j ? `${i},${j}` : `${j},${i}`);
    k++;
  }
}
// 연결 확인 (하나로 이어져야 함) — 떨어진 덩어리는 가장 가까운 노드와 이어 본다
function components() {
  const adj = nodes.map(() => []);
  for (const e of edges) { const [a, b] = e.split(',').map(Number); adj[a].push(b); adj[b].push(a); }
  const comp = new Int32Array(nodes.length).fill(-1); let c = 0;
  for (let i = 0; i < nodes.length; i++) {
    if (comp[i] >= 0) continue;
    const st = [i]; comp[i] = c;
    while (st.length) { const v = st.pop(); for (const u of adj[v]) if (comp[u] < 0) { comp[u] = c; st.push(u); } }
    c++;
  }
  return { comp, n: c };
}
let { comp, n: nc } = components();
for (let it = 0; it < 50 && nc > 1; it++) {
  const sizes = {}; for (const c of comp) sizes[c] = (sizes[c] || 0) + 1;
  const main = Object.entries(sizes).sort((a, b) => b[1] - a[1])[0][0] | 0;
  let fixed = false;
  for (let i = 0; i < nodes.length && !fixed; i++) {
    if (comp[i] === main) continue;
    let best = null, bd = 0.15;
    for (let j = 0; j < nodes.length; j++) {
      if (comp[j] !== main) continue;
      const d = Math.hypot(nodes[i][0] - nodes[j][0], nodes[i][1] - nodes[j][1]);
      if (d < bd && segClear(nodes[i], nodes[j], 1)) { bd = d; best = j; }
    }
    if (best !== null) { edges.add(i < best ? `${i},${best}` : `${best},${i}`); fixed = true; }
  }
  if (!fixed) break;
  ({ comp, n: nc } = components());
}
// 이어지지 않은 노드는 버린다
const sizes = {}; for (const c of comp) sizes[c] = (sizes[c] || 0) + 1;
const main = Object.entries(sizes).sort((a, b) => b[1] - a[1])[0][0] | 0;
const keep = nodes.map((_, i) => comp[i] === main);
const remap = []; const outNodes = [];
nodes.forEach((n, i) => { if (keep[i]) { remap[i] = outNodes.length; outNodes.push(n); } });
const outEdges = [...edges].map(e => e.split(',').map(Number)).filter(([a, b]) => keep[a] && keep[b]).map(([a, b]) => [remap[a], remap[b]]);
const dropped = nodes.length - outNodes.length;

// ---------- 5) 격자 압축 (행마다 RLE → base64) ----------
const runs = [];
for (let i = 0, cur = 0, len = 0; i <= N * N; i++) {
  const v = i < N * N ? grid[i] : -1;
  if (v === cur && len < 255) len++;
  else { runs.push(len); if (v === cur) { runs.push(0); len = 1; } else { cur = v; len = 1; } }
}
const maskB64 = Buffer.from(Uint8Array.from(runs)).toString('base64');

const types = {}; for (const n of outNodes) types[n[2]] = (types[n[2]] || 0) + 1;
const src = `// 미니맵 이동 그래프 — tools/build-navgraph.mjs 가 지도 이미지에서 만든 파일 (직접 고치지 말고 다시 만든다)
// 좌표: 미니맵 0~1 (좌상단 원점). MASK: ${N}×${N} 걸을 수 있는 격자 (1=길, 0=벽), 0부터 번갈아 세는 RLE를 base64로.
// NODES: [x, y, 종류, 이름] — 종류: ${Object.entries(types).map(([k, v]) => `${k} ${v}`).join(', ')}
// EDGES: [a, b] — 두 노드 사이 직선이 벽에서 1칸 이상 떨어진 길 위
export const MASK_N = ${N};
export const MASK = '${maskB64}';
export const NODES = ${JSON.stringify(outNodes)};
export const EDGES = ${JSON.stringify(outEdges)};
`;
writeFileSync('data/navgraph.js', src);
console.log(`노드 ${outNodes.length}개 (이름 ${named}개, 통로 ${nodes.length - named}개, 버림 ${dropped}) · 간선 ${outEdges.length}개 · 덩어리 ${nc}개`);
console.log('종류:', JSON.stringify(types));
