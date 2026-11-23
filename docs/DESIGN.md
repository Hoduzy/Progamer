# LCK 프로게이머 커리어 — 설계 문서

개인용 싱글 플레이 웹 게임. 빌드 도구 없이 정적 파일(HTML + CSS + 바닐라 JS ES 모듈)로 동작한다.
엔진(경기·시즌·커리어)은 DOM에 의존하지 않아서 node에서 그대로 돌아간다.

---

## 1. 디렉터리 구조

```
index.html              진입점 (ES 모듈 로드)
css/style.css           전체 스타일 (남색 + 금색, 중계 그래픽 톤)
js/config.js            ★ 모든 수치 상수 (확률, 성장, 연봉, 오브젝트 시간, 대회 형식 …)
js/core/rng.js          시드 기반 난수 (sfc32), 상태 직렬화
js/core/util.js         공용 유틸 (clamp, 포맷, 날짜 등)
js/engine/              ── 화면 없는 순수 로직 ──
  mapgeo.js             미니맵 좌표(라인 경로, 포탑, 정글 캠프, 오브젝트 위치)
  players.js            선수 생성, OVR, 성장/노화, 연봉 시세
  meta.js               패치 생성, 메타 티어, 챔피언 파워
  draft.js              밴픽 순서, 피어리스, AI 밴/픽, 조합 평가, 감독 추천
  match.js              경기 엔진 (10초 틱, 선택 장면 훅)
  choices.js            선택 장면 확률 계산·판정·효과 적용
  rating.js             경기 평점, POG
  series.js             시리즈(Bo1/3/5) 진행 + 퍼스트 셀렉션 + 피어리스 상태
  tournament.js         대회 형식: 라운드 로빈, 그룹 대항전, 더블 엘리미네이션, 플레이-인, 스위스
  season.js             시즌 캘린더, 일정, 하루 진행, 대회 전환, 해외 대표 선발
  daily.js              하루 3칸 행동(훈련/솔랭/방송…), 피로·부상, 루틴
  roster.js             주전 결정, 콜업/강등, 주전 경쟁자
  career.js             계약, FA, 재계약, 이적 요청, AI 이적, 노화·은퇴·신인, 시상
  events.js             랜덤 이벤트 실행
  community.js          커뮤니티 글/댓글, 인터뷰, 뉴스
  state.js              새 게임 상태 생성, 세이브 직렬화/역직렬화
js/ui/                  ── 화면 ──
  app.js                라우터, 공용 레이아웃, 모달, 토스트
  assets.js             Data Dragon 로딩·캐시, 이미지 대체 그래픽
  save.js               localStorage 자동 저장, 슬롯 3개, JSON 내보내기/불러오기
  screens/*.js          타이틀, 캐릭터 생성, 허브, 캘린더, 팀, 선수, 순위, 패치, 커뮤니티 …
  draftScreen.js        밴픽 화면
  matchScreen.js        경기 화면(미니맵, HUD, 장면 카드)
data/
  champions.js          챔피언 100여 개: id, 이름, 포지션, 성향(1~10), 클래스
  items.js              클래스별 코어 아이템 빌드, 소환사 주문, 대체 이름
  teams.js              LCK 10팀 + 해외 24팀 (수정 가능)
  names.js              가상 닉네임 생성기 + 실존 선수 이름 차단 목록
  scenarios.js          선택 장면 (포지션별 10+, 공통 10+)
  events.js             랜덤 이벤트 30+
  commentary.js         문자중계 문장 (이벤트당 5+ 변형)
  community.js          커뮤니티 글/댓글/인터뷰 템플릿
tools/
  sim-season.mjs        시즌 10회 자동 시뮬레이션 통계
  sim-choices.mjs       선택 장면 확률·우월 선택지 검사
assets/teams/<코드>.png 팀 로고, assets/player/me.png 내 사진
```

## 2. 데이터 구조

### 2.1 선수 (Player)
```js
{
  id: 'p123', nick: 'Varion', age: 19, pos: 'MID',          // TOP JGL MID ADC SUP
  teamId: 'T1', squad: 'main' | 'academy' | 'fa' | 'retired',
  region: 'LCK',
  stats:  { laning, teamfight, mechanics, decision, vision, mental, pool, stamina }, // 1~100
  hidden: { potential, growth, variance },                  // 숨은 능력치
  form: 0,                                                   // -10~+10 (폼)
  champs: { Ahri: 72, Azir: 65, … },                         // 숙련도 0~100 (희소 저장)
  contract: { salary, endSeason, buyout, starter },
  season: { games, wins, k, d, a, ratingSum, champs:{} },    // 시즌 누적
  history: [...],                                            // 시즌별 기록
  isUser: false, rookieSeason: 2026
}
```
OVR = 포지션별 가중 평균 (`CONFIG.ovrWeights`).

