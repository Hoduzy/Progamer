// 팀 데이터 — 자유롭게 수정 가능
// tier: S/A/B/C/D (초기 전력). 선수·감독은 게임 시작 시 가상 닉네임으로 생성된다.
export const LCK_TEAMS = [
  { code: 'GEN', name: '젠지', color: '#AA8A00', tier: 'S' },
  { code: 'HLE', name: '한화생명e스포츠', color: '#F37321', tier: 'S' },
  { code: 'T1', name: 'T1', color: '#E2012D', tier: 'S' },
  { code: 'DK', name: '디플러스 기아', color: '#1CC4B4', tier: 'A' },
  { code: 'KT', name: 'kt 롤스터', color: '#E4002B', tier: 'A' },
  { code: 'NS', name: '농심 레드포스', color: '#DE2027', tier: 'B' },
  { code: 'BFX', name: 'BNK 피어엑스', color: '#F5A623', tier: 'B' },
  { code: 'DRX', name: '키움 DRX', color: '#3B6CFF', tier: 'C' },
  { code: 'DNS', name: 'DN 수퍼스', color: '#7B4DFF', tier: 'C' },
  { code: 'BRO', name: '한진 브리온', color: '#0B6E4F', tier: 'C' },
];

// 첫 시즌 LCK컵 그룹
export const FIRST_CUP_GROUPS = {
  baron: ['GEN', 'T1', 'NS', 'DNS', 'BRO'],
  elder: ['HLE', 'DK', 'KT', 'BFX', 'DRX'],
};

export const OVERSEAS_TEAMS = [
  // LPL
  { region: 'LPL', code: 'BLG', name: '빌리빌리 게이밍', tier: 'S', color: '#3FA9F5' },
  { region: 'LPL', code: 'AL', name: '애니원즈 레전드', tier: 'A', color: '#C8102E' },
  { region: 'LPL', code: 'TES', name: '탑 e스포츠', tier: 'A', color: '#FF6A13' },
  { region: 'LPL', code: 'JDG', name: 'JD 게이밍', tier: 'A', color: '#D7182A' },
  { region: 'LPL', code: 'WBG', name: '웨이보 게이밍', tier: 'B', color: '#F2C200' },
  { region: 'LPL', code: 'LNG', name: 'LNG e스포츠', tier: 'B', color: '#00A0E9' },
  { region: 'LPL', code: 'IG', name: '인빅터스 게이밍', tier: 'B', color: '#9B9B9B' },
  // LEC
  { region: 'LEC', code: 'G2', name: 'G2 e스포츠', tier: 'A', color: '#E3E3E3' },
  { region: 'LEC', code: 'FNC', name: '프나틱', tier: 'B', color: '#FF5900' },
  { region: 'LEC', code: 'KC', name: '카르민 코프', tier: 'B', color: '#1E90FF' },
  { region: 'LEC', code: 'MKOI', name: '모비스타 코이', tier: 'B', color: '#7A2EFF' },
  { region: 'LEC', code: 'VIT', name: '팀 바이탈리티', tier: 'C', color: '#F7E400' },
  // LCS
  { region: 'LCS', code: 'TL', name: '팀 리퀴드', tier: 'B', color: '#0A2F5C' },
  { region: 'LCS', code: 'FLY', name: '플라이퀘스트', tier: 'B', color: '#1D6B3A' },
  { region: 'LCS', code: 'C9', name: '클라우드9', tier: 'C', color: '#00AEEF' },
  { region: 'LCS', code: 'LYON', name: '라이온', tier: 'C', color: '#D4AF37' },
  // CBLOL
  { region: 'CBLOL', code: 'PNG', name: '페인 게이밍', tier: 'C', color: '#E10600' },
  { region: 'CBLOL', code: 'LOUD', name: '라우드', tier: 'C', color: '#13FF00' },
  { region: 'CBLOL', code: 'FUR', name: '퓨리아', tier: 'C', color: '#888888' },
  { region: 'CBLOL', code: 'VKS', name: '비보 키드', tier: 'C', color: '#415FFF' },
  // LCP
  { region: 'LCP', code: 'CFO', name: 'CTBC 플라잉 오이스터', tier: 'B', color: '#00953B' },
  { region: 'LCP', code: 'TSW', name: '팀 시크릿 웨일스', tier: 'C', color: '#2E5EAA' },
  { region: 'LCP', code: 'GAM', name: 'GAM e스포츠', tier: 'C', color: '#F2B705' },
  { region: 'LCP', code: 'SHG', name: '후쿠오카 소프트뱅크 호크스 게이밍', tier: 'C', color: '#F6AB00' },
];

export const REGIONS = ['LCK', 'LPL', 'LEC', 'LCS', 'CBLOL', 'LCP'];
export const REGION_KO = { LCK: 'LCK', LPL: 'LPL', LEC: 'LEC', LCS: 'LCS', CBLOL: 'CBLOL', LCP: 'LCP' };
