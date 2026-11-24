// 바론·드래곤·장로 장면 생성기
// 고정 장면 대신 엔진의 실제 상황(상황·장소·인원·상태·조합·내 포지션)을 조합해 제목·설명·선택지·결과를 만든다.
// 설명에 쓰는 수치(인원, 오브젝트 체력, 강타 유무, 내 체력)는 facts 에 그대로 담아 검사기가 엔진 상태와 대조한다.
import { CONFIG } from '../config.js';
import { clamp } from '../core/util.js';
import * as geo from './mapgeo.js';
import * as T from '../../data/objScenes.js';
import { CHAMPIONS, champName } from '../../data/champions.js';
import { allPlayers, byPos, ultReady, flashReady, goldDiff, trait, champCls, compTraits, nextLaneStructure } from './matchcore.js';

const C = () => CONFIG.scene.obj;
const KEYS = ['elder', 'baron', 'dragon'];
const OBJ = T.OBJ_NAME;
const dist = (p, pt) => Math.hypot(p.x - pt[0], p.y - pt[1]);
const POKE_CLS = new Set(['mageControl', 'mageBattle', 'ezreal', 'adcCrit', 'smolder']);
const inSideLane = p => { const r = geo.regionOf(p.x, p.y); return r === 'topLane' || r === 'botLane'; };

// ---------- 사실 (설명 수치의 근거) ----------
export function objFacts(g, me, key) {
  const pit = geo.OBJ_POS[key];
  const R = C().radius;
  const near = allPlayers(g).filter(p => p.alive && dist(p, pit) <= R);
  const A = near.filter(p => p.side === me.side), E = near.filter(p => p.side !== me.side);
  const o = g.obj[key];
  const S = g.sides[me.side], ES = g.sides[1 - me.side];
  const side = (s) => s.players.filter(p => p.alive && inSideLane(p) && dist(p, pit) > R).length;
  const ej = byPos(ES, 'JGL'), aj = byPos(S, 'JGL');
  return {
    key, nA: A.length, nE: E.length, aSide: side(S), eSide: side(ES),
    aliveA: S.players.filter(p => p.alive).length, aliveE: ES.players.filter(p => p.alive).length,
    objHp: o.alive ? Math.round((o.prog ? 1 - o.prog.val : 1) * 100) : null,
    eSmite: !!(ej.alive && dist(ej, pit) <= R && g.t >= (ej.smiteAt || 0)),
    aSmite: !!(aj.alive && dist(aj, pit) <= R && g.t >= (aj.smiteAt || 0)),
    myHp: Math.round(me.hp * 100),
    ultA: A.filter(p => ultReady(g, p)).length, ultE: E.filter(p => ultReady(g, p)).length,
  };
}

// ---------- 상황 찾기 ----------
function pickObjective(g, me) {
  let best = null;
  for (const k of KEYS) {
    const o = g.obj[k];
    if (!o || o.done) continue;
    const soon = o.alive || (o.next !== null && o.next > g.t && o.next - g.t <= 60);
    if (!soon) continue;
    const pit = geo.OBJ_POS[k];
    const d = dist(me, pit);
    const busy = allPlayers(g).filter(p => p.alive && dist(p, pit) <= C().radius).length;
    const pitScene = d <= C().radius;
    const sideScene = !pitScene && inSideLane(me) && busy >= 4 && (o.alive || k !== 'dragon');
    if (!pitScene && !sideScene) continue;
    if (busy < 3 && !(o.prog)) continue;
    if (!best || d < best.d) best = { key: k, d, place: pitScene ? null : 'sideLane' };
  }
  return best;
}
function placeOf(me, key, side) {
  const pit = geo.OBJ_POS[key];
  const d = dist(me, pit);
  if (d <= 0.06) return 'pitFront';
  const nx = geo.nexusPos(side);
  const ux = nx[0] - pit[0], uy = nx[1] - pit[1], L = Math.hypot(ux, uy);
  const vx = me.x - pit[0], vy = me.y - pit[1];
  const along = (vx * ux + vy * uy) / L;          // + 우리 기지 쪽
  const lat = Math.abs(vx * uy - vy * ux) / L;
  const reg = geo.regionOf(me.x, me.y);
  if (along < -0.02) return 'behindWall';
  if (/River/.test(reg)) return 'riverMouth';
  if (lat > Math.max(0.05, along * 0.8) || /Jungle/.test(reg)) return 'flank';
  return 'pitFront';
}
function situations(g, me, key, f, place) {
  const o = g.obj[key];
  const S = g.sides[me.side], E = g.sides[1 - me.side];
  const out = [];
  if (!o.alive) out.push('spawnVision');
  else {
    if (o.prog && o.prog.side === me.side) out.push('weTake');
    if (o.prog && o.prog.side !== me.side) out.push('theyTake');
    if (!o.prog && f.nA >= 2 && f.nE >= 2) out.push('standoff');
  }
  const recent = g.feed.filter(e => e.type === 'kill' && e.t >= g.t - 25);
  if (recent.some(e => g.byId[e.victim].side !== me.side && !g.byId[e.victim].alive)) out.push('pickedEnemy');
  if (recent.some(e => g.byId[e.victim].side === me.side && !g.byId[e.victim].alive)) out.push('pickedAlly');
  if (f.aSide + f.eSide > 0 || place === 'sideLane') out.push('sideOut');
  if (key !== 'baron' && (S.baronUntil > g.t || E.baronUntil > g.t)) out.push('buffSiege');
  const soon = k => { const x = g.obj[k]; return x && !x.done && (x.alive || (x.next !== null && x.next > g.t && x.next - g.t <= 90)); };
  if (g.t >= CONFIG.match.midEnd && soon('elder') && soon('baron')) out.push('lateDouble');
  return out;
}

