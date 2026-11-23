// ============================================================
//  모든 수치 상수는 여기 한 곳에서 조정한다.
//  (확률은 0~1 또는 % 로 주석에 표기)
// ============================================================
export const CONFIG = {
  saveVersion: 1,
  storagePrefix: 'lckc',
  startYear: 2026,

  // ---------------- 경기 엔진 ----------------
  match: {
    tickSec: 10,
    laningEnd: 840,            // 14:00 라인전 종료
    midEnd: 1500,              // 25:00 이후 후반
    maxTime: 3600,             // 안전장치: 60분이 넘으면 강제 종료 판정
    blueSideBonus: 0.6,
    statScale: 0.27,            // 능력치 차이가 파워에 반영되는 비율 (클수록 강팀이 더 자주 이김)        // 블루 진영 파워 보정
    perfSdBase: 2.0,           // 경기 당 개인 컨디션 흔들림 기본값 (+variance 보정)
    // 포지션별 기본 GPM (패시브 골드 포함)
    gpm: { TOP: 345, JGL: 315, MID: 365, ADC: 385, SUP: 215 },
    csPerMin: { TOP: 8.3, JGL: 6.2, MID: 8.8, ADC: 9.4, SUP: 1.3 },
    lateGpmBoost: 0.35,        // 30분에 GPM이 +35%
    farmSkillEffect: 0.002,    // (라인전+피지컬)/2 - 70 1점당 수입 배율
    laneGoldEffect: 0.004,     // 라인 상태 1점당 수입 배율
    xpPerMin: { TOP: 470, JGL: 400, MID: 480, ADC: 400, SUP: 330 },
    xpTable: [0, 280, 660, 1140, 1720, 2400, 3180, 4060, 5040, 6120, 7300, 8580, 9960, 11440, 13020, 14700, 16480, 18360],
    deathTimer: [6, 6, 8, 8, 10, 12, 16, 21, 26, 32.5, 35, 37.5, 40, 42.5, 45, 47.5, 50, 52.5],
    deathTimerLateMult: 0.012, // 15분 이후 1분당 부활 시간 +1.2%
    gold: {
      kill: 300, firstBlood: 100, assistPool: 150, bountyPerStreak: 100, maxBounty: 600,
      towerOuterEarly: 650,    // 14분 전 외곽 포탑 (방패 골드 포함, 팀 전체)
      towerOuter: 350, towerInner: 400, towerInhib: 350, inhib: 100, nexusTower: 100,
      dragon: 150, grubs: 180, herald: 200, baron: 1500, elder: 250, atakhan: 300,
    },
    // 라인전
    lane: {
      drift: 0.06,             // 라인 상태 변화 속도
      revert: 0.985,           // 라인 상태 평균 회귀
      noise: 1.2,
      clampAbs: 30,
      soloKillChance: { TOP: 0.007, MID: 0.0055, BOT: 0.008 }, // 틱당 교전 시도
      fightScale: 7.0,
      laneStateWeight: 0.10,
      tradeChance: 0.12,       // 교전 시 서로 킬 교환
      gankChance: 0.016,       // 틱당 정글 갱킹 시도
      counterJungleChance: 0.32,
      gankFightScale: 7.5,
      gankBaseAdv: 4.0,        // 갱킹 쪽 기본 유리 (수적 우위)
    },
    // 중후반
    fight: {
      scale: 11,              // 한타 로지스틱 스케일 (클수록 이변↑)
      noise: 3.0,              // 한타마다 양 팀 파워 노이즈
      perMan: 7.5,             // 인원 1명 차이당 파워
      goldPerK: 0.9,           // 선수 골드가 평균보다 1천 많을 때마다 파워
      levelPer: 0.9,           // 레벨 1 차이당 파워
      compWeight: 0.55,        // 조합 한타/이니시 차이 반영
      buff: { baron: 7, elder: 14, soul: 4, dragonStack: 0.7, atakhan: 2.5 },
      skirmishChance: 0.011,   // 틱당 소규모 교전
      teamfightChance: 0.011,  // 틱당 대규모 한타 (오브젝트 없을 때)
      objFightChance: 0.30,    // 오브젝트 시도 시 상대가 맞서 싸울 확률(기본)
      pickChance: 0.009,       // 틱당 시야 싸움으로 한 명 끊기
      throwBase: 0.010,        // 골드 열세 + 멘탈 낮을 때 무리하다 잘리는 확률
      throwGoldGap: 2500,
      splitChance: 0.020,
      siegeBase: 0.022,        // 틱당 포탑 압박 기본 확률
      siegePerKGold: 0.004,
      siegePerInhib: 0.05,     // 상대 억제기가 1개 부서질 때마다 공성 확률 +
      siegeBuff: { baron: 0.16, elder: 0.10, herald: 0.05, grubs: 0.008 },
      endPushDeadMin: 3,
      defendFightChance: 0.18, // 공성 시 수비 팀이 한타를 여는 확률
      pushChance1: 0.6,
      highgroundMinTime: 1380, // 21분 전에는 4명 이상 잡아야 고지 진입
      highgroundFreeTime: 1500, // 30분 이후엔 공성만으로 고지 가능       // 1명만 잡았을 때 포탑까지 미는 확률       // 넥서스까지 밀려면 상대 사망 인원 최소
    },
    objectives: {
      dragonSpawn: 300, dragonRespawn: 300,
      grubsSpawn: 480, grubsDespawn: 885,
      heraldSpawn: 900, heraldDespawn: 1185,
      baronSpawn: 1200, baronRespawn: 360, baronBuff: 180,
      elderRespawn: 360, elderBuff: 150,
      soulAt: 4,
      atakhanEnabled: false,   // 패치마다 바뀌는 오브젝트: 켜고 끌 수 있음
      atakhanSpawn: 1200,
      inhibRespawn: 300,
      takeChance: 0.16,        // 오브젝트가 살아 있을 때 틱당 시도 확률
    },
    dragonTypes: ['화염', '대지', '바다', '바람', '화학공학', '마법공학'],
    dragonIds: { '화염': 'infernal', '대지': 'mountain', '바다': 'ocean', '바람': 'cloud', '화학공학': 'chemtech', '마법공학': 'hextech' },
  },

  // ---------------- 선택 장면 ----------------
  scene: {
    perGameMin: 5, perGameMax: 8,
    firstAt: 150,              // 2:30 이후부터
    timeLimitSec: 15,
    autoContinueSec: 4,
    bigEventShowSec: 2,
    clampMin: 5, clampMax: 95,
    statPer10: 1,              // 능력치 가중치 × (능력치-60)/10 × statPer10
    masteryPer10: 1.2,
    condPer10: 1.5,
    mentalPer10: 1.0,
    fatiguePer10: 1.5,
    goldPerK: 0.9, goldCap: 9,
    perMan: 6,
    noUlt: -12, noFlash: -9,
    exactDecision: 82,         // 판단력이 이 이상이면 정확한 확률 표시
    rangePerPoint: 0.55,       // 판단력 1 부족할 때마다 범위 폭 +0.55%p
    critShare: { low: 0.10, mid: 0.20, high: 0.35 },
    fumbleShare: { low: 0.10, mid: 0.25, high: 0.40 },
    ratingDelta: { crit: 0.9, success: 0.45, fail: -0.35, fumble: -0.8 },
    riskMult: { low: 0.7, mid: 1.0, high: 1.35 },
  },

  // ---------------- 평점 ----------------
  rating: {
    base: 6.45, win: 0.6, lose: -0.5,
    roleBase: { TOP: 0.12, JGL: 0.0, MID: -0.08, ADC: -0.12, SUP: 0.55 },
    kill: 0.22, death: -0.32, assist: 0.07,
    kpWeight: 1.4, kpAvg: 0.6,
    dmgWeight: 4.5,
    roleDmgAvg: { TOP: 0.21, JGL: 0.15, MID: 0.26, ADC: 0.28, SUP: 0.10 },
    visionWeight: 0.012, visionAvg: { TOP: 25, JGL: 40, MID: 30, ADC: 30, SUP: 80 },
    supportAssistBonus: 0.035,
    choiceWeight: 0.55,        // 선택 장면 누적 점수가 평점에 반영되는 비율
  },

  // ---------------- 선수 ----------------
  ovrWeights: {
    TOP: { laning: .22, teamfight: .18, mechanics: .2, decision: .14, vision: .06, mental: .08, pool: .06, stamina: .06 },
    JGL: { laning: .08, teamfight: .18, mechanics: .17, decision: .24, vision: .15, mental: .08, pool: .05, stamina: .05 },
    MID: { laning: .2, teamfight: .19, mechanics: .21, decision: .16, vision: .06, mental: .07, pool: .06, stamina: .05 },
    ADC: { laning: .19, teamfight: .23, mechanics: .23, decision: .13, vision: .04, mental: .08, pool: .05, stamina: .05 },
    SUP: { laning: .14, teamfight: .19, mechanics: .1, decision: .2, vision: .2, mental: .08, pool: .05, stamina: .04 },
  },
  tierOvr: { S: 83, A: 79.5, B: 76, C: 73, D: 68 }, // 1군 평균 OVR (팀 티어별)
  academyOffset: -13,                                 // 2군 평균 = 1군 - 13
  userStartAvg: 55,
  playstyles: {
    '라인전 괴물': { laning: 8, mechanics: 4, teamfight: -3, decision: -2 },
    '한타 장인': { teamfight: 8, mechanics: 2, laning: -3 },
    '운영형': { decision: 7, vision: 5, mechanics: -4, laning: -2 },
    '캐리형': { mechanics: 7, laning: 3, mental: -3, vision: -3 },
    '헌신형': { vision: 6, teamfight: 3, decision: 3, mechanics: -4, laning: -3 },
  },

  // ---------------- 성장 ----------------
  growth: {
    baseGain: { train: 0.24, scrim: 0.10, replay: 0.19, solo: 0.08, match: 0.16 },
    ageFactor: { 17: 1.3, 18: 1.25, 19: 1.15, 20: 1.05, 21: 1.0, 22: 0.92, 23: 0.82, 24: 0.72, 25: 0.6, 26: 0.45, 27: 0.3, 28: 0.15 },
    declineStartAge: 26, declinePerYear: [0, 1.2, 2.0, 3.0, 4.0], // 26세부터 매년 하락폭
    masteryGain: { practice: 3.2, solo: 1.6, match: 2.2, scrim: 0.8 },
    potentialRange: [72, 97],
    growthRange: [0.75, 1.35],
    varianceRange: [1, 10],
    aiSeasonGrowth: 2.4,       // AI 선수 시즌당 평균 성장(나이 보정 전)
  },

  // ---------------- 일상 ----------------
  daily: {
    slots: ['오전', '오후', '저녁'],
    fatigue: { scrim: 8, train: 7, practice: 5, solo: 6, replay: 3, rest: -18, stream: 7, bond: 1, match: 14 },
    nightRecovery: 18,
    mental: { rest: 3, stream: 1, bond: 2, solo: 0, scrim: 0 },
    streamFans: [300, 1500], streamMoney: [300000, 1500000], streamControversy: 0.04,
    bondChem: [3, 7],
    soloWinBase: 0.55, soloLpWin: [18, 24], soloLpLoss: [15, 21],
  },
  injury: { threshold: 72, perPoint: 0.004, days: [3, 14], types: ['손목 염증', '허리 통증', '어깨 결림', '목 디스크 증상'] },
  condition: { base: 75, fatigueWeight: 0.45, mentalWeight: 0.2 },

  // ---------------- 주전 결정 ----------------
  lineup: {
    w: { trust: 0.30, rating: 6.0, condition: 0.12, scrim: 0.25, ovr: 0.55 },
    noise: 3,
    callupMargin: 1.0,         // 2군 → 1군 콜업 기준 점수 차
    demoteBenchStreak: 4,      // 연속 벤치 시 강등 검토
    demoteRatingBelow: 6.0,
    reviewEveryDays: 7,
    starterGuarantee: 12,      // 주전 보장 계약 시 주전 점수 보너스
  },

  // ---------------- 패치 ----------------
  patch: {
    everyDays: 14,
    changesMin: 6, changesMax: 11,
    buffPower: [0.8, 2.2], nerfPower: [-2.2, -0.8],
    tierPower: { OP: 4.5, '1': 2.5, '2': 0.8, '3': -0.8, '4': -2.2 },
    tierShare: { OP: 0.06, '1': 0.16, '2': 0.33, '3': 0.30, '4': 0.15 },
    meanReversion: 0.15,
  },

  // ---------------- 연봉/계약 ----------------
  salary: {
    base: 30000000, growth: 1.118, popularityMult: 0.8, minAcademy: 25000000,
    starterMin: 60000000,
    buyoutMult: [1.5, 3.0],
    negotiate: { small: { raise: 0.1, accept: 0.75 }, mid: { raise: 0.2, accept: 0.5 }, big: { raise: 0.35, accept: 0.25 } },
    withdrawOnReject: 0.35,
    transferRequestAccept: 0.35,
  },
  fa: {
    startDate: '11-20', endDate: '12-28',
    offerInterest: 0.55,       // 팀별 제안 확률 기본
    overseasShare: 0.35,
    aiMoveChance: 0.35,        // 계약 만료 AI 선수가 이적할 확률
    retireAge: [26, 32],
    retireBase: 0.08, retirePerYear: 0.12,
  },

  // ---------------- 대회 ----------------
  competitions: {
    lckCup: { start: '01-14', groupBo: 3, playInBo: 3, playoffBo: 5, toFirstStand: 2 },
    firstStand: { start: '03-15', city: '상파울루', bo: 5 },
    lckR12: { start: '04-01', bo: 3 },
    roadToMsi: { start: '06-03', bo: 5, toMsi: 2 },
    msi: { start: '06-24', city: '대전', bo: 5 },
    lckR34: { start: '07-15', bo: 5 },
    lckPlayoffs: { start: '09-16', bo: 5, toWorlds: 4 },   // toWorlds: LCK 월즈 출전 팀 수
    worlds: { start: '10-13', city: '미국', finalCity: '뉴욕', bo: 5 },
    cl12: { start: '01-20', bo: 3 },
    cl34: { start: '06-01', bo: 3 },
    clPlayoffs: { start: '09-14', bo: 5 },
    matchDays: [3, 4, 5, 6, 0],     // 수목금토일
    seriesPerDay: 2,
    // 해외 지역 출전권 [First Stand, MSI, Worlds]
    regionSlots: {
      LPL: { fs: 2, msi: 2, worlds: 4 }, LEC: { fs: 1, msi: 2, worlds: 3 }, LCS: { fs: 1, msi: 2, worlds: 3 },
      CBLOL: { fs: 1, msi: 1, worlds: 1 }, LCP: { fs: 1, msi: 2, worlds: 3 },
    },
    worldsDirect: { LCK: 3, LPL: 3, LEC: 3, LCS: 2, LCP: 2, CBLOL: 1 }, // 스위스 직행. 나머지는 플레이-인 (스위스 16팀)
    msiDirect: { LCK: 1, LPL: 1, LEC: 1, LCP: 1 },                    // + First Stand 우승 지역 2번 시드
    regionNoise: 4.0,          // 해외 대표 선발 시 전력 노이즈
  },

  // ---------------- 랜덤 이벤트 ----------------
  events: { dailyChance: 0.16, cooldownDays: 2 },
  // 이벤트별 가중치는 data/events.js 의 weight 값 × 아래 배율
  eventWeightMult: 1.0,

  // ---------------- 커뮤니티 ----------------
  community: { postsMin: 3, postsMax: 5, commentsMin: 3, commentsMax: 5 },
  fans: { winBase: 400, ratingMult: 250, pogBonus: 1500, trophyBonus: 20000 },

  ui: {
    msPerGameMinute: 4000,     // 1배속: 게임 1분 = 4초
    speeds: [1, 2, 4],
    sceneShrinkMs: 600,
    showBigEvents: true,
  },
};
