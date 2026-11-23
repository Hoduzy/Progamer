// 맵 기하 함수 (좌표 데이터는 data/map.js)
import * as M from '../../data/map.js';

export const LANES = ['TOP', 'MID', 'BOT'];
export const LANE_PATH = M.LANE_PATH;
export const REGION_KO = M.REGION_KO;
const mir = M.mir;
const ML = { TOP: 'BOT', BOT: 'TOP', MID: 'MID' };

export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const dxy = (x1, y1, x2, y2) => Math.hypot(x1 - x2, y1 - y2);

export function towerPos(side, lane, idx) { return side === 0 ? M.BLUE.towers[lane][idx] : mir(M.BLUE.towers[ML[lane]][idx]); }
export function inhibPos(side, lane) { return side === 0 ? M.BLUE.inhibs[lane] : mir(M.BLUE.inhibs[ML[lane]]); }
export function nexusTowerPos(side, i) { return side === 0 ? M.BLUE.nexusTowers[i] : mir(M.BLUE.nexusTowers[i]); }
export function nexusPos(side) { return side === 0 ? M.BLUE.nexus : mir(M.BLUE.nexus); }
export function fountain(side) { return side === 0 ? M.BLUE.fountain : mir(M.BLUE.fountain); }
export function inBase(side, x, y) { const n = nexusPos(side); return dxy(x, y, n[0], n[1]) <= M.BASE_RADIUS; }
export const BASE_RADIUS = M.BASE_RADIUS;

export const OBJ_POS = Object.fromEntries(Object.entries(M.OBJ_PIT).map(([k, pit]) => [k, M.PITS[pit]]));
export const OBJ_PIT = M.OBJ_PIT;
export const PIT_RADIUS = M.PIT_RADIUS;

// 정글 캠프
export const CAMP_IDS = Object.keys(M.BLUE.camps);
export function campPos(side, id) { const c = M.BLUE.camps[typeof id === 'number' ? CAMP_IDS[id % CAMP_IDS.length] : id]; return side === 0 ? c : mir(c); }
export const CAMP_COUNT = CAMP_IDS.length;
export const SCUTTLE = M.SCUTTLE;

// ---------- 라인 경로 ----------
const PATHS = {};
for (const l of LANES) {
  const pts = M.LANE_PATH[l];
  const segs = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
    const len = Math.hypot(x2 - x1, y2 - y1);
    segs.push({ x1, y1, x2, y2, len, s0: total });
    total += len;
  }
  PATHS[l] = { segs, total };
}
export const laneLength = l => PATHS[l].total;

// s: 0 = 블루 넥서스, 1 = 레드 넥서스
export function pointOnLane(lane, s) {
  const P = PATHS[lane];
  let d = Math.max(0, Math.min(1, s)) * P.total;
  for (const g of P.segs) {
    if (d <= g.len) { const t = d / g.len; return [g.x1 + (g.x2 - g.x1) * t, g.y1 + (g.y2 - g.y1) * t]; }
    d -= g.len;
  }
  const last = P.segs[P.segs.length - 1];
  return [last.x2, last.y2];
}
// 점을 라인 경로에 투영 → { s, d(거리) }
export function projectOnLane(lane, x, y) {
  const P = PATHS[lane];
  let best = { s: 0, d: 9 };
  for (const g of P.segs) {
    const vx = g.x2 - g.x1, vy = g.y2 - g.y1;
    let t = ((x - g.x1) * vx + (y - g.y1) * vy) / (g.len * g.len);
    t = Math.max(0, Math.min(1, t));
    const px = g.x1 + vx * t, py = g.y1 + vy * t;
    const d = Math.hypot(x - px, y - py);
    if (d < best.d) best = { s: (g.s0 + t * g.len) / P.total, d };
  }
  return best;
}

// 구조물의 라인 경로상 위치 s
export const STRUCT_S = [0, 1].map(side => Object.fromEntries(LANES.map(l => [l, {
  towers: [0, 1, 2].map(i => projectOnLane(l, ...towerPos(side, l, i)).s),
  inhib: projectOnLane(l, ...inhibPos(side, l)).s,
}])));

// ---------- 지역 ----------
function distToPolyline(pts, x, y) {
  let best = 9;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
    const vx = x2 - x1, vy = y2 - y1, L2 = vx * vx + vy * vy;
    let t = ((x - x1) * vx + (y - y1) * vy) / L2;
    t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(x - x1 - vx * t, y - y1 - vy * t));
  }
  return best;
}
export const LANE_REGION = { TOP: 'topLane', MID: 'midLane', BOT: 'botLane' };
export const LANE_HALF_WIDTH = 0.05;
export function regionOf(x, y) {
  if (inBase(0, x, y)) return 'blueBase';
  if (inBase(1, x, y)) return 'redBase';
  if (dxy(x, y, ...M.PITS.baron) <= PIT_RADIUS + 0.015) return 'baronPit';
  if (dxy(x, y, ...M.PITS.dragon) <= PIT_RADIUS + 0.015) return 'dragonPit';
  let lane = null, ld = LANE_HALF_WIDTH;
  for (const l of LANES) { const d = projectOnLane(l, x, y).d; if (d < ld) { ld = d; lane = l; } }
  if (lane) return LANE_REGION[lane];
  if (distToPolyline(M.RIVER, x, y) <= M.RIVER_HALF_WIDTH) return x + y < 1 ? 'topRiver' : 'botRiver';
  const blueSide = y > x;
  const topHalf = x + y < 1;
  return (blueSide ? 'blueJungle' : 'redJungle') + (topHalf ? 'Top' : 'Bot');
}
export const regionKo = r => M.REGION_KO[r] || r;
// 지역 → 라인 이름 (문자중계 검사용)
export function regionLane(r) {
  if (r === 'topLane' || r === 'topRiver' || r === 'baronPit' || r === 'blueJungleTop' || r === 'redJungleTop') return 'TOP';
  if (r === 'botLane' || r === 'botRiver' || r === 'dragonPit' || r === 'blueJungleBot' || r === 'redJungleBot') return 'BOT';
  if (r === 'midLane') return 'MID';
  return null;
}

// 오브젝트 대기 위치 (둥지에서 아군 기지 쪽으로 물러난 지점, i번째 선수 분산)
export function setupPoint(side, key, i = 0) {
  const pit = OBJ_POS[key];
  const n = nexusPos(side);
  const dx = n[0] - pit[0], dy = n[1] - pit[1];
  const L = Math.hypot(dx, dy);
  const ux = dx / L, uy = dy / L;
  const spread = (i - 2) * 0.022;
  return [pit[0] + ux * 0.12 - uy * spread, pit[1] + uy * 0.12 + ux * spread];
}
// 둥지 안 위치 (분산)
export function pitPoint(key, i = 0) {
  const pit = OBJ_POS[key];
  const a = i * 1.257;
  return [pit[0] + Math.cos(a) * 0.018, pit[1] + Math.sin(a) * 0.018];
}
export function visionPoints(key) { return M.VISION[OBJ_PIT[key] || key] || M.VISION.mid; }

// 목표 쪽으로 최대 maxD 이동
export function stepToward(x, y, tx, ty, maxD) {
  const d = Math.hypot(tx - x, ty - y);
  if (d <= maxD || d === 0) return [tx, ty];
  return [x + (tx - x) / d * maxD, y + (ty - y) / d * maxD];
}
export const clamp01 = v => Math.max(0.01, Math.min(0.99, v));