// ---------- 조합·역할 ----------
function compOf(g, side) {
  const ps = g.sides[side].players;
  const tr = compTraits(ps.map(p => p.champ));
  const poke = ps.filter(p => POKE_CLS.has(champCls(p))).length;
  const flankers = ps.filter(p => trait(p, 'mobility') >= 7).length;
  if (tr.engage >= 7.5) return 'engage';
  if (poke >= 2) return 'poke';
  if (tr.mobility >= 6) return 'dive';
  if (flankers >= 1) return 'flank';
  return 'none';
}
const tpReady = (g, p) => p.spells && p.spells.includes('SummonerTeleport') && g.t >= (p.tpAt || 0);

// ---------- 선택지 ----------
function otherTarget(g, me, key) {
  const alt = key === 'baron' ? 'dragon' : 'baron';
  const o = g.obj[alt];
  if (o && o.alive && !o.prog) return { obj: alt };
  for (const l of ['TOP', 'MID', 'BOT']) if (nextLaneStructure(g, me.side, l)) return { tower: true };
  return null;
}
function optionDefs(g, me, key, f, sit, place, comp) {
  const o = g.obj[key];
  const adv = f.nA - f.nE;
  const gd = clamp((me.side === 0 ? goldDiff(g) : -goldDiff(g)) / 1000, -8, 8);
  const mySmite = me.pos === 'JGL' && g.t >= (me.smiteAt || 0);
  const alive = o.alive;
  const ot = otherTarget(g, me, key);
  const nAo = Math.max(0, f.nA - 1);   // 나 빼고 근처 아군
  const k1 = Math.min(1, f.nE), k2 = Math.min(2, f.nE), k3 = Math.min(3, f.nE);
  const ob = alive ? { obj: key } : {};
  const eob = alive ? { enemyObj: key } : {};
  const D = [];
  const add = (id, valid, base, risk, st, tags, eff, w = 1) => { if (valid) D.push({ id, base: Math.round(base), risk, st, tags, eff, w }); };
  add('steal', alive && (sit === 'theyTake' || (sit === 'standoff' && f.objHp <= 60) || (sit === 'weTake' && f.eSmite)) && f.nE >= 1,
    me.pos === 'JGL' ? 26 + (mySmite ? 10 : -16) + (f.eSmite ? -8 : 6) + (f.objHp <= 30 ? 8 : 0) : 13 + (f.objHp <= 30 ? 6 : 0), 'high',
    { mechanics: 2.5, decision: 1.5 }, ['flash'],
    [{ ...ob, kill: k1 }, { ...ob }, { ...eob }, { ...eob, death: true }], me.pos === 'JGL' ? 3 : 1);
  add('engage', f.nE >= 1 && f.nA >= 2, 44 + adv * 9 + gd * 1.5 + (f.ultA - f.ultE) * 3 + (comp === 'engage' ? 6 : 0), 'high',
    { teamfight: 2, decision: 1.5 }, ['fight', 'ult'],
    [{ ...ob, kill: k1, allyKill: Math.min(Math.max(0, f.nE - 1), nAo, 3) }, { ...ob, assist: k1, allyKill: Math.min(1, Math.max(0, f.nE - 1), nAo), allyDeath: f.nE >= 3 && nAo ? 1 : 0 },
      { ...eob, assist: k1, allyDeath: Math.min(2, nAo) }, { ...eob, death: true, allyDeath: Math.min(3, nAo) }], me.pos === 'SUP' || me.pos === 'TOP' ? 2 : 1);
  add('flank', f.nE >= 1 && place !== 'sideLane' && (place === 'flank' || place === 'behindWall' || trait(me, 'mobility') >= 7 || comp === 'flank' || comp === 'dive'),
    40 + (place === 'flank' || place === 'behindWall' ? 8 : 0) + (trait(me, 'mobility') - 5) * 2 + adv * 5, 'high',
    { mechanics: 2, decision: 1.5 }, ['fight', 'flash'],
    [{ ...ob, kill: k2 }, { kill: k1, assist: Math.min(1, Math.max(0, f.nE - 1)) }, { allyDeath: Math.min(1, nAo), ...eob }, { death: true, allyDeath: Math.min(1, nAo), ...eob }], 1.2);
  add('trade', !!ot && (sit === 'theyTake' || adv < 0 || sit === 'pickedAlly' || sit === 'sideOut'), 60, 'mid',
    { decision: 2.5 }, [],
    [{ ...(ot && ot.obj ? { obj: ot.obj } : {}), tower: ot && ot.tower ? 2 : 0 }, { ...(ot && ot.obj ? { obj: ot.obj } : {}), tower: ot && ot.tower ? 1 : 0 }, { ...eob }, { ...eob, allyDeath: Math.min(1, nAo) }], 1);
  add('retreat', true, 76 - (sit === 'pickedAlly' ? 4 : 0), 'low', { decision: 1.5 }, [],
    [{ teamGold: 150 }, { ...(alive && f.nE ? eob : {}) }, { ...eob, allyDeath: Math.min(1, nAo) }, { ...eob, death: true }], 0.8);
  add('poke', f.nE >= 1 && (comp === 'poke' || POKE_CLS.has(champCls(me)) || me.pos === 'MID') && sit !== 'spawnVision', 52 + (comp === 'poke' ? 8 : 0) + adv * 4, 'mid',
    { mechanics: 1.5, decision: 1.5 }, ['ult'],
    [{ ...ob }, { teamGold: 100 }, { ...eob }, { ...eob, death: true }], me.pos === 'MID' ? 2 : 1);
  add('ward', sit === 'spawnVision' || sit === 'standoff' || sit === 'buffSiege', 58, 'low',
    { vision: 2.5, decision: 1 }, [],
    [{ kill: k1, boost: 0.5 }, { boost: 0.5, teamGold: 100 }, {}, { death: true }], me.pos === 'SUP' || me.pos === 'JGL' ? 2.5 : 0.8);
  add('take', alive && (sit === 'weTake' || f.nE === 0 || sit === 'pickedEnemy' || adv >= 2), 58 + adv * 8 + (f.eSmite ? -8 : 0), 'mid',
    { mechanics: 1.5, teamfight: 1 }, ['fight'],
    [{ ...ob, teamGold: 200 }, { ...ob }, { assist: k1, allyDeath: Math.min(1, nAo) }, { allyDeath: Math.min(2, nAo), ...eob }], me.pos === 'ADC' ? 2.5 : 1.2);
  add('split', place === 'sideLane', 64, 'mid', { laning: 1.5, decision: 1.5 }, [],
    [{ tower: 2 }, { tower: 1 }, { ...eob }, { death: true, ...eob }], 2);
  return D;
}

