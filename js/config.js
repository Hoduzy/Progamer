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
    tickSec: 5,
    laningEnd: 840,            // 14:00 라인전 종료
    midEnd: 1500,              // 25:00 이후 후반
    maxTime: 4200,             // 안전장치: 70분이 넘으면 강제 종료 판정 (검사기에서 위반으로 집계)
    blueSideBonus: 0.25,       // 블루 진영 파워 보정 (교전 피해량)
    statScale: 0.27,           // 능력치 차이가 파워에 반영되는 비율 (클수록 강팀이 더 자주 이김)
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
    // 선수 파워 (교전 피해량에 반영)
    power: {
      goldPerK: 0.9,           // 선수 골드가 같은 포지션 평균보다 1천 많을 때마다
      levelPer: 0.9,           // 레벨 1 차이당
      compWeight: 0.55,        // 조합 한타·이니시 (3명 이상 교전에서만)
      mentalBehindGap: 2000,
    },
    // ---- 시뮬레이션 (계획 → 이동 → 도착 → 판정) ----
    sim: {
      moveSpeed: 0.0275,       // 초당 이동 거리 (맵 대각선 1.30 ≈ 47초)
      maxSpeedMult: 1.15,      // 신발·기동성 보정 최대치 (검사기 기준)
      recallChannel: 8,        // 귀환 채널링(초) → 우물
      tpChannel: 4,            // 텔레포트 채널링(초) → 아군 포탑·와드·미니언
      tpCooldown: 300,
      campClearSec: 10,        // 정글 캠프 하나 정리 시간
      campRespawn: 135,
      regenPerSec: 0.004,      // 비전투 체력 회복
      recallHp: 0.32,          // 이 체력 아래면 귀환
      recallGoldExtra: 250,    // 다음 아이템 가격 + 이 골드가 모이면 귀환 고려
      // 교전
      clusterLink: 0.07,       // 이 거리 안의 선수들을 한 무리로 묶음
      engageRange: 0.065,      // 적과 이 거리 안이면 교전 개시 판정
      fightRadius: 0.085,      // 교전 중심에서 이 거리 안이면 참여
      joinRange: 0.30,         // 아군 교전에 합류하러 가는 거리
      fightMaxTicks: 5,
      dps: 0.052,              // 기본 초당 피해 (체력 1 = 한 명)
      powScale: 10,            // 파워 10 차이당 피해 e배
      focus: 0.6,              // 같은 대상을 집중 공격할 확률
      fleeHp: 0.2,             // 이 체력 아래면 도주
      fleeRatio: 0.5,          // 남은 전력이 상대의 이 비율 아래면 팀 전체 후퇴
      fleeRatioBig: 0.3,       // 8명 이상 큰 교전 후퇴 기준 (더 오래 버팀)
      bigFightDps: 1.3,        // 8명 이상 큰 교전 피해 배율 (첫 교환에서 양쪽 모두 쓰러짐)
      fleeHpBig: 0.1,          // 큰 교전 개인 도주 체력
      mutualDisengage: 0.36,   // 큰 교전 첫 5초 뒤 팽팽하면 양 팀이 빠질 확률
      catchSmall: 0.45,        // 5명 이하 교전에서 잡힐 확률 배율 (도주가 쉬움)
      catchPerChaser: 0.05,    // 추격자 1명 늘 때마다 잡힐 확률 배율 +
      catchBase: 0.36,         // 도주자가 잡힐 기본 확률
      trade: { chance: 0.07, intensity: 0.45, fleeHp: 0.45 }, // 라인전 견제
      engage: { objective: 0.16, structure: 0.13, numbers: 0.15, gank: 0.55, roam: 0.03, late: 0.06 },
      avoidRatio: 0.8,         // 전력비가 이 아래면 교전을 피해 물러남
      buffDps: { baron: 0.22, elder: 0.45, soul: 0.10, dragon: 0.025 }, // 피해 배율 가산
      // 구조물
      towerRange: 0.05,
      towerDps: 0.035,         // 미니언 없이 포탑 아래 들어간 챔피언이 초당 잃는 체력
      champStructDps: 0.0062,  // 챔피언 1명 초당 구조물 피해 (구조물 체력 1)
      minionStructDps: 0.0018, // 미니언 웨이브 초당 구조물 피해
      superMinionMult: 3,
      structHp: { tower: [1, 1.25, 1.35], inhib: 1.0, nexusTower: 1.1, nexus: 1.4 },
      fortifyUntil: 300,       // 이 시간 전에는 포탑 피해 -70%
      plateUntil: 840,         // 이 시간 전에는 외곽 포탑 피해 -35% (포탑 방패)
      grubsStructBonus: 0.06,  // 유충 1마리당 구조물 피해 +6%
      baronStructBonus: 0.8,   // 바론 버프 중 구조물 피해 +80%
      nexusMinAttackers: 3,    // 넥서스 공격 최소 인원 (상대 기지 안)
      // 웨이브
      wavePush: 0.012,         // 라인 앞 챔피언 전력 1당 웨이브 이동 (s/틱)
      waveMaxStep: 0.03,
      waveRelax: 0.006,        // 아무도 없을 때 가운데로 돌아가는 속도
      // 오브젝트 처치 시간 [최소, 최대] 초 (인원·골드가 많을수록 최소 쪽)
      objTime: { grubs: [30, 45], herald: [35, 50], dragon: [25, 40], baron: [40, 70], elder: [30, 45], atakhan: [35, 55] },
      baronEarlyMult: 1.3,     // 25분 이전 바론 처치 시간 배율
      baronFewMult: 1.2,       // 4명 미만 바론 처치 시간 배율
      setupLead: 60,           // 오브젝트 등장 이 시간 전부터 시야 장악
      stealBase: 0.10, stealPerMech: 0.004,
      heraldSpeed: 0.022, heraldStructDmg: 0.65, heraldHp: 1, heraldHoldSec: 240,
      // 장면·검사
      sceneRadius: 0.09,       // 장면 참여자 범위
      eventRadius: 0.17,       // 이벤트 참여자가 있어야 하는 거리
      historyTicks: 7,         // 버그 신고용 최근 상태 보관 (7틱 = 35초)
    },
    // 검사기 목표 범위
    validate: {
      earlyMidStackMax: 0.10,  // 0~14분 5명이 미드에 함께 있는 시간 비율 상한
      sideLaneMin: 0.35,       // 14분 이후 사이드 라인에 1명 이상 있는 시간 비율 하한
      durationMin: [27, 35],   // 평균 경기 시간(분)
      killsAvg: [18, 32],
      tfDeaths: { '0-1': [0.04, 0.18], '2-4': [0.33, 0.57], '5-7': [0.20, 0.40], ace: [0.08, 0.24] },
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
  regionOffset: { LCK: 0, LPL: 1.5, LEC: -2, LCS: -4, CBLOL: -6, LCP: -4 }, // 지역별 전력 보정 (국제대회 밸런스)
  tierThresholds: { S: 82, A: 78, B: 74, C: 70 },     // 시즌마다 1군 평균 OVR로 팀 티어 재계산
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
    teamBudget: { S: 1.25, A: 1.1, B: 1.0, C: 0.9, D: 0.8 },                       // 팀 티어별 연봉 배율
    regionPay: { LCK: 1, LPL: 1.25, LEC: 0.95, LCS: 1.15, CBLOL: 0.6, LCP: 0.55 }, // 지역별 연봉 배율
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
  community: {
    postsMin: 3, postsMax: 5,            // 시리즈 하나 끝나면 올라오는 글 수
    commentsMin: 4, commentsMax: 8,      // 글 하나의 댓글 수
    repliesMax: 6,                       // 글 하나의 대댓글 최대 수
    fightAnti: 0.38, fightFan: 0.2, fightTeam: 0.3,   // 안티 댓글에 팬이 / 팬 댓글에 안티가 / 다른 팀 팬끼리 대댓글 싸움을 걸 확률
    cooldown: { t: 60, b: 40, c: 150, r: 80 },  // 같은 템플릿을 다시 쓰기까지: 제목 60글, 본문 40글, 댓글 150개, 대댓글 80개
    keepPosts: 40,                       // 게시판에 남기는 글 수
    fixedShare: 0.38,                    // 댓글 중 고정 유저(고닉)가 쓰는 비율
    fanAt: 40, antiAt: -40,              // 호감도가 이 값 이상이면 팬처럼, 이하면 안티처럼 행동
    favorStep: 6,                        // 시리즈 하나·인터뷰 하나로 바뀌는 호감도 최대폭
    favorRate: 0.6,                      // 경기 성적이 호감도에 주는 영향 배율
    favorPull: 0.015,                    // 시리즈마다 원래 호감도로 돌아가려는 비율 (안티는 압도적으로 잘해야 돌아섬)
    favorHyst: 15,                       // 팬·안티에서 벗어나려면 경계선보다 이만큼 더 넘어가야 함
    grudgingChance: 0.25,                // 내가 압도적으로 잘했을 때 안티가 "이번엔 인정함"을 남길 확률
    comebackGold: 3500,                  // 역전승·역전패로 치는 최대 골드 차
    defaultTone: 'spicy',                // 커뮤니티 수위 기본값 (mild 순한맛 / normal 보통 / spicy 매운맛)
  },
  fans: { winBase: 400, ratingMult: 250, pogBonus: 1500, trophyBonus: 20000 },

  ui: {
    msPerGameMinute: 4000,     // 1배속: 게임 1분 = 4초
    images: { concurrency: 6, retryDelays: [1000, 3000, 8000] },   // 이미지 동시 요청 수, 실패 후 다시 시도 간격(ms)
    speeds: [1, 2, 4],
    sceneShrinkMs: 600,
    showBigEvents: true,
  },
};
