// ============================================================
//  문자중계: 엔진 이벤트 → 문장. 화면과 검사기가 같은 함수를 쓴다.
//  문장 속 위치·오브젝트 이름은 반드시 이벤트 데이터(ev.lane / ev.region / ev.obj)에서 온다.
// ============================================================
import { LINES } from '../../data/commentary.js';
import { champName } from '../../data/champions.js';
import { fill } from '../core/util.js';
import * as geo from './mapgeo.js';

export const LANE_KO = { TOP: '탑', MID: '미드', BOT: '바텀' };
export const OBJ_NAME = { dragon: '드래곤', baron: '내셔 남작', herald: '협곡의 전령', grubs: '공허 유충', elder: '장로 드래곤', atakhan: '아타칸' };

// 이벤트 → { key, vars, pri, banner?, big? }
export function describe(g, ev) {
  const T = g.sides.map(s => s.team);
  const v = { blue: T[0].name, red: T[1].name };
  const side = ev.side != null && ev.side >= 0 ? ev.side : ev.winner != null && ev.winner >= 0 ? ev.winner : null;
  if (side != null) { v.team = T[side].name; v.enemy = T[1 - side].name; }
  const P = pid => (pid != null && g.byId[pid]) || null;
  const who = P(ev.killer) || P(ev.pid) || P(ev.splitPid);
  if (who) { v.p = who.nick; v.c = champName(who.champ); }
  const vic = P(ev.victim);
  if (vic) { v.v = vic.nick; v.vc = champName(vic.champ); }
  if (ev.lane) v.lane = LANE_KO[ev.lane];
  if (ev.region) v.where = geo.regionKo(ev.region);
  if (ev.dragon) v.dragon = ev.dragon;
  if (ev.obj) v.obj = OBJ_NAME[ev.obj];
  if (ev.kills != null) v.n = ev.kills;
  // 교전 요약: 그 교전의 첫 킬(이긴 팀 쪽)로 선수 이름을 채운다
  if (ev.fightId && ev.type !== 'kill' && ev.type !== 'multi') {
    const k = g.feed.find(e => e.type === 'kill' && e.fightId === ev.fightId && (ev.winner == null || ev.winner < 0 || e.side === ev.winner));
    if (k) { const kp = P(k.killer), vp = P(k.victim); if (kp) { v.p = kp.nick; v.c = champName(kp.champ); } if (vp) { v.v = vp.nick; v.vc = champName(vp.champ); } }
  }
  const out = (key, pri, extra = {}) => (LINES[key] ? { key, vars: v, pri, ...extra } : null);
  switch (ev.type) {
    case 'kill':
      if (!who) return null;
      if (ev.firstBlood) return out('firstBlood', 6);
      if (ev.shutdown) return out('shutdown', 5);
      return out('kill', 2);
    case 'soloKill': return out('soloKill', 7, { big: 'soloKill' });
    case 'gank': return ev.kills && ev.winner >= 0 ? out('gank', 5) : ev.kills ? null : out('gankFail', 1);
    case 'gankFail': return out('gankFail', 1);
    case 'counterGank': return ev.kills ? out('counterGank', 5) : null;
    case 'pick': return ev.kills && ev.winner >= 0 ? out('pick', 3) : null;
    case 'skirmish': return ev.kills && ev.winner >= 0 ? out('skirmish', 4) : null;
    case 'teamfight': return ev.kills >= 3 && ev.winner >= 0 ? out('teamfightWin', 6, { big: ev.kills >= 4 && !ev.obj ? 'teamfight' : null }) : out('teamfightEven', 4);
    case 'multi': return out('multi' + Math.min(5, ev.n), 6 + ev.n, { big: ev.n >= 3 ? 'multi' : null });
    case 'ace': return out('ace', 9, { banner: `${v.team} 에이스!`, big: 'ace' });
    case 'dragon':
      if (ev.soul) return out('soul', 8, { banner: `${v.team} ${ev.dragon} 드래곤의 영혼!`, big: 'soul' });
      if (ev.stolen) return out('dragonSteal', 8, { banner: `드래곤 스틸! ${v.team}` });
      return out('dragon', 4, { banner: `${v.team} ${ev.dragon} 드래곤 처치` });
    case 'elder': return out('elder', 9, { banner: `${v.team} 장로 드래곤 처치!`, big: 'elder' });
    case 'baron': return out(ev.stolen ? 'baronSteal' : 'baron', 9, { banner: `${v.team} 내셔 남작 처치${ev.stolen ? ' (스틸!)' : ''}`, big: 'baron' });
    case 'herald': return out('herald', 4, { banner: `${v.team} 협곡의 전령 처치` });
    case 'grubs': return out('grubs', 4, { banner: `${v.team} 공허 유충 처치` });
    case 'atakhan': return out('atakhan', 7, { banner: `${v.team} 아타칸 처치` });
    case 'tower':
      if (ev.first) return out('firstTower', 5, { banner: `${v.team} 첫 포탑 파괴` });
      if (ev.split) return out('split', 3);
      return out('tower', 3);
    case 'inhib': return out('inhib', 6, { banner: `${v.team} ${v.lane} 억제기 파괴` });
    case 'nexusTower': return out('nexusTower', 6);
    case 'nexus': return out('nexus', 10, { banner: `${v.team} 승리!` });
    case 'spawn':
      if (ev.obj === 'baron') return out('baronSpawn', 4);
      if (ev.obj === 'elder') return out('elderSpawn', 6);
      return null;
    case 'objStart': return ['baron', 'elder', 'dragon'].includes(ev.obj) ? out('objStart', 3) : null;
    case 'heraldSummon': return out('heraldSummon', 4);
    case 'move':
      if (ev.kind === 'tp') { v.where = geo.regionKo(geo.regionOf(...ev.to)); return out('tp', 2); }
      return null;
  }
  return null;
}

