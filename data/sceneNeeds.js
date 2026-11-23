// ============================================================
//  선택 장면의 "실제 상황" 조건
//  장면 설명에 적힌 사실(체력, 점멸, 근처에 있는 적, 오브젝트 진행 등)이
//  엔진 상태와 맞을 때만 그 장면을 고른다. 숫자는 엔진 값으로 채운다.
//
//  need(s): s = 엔진 상황 (js/engine/choices.js situation())
//    s.near('ejg')        상대 정글이 장면 반경 안에 있는지 (opp, ejg, emid, eadc, esup, etop / atop, ajg, amid, aadc, asup / bounty)
//    s.hp('eadc')         체력 0~1     s.flash('opp') / s.ult('me')
//    s.nE, s.nA           장면 반경 안 적 / 아군(나 제외) 수
//    s.inSide             내가 탑·바텀 라인에 있는지   s.region
//    s.ownTowerNear       내 근처(0.1) 아군 포탑   s.enemyTowerNear(p) 그 선수 근처 상대 포탑
//    s.prog(k)            오브젝트 처치 진행 { mine, val, n } 또는 null    s.soon(k, 초)
//  desc: 설명 문장 교체 (변수 {opphp} 등은 엔진 값)
//  noFight: 근처에 적이 없어도 되는 장면 (넥서스 백도어 등)
//  remote: 다른 곳에서 벌어지는 일을 다루는 장면 — 장면 위치가 내 위치와 달라 쓰지 않음
// ============================================================
export const SCENE_NEEDS = {
  mid_roam: { remote: true },
  mid_tp_save: { remote: true },
  top_tp: { remote: true },
  top_backline_tp: { remote: true },
  sup_roam: { remote: true },

  mid_solo: { need: s => s.near('opp') && s.hp('opp') < 0.5 && s.flash('opp'), desc: '{opp}의 체력이 {opphp}% 남았다. 상대는 점멸이 있는 상태.\n정글 위치는 확인되지 않았다.' },
  mid_flank: { need: s => s.nE >= 2 && s.ult('me'), desc: '양 팀이 {where}에서 대치 중. 상대 딜러진이 앞으로 나와 있다.\n{me}의 궁극기로 측면을 노릴 수 있다.' },
  mid_lvl6: { need: s => s.near('opp') && !s.near('ejg') },
  mid_side_wave: { need: s => s.inSide && (s.soon('baron', 90) || s.soon('dragon', 90)), desc: '{where}에 큰 웨이브가 쌓여 있다. 상대 위치가 일부 보이지 않는다.\n곧 오브젝트 타이밍이다.' },
  mid_baron_zone: { need: s => s.near('esup') },
  mid_counter_gank: { need: s => s.near('ejg'), desc: '와드에 {ejg}이(가) 내 쪽으로 오는 모습이 찍혔다.\n내 체력은 {myhp}%, 점멸은 {myflash}.' },
  mid_carry: { need: s => s.nE >= 3 && s.near('eadc') && s.ult('me') && s.flash('me') },
  mid_invade: { need: s => s.near('ejg'), desc: '웨이브를 먼저 밀었다. 상대 {ejg}이(가) 근처 캠프를 정리하고 있다.\n{ajg}이(가) 함께 덮치자고 한다.' },
  jgl_track: { need: s => s.near('ejg') && s.soon('grubs', 120), desc: '{ejg}의 동선이 보인다. 근처 캠프로 향하는 중이다.\n오브젝트도 곧 열린다.' },
  jgl_first_gank: { need: s => s.near('etop') && !s.near('ejg') },
  jgl_dragon_smite: { need: s => s.near('ejg') && !!s.prog('dragon') },
  jgl_baron_smite: { need: s => s.near('ejg') && !!s.prog('baron') && s.prog('baron').val >= 0.5, desc: '내셔 남작 처치가 {objpct}% 진행됐다. 상대 {ejg}이(가) 근처에서 강타를 노린다.\n강타 하나에 게임이 기운다.' },
  jgl_invade: { need: s => s.near('ejg'), desc: '상대 캠프 근처에서 {ejg}과(와) 마주쳤다.\n미드 주도권은 우리에게 있다.' },
  jgl_herald: { need: s => !s.near('ejg'), desc: '협곡의 전령이 등장했다. 탑 라인 주도권은 우리 쪽이다.\n상대 정글은 근처에 보이지 않는다.' },
  jgl_counter: { need: s => s.near('ejg') && (s.near('aadc') || s.near('asup')), desc: '{ejg}이(가) 아군 바텀을 갱킹하고 있다. 내가 바로 근처에 있다.' },
  jgl_engage: { need: s => s.nE >= 2, desc: '오브젝트 앞 대치. 상대 {nE}명이 {where}에 서 있다.\n{me}의 진입 스킬이 준비됐다.' },
  jgl_scuttle: { need: s => s.near('ejg') && /River/.test(s.region), desc: '양 팀 정글이 {where}에서 마주쳤다. 미드 주도권은 비슷하다.' },
  jgl_ambush: { need: s => s.near('esup'), desc: '상대 {esup}이(가) 와드를 박으러 들어왔다. 근처에 상대 시야가 없다.' },
  jgl_gank_dive: { need: s => s.near('eadc') && s.hp('eadc') < 0.65 && s.enemyTowerNear('eadc'), desc: '아군 바텀이 라인을 밀었다. {eadc}의 체력은 {eadchp}%. 포탑 아래다.\n{asup}이(가) 다이브 콜을 했다.' },
  jgl_void: { need: s => s.near('ejg'), desc: '공허 유충이 등장했다. 상대 {ejg}이(가) 근처에 있다.\n아군 탑 {atop}의 체력은 {atophp}%.' },
  top_solo: { need: s => s.near('opp') && !s.near('ejg'), desc: '{opp}이(가) 스킬을 빗나갔다. 지금 들어가면 맞딜 각이 나온다.\n상대 정글은 근처에 없다.' },
  top_freeze: { need: s => s.near('opp') && s.ownTowerNear },
  top_gank_threat: { need: s => s.near('ejg'), desc: '{ejg}이(가) 근처 와드에 찍혔다. 라인은 상대 포탑 쪽에 있다.' },
  top_split: { need: s => s.inSide && !s.near('etop'), desc: '팀은 다른 곳에서 대치 중. 나는 {where}를 밀고 있다.\n상대 {etop}이(가) 아직 보이지 않는다.' },
  top_frontline: { need: s => s.nE >= 3 },
  top_lvl2: { need: s => s.near('opp') && s.me.level <= 2, desc: '라인 초반. 내가 다음 미니언을 먹으면 레벨 업을 먼저 한다.' },
  top_herald_fight: { need: s => !!(s.prog('herald') || s.prog('grubs')) && (s.prog('herald') || s.prog('grubs')).mine && (s.near('ejg') || s.near('etop')), desc: '아군이 바론 둥지에서 오브젝트를 치고 있다. 상대가 접근한다.' },
  top_1v2: { need: s => s.near('etop') && s.near('ejg') && s.nA === 0 && s.ownTowerNear, desc: '상대 탑과 정글이 내 포탑을 다이브하려 한다. 아군은 근처에 없다.' },
  adc_assassin: { need: s => s.near('emid') && s.near('asup') },
  adc_2v2: { need: s => s.near('eadc') && s.near('asup') },
  adc_dive_def: { need: s => s.near('ejg') && (s.near('eadc') || s.near('esup')) && s.ownTowerNear, desc: '상대 정글과 바텀이 우리 포탑으로 다이브한다. 내 체력은 {myhp}%.' },
  adc_baron_dps: { need: s => !!s.prog('baron') && s.prog('baron').mine },
  adc_side_farm: { need: s => s.inSide && s.itemGold > 0, desc: '{where}에 큰 웨이브가 있다. 팀은 다른 곳에서 대치 중.\n다음 아이템까지 {itemgold}골드 남았다.' },
  adc_position: { need: s => s.nE >= 3 && s.aliveMine === 5 && s.aliveEnemy === 5 },
  adc_no_flash: { need: s => s.near('eadc') && !s.flash('eadc'), desc: '{eadc}의 점멸이 빠져 있다. 아직 한참 남았다.' },
  adc_chase: { need: s => s.near('emid') && s.hp('emid') < 0.35, desc: '체력이 {emidhp}% 남은 {emid}이(가) 정글로 도망친다.\n상대 정글의 위치는 모른다.' },
  adc_soul: { need: s => s.near('eadc') && !!s.prog('dragon') && s.prog('dragon').mine },
  adc_lvl3_spike: { need: s => s.near('eadc') && s.itemGold <= 0, desc: '귀환 골드가 모였다. 지금 귀환하면 상대보다 먼저 아이템을 맞춘다.\n하지만 웨이브가 우리 포탑으로 밀려 오고 있다.' },
  sup_engage: { need: s => s.near('eadc') },
  sup_deep_ward: { need: s => s.soon('dragon', 90) || s.soon('baron', 90), desc: '오브젝트 타이밍이 다가온다. 상대 정글 안쪽 시야가 필요하다.' },
  sup_peel: { need: s => s.near('ejg') && s.near('aadc') },
  sup_hook: { need: s => s.near('esup') },
  sup_lvl2: { need: s => (s.near('esup') || s.near('eadc')) && s.me.level <= 2, desc: '라인 초반. 우리가 먼저 레벨 업을 한다.' },
  sup_dragon_vision: { desc: '{dragon} 드래곤이 열려 있다. 드래곤 둥지 주변 시야가 비어 있다.' },
  sup_flash_save: { need: s => s.near('ejg') && s.near('aadc') && s.hp('aadc') < 0.55, desc: '{ejg}이(가) 바텀 갱킹을 왔다. 아군 {aadc}의 체력은 {aadchp}%.' },
  sup_facecheck: { need: s => s.near('esup') },
  all_baron_steal: { need: s => !!s.prog('baron') && !s.prog('baron').mine, desc: '와드에 상대 {objn}명이 바론 둥지에 들어간 게 보인다. 바론 처치가 {objpct}% 진행됐다.\n우리 팀은 근처에 있다.' },
  all_elder: { need: s => s.aliveMine === 5 && s.aliveEnemy === 5, desc: '장로 드래곤이 등장했다. 이 싸움이 게임을 결정한다.\n양 팀 모두 다섯 명이 살아 있다.' },
  all_backdoor: { noFight: true, need: s => s.nE === 0 && s.inEnemyBase && s.enemiesInMyBase >= 2, desc: '상대 넥서스 앞이 비었다! 상대는 우리 본진을 공격 중.\n쌍둥이 포탑이 무너진 상태.' },
  all_nexus_def: { need: s => s.inMyBase && s.myDead >= 1, desc: '상대가 우리 기지까지 들어왔다. 아군 {mydead}명이 부활 대기 중.' },
  all_pick: { need: s => s.near('esup') && s.nE === 1 && s.nA >= 1, desc: '와드에 홀로 이동하는 상대 {esup}이(가) 찍혔다. 근처에 아군 {nA}명.' },
  all_tf_open: { need: s => s.nE >= 3 && s.ult('me'), desc: '양 팀이 {where}에서 마주 섰다. 내 궁극기는 준비 상태.\n누가 먼저 움직일 것인가.' },
  all_shutdown: { need: s => s.near('bounty'), desc: '상대 {bounty}에게 큰 현상금이 걸려 있다. 지금 바로 근처에 있다.' },
  all_bait: { need: s => s.near('etop') && s.hp('etop') < 0.45, desc: '상대 {etop}이(가) 체력 {etophp}%로 {where}에 서 있다. 주변 시야는 없다.' },
  all_tower_dive_def: { need: s => s.nE >= 2 && s.ownTowerNear && s.ownTowerHp < 0.7, desc: '상대 {nE}명이 아군 포탑을 공격 중. 포탑 체력은 {towerhp}%.' },
  all_enemy_baron_siege: { need: s => s.near('eadc'), desc: '상대가 바론 버프를 두르고 밀고 들어온다.\n버프 시간은 {ebaron} 남았다.' },
};
