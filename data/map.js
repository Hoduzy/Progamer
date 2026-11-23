// ============================================================
//  소환사의 협곡 미니맵 좌표 (0~1, 좌상단 원점)
//  블루 = 좌하단, 레드 = 우상단. 맵은 점대칭: 레드 좌표 = (1-x, 1-y)
//  대칭 시 TOP ↔ BOT 라인이 서로 바뀐다 (블루 BOT 포탑을 대칭하면 레드 TOP 포탑).
// ============================================================
export const mir = ([x, y]) => [1 - x, 1 - y];

export const BLUE = {
  fountain: [0.04, 0.96],
  nexus: [0.115, 0.885],
  nexusTowers: [[0.135, 0.83], [0.17, 0.865]],
  // 라인별 [외곽, 내부, 억제기 포탑]
  towers: {
    TOP: [[0.075, 0.27], [0.10, 0.52], [0.083, 0.70]],
    MID: [[0.405, 0.585], [0.345, 0.665], [0.25, 0.745]],
    BOT: [[0.72, 0.925], [0.48, 0.905], [0.29, 0.915]],
  },
  inhibs: { TOP: [0.083, 0.755], MID: [0.215, 0.775], BOT: [0.245, 0.917] },
  // 정글 캠프 (블루 진영)
  camps: {
    blue: [0.255, 0.465], gromp: [0.16, 0.425], wolves: [0.26, 0.565],
    raptors: [0.48, 0.635], red: [0.525, 0.74], krugs: [0.57, 0.83],
  },
};
export const BASE_RADIUS = 0.16;          // 넥서스 중심 기지 반경 (억제기 포함)

// 블루 → 레드 방향 라인 경로 (웨이포인트)
export const LANE_PATH = {
  TOP: [BLUE.nexus, [0.085, 0.72], [0.075, 0.30], [0.10, 0.10], [0.30, 0.075], [0.72, 0.085], mir(BLUE.nexus)],
  MID: [BLUE.nexus, [0.30, 0.70], [0.5, 0.5], [0.70, 0.30], mir(BLUE.nexus)],
  BOT: [BLUE.nexus, [0.28, 0.915], [0.70, 0.925], [0.90, 0.90], [0.925, 0.30], [0.915, 0.28], mir(BLUE.nexus)],
};

// 강: 좌상단(탑 강) → 우하단(바텀 강)으로 y≈x 대각선
export const RIVER = [[0.17, 0.17], [0.325, 0.30], [0.5, 0.5], [0.675, 0.70], [0.83, 0.83]];
export const RIVER_HALF_WIDTH = 0.055;

// 오브젝트 둥지: 바론 둥지(상단 강) — 공허 유충·협곡의 전령·내셔 남작 / 드래곤 둥지(하단 강) — 드래곤·장로
export const PITS = {
  baron: [0.325, 0.30], dragon: [0.675, 0.70], center: [0.5, 0.5],
};
export const OBJ_PIT = { grubs: 'baron', herald: 'baron', baron: 'baron', dragon: 'dragon', elder: 'dragon', atakhan: 'center' };
export const PIT_RADIUS = 0.045;

// 바위게 (강)
export const SCUTTLE = { top: [0.30, 0.37], bot: [0.70, 0.63] };

// 주요 시야 지점 (블루 기준 이름: 아군 쪽/상대 쪽)
export const VISION = {
  baron: [[0.27, 0.37], [0.24, 0.27], [0.40, 0.33], [0.37, 0.22]],
  dragon: [[0.60, 0.67], [0.63, 0.78], [0.73, 0.63], [0.76, 0.73]],
  mid: [[0.40, 0.45], [0.55, 0.60], [0.45, 0.40], [0.60, 0.55]],
};

export const REGION_KO = {
  blueBase: '블루 기지', redBase: '레드 기지', baronPit: '바론 둥지', dragonPit: '드래곤 둥지',
  topLane: '탑 라인', midLane: '미드 라인', botLane: '바텀 라인', topRiver: '탑 강가', botRiver: '바텀 강가',
  blueJungleTop: '블루 진영 윗 정글', blueJungleBot: '블루 진영 아랫 정글', redJungleTop: '레드 진영 윗 정글', redJungleBot: '레드 진영 아랫 정글',
};