export function render(d, rnd = Math.random) {
  const arr = LINES[d.key];
  return fill(arr[Math.floor(rnd() * arr.length)], d.vars);
}

// ---------- 검사: 문장 속 위치·오브젝트 단어가 이벤트와 맞는지 ----------
const laneOk = (ev, L) => {
  if (ev.lane === L) return true;
  const r = ev.region || (ev.type === 'move' && ev.to ? geo.regionOf(...ev.to) : null);
  return !!r && geo.regionLane(r) === L;
};
const RULES = [
  [/(?<!포)탑(?!승)/, ev => laneOk(ev, 'TOP')],
  [/미드/, ev => laneOk(ev, 'MID')],
  [/바텀/, ev => laneOk(ev, 'BOT')],
  [/바론|내셔/, ev => ev.type === 'baron' || ev.obj === 'baron' || ev.region === 'baronPit'],
  [/드래곤/, ev => ['dragon', 'elder'].includes(ev.type) || ['dragon', 'elder'].includes(ev.obj) || ev.region === 'dragonPit'],
  [/전령/, ev => ev.type === 'herald' || ev.type === 'heraldSummon' || ev.obj === 'herald'],
  [/유충/, ev => ev.type === 'grubs' || ev.obj === 'grubs'],
  [/억제기/, ev => ev.type === 'inhib'],
  [/쌍둥이/, ev => ev.type === 'nexusTower'],
  [/넥서스/, ev => ev.type === 'nexus' || ev.type === 'nexusTower'],
  [/외곽/, ev => ev.type === 'tower' && ev.idx === 0],
  [/내부 포탑/, ev => ev.type === 'tower' && ev.idx === 1],
  [/한타/, ev => ev.type === 'teamfight' || ev.fightLabel === 'teamfight'],
  [/강가/, ev => /River/.test(ev.region || (ev.to ? geo.regionOf(...ev.to) : ''))],
];
// 해당 이벤트에 쓰일 수 있는 모든 문장을 검사 → 어긋난 문장 목록
export function checkEvent(g, ev) {
  const d = describe(g, ev);
  if (!d) return [];
  const bad = [];
  for (const line of LINES[d.key]) {
    const text = fill(line, d.vars);
    if (/\{\w+\}/.test(text)) { bad.push({ text, why: '빈 변수' }); continue; }
    for (const [re, ok] of RULES) if (re.test(text) && !ok(ev)) bad.push({ text, why: re.source });
  }
  return bad;
}