### 2.2 팀 (Team)
```js
{ id:'T1', code:'T1', name:'T1', color:'#E2012D', tier:'S', region:'LCK',
  main:{TOP:pid,…}, academy:{TOP:pid,…}, bench:[pid…], coach:{nick, style, strictness},
  budget, prestige }
```

### 2.3 경기 상태 (Match)
```js
{ t, sides:[blue, red], objectives:{dragon,grubs,herald,baron,elder,atakhan}, events:[], goldHist:[],
  scenePlan:[t…], pendingScene, over, winner }
side = { team, players:[P×5], kills, towers:{TOP:[외곽,내부,억제기포탑],MID,BOT}, inhibs:{TOP,MID,BOT},
         nexusTowers, nexus, dragons:[], soul, grubs, heralds, baronUntil, elderUntil, wards:[] }
P = { pid, pos, champ, level, xp, cs, gold, items[], k,d,a, alive, respawnAt, hp, mana,
      ultReadyAt, flashReadyAt, dmg, vision, x, y, perf }
```

### 2.4 게임 전체 상태 (GameState)
```js
{ version, seed, rng:<state>, date:'2026-01-02', slot:0, season:2026,
  user:{ pid, fatigue, condition, trust, chem:{pid:값}, fans, popularity, money, injury,
         soloRank:{tier, lp, rank}, routine:[7][3], scrimScore, recentRatings[], benchStreak },
  players:{id:Player}, teams:{id:Team}, patch:{version, tiers, power, notes[]},
  season:{ comps:{id:Competition}, schedule:[…], phase, … },
  news:[], inbox:[], community:[], records:{…}, awards:[], settings:{…} }
```

## 3. 화면 목록
| 화면 | 설명 |
|---|---|
| 타이틀 | 새 게임 / 이어하기 / 불러오기(슬롯·파일) / 테스트 경기 |
| 캐릭터 생성 | 닉네임, 포지션, 나이, 플레이스타일, 주력 챔피언 3개 |
| 입단 제안 | 입단 테스트 결과 2~3팀 2군 계약 제안 |
| 메인 허브 | 오늘 일정(오전/오후/저녁), 다음 경기, 상태 값, 알림, 자동 진행 |
| 캘린더 | 월간 달력, 경기·패치·대회 일정 |
| 팀 | 1군·2군 로스터, 감독, 케미, 주전 경쟁 |
| 내 선수 | 능력치, 숨은 능력치 평가, 숙련도, 솔랭, 계약 |
| 순위·브래킷 | 대회별 순위표·브래킷·스위스 |
| 패치 노트 | 버프/너프, 메타 티어 표 |
| 커뮤니티 | 게시판(글+댓글), 뉴스 피드 |
| 메시지함 | 감독·에이전트·기자 메시지 |
| 기록실 | 커리어 기록, 트로피, 수상, 명예의 전당 |
| 설정 | 연출 옵션, 세이브 슬롯, 내보내기/불러오기 |
| 밴픽 | 피어리스 드래프트, 퍼스트 셀렉션 |
| 경기 | 미니맵 + 방송 HUD + 장면 카드 |
| 경기 결과 | 승패, 골드 그래프, 10명 스탯, POG, 평점 |
| FA | 제안 목록, 협상, 재계약, 이적 요청, 은퇴 |

## 4. 확률 공식

### 4.1 선택 장면 성공 확률
```
p = base
  + Σ w_s × (능력치_s − 60) / 10                 (옵션마다 관련 능력치 가중치 w_s)
  + (숙련도 − 50) / 10 × CONFIG.scene.masteryPer10
  + (컨디션 − 70) / 10 × condPer10
  + (멘탈 − 60) / 10 × mentalPer10
  − max(0, 피로 − 30) / 10 × fatiguePer10
  + 상황 보정: 골드 차(1천당), 살아있는 인원 차, 궁극기/점멸 미보유 패널티, 옵션 고유 보정
p = clamp(p, 5, 95)
```
표시: 판단력 ≥ `scene.exactDecision`이면 정확한 값, 아니면 `폭 = (exact − 판단력) × k` 의 범위.

판정: `r ∈ [0,100)`. `r < p` 성공. 성공 중 하위 `critShare[risk]` 비율은 대성공, 실패 중 상위 `fumbleShare[risk]` 비율은 대실패.
위험도(low/mid/high)가 높을수록 대성공·대실패 비율과 효과 폭이 커진다.

### 4.2 경기 엔진 (10초 틱)
- 수입: 포지션별 GPM × (0.85 + 파밍 능력 보정) × 라인 상태 보정, 사망 중 0.
- 라인전(0~14분): 라인마다 `laneScore = 라인전·피지컬·판단력 + 챔피언 초반 강함 + 메타 + 숙련도 + 폼 + 레벨/골드`.
  라인 상태 `lane += k × (blue − red) + 노이즈`. 매 틱 솔로킬 시도 확률, 정글 갱킹 확률(상대 정글 카운터 포함).
