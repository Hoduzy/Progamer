// 저장: 자동 저장 + 슬롯 3개 + JSON 내보내기/불러오기
import { CONFIG } from '../config.js';
import { serialize, deserialize, needsNameMigration, needsDailyMigration, needsStatsMigration } from '../engine/state.js';
import { fmtDate } from '../core/util.js';

const P = CONFIG.storagePrefix;
export const SLOT_KEYS = ['auto', 'slot1', 'slot2', 'slot3'];
export const SLOT_NAMES = { auto: '자동 저장', slot1: '슬롯 1', slot2: '슬롯 2', slot3: '슬롯 3' };
// 변환 전 백업: 변환 종류·원래 슬롯마다 하나 (backup.slot1 = 이름 변환 전, backup-day.slot1 = 하루 1활동 변환 전 …,
// 파일·코드로 가져온 것은 .import)
const BACKUP_SRC = { auto: '자동 저장', slot1: '슬롯 1', slot2: '슬롯 2', slot3: '슬롯 3', import: '가져온 세이브' };
const MIGRATIONS = [
  { tag: 'backup', name: '이름 변환 전', need: needsNameMigration },
  { tag: 'backup-day', name: '하루 1활동 변환 전', need: needsDailyMigration },
  { tag: 'backup-stats', name: '능력치 기준 보정 전', need: needsStatsMigration },
];
for (const m of MIGRATIONS) for (const [k, n] of Object.entries(BACKUP_SRC)) SLOT_NAMES[`${m.tag}.${k}`] = `${n} 백업 (${m.name})`;
export const isBackupKey = k => k.startsWith('backup');
// 불러오기 목록: 저장 슬롯 + 있는 백업
export const loadKeys = () => SLOT_KEYS.concat(MIGRATIONS.flatMap(m => Object.keys(BACKUP_SRC).map(k => `${m.tag}.${k}`)).filter(k => localStorage.getItem(`${P}.${k}`)));

// 옛 형식 세이브는 변환하기 전에 원본을 백업 슬롯에 한 부 남긴다 (변환이 실패해도 원본은 그대로)
function backupBeforeMigration(data, src) {
  try {
    const st = data && (data.state || data);
    const need = MIGRATIONS.filter(m => m.need(st));
    if (!need.length) return false;
    const raw = JSON.stringify(data.state ? data : { version: 1, savedAt: Date.now(), summary: null, state: data });
    for (const m of need) localStorage.setItem(`${P}.${m.tag}.${src}`, raw);
    return true;
  } catch (e) { console.error('백업 실패', e); return false; }
}

export function summaryOf(state) {
  const u = state.players[state.user.pid];
  const t = u.teamId ? state.teams[u.teamId] : null;
  return { nick: u.nick, pos: u.pos, team: t ? t.name : 'FA', squad: u.squad, date: state.date, year: state.year };
}

export function saveTo(key, state, rng) {
  const data = { version: CONFIG.saveVersion, savedAt: Date.now(), summary: summaryOf(state), state: JSON.parse(serialize(state, rng)) };
  try { localStorage.setItem(`${P}.${key}`, JSON.stringify(data)); return true; }
  catch (e) { console.error('저장 실패', e); return false; }
}
export function loadFrom(key) {
  const raw = localStorage.getItem(`${P}.${key}`);
  if (!raw) return null;
  const data = JSON.parse(raw);
  if (!isBackupKey(key)) backupBeforeMigration(data, key);
  return deserialize(data.state);
}
export function slotInfo(key) {
  try { const raw = localStorage.getItem(`${P}.${key}`); if (!raw) return null; const d = JSON.parse(raw); return { ...d.summary, savedAt: d.savedAt, size: raw.length }; } catch { return null; }
}
export function deleteSlot(key) { localStorage.removeItem(`${P}.${key}`); }
export function exportJSON(state, rng) {
  const data = { version: CONFIG.saveVersion, savedAt: Date.now(), summary: summaryOf(state), state: JSON.parse(serialize(state, rng)) };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `lck-career-${state.user ? state.players[state.user.pid].nick : 'save'}-${state.date}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
export function importJSON(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => { try { const d = JSON.parse(fr.result); backupBeforeMigration(d, 'import'); const r = deserialize(d.state || d); r.summary = d.summary || null; resolve(r); } catch (e) { reject(e); } };
    fr.onerror = reject;
    fr.readAsText(file);
  });
}
export function describeSlot(info) {
  if (!info) return '비어 있음';
  if (!info.nick) return `저장 ${new Date(info.savedAt).toLocaleString()}`;
  return `${info.nick} (${info.team}) · ${fmtDate(info.date)}`;
}

// ---------- 세이브 코드 (기기 간 옮기기) ----------
// 형식: "LCKC1." + base64url(deflate-raw(JSON))   압축 미지원 브라우저는 "LCKC0." + base64url(JSON)
const CODE_RE = /LCKC([01])\.([A-Za-z0-9_-]+)/;
function b64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(str) {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
async function pipe(bytes, stream) {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}
export async function makeSaveCode(state, rng) {
  const data = { version: CONFIG.saveVersion, savedAt: Date.now(), summary: summaryOf(state), state: JSON.parse(serialize(state, rng)) };
  const raw = new TextEncoder().encode(JSON.stringify(data));
  if (typeof CompressionStream !== 'undefined') {
    try { return 'LCKC1.' + b64url(await pipe(raw, new CompressionStream('deflate-raw'))); } catch { /* 아래로 */ }
  }
  return 'LCKC0.' + b64url(raw);
}
// 코드 → { data(요약 포함), loaded: {state, rng} }
export async function readSaveCode(text) {
  const m = String(text || '').replace(/\s+/g, '').match(CODE_RE);
  if (!m) throw new Error('세이브 코드 형식이 아닙니다 (LCKC로 시작해야 합니다)');
  if (m[1] === '1' && typeof DecompressionStream === 'undefined') throw new Error('이 브라우저는 압축 해제를 지원하지 않습니다. JSON 파일로 옮겨 주세요');
  let data;
  try {
    let bytes = unb64url(m[2]);
    if (m[1] === '1') bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
    data = JSON.parse(new TextDecoder().decode(bytes));
  } catch { throw new Error('코드가 손상됐거나 일부만 복사됐어요. 처음부터 끝까지 다시 복사해 주세요'); }
  if (!data || !(data.state || data.players)) throw new Error('세이브 데이터가 아닙니다');
  backupBeforeMigration(data, 'import');
  return { data, loaded: deserialize(data.state || data) };
}
// 클립보드 복사 (Safari는 사용자 터치 직후에만 허용하므로 ClipboardItem에 Promise를 넘긴다)
export async function copySaveCode(state, rng) {
  const codeP = makeSaveCode(state, rng);
  try {
    if (navigator.clipboard && typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': codeP.then(c => new Blob([c], { type: 'text/plain' })) })]);
      return { code: await codeP, copied: true };
    }
  } catch { /* 아래로 */ }
  const code = await codeP;
  try { await navigator.clipboard.writeText(code); return { code, copied: true }; } catch { return { code, copied: false }; }
}
