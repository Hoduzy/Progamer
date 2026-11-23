export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const round1 = v => Math.round(v * 10) / 10;
export const avg = arr => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
export const sum = arr => arr.reduce((s, v) => s + v, 0);
export const logistic = x => 1 / (1 + Math.exp(-x));
export const POS = ['TOP', 'JGL', 'MID', 'ADC', 'SUP'];
export const POS_KO = { TOP: '탑', JGL: '정글', MID: '미드', ADC: '원딜', SUP: '서폿' };
export const STAT_KEYS = ['laning', 'teamfight', 'mechanics', 'decision', 'vision', 'mental', 'pool', 'stamina'];
export const STAT_KO = {
  laning: '라인전', teamfight: '한타', mechanics: '피지컬', decision: '판단력',
  vision: '시야', mental: '멘탈', pool: '챔프폭', stamina: '체력',
};

export function fmtTime(sec) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
export function fmtGold(g) { return (g / 1000).toFixed(1) + 'K'; }
export function fmtWon(w) {
  w = Math.round(w);
  const eok = Math.floor(w / 1e8), man = Math.floor((w % 1e8) / 1e4);
  if (eok > 0) return `${eok}억${man ? ' ' + man.toLocaleString() + '만' : ''} 원`;
  return `${man.toLocaleString()}만 원`;
}
export function fmtNum(n) { return Math.round(n).toLocaleString(); }

// 날짜: 'YYYY-MM-DD' 문자열 (UTC 기준으로 계산)
export function dateAdd(d, days) {
  const dt = new Date(d + 'T00:00:00Z');
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
export function dateDiff(a, b) { // b - a (일)
  return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
}
export function weekday(d) { return new Date(d + 'T00:00:00Z').getUTCDay(); } // 0=일
export const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];
export function fmtDate(d) {
  const [y, m, dd] = d.split('-').map(Number);
  return `${y}년 ${m}월 ${dd}일 (${WEEKDAY_KO[weekday(d)]})`;
}
export function fmtDateShort(d) {
  const [, m, dd] = d.split('-').map(Number);
  return `${m}/${dd}`;
}
export function fill(tpl, vars) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`));
}
export function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function deepClone(o) { return JSON.parse(JSON.stringify(o)); }
