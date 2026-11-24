// LCK 1군 로스터 — 중계 화면 표기(영문, 대소문자 그대로)와 한글 표기
// 항목: [포지션, 영문 닉네임, 한글 표기, 비중]
//   같은 포지션에 두 명이면 먼저 적힌 선수가 주전, 뒤 선수는 같은 포지션 경쟁(1군 후보)
//   비중(0~3): 게임 시작 때 팀의 슈퍼스타(OVR 90+)·에이스(85~89) 자리를 누구에게 줄지 고를 때 쓰는 우선순위.
//             능력치는 게임 안에서 따로 만들어지고, 시즌이 지나며 성장·노화로 바뀐다.
// 커뮤니티 글·댓글에서는 한글 표기를 섞어 쓴다 (예: Faker / 페이커).
export const LCK_ROSTERS = {
  GEN: [['TOP', 'Kiin', '기인', 2], ['JGL', 'Canyon', '캐니언', 3], ['MID', 'Chovy', '쵸비', 3], ['ADC', 'Ruler', '룰러', 3], ['SUP', 'Duro', '듀로', 1]],
  HLE: [['TOP', 'Zeus', '제우스', 3], ['JGL', 'Kanavi', '카나비', 3], ['MID', 'Zeka', '제카', 2], ['ADC', 'Gumayusi', '구마유시', 2], ['SUP', 'Delight', '딜라이트', 2]],
  T1: [['TOP', 'Doran', '도란', 1], ['JGL', 'Oner', '오너', 2], ['MID', 'Faker', '페이커', 3], ['ADC', 'Peyz', '페이즈', 2], ['SUP', 'Keria', '케리아', 3]],
  KT: [['TOP', 'PerfecT', '퍼펙트', 1], ['JGL', 'Cuzz', '커즈', 1], ['MID', 'Bdd', '비디디', 2], ['ADC', 'Aiming', '에이밍', 2], ['SUP', 'Ghost', '고스트', 1], ['SUP', 'Pollu', '폴루', 0]],
  DK: [['TOP', 'Siwoo', '시우', 1], ['JGL', 'Lucid', '루시드', 2], ['MID', 'ShowMaker', '쇼메이커', 2], ['ADC', 'Smash', '스매시', 1], ['SUP', 'Career', '커리어', 1]],
  NS: [['TOP', 'Kingen', '킹겐', 1], ['JGL', 'Sponge', '스펀지', 1], ['MID', 'Calix', '칼릭스', 1], ['MID', 'Scout', '스카웃', 1], ['ADC', 'Taeyoon', '태윤', 1], ['SUP', 'Lehends', '리헨즈', 2]],
  BFX: [['TOP', 'Clear', '클리어', 1], ['JGL', 'Raptor', '랩터', 1], ['MID', 'VicLa', '빅라', 1], ['MID', 'Daystar', '데이스타', 0], ['ADC', 'Diable', '디아블', 2], ['SUP', 'Kellin', '켈린', 1]],
  BRO: [['TOP', 'Casting', '캐스팅', 1], ['JGL', 'GIDEON', '기드온', 1], ['MID', 'Fisher', '피셔', 1], ['ADC', 'Teddy', '테디', 2], ['SUP', 'Namgung', '남궁', 1]],
  DRX: [['TOP', 'Rich', '리치', 1], ['JGL', 'Vincenzo', '빈첸조', 1], ['JGL', 'Willer', '윌러', 1], ['MID', 'Ucal', '유칼', 1], ['ADC', 'Jiwoo', '지우', 1], ['SUP', 'Andil', '안딜', 1]],
  DNS: [['TOP', 'DuDu', '두두', 1], ['JGL', 'Pyosik', '표식', 2], ['MID', 'Clozer', '클로저', 1], ['ADC', 'deokdam', '덕담', 1], ['SUP', 'Life', '라이프', 1], ['SUP', 'Peter', '피터', 1]],
};

// 팀·포지션별 [주전, 경쟁…] 목록
export function rosterOf(code) {
  const out = {};
  for (const [pos, nick, ko, w] of LCK_ROSTERS[code] || []) (out[pos] = out[pos] || []).push({ pos, nick, ko, w });
  return out;
}

// 영문 닉네임(소문자) → 한글 표기
export const KO_OF = Object.fromEntries(Object.values(LCK_ROSTERS).flat().map(([, nick, ko]) => [nick.toLowerCase(), ko]));
export const ROSTER_NICKS = Object.values(LCK_ROSTERS).flat().map(r => r[1]);