- 중후반: 팀 단위 `power = 평균(개인 한타 파워) + 조합(한타·이니시) + 버프(바론, 장로, 영혼, 드래곤 스택) + 인원 차 × perMan`
  `P(블루 승) = 1 / (1 + e^{−(diff + noise) / scale})`.
- 골드 → 파워: 선수 골드가 전체 평균보다 1천 많을 때마다 `fight.goldPerK` 만큼 파워.
- 멘탈 낮은 팀이 골드 열세면 `throwBase × (1 + (60 − 멘탈)/20)` 확률로 무리하다 잘리는 이벤트.
- 한타 승리 후 사망 인원·부활 시간에 따라 포탑→억제기→쌍둥이→넥서스 진격.
- 오브젝트: 드래곤(5:00, 5분 리젠, 3번째 드래곤 속성이 협곡 속성, 4스택 영혼), 장로(영혼 후 6분),
  공허 유충(8:00), 협곡의 전령(15:00), 내셔 남작(20:00, 6분 리젠, 버프 3분), 아타칸(옵션, 기본 꺼짐).
- 아이템: 챔피언 클래스별 실제 코어 아이템 순서. 구매 가능 골드가 쌓이면 순서대로 구매.

### 4.3 일상 훈련 성장
```
gain = baseGain[행동] × growth(숨은 성장 속도) × ageFactor(나이) × (1 − (stat / potential)^2) × (1 − 피로/200)
```
피로 > `injury.threshold`이면 행동마다 `(피로 − threshold) × injury.perPoint` 확률로 손목/허리 부상(3~14일).

### 4.4 주전 결정
```
score = trust × w1 + 최근 평점 평균 × w2 + 컨디션 × w3 + 스크림 점수 × w4 + OVR × w5 + 노이즈
```
결과와 항목별 비교를 이유로 보여준다. 2군에서 `callup` 기준을 넘으면 콜업, 1군에서 연속 벤치 + 부진 시 강등.

### 4.5 연봉
```
시세 = salary.base × salary.growth^(OVR − 55) × (1 + 인기 보정) × 나이 보정
```
FA 평가 점수 = 평균 평점, 수상, 인기, 나이, 잠재력 가중 합 → 팀별 관심도 → 제안(연봉, 기간, 주전 보장, 바이아웃).
협상: 인상률이 클수록 수락 확률↓, 거절 시 일정 확률로 제안 철회.

## 5. 대회 구조 (config.competitions)
| 대회 | 기간 | 형식 |
|---|---|---|
| LCK컵 | 1월 중순 ~ 3월 초 | 바론/장로 그룹 대항전(Bo3) → 플레이-인(Bo3) → 6팀 더블 엘리미네이션(Bo5). 결승 진출 2팀 → First Stand |
| First Stand | 3월 (상파울루) | 8팀: 4팀 GSL 그룹 2개(Bo5) → 4강·결승 Bo5. 우승 지역 MSI 시드 혜택 |
| LCK 1~2라운드 | 4~5월 | 더블 라운드 로빈 Bo3 |
| Road to MSI | 6월 초 | 상위 6팀 더블 엘리미네이션 Bo5 → 결승 2팀 MSI |
| MSI | 6~7월 (대전) | 플레이-인(Bo5) → 8팀 더블 엘리미네이션 Bo5 |
| LCK 3~4라운드 | 7~9월 | 더블 라운드 로빈 Bo5 |
| LCK 플레이오프 | 9월 | 5~8위 플레이-인 → 6팀 더블 엘리미네이션 Bo5 → 상위 4팀 Worlds |
| Worlds | 10~11월 (미국, 결승 뉴욕) | 플레이-인 → 스위스 16팀(3승/3패, 결정전 Bo3, 나머지 Bo1) → 8강·4강·결승 Bo5 |
| LCK CL | 시즌 전체 | 2군 리그: 1~2라운드, 3~4라운드 + 플레이오프 |

모든 시리즈는 피어리스 드래프트. 퍼스트 셀렉션: 1세트는 시드가 높은 팀, 이후 세트는 직전 세트 패배 팀이
진영 또는 픽 순서 중 하나를 고르고 상대가 나머지를 가진다.

## 6. 저장 구조
- `localStorage['lckc.auto']` : 자동 저장 (경기 종료 시, 하루 진행 시)
- `localStorage['lckc.slot1~3']` : 수동 슬롯
- `localStorage['lckc.ddragon']` : Data Dragon 캐시 (버전, 챔피언/아이템/주문 데이터)
- `localStorage['lckc.hof']` : 명예의 전당 (세이브와 무관하게 유지)
- 세이브 = `{ version, savedAt, summary, state }`. state에는 `seed`와 현재 `rng` 상태가 들어간다.
- JSON 파일 내보내기/불러오기 지원.

## 7. 난수
- `sfc32` 기반 RNG. 상태(4개 32비트 정수)를 그대로 저장 → 불러온 뒤 같은 흐름 재현.
- 경기마다 게임 RNG에서 시드를 뽑아 별도 RNG로 진행 (경기 재현 가능).
