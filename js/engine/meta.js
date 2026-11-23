import { CONFIG } from '../config.js';
import { clamp, POS } from '../core/util.js';
import { CHAMPIONS, CHAMP_IDS } from '../../data/champions.js';

export const TIER_ORDER = ['OP', '1', '2', '3', '4'];
export const TIER_LABEL = { OP: 'OP', '1': '1티어', '2': '2티어', '3': '3티어', '4': '4티어' };

export function newMeta(rng, year) {
  const power = {};
  for (const id of CHAMP_IDS) power[id] = Math.round(rng.normal(0, 1.6) * 10) / 10;
  const meta = { year, num: 1, version: `${year % 100}.1`, power, tiers: {}, notes: [], history: [] };
  computeTiers(meta);
  return meta;
}

export function computeTiers(meta) {
  const S = CONFIG.patch.tierShare;
  for (const pos of POS) {
    const list = CHAMP_IDS.filter(id => CHAMPIONS[id].pos[0] === pos).sort((a, b) => meta.power[b] - meta.power[a]);
    const n = list.length;
    let cut = 0;
    const bounds = [];
    for (const t of TIER_ORDER) { cut += S[t]; bounds.push([t, Math.round(cut * n)]); }
    list.forEach((id, i) => {
      for (const [t, b] of bounds) { if (i < Math.max(1, b)) { meta.tiers[id] = t; break; } }
      if (!meta.tiers[id]) meta.tiers[id] = '4';
    });
  }
}

// 경기에서 쓰는 챔피언 메타 파워 (파워 포인트)
export function champMetaPower(meta, id) {
  if (!meta) return 0;
  const t = meta.tiers[id] || '3';
  return CONFIG.patch.tierPower[t] + clamp(meta.power[id] || 0, -4, 4) * 0.25;
}

const SKILLS = ['Q', 'W', 'E', 'R', '기본 지속 효과'];
const STATS = [
  ['피해량', true], ['재사용 대기시간', false], ['마나 소모량', false], ['기본 공격력', true], ['기본 방어력', true],
  ['체력 회복량', true], ['둔화 지속시간', true], ['보호막 흡수량', true], ['레벨당 체력', true], ['사거리', true],
];

function noteText(rng, champ, buff) {
  const sk = rng.pick(SKILLS);
  const [st, higherBetter] = rng.pick(STATS);
  const a = rng.int(4, 18) * 5;
  const step = rng.int(1, 4) * 5;
  const up = buff === higherBetter;
  const b = up ? a + step : Math.max(5, a - step);
  if (st === '재사용 대기시간' || st === '마나 소모량') {
    const x = rng.int(6, 20), y = up ? x + rng.int(1, 3) : Math.max(2, x - rng.int(1, 3));
    return `${sk} ${st}: ${x}초 → ${y}초`.replace('초 →', st === '마나 소모량' ? ' →' : '초 →').replace(/초$/, st === '마나 소모량' ? '' : '초');
  }
  return `${sk} ${st}: ${a} → ${b}`;
}

export function rollPatch(rng, meta) {
  const C = CONFIG.patch;
  const prevTiers = { ...meta.tiers };
  // 평균 회귀
  for (const id of CHAMP_IDS) meta.power[id] = Math.round(meta.power[id] * (1 - C.meanReversion) * 10) / 10;
  const n = rng.int(C.changesMin, C.changesMax);
  const notes = [];
  // 너프는 강한 챔피언 위주, 버프는 약한 챔피언 위주
  const sorted = CHAMP_IDS.slice().sort((a, b) => meta.power[b] - meta.power[a]);
  const used = new Set();
  for (let i = 0; i < n; i++) {
    const buff = rng.chance(0.5);
    const pool = buff ? sorted.slice(Math.floor(sorted.length * 0.4)) : sorted.slice(0, Math.floor(sorted.length * 0.45));
    let id = rng.pick(pool), guard = 0;
    while (used.has(id) && guard++ < 20) id = rng.pick(pool);
    if (used.has(id)) continue;
    used.add(id);
    const delta = Math.round(rng.float(...(buff ? C.buffPower : C.nerfPower)) * 10) / 10;
    meta.power[id] = Math.round((meta.power[id] + delta) * 10) / 10;
    notes.push({ champ: id, type: buff ? 'buff' : 'nerf', lines: [noteText(rng, id, buff), ...(rng.chance(0.5) ? [noteText(rng, id, buff)] : [])] });
  }
  meta.num += 1;
  meta.version = `${meta.year % 100}.${meta.num}`;
  computeTiers(meta);
  for (const nt of notes) { nt.from = prevTiers[nt.champ]; nt.to = meta.tiers[nt.champ]; }
  meta.notes = notes;
  meta.history.unshift({ version: meta.version, notes });
  if (meta.history.length > 30) meta.history.length = 30;
  return notes;
}