// ---------- 문장 ----------
function josa(word, a, b) { const c = word.charCodeAt(word.length - 1); const has = c >= 0xac00 && c <= 0xd7a3 ? (c - 0xac00) % 28 !== 0 : false; return has ? a : b; }
function fillT(tpl, v) {
  return tpl.replace(/\{(\w+)\}(을|을|이|과|으로)?/g, (m, k, j) => {
    const val = v[k] === undefined ? m : String(v[k]);
    if (!j) return val;
    const pairs = { 을: ['을', '를'], 이: ['이', '가'], 과: ['과', '와'], 으로: ['으로', '로'] };
    return val + josa(val, ...pairs[j]);
  });
}
function stateLine(f, key) {
  const parts = [];
  if (f.objHp !== null) parts.push(`${OBJ[key]} 체력 ${f.objHp}%`);
  parts.push(`상대 정글 강타 ${f.eSmite ? '있음' : '없음'}`);
  parts.push(`궁극기 준비 우리 ${f.ultA}명 · 상대 ${f.ultE}명`);
  parts.push(`내 체력 ${f.myHp}%`);
  return parts.join(' · ');
}
function numbersText(f) {
  const split = f.aSide || f.eSide ? ` (사이드: 우리 ${f.aSide}명 · 상대 ${f.eSide}명)` : '';
  return `${f.nA}대${f.nE}${split}`;
}

