# LCK 프로게이머 커리어 게임 — 작업 규칙

개인용 브라우저 게임 (바닐라 ES 모듈, 빌드 없음). 화면 문구는 모두 한국어.
설계: `docs/DESIGN.md`, 경기 엔진 정합성 수정 기록: `docs/MATCH_FIX.md`.

## 반드시 지킬 것

- **경기 엔진(`js/engine/match.js`, `matchcore.js`, `teamai.js`, `combat.js`, `world.js`, `mapgeo.js`, `choices.js`, `objScenes.js`, `commentary.js`, `data/map.js`, `data/scenarios.js`, `data/sceneNeeds.js`, `data/objScenes.js`, `data/commentary.js`, `CONFIG.match`, `CONFIG.scene`)을 고칠 때마다**
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
- LCK 1군 선수 이름은 `data/rosters.js`의 실제 로스터 영문 표기(대소문자 그대로)를 쓴다. 화면 어디서나 영문 표기, 커뮤니티 글·댓글에서만 한글 표기(예: 페이커)를 섞는다.
  그 밖의 선수(2군·신인·해외·FA)는 `data/names.js` 생성기의 영문 스타일 가상 이름이고, 차단 목록으로 실존 선수 이름을 피한다.
- 세이브 형식이 바뀌면 `state.js`의 변환(`migrateNames` 같은)으로 옛 세이브를 고치고, 고치기 전 원본을 백업 슬롯에 남긴다.
- **커뮤니티(`js/engine/community.js`, `data/community/`, `CONFIG.community`)를 고치면** `node tools/validate-community.mjs`로 위반 0건을 확인한 뒤 커밋한다.
  욕은 플레이·경기력·판단·운영에 대한 것만. 혐오(성별·지역·장애·국적), 가족 욕, 성적인 내용, 살해·자해 협박은 넣지 않는다 (`data/community/words.js`의 BANNED).
  실존 선수(로스터)는 변수(`{다른선수}` `{라이벌}` `{상대선수}` `{슈퍼스타}`)로만 등장하고 템플릿 원문에 실명을 쓰지 않는다. 센 욕(ㅅㅂ 등) 문장·`curse` 댓글에는 실존 선수를 넣지 않는다.

## 배포 (GitHub Pages)

- `main`에 push하면 `.github/workflows/pages.yml`이 배포한다. 주소: https://hoduzy.github.io/Progamer/
- 모든 경로는 상대 경로(`/`로 시작 금지), 파일 이름 대소문자 일치. `node tools/build-pages.mjs`가 검사하고 `js/assetList.js`·`sw.js` 캐시 목록·버전을 갱신한다. 파일을 추가·삭제했으면 커밋 전에 실행한다.
- 화면은 태블릿·PC(1180×820 배율)와 폰(`html.ph` + 세로 `.pt` / 가로 `.pl`) 두 모드. 화면을 고치면 폰 세로(390×664)·가로(760×340)도 확인한다.

## 자주 쓰는 도구

- `node tools/validate-match.mjs [판 수] [--no-scenes] [--verbose] [--max N]` — 경기 정합성 검사 (기본 500판)
- `node tools/replay-bug.mjs bug-reports/<파일>.json` — 경기 화면 "🐞 버그 신고" 파일을 그대로 재현하고 검사·타임라인 출력
- `node tools/sim-season.mjs [시즌 수] [--chain]` — 시즌 전체 시뮬레이션 통계
- `node tools/sim-choices.mjs [반복]` — 선택 장면 확률·우월 선택지 검사
- `node tools/validate-community.mjs [설정 수] [--show N]` — 커뮤니티 템플릿·중복·금지 표현 검사
- `node tools/build-pages.mjs [--check]` — 배포 준비·경로 검사
- 브라우저 확인: `python3 -m http.server 8080` 후 `http://localhost:8080` (iPad 가로 1180×820 기준)
