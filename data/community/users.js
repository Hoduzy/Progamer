// 고정 닉네임 유저 (고닉) — 반복해서 등장하는 커뮤니티 사람들
//   role : anti(내 안티) fan(내 팬) teamFan(다른 팀 팬) analyst(분석충) joker(드립충) asker(질문충) neutral(중립 고닉)
//   team : 응원 팀 코드 (teamFan만)      favor: 나에 대한 처음 호감도 (-100~100, 세이브에 저장되어 천천히 바뀜)
//   stances: 내 글이 아닐 때 주로 쓰는 댓글 성향       pre/post: 말버릇 (앞에 붙이기 / 뒤에 붙이기)
//   desc : 성격 설명 (고닉 목록 화면에 표시)
export const FIXED_USERS = [
  // 내 안티
  { id: 'a1', nick: '협곡검사관', role: 'anti', favor: -72, stances: ['rebut', 'info'], pre: ['팩트만 말함.', ''], post: ['팩트임', '반박 ㄴ', ''], desc: '지표로 까는 데이터형 안티. 잘해도 "표본이 작다"고 함.' },
  { id: 'a2', nick: '거품감별사', role: 'anti', favor: -80, stances: ['sarcasm', 'rebut'], pre: [''], post: ['거품 ㅇㅇ', '두고 봐라', ''], desc: '모든 선수를 거품이라고 부르는 사람. 특히 나한테 집착.' },
  { id: 'a3', nick: '롤잘알노예', role: 'anti', favor: -65, stances: ['sarcasm', 'joke'], pre: ['ㅋㅋㅋ', ''], post: ['하던데 ㅋㅋ', 'ㅋㅋㅋ', ''], desc: '비꼬기 장인. 칭찬하는 척하면서 깐다.' },
  { id: 'a4', nick: '라이벌주전가자', role: 'anti', favor: -60, rivalFan: true, stances: ['side', 'rebut'], pre: [''], post: ['{라이벌} 주전 가자', '', ''], desc: '경쟁자 팬. 내가 나오기만 하면 경쟁자를 쓰라고 한다.' },
  // 내 팬
  { id: 'f1', nick: '1호팬_협곡', role: 'fan', favor: 85, stances: ['cheer', 'shield'], pre: ['', '우리 {선수}'], post: ['♡', '사랑한다', ''], desc: '데뷔 때부터 응원한 1호 팬. 안티를 보면 못 참는다.' },
  { id: 'f2', nick: '쉴드장인', role: 'fan', favor: 75, stances: ['shield', 'rebut'], pre: [''], post: ['쉴드 아님 팩트임', ''], desc: '어떤 상황에서도 나를 감싸는 사람. 안티와 매일 싸움.' },
  { id: 'f3', nick: '직관개근러', role: 'fan', favor: 70, stances: ['cheer', 'info'], pre: ['직관 갔다 왔는데', ''], post: ['현장 분위기 미쳤음', ''], desc: '모든 경기 직관하는 팬. 현장 소식을 전한다.' },
  { id: 'f4', nick: '성장일기', role: 'fan', favor: 60, stances: ['info', 'shield'], pre: [''], post: ['그래프 우상향 중', ''], desc: '내 성장 기록을 정리하는 분석형 팬. 못하면 조용히 실망한다.' },
  // 다른 팀 팬
  { id: 't1', nick: '젠지만세', role: 'teamFan', team: 'GEN', favor: 0, stances: ['side', 'sarcasm'], pre: [''], post: ['젠지 화이팅', ''], desc: '젠지 팬. 젠지가 이기면 모든 글에 나타난다.' },
  { id: 't2', nick: '한화불꽃놀이', role: 'teamFan', team: 'HLE', favor: 0, stances: ['side', 'curse'], pre: [''], post: ['한화 가자', ''], desc: '한화 팬. 다혈질이라 욕을 자주 한다.' },
  { id: 't3', nick: '티원팬30년차', role: 'teamFan', team: 'T1', favor: 0, stances: ['side', 'info'], pre: ['라떼는', ''], post: ['T1 클라스', ''], desc: 'T1 올드 팬. 옛날 얘기를 자주 꺼낸다.' },
  { id: 't4', nick: '케티의봄', role: 'teamFan', team: 'KT', favor: 0, stances: ['side', 'cheer'], pre: [''], post: ['케티 올해는 다르다', ''], desc: 'kt 팬. 매년 "올해는 다르다"고 한다.' },
  { id: 't5', nick: '디플매직', role: 'teamFan', team: 'DK', favor: 0, stances: ['side', 'rebut'], pre: [''], post: ['디플 믿는다', ''], desc: '디플러스 기아 팬. 다른 팀 팬과 자주 싸운다.' },
  // 분석충·드립충·질문충·중립
  { id: 'n1', nick: '밴픽연구소', role: 'analyst', favor: 10, stances: ['info', 'rebut'], pre: ['밴픽 관점에서 보면', ''], post: ['', '내 생각임'], desc: '밴픽 분석충. 모든 패배를 밴픽 탓으로 본다.' },
  { id: 'n2', nick: '데이터맨', role: 'analyst', favor: 0, stances: ['info', 'agree'], pre: ['데이터상', ''], post: ['', '(출처: 공식 기록)'], desc: '숫자만 믿는 사람. 내가 잘하면 호감도가 오른다.' },
  { id: 'n3', nick: '드립장인', role: 'joker', favor: 15, stances: ['joke', 'joke', 'sarcasm'], pre: [''], post: ['ㅋㅋㅋㅋ', ''], desc: '드립충. 모든 글에 드립을 단다.' },
  { id: 'n4', nick: '킹받는고양이', role: 'joker', favor: -10, stances: ['joke', 'sarcasm'], pre: [''], post: ['냥', 'ㅋㅋ', ''], desc: '말끝마다 "냥"을 붙이는 드립충. 은근히 깐다.' },
  { id: 'n5', nick: '롤알못입문', role: 'asker', favor: 20, stances: ['ask', 'ask', 'cheer'], pre: ['롤알못인데', ''], post: ['', '알려주세요 ㅠ'], desc: '롤 입문자. 질문을 많이 한다.' },
  { id: 'n6', nick: '중립기어박음', role: 'neutral', favor: 0, stances: ['agree', 'rebut', 'info'], pre: ['중립에서 보면', ''], post: ['', '중립임'], desc: '중립 고닉. 성적대로 판단한다.' },
  { id: 'n7', nick: '평화주의자', role: 'neutral', favor: 5, stances: ['agree', 'cheer'], pre: [''], post: ['', '다들 싸우지 마요'], desc: '싸움 말리는 사람. 대댓글 싸움이 나면 꼭 나타난다.' },
];
