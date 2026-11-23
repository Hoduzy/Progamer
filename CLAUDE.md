# LCK 프로게이머 커리어 게임 — 작업 규칙

개인용 브라우저 게임 (바닐라 ES 모듈, 빌드 없음). 화면 문구는 모두 한국어.
설계: `docs/DESIGN.md`, 경기 엔진 정합성 수정 기록: `docs/MATCH_FIX.md`.

## 반드시 지킬 것

- **경기 엔진(`js/engine/match.js`, `matchcore.js`, `teamai.js`, `combat.js`, `world.js`, `mapgeo.js`, `choices.js`, `commentary.js`, `data/map.js`, `data/scenarios.js`, `data/sceneNeeds.js`, `data/commentary.js`, `CONFIG.match`)을 고칠 때마다**
  ```
  node tools/validate-match.mjs 500
  ```
  를 돌려 **위반 0건과 "결과: 통과 ✓"(경기 시간·킬·한타 분포 목표 범위)** 를 확인한 뒤에만 커밋한다.
  위반이 있으면 엔진을 고치고 다시 돌린다. 검사 항목을 느슨하게 바꿔 통과시키지 않는다.
- 엔진 구조는 **계획 → 이동 → 도착 → 판정** 순서다. 이벤트를 확률로 먼저 뽑고 위치를 나중에 맞추는 코드를 다시 넣지 않는다.
  교전·오브젝트·포탑 판정은 그 자리에 실제로 있는 선수만 대상으로 한다.
- 미니맵·문자중계·주요 장면 카드·HUD는 엔진 상태와 이벤트(`ev.pos`, `ev.parts`, `ev.region`)만 읽는다. 화면 쪽에서 위치를 따로 만들지 않는다.
- 주요 장면 설명에 사실(체력, 점멸, 근처의 적, 오브젝트 진행)을 쓰면 `data/sceneNeeds.js`에 그 조건을 넣는다.
- 수치 상수는 `js/config.js`에만 둔다.
- 실제 프로 선수 이름은 쓰지 않는다 (`data/names.js` 차단 목록).

## 자주 쓰는 도구

- `node tools/validate-match.mjs [판 수] [--no-scenes] [--verbose] [--max N]` — 경기 정합성 검사 (기본 500판)
- `node tools/replay-bug.mjs bug-reports/<파일>.json` — 경기 화면 "🐞 버그 신고" 파일을 그대로 재현하고 검사·타임라인 출력
- `node tools/sim-season.mjs [시즌 수] [--chain]` — 시즌 전체 시뮬레이션 통계
- `node tools/sim-choices.mjs [반복]` — 선택 장면 확률·우월 선택지 검사
- 브라우저 확인: `python3 -m http.server 8080` 후 `http://localhost:8080` (iPad 가로 1180×820 기준)
