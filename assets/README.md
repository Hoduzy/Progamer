# 이미지 넣는 곳

이미지가 없어도 게임은 동작합니다. 없으면 팀 색 원 안에 팀 코드/이니셜을 넣은 대체 그래픽이 나옵니다.

## 팀 로고 — `assets/teams/<팀코드>.png`
정사각형 PNG(투명 배경 권장, 256×256 정도). 파일 이름은 팀 코드와 대소문자까지 같아야 합니다.

| 지역 | 파일 이름 |
|---|---|
| LCK (포함됨) | `GEN.png` `HLE.png` `T1.png` `DK.png` `KT.png` `NS.png` `BFX.png` `DRX.png` `DNS.png` `BRO.png` |
| LPL | `BLG.png` `AL.png` `TES.png` `JDG.png` `WBG.png` `LNG.png` `IG.png` |
| LEC | `G2.png` `FNC.png` `KC.png` `MKOI.png` `VIT.png` |
| LCS | `TL.png` `FLY.png` `C9.png` `LYON.png` |
| CBLOL | `PNG.png` `LOUD.png` `FUR.png` `VKS.png` |
| LCP | `CFO.png` `TSW.png` `GAM.png` `SHG.png` |

`data/teams.js`에서 팀 코드를 바꾸면 파일 이름도 같이 바꿔 주세요.

## 내 선수 사진 — `assets/player/me.png`
정사각형 PNG/JPG를 `me.png` 이름으로 넣으면 캐릭터 화면·허브·기록실에 표시됩니다.

## 챔피언·아이템·소환사 주문·미니맵
Riot Data Dragon에서 자동으로 불러오므로 따로 넣을 필요가 없습니다.
처음 접속할 때 받은 데이터는 localStorage에 캐시되고, 인터넷이 없으면 이니셜 원과 코드로 그린 3라인 맵을 씁니다.
