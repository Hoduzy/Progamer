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
    catchUpXp: 0.35, catchUpMax: 1.0,  // 상대 평균보다 레벨이 낮으면 1레벨당 경험치 +35% (최대 +100%)
    gold: {
      kill: 250, firstBlood: 100, assistPool: 120, bountyPerStreak: 150, maxBounty: 1000,
      goldBountyFrom: 1000, goldBountyPerK: 150,   // 같은 포지션 평균보다 1천 넘게 번 선수: 초과 1천당 현상금 150
      towerOuterEarly: 650,    // 14분 전 외곽 포탑 (방패 골드 포함, 팀 전체)
      towerOuter: 350, towerInner: 300, towerInhib: 350, inhib: 100, nexusTower: 100,
      dragon: 150, grubs: 180, herald: 200, elder: 250, atakhan: 300,
      baronPerAlive: 300,      // 바론: 처치 팀 생존자 1인당 (버프는 공성 능력으로만)
      objBounty: { gap: 3000, tower: 150, dragon: 200, baron: 1000, elder: 300, herald: 150 },  // 이만큼 뒤진 팀이 가져가면 추가 팀 골드
    },
    // 선수 파워 (교전 피해량에 반영)
    power: {
      goldPerK: 0.9,           // 선수 골드가 같은 포지션 평균보다 1천 많을 때마다
      goldSoftK: 1.5, goldSoftMult: 0.4,   // 1.5천 골드를 넘는 차이는 40%만 반영
      levelPer: 0.55,          // 레벨 1 차이당
      compWeight: 0.55,        // 조합 한타·이니시 (3명 이상 교전에서만)
      mentalBehindGap: 2000, baseDefense: 0.15,
      refLevel: 72.8,          // 교전 피해 기준 경기 수준 (10명 평균 능력치 파워 + 숙련도, 검사기 무작위 팀 평균)
    },
    // ---- 시뮬레이션 (계획 → 이동 → 도착 → 판정) ----
    sim: {
      moveSpeed: 0.030,        // 초당 이동 거리 (맵 대각선 1.30 ≈ 43초). 실제 길은 직선보다 평균 1.1배 길어 직선 시절 0.0275에서 올림
      maxSpeedMult: 1.15,      // 신발·기동성 보정 최대치 (검사기 기준)
      recallChannel: 8,        // 귀환 채널링(초) → 우물
      tpChannel: 4,            // 텔레포트 채널링(초) → 아군 포탑·와드·미니언
      tpCooldown: 300,
      campClearSec: 10,        // 정글 캠프 하나 정리 시간 (아래 campClear에 없는 캠프)
      campClear: { blue: 15, red: 15, gromp: 8, wolves: 8, raptors: 8, krugs: 10 },   // 캠프별 정리 시간(초)
      // 이동(포지션별 행동 + 조향). 거리 단위 = 미니맵 0~1
      move: {
        accel: 0.9,              // 1초에 최고 속도의 이 비율까지 속도를 바꿀 수 있음 (출발 가속·도착 감속)
        arriveR: 0.025,          // 목표까지 이 거리 안에서 감속
        turnDeg: 110,            // 1초 최대 회전 (교전 카이팅·도주는 예외)
        lookahead: 1.0,          // 경로 위 앞쪽 점 (최고 속도 × 이 값)
        sepR: 0.014, sepW: 0.008, sepSmooth: 0.7,   // 같은 팀 밀어내기 반경·세기(상한)·부드럽게
        nearGoal: 0.04, holdSec: 3,   // 가까운 목표가 바위 너머로 살짝 옮겨지면 3초까지 원래 목표 유지
        supFollow: 0.12, supFar: 0.03,   // 서폿이 원딜 위치를 따라가는 비율, 이보다 멀면 빠르게 따라붙음
        replanSec: 3, repathDist: 0.004, repathFar: 0.06,   // 목표가 0.004~0.06 옮겨지면 경로 끝만 바꾸고, 0.06 넘으면 새로 찾음. 막혔을 때 3초마다 다시
        wanderR: 0.004,          // 대기 중 아주 작은 움직임
        laneJitR: 0.008, laneJitSec: [1, 3],   // 라인전 막타 움찔
        jitSpeed: 0.22,          // 자리에 와 있을 때 움찔·대기 움직임 속도 (최고 속도 비율)
        backR: 0.035,            // 이 거리 안의 목표가 뒤쪽이면 천천히 돌아섬
        wardEvery: [70, 110], wardStay: 4, wardRange: 0.11, visionLead: 55,
        orbitR: { camp: 0.008, pit: 0.016, roleShift: 0.012 },
        gankDirect: 0.05,        // 이 거리 안이면 대상에게 바로
        scatter: 0.05,           // 도망칠 때 흩어지는 폭
        fight: { front: 0.008, mid: 0.018, diveIn: 0.004, flank: 0.02, back: 0.032, kite: 0.006, spread: 0.03 },
        formation: { joinR: 0.12, front: 0.034, back: 0.03, side: 0.03, moveR: 0.03, arrived: 0.62, faceR: 0.15, siegeIn: 0.85 },   // 이동 중 대형 간격 / 도착 후 배율
      },
      campRespawn: 135,
      regenPerSec: 0.004,      // 비전투 체력 회복
      recallHp: 0.32,          // 이 체력 아래면 귀환
      recallGoldExtra: 250,    // 다음 아이템 가격 + 이 골드가 모이면 귀환 고려
      // 교전
      clusterLink: 0.07,       // 이 거리 안의 선수들을 한 무리로 묶음
      engageRange: 0.065,      // 적과 이 거리 안이면 교전 개시 판정
      fightRadius: 0.085,      // 교전 중심에서 이 거리 안이면 참여
      joinRange: 0.33,         // 아군 교전에 합류하러 가는 거리
      fightMaxTicks: 4, fightMaxTicksBig: 5,   // 교전 최대 길이(틱): 소규모 / 8명 이상
      fightSwing: 0.4,         // 교전마다 팀 집중력 (피해 배율 e^N(0,σ))
      dps: 0.046,              // 기본 초당 피해 (체력 1 = 한 명)
      powScale: 10,            // 파워 10 차이당 피해 e배
      focus: 0.6,              // 같은 대상을 집중 공격할 확률
      fleeHp: 0.25,            // 이 체력 아래면 도주
      fleeRatio: 0.65,         // 남은 전력이 상대의 이 비율 아래면 팀 전체 후퇴
      fleeRatioBig: 0.35,       // 8명 이상 큰 교전 후퇴 기준 (더 오래 버팀)
      bigFightDps: 2.6,         // 8명 이상 큰 교전 피해 배율 (본 교전)
      bigFightOpen: 1.6,        // 큰 교전 첫 교환(5초) 피해 배율
      fleeHpBig: 0.08,          // 큰 교전 개인 도주 체력
      lastFleeHp: 0.7, lastEscape: 0.4,   // 큰 교전에서 혼자 남으면 체력 70% 아래에서 빠지고, 잡힐 확률 40%
      mutualDisengage: 0.18,   // 큰 교전 첫 5초 뒤 팽팽하면 양 팀이 빠질 확률
      catchSmall: 0.3,         // 5명 이하 교전에서 잡힐 확률 배율 (도주가 쉬움)
      catchPerChaser: 0.05,    // 추격자 1명 늘 때마다 잡힐 확률 배율 +
      catchBase: 0.17,         // 도주자가 잡힐 기본 확률
      trade: { chance: 0.07, intensity: 0.45, fleeHp: 0.45 }, // 라인전 견제
      engage: { objective: 0.11, objTaking: { baron: 0.08, elder: 0.7 }, objTakingMin: { elder: 4 }, structure: 0.05, numbers: 0.07, gank: 0.25, roam: 0.02, late: 0.02 },
      avoidRatio: 0.8, retreatSlack: 0.02, retreatBehind: 0.02, siegeChainRadius: 0.2, siegeChainRatio: 0.9,         // 전력비가 이 아래면 교전을 피해 물러남
      // 킬 배분: 마무리 일격 = 그 대상에게 준 피해(기여) × 포지션 가중치 × 챔피언 성향
      // 오브젝트 준비 중 강가 장악: 둥지 근처(radius) 전력비로 control(둥지 앞 강가 전진)·push(상대 대기 지점까지 밀기)·hold·yield(더 뒤로)
      river: { radius: 0.35, controlEnter: 1.15, controlKeep: 0.9, pushRatio: 1.9, pushKeep: 1.6, yieldBelow: 0.7, yieldKeep: 0.8,
        boldBonus: 0.15, minHold: 10, controlDist: 0.08, yieldDist: 0.2, pushR: 0.22,
        pushKeys: ['dragon', 'grubs', 'herald'] },   // 밀어내기·뒤로 빠지기는 이 오브젝트만 (바론·장로는 강가 장악 / 대기까지 — 끝까지 버틴다)
      // 오브젝트 스탠스 (등장 1분 전 한 번 결정) · 진입·후퇴 히스테리시스 · 계획 최소 유지
      stance: {
        bias: { dragon: 3.8, baron: 1.4, elder: 8 },   // 정면 승부 기본 성향 (로지스틱 입력)
        importance: { dragon: 0, baron: 0.3, elder: 0.6 }, soulPoint: 0.9, stack: 0.3,
        advScale: 0.8,                // 유불리 점수 반영 배율
        w: { goldPerK: 0.25, level: 0.35, alive: 0.7, ult: 0.12, flash: 0.08, comp: 0.15, vision: 0.12 },
        tradeBelow: -0.4,             // 이보다 불리하면 교환·포기 쪽으로
        tradeShare: 0.7, contestShare: 0.6,
        tiltMental: 55, tiltEngage: 7.8, tiltChance: 0.18,   // 멘탈이 낮거나 공격적인 팀이 무리하게 싸울 확률
        scoreBase: 0.6, scoreSpan: 1.0, enterScore: 0.6, exitScore: 0.4, fightBonus: 0.15,
        holdSec: 20,                  // 오브젝트 계획 최소 유지 시간
        maxRetreats: 2,               // 한 번 등장 동안 같은 오브젝트 앞 후퇴 최대 횟수
        reenterSec: 30,               // 오브젝트 계획에서 빠진 뒤 같은 오브젝트로 다시 들어가기까지
        groupR: 0.12, groupDist: 0.22, groupUntilProg: 0.6,   // 장로·바론 견제: 모임 지점(둥지에서 0.22) 0.12 안에 4명 모일 때까지 대기 (처치 진행 60% 전까지만)
        contestKeepR: 0.3, defendKeepR: 0.28, defendMinSec: 12,   // 견제·수비 계획 유지 반경(들어올 때보다 넓게)·최소 시간
      },
      kill: {
        pos: { ADC: 0.68, MID: 0.59, JGL: 0.65, TOP: 0.66, SUP: 0.18 },
        dmgSup: 0.4,             // 딜 서폿(마법사·원딜·암살자형 서폿)은 서폿 중 높게
        dmgExp: 0.5,              // 피해 기여 반영 지수 (1 = 기여에 비례)
        cls: { apAssassin: 1.3, lethality: 1.25, mageBurst: 1.15, adcCrit: 1.1, adcLethal: 1.15, adcOnhit: 1.05, ezreal: 1.05, smolder: 1.05, yasuo: 1.15, gpCrit: 1.05,
               skirm: 1.1, mageControl: 1.0, mageBattle: 1.0, apFighter: 1.0, bruiser: 0.9, tank: 0.6, apTank: 0.65, tankSup: 0.55, enchant: 0.5 },
      },
      buffDps: { baron: 0, elder: 0.45, soul: 0.10, dragon: 0.025 }, // 피해 배율 가산 (바론 버프는 교전 피해를 올리지 않음)
      // 구조물
      towerRange: 0.05,
      towerDps: 0.035,         // 미니언 없이 포탑 아래 들어간 챔피언이 초당 잃는 체력
      champStructDps: 0.0085,  // 챔피언 1명 초당 구조물 피해 (구조물 체력 1)
      lateStructFrom: 1800, lateStructPerMin: 0.14,   // 30분 이후 1분마다 챔피언 구조물 피해 +14%
      veryLateFrom: 2700, veryLatePerMin: 0.25,       // 45분 이후 1분마다 +25% 추가 (끝없는 장기전 방지)
      minionStructDps: 0.0018, // 미니언 웨이브 초당 구조물 피해
      superMinionMult: 3,
      structHp: { tower: [1, 1.25, 1.35], inhib: 1.0, nexusTower: 1.1, nexus: 1.4 },
      fortifyUntil: 300,       // 이 시간 전에는 포탑 피해 -70%
      plateUntil: 720,         // 이 시간 전에는 외곽 포탑 피해 -35% (포탑 방패)
      grubsStructBonus: 0.06,  // 유충 1마리당 구조물 피해 +6%
      baronStructBonus: 0.04,  // 바론 버프 중 챔피언의 구조물 피해 +4%
      baronMinionMult: 1.1,    // 바론 버프 선수 근처 미니언의 구조물 피해 배율
      baronFarmMult: 1.08, baronDenyMult: 1.0,    // 바론 버프 중 강화 미니언: 버프 팀 파밍 +8%, 상대 파밍 그대로
      recallChannelBaron: 4,   // 바론 버프 중 귀환 채널링(초)
      closeLead: 2500,         // 기지가 열렸을 때 이만큼 앞서면 인원이 같아도 넥서스를 치러 간다
      reopenAt: 2400,          // 40분 이후: 앞선 팀은 되살아난 억제기도 다시 민다
      nexusMinAttackers: 3,    // 넥서스 공격 최소 인원 (상대 기지 안)
      // 웨이브
      wave: { every: 30, perWave: 6, trade: 0.05, towerKill: 0.4, max: 30 },   // 웨이브 크기: 30초마다 6마리, 초당 교환 비율, 포탑이 초당 줄이는 수
      wavePush: 0.012,         // 라인 앞 챔피언 전력 1당 웨이브 이동 (s/틱)
      waveMaxStep: 0.03,
      waveRelax: 0.006,        // 아무도 없을 때 가운데로 돌아가는 속도
      // 오브젝트 처치 시간 [최소, 최대] 초 (인원·골드가 많을수록 최소 쪽)
      objTime: { grubs: [30, 45], herald: [35, 50], dragon: [25, 40], baron: [40, 70], elder: [30, 45], atakhan: [35, 55] },
      baronEarlyMult: 1.3,     // 25분 이전 바론 처치 시간 배율
      baronFewMult: 1.2,       // 4명 미만 바론 처치 시간 배율
      setupLead: 60,           // 오브젝트 등장 이 시간 전부터 시야 장악
      objDrain: { baron: 0.015 }, objDrainFloor: 0.4,   // 오브젝트 치는 동안 초당 체력 감소 (하한)
      stealBase: 0.3,  stealPerMech: 0.004,
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
      killShare: { ADC: [0.27, 0.32], MID: [0.22, 0.27], JGL: [0.17, 0.22], TOP: [0.14, 0.19], SUP: [0.03, 0.08] },  // 팀 킬 중 포지션 비율
      supAssistRankMax: 2,     // 서폿 평균 어시스트가 팀 안에서 이 순위 안
      objCombosMin: 40,        // 바론·드래곤·장로 생성 장면 "상황+장소+인원" 조합 종류 하한
      objComboMaxShare: 0.10,  // 한 조합이 전체 생성 장면에서 차지하는 비율 상한
      recentTitleGames: 10,    // 최근 몇 경기 안에서 같은 장면 제목 금지
      objFightRate: { dragon: [0.35, 0.50], baron: [0.40, 0.55], elder: [0.70, 0.85] },  // 오브젝트 등장 중 한타로 이어지는 비율
      baronSwing: [1500, 3000],  // 바론 처치~버프 종료 동안 늘어나는 골드 격차 평균
      baronSwingP90: 4000,       // 그 상위 10% 하한
      baronWinRate: [0.70, 0.80],// 첫 바론 처치 팀 승률
      // 이동 자연스러움: 방향 전환 = 최고 속도의 turnMinFrac 이상 움직인 초끼리 reverseDeg 이상 꺾임, turnWindow초 안에 turnMax번이면 위반
      move: { turnMinFrac: 0.25, reverseDeg: 150, turnWindow: 5, turnMax: 3, laneWaveDist: [0.01, 0.06] },   // 라인전 라이너 ↔ 자기 웨이브 평균 거리 목표
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
    obj: {   // 바론·드래곤·장로 생성 장면
      radius: 0.3,      // 둥지 반경 (인원 계산·장면 참여자)
      chance: 0.65,     // 상황이 맞을 때 생성 장면을 쓸 확률 (나머지는 다른 장면)
      visionOnlyChance: 0.25,  // '등장 전 시야 싸움'만 성립할 때 생성 장면을 쓸 확률
      sitWeight: { theyTake: 3, weTake: 3, pickedEnemy: 3, pickedAlly: 3, standoff: 2.5, lateDouble: 2.5, buffSiege: 2, spawnVision: 0.8, sideOut: 0.6 },
    },
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
  tierOvr: { S: 83, A: 79.5, B: 77, C: 76, D: 71 }, // 1군 평균 OVR (팀 티어별)
  academyOffset: -12,                                 // 2군 평균 = 1군 - 12
  rookieMainOffset: -2,                               // 1군으로 바로 뽑는 신인 = 팀 평균 - 2
  regionOffset: { LCK: 0, LPL: 1.5, LEC: -2, LCS: -4, CBLOL: -6, LCP: -4 }, // 지역별 전력 보정 (국제대회 밸런스)
  tierThresholds: { S: 82, A: 78, B: 74, C: 70 },     // 시즌마다 1군 평균 OVR로 팀 티어 재계산
  userStartAvg: 55,
  // ---------------- 슈퍼스타 ----------------
  stars: {
    // 잠재력 등급 = 도달 가능한 최대 OVR
    potGrade: { S: [95, 99], A: [88, 94], B: [80, 87], C: [72, 79] },
    rookieOdds: { S: 0.04, A: 0.15, B: 0.41, C: 0.4 },     // 새 유망주 등급 확률
    rookieBoost: { S: 5, A: 2, B: 0, C: -1 },             // 등급별 데뷔 능력치 보정
    // LCK 1군 50명 OVR 분포 (게임 시작)
    lck: { n90: [4, 6], n85: [8, 12], nLow: [3, 6], r90: [90, 94], r85: [85, 89], rMid: [75, 84], rLow: [68, 74], maxPerTeam: 2, benchGap: [2, 5] },   // benchGap: 같은 포지션 경쟁 선수는 주전보다 이만큼 낮게
    tierW: { S: 5, A: 2, B: 1, C: 0.5, D: 0.3 },          // 90+ 배정 가중치 (팀 티어)
    overseas: { n: [3, 5], r: [90, 94], lecChance: 0.3 },  // 해외 슈퍼스타 (LPL 중심)
    spikeChance: 0.5, spike: [6, 12], spikeMax: 99,       // 한 가지 압도형: 핵심 능력치 1~2개가 튐
    starOvr: 90,                                           // 슈퍼스타 기준
    // 캐리 보정: 슈퍼스타가 솔로킬·한타·스틸의 주인공이 될 확률
    carry: { kill: 1.35, steal: 0.06, perOvr: 0.1 },
    topFrom: 87, topGrowth: 0.5,   // OVR 87 이상은 성장 속도 50%
    starAge: [21, 28], aceAge: [20, 27],   // 게임 시작 때 90+ / 85~89 선수 나이
    growK: 0.27,            // AI 성장: (잠재력 - OVR) × growK × 나이 보정 / 시즌
  },
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
    declineStartAge: 26, declinePerYear: [0.6, 1.6, 2.6, 3.6, 4.6], // 26세부터 매년 하락폭
    masteryGain: { practice: 3.2, solo: 1.6, match: 2.2, scrim: 0.8 },
    potentialRange: [68, 99],
    growthRange: [0.75, 1.35],
    varianceRange: [1, 10],
  },

  // ---------------- 일상 ----------------
  daily: {
    // 하루 1개 활동: 효과(성장·숙련도·피로·멘탈·케미·팬·수입) = 예전 한 칸 × 이 배율
    // (처음 2.5 → 경기일에 활동이 없어 하루 활동량이 예전보다 적어서 tools/sim-career.mjs 비교로 3.0에 맞춤)
    ACTIVITY_DAY_MULTIPLIER: 3.0,
    streakFrom: 3, streakStep: 0.15, streakMin: 0.55,   // 같은 훈련 3일째부터 -15%씩, 최소 55%
    recoveryDay: { fatigue: 8, mental: 2, restMult: 1.3 }, // 경기 다음 날: 피로 -8, 멘탈 +2, 휴식 효과 ×1.3
    fatigueWarn: 70,                                       // 활동 선택 화면 경고 기준 (훈련 효과 감소·부상 위험)
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
    koShare: 0.4,                        // 실제 로스터 선수를 한글 표기(예: 페이커)로 부를 확률
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
    // 경기 미니맵: 궤적 길이(초), 이 거리보다 1초에 멀리 옮겨지면 보간 없이 바로(귀환·순간이동), 미니언 점 하나 = minionPer마리
    minimap: { trailSec: 20, jump: 0.05, minionPer: 2, minionMaxDots: 10, minionGap: 0.006 },
  },
};
