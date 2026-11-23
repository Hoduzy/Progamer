// 미니맵 좌표 (0~1, 좌상단 원점). 블루 = 좌하단, 레드 = 우상단. 맵은 점대칭.
export const LANES = ['TOP', 'MID', 'BOT'];
const BLUE_NEXUS = [0.115, 0.885];
const mir = ([x, y]) => [1 - x, 1 - y];

// 블루 → 레드 방향 라인 경로
export const LANE_PATH = {
  TOP: [BLUE_NEXUS, [0.085, 0.72], [0.075, 0.30], [0.10, 0.10], [0.30, 0.075], [0.72, 0.085], mir(BLUE_NEXUS)],
  MID: [BLUE_NEXUS, [0.30, 0.70], [0.5, 0.5], [0.70, 0.30], mir(BLUE_NEXUS)],
  BOT: [BLUE_NEXUS, [0.28, 0.915], [0.70, 0.925], [0.90, 0.90], [0.925, 0.30], [0.915, 0.28], mir(BLUE_NEXUS)],
};

// 블루 포탑 [외곽, 내부, 억제기 포탑], 억제기, 쌍둥이 포탑
const BLUE_TOWERS = {
  TOP: [[0.075, 0.27], [0.10, 0.52], [0.083, 0.70]],
  MID: [[0.405, 0.585], [0.345, 0.665], [0.25, 0.745]],
  BOT: [[0.72, 0.925], [0.48, 0.905], [0.29, 0.915]],
};
const BLUE_INHIB = { TOP: [0.083, 0.755], MID: [0.215, 0.775], BOT: [0.245, 0.917] };
const BLUE_NEXUS_TOWERS = [[0.135, 0.83], [0.17, 0.865]];

export function towerPos(side, lane, idx) {
  if (side === 0) return BLUE_TOWERS[lane][idx];
  const mirrorLane = lane === 'TOP' ? 'BOT' : lane === 'BOT' ? 'TOP' : 'MID';
  return mir(BLUE_TOWERS[mirrorLane][idx]);
}
export function inhibPos(side, lane) {
  if (side === 0) return BLUE_INHIB[lane];
  const ml = lane === 'TOP' ? 'BOT' : lane === 'BOT' ? 'TOP' : 'MID';
  return mir(BLUE_INHIB[ml]);
}
export function nexusTowerPos(side, i) { return side === 0 ? BLUE_NEXUS_TOWERS[i] : mir(BLUE_NEXUS_TOWERS[i]); }
export function nexusPos(side) { return side === 0 ? BLUE_NEXUS : mir(BLUE_NEXUS); }
export function fountain(side) { return side === 0 ? [0.04, 0.96] : [0.96, 0.04]; }

export const OBJ_POS = {
  dragon: [0.675, 0.70], elder: [0.675, 0.70],
  baron: [0.325, 0.30], herald: [0.325, 0.30], grubs: [0.325, 0.30], atakhan: [0.5, 0.5],
};

// 정글 캠프 (블루 쪽). 레드는 대칭
const BLUE_CAMPS = [[0.25, 0.47], [0.27, 0.56], [0.22, 0.40], [0.49, 0.74], [0.54, 0.82], [0.56, 0.66], [0.15, 0.55]];
export function campPos(side, i) { const c = BLUE_CAMPS[i % BLUE_CAMPS.length]; return side === 0 ? c : mir(c); }
export const CAMP_COUNT = BLUE_CAMPS.length;

// 경로 위의 점 (s: 0=블루 넥서스, 1=레드 넥서스)
export function pointOnLane(lane, s) {
  const path = LANE_PATH[lane];
  const segs = [];
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const [x1, y1] = path[i], [x2, y2] = path[i + 1];
    const len = Math.hypot(x2 - x1, y2 - y1);
    segs.push([x1, y1, x2, y2, len]);
    total += len;
  }
  let d = Math.max(0, Math.min(1, s)) * total;
  for (const [x1, y1, x2, y2, len] of segs) {
    if (d <= len) { const t = d / len; return [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]; }
    d -= len;
  }
  return path[path.length - 1];
}

// 포탑 인덱스 → 경로상 위치 (대략)
export const TOWER_S = [0.36, 0.26, 0.17]; // 블루 기준 외곽/내부/억제기 (레드는 1-s)