// ---------- 장면 만들기 ----------
export function buildObjScene(g, ctx, userState, { calcProb, nearPlayers }) {
  const me = ctx.me;
  const found = pickObjective(g, me);
  if (!found) return null;
  const key = found.key;
  const place = found.place || placeOf(me, key, me.side);
  const f = objFacts(g, me, key);
  const sits = situations(g, me, key, f, place);
  if (!sits.length) return null;
  // 등장 전 시야 싸움만 성립하면(대기 위치가 비슷해 장면이 닮기 쉽다) 덜 자주
  if (sits.every(x => x === 'spawnVision' || x === 'sideOut') && !g.rng.chance(C().visionOnlyChance)) return null;
  const comp = compOf(g, me.side);
  g.objSceneKeys = g.objSceneKeys || new Set();
  g.usedTitles = g.usedTitles || new Set();
  // 구체적인 상황일수록 먼저 (가중치 순서로 섞기)
  const W = C().sitWeight;
  const order = [];
  const left = sits.slice();
  while (left.length) { const x = g.rng.weighted(left.map(k => [k, W[k] || 1])); order.push(x); left.splice(left.indexOf(x), 1); }
  for (let attempt = 0; attempt < 8; attempt++) {
    const sit = order[attempt % order.length];
    const defs = optionDefs(g, me, key, f, sit, place, comp);
    if (defs.length < 2) continue;
    // 지금 말이 되는 선택지 중 2~4개 (역할에 맞는 것 우선, 무작위 섞기)
    const want = clamp(g.rng.int(2, 4), 2, defs.length);
    const pool = defs.slice();
    const chosen = [];
    while (chosen.length < want && pool.length) {
      const d = g.rng.weighted(pool.map(x => [x, x.w]));
      chosen.push(d); pool.splice(pool.indexOf(d), 1);
    }
    if (!chosen.some(d => d.risk === 'low')) { const r = defs.find(d => d.id === 'retreat'); if (r && !chosen.includes(r)) chosen[chosen.length - 1 < 3 ? chosen.length : 3] = r; }
    const opts = chosen.slice(0, 4);
    const layout = `${sit}|${place}|${opts.map(o => o.id).sort().join(',')}`;
    if (g.objSceneKeys.has(layout)) continue;
    // 제목: 이 경기·최근 경기에서 쓰지 않은 문장
    const v = { obj: OBJ[key], n: `${f.nA}대${f.nE}`, hp: f.objHp === null ? '-' : f.objHp };
    const titles = T.TITLES[sit].map(t => fillT(t, v)).filter(t => !g.usedTitles.has(t) && !(g.recentTitles && g.recentTitles.has(t)));
    if (!titles.length) continue;
    const title = g.rng.pick(titles);
    g.objSceneKeys.add(layout);
    g.usedTitles.add(title);
    const roleLine = T.ROLE_LINE[me.pos] ? T.ROLE_LINE[me.pos]({ me: champName(me.champ), mySmite: me.pos === 'JGL' && g.t >= (me.smiteAt || 0), myTp: tpReady(g, me), myUlt: ultReady(g, me) }) : '';
    const desc = [
      fillT(g.rng.pick(T.SIT_LINE[sit]), v),
      `${numbersText(f)}. ${g.rng.pick(T.PLACE_LINE[place])}`,
      stateLine(f, key),
      [T.COMP_LINE[comp], roleLine].filter(Boolean).join(' '),
    ].join('\n');
    // 장면 위치: 둥지 장면은 둥지 중심(반경 C().radius), 사이드 장면은 내 위치
    const loc = place === 'sideLane' ? [me.x, me.y] : geo.OBJ_POS[key].slice();
    const R = place === 'sideLane' ? CONFIG.match.sim.sceneRadius : C().radius;
    const near = nearPlayers(g, loc, R);
    const dd = p => Math.hypot(p.x - loc[0], p.y - loc[1]);
    const involved = [me, ...near.filter(p => p.side !== me.side).sort((a, b) => dd(a) - dd(b)), ...near.filter(p => p.side === me.side && p !== me).sort((a, b) => dd(a) - dd(b))];
    const cards = {};
    for (const p of involved) cards[p.pid] = { hp: p.hp, ult: ultReady(g, p), flash: flashReady(g, p), level: p.level };
    const options = opts.map((d, i) => {
      const lab = T.OPT_LABEL[d.id][me.pos] || T.OPT_LABEL[d.id]._;
      const pr = calcProb({ base: d.base, st: d.st, tags: d.tags }, ctx, userState);
      return { idx: i, label: lab, risk: d.risk, prevS: T.OPT_PREV[d.id][0], prevF: T.OPT_PREV[d.id][1], ...pr };
    });
    const safest = options.slice().sort((a, b) => ({ low: 0, mid: 1, high: 2 }[a.risk] - { low: 0, mid: 1, high: 2 }[b.risk]) || (b.p - a.p))[0].idx;
    const enemyNear = involved.filter(p => p.side !== me.side);
    return {
      id: `obj:${key}:${sit}`, gen: { key, opts: opts.map(d => ({ id: d.id, risk: d.risk, eff: d.eff })) },
      combo: `${sit}|${place}|${f.nA}v${f.nE}`, layout, facts: { ...f, place, sit },
      t: g.t, loc, R, region: geo.regionOf(...loc), title, desc,
      splash: (enemyNear[0] || me).champ, involved: involved.map(p => p.pid), cards, options, safest, vars: {},
    };
  }
  return null;
}

// ---------- 결과 ----------
const TIERS = ['crit', 'succ', 'fail', 'fumble'];
export function genEffect(scene, optIdx, tier) {
  const o = scene.gen.opts[optIdx];
  const e = { ...o.eff[TIERS.indexOf(tier)] };
  for (const k of Object.keys(e)) if (!e[k]) delete e[k];
  return e;
}
const CLAIM_OURS = /잡았|녹였|대승|완승/, CLAIM_THEIRS = /잡혔|녹았|무너|대참사|고립/;
const PLAIN_LEAD = { crit: '흐름을 완전히 잡았다.', succ: '무난하게 풀렸다.', fail: '뜻대로 되지 않았다.', fumble: '크게 꼬였다.' };
const QUIET = { retreat: '인명 피해 없이 정비했다', poke: '상대가 쉽게 들어오지 못했다', ward: '둥지 주변 시야를 다퉜다', take: '처치를 이어 간다', steal: '둥지 주변에서 신경전만 오갔다', trade: '반대편 상황을 살폈다', split: '사이드 라인을 밀어 두었다' };
export function genText(g, scene, optIdx, tier, events, eff, rng) {
  const o = scene.gen.opts[optIdx];
  const mySide = g.byId[scene.involved[0]].side;
  const kills = events.filter(e => e.type === 'kill');
  const ours = kills.filter(e => e.side === mySide).length, theirs = kills.length - ours;
  // 첫 문장도 실제로 일어난 일과 맞는 것만 (킬이 안 났는데 "잡았다"고 하지 않게)
  const leads = T.RESULT_LEAD[o.id][tier].filter(l => (!CLAIM_OURS.test(l) || ours > 0) && (!CLAIM_THEIRS.test(l) || theirs > 0));
  const lead = leads.length ? rng.pick(leads) : PLAIN_LEAD[tier];
  const parts = [];
  if (ours || theirs) parts.push(ours && theirs ? `서로 ${ours}명·${theirs}명을 주고받았다` : ours ? `상대 ${ours}명을 잡았다` : `우리 쪽 ${theirs}명이 쓰러졌다`);
  if (ours && g.sides[1 - mySide].players.every(p => !p.alive)) parts.push('에이스!');
  const key = scene.gen.key;
  if (eff.obj) parts.push(`${OBJ[eff.obj] || eff.obj}${josa(OBJ[eff.obj] || eff.obj, '을', '를')} 가져가러 간다`);
  if (eff.enemyObj) parts.push(`상대가 ${OBJ[eff.enemyObj]}${josa(OBJ[eff.enemyObj], '을', '를')} 가져간다`);
  if (eff.tower) parts.push('포탑 공성에 들어간다');
  if (!parts.length) parts.push(QUIET[o.id] || (o.id === 'engage' || o.id === 'flank' ? '아무도 먼저 들어가지 못하고 대치가 끝났다' : '큰 변화 없이 상황이 정리됐다'));
  return `${lead} ${parts.join(', ')}.`;
}
