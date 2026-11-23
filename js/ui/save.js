// 저장: 자동 저장 + 슬롯 3개 + JSON 내보내기/불러오기
import { CONFIG } from '../config.js';
import { serialize, deserialize } from '../engine/state.js';
import { fmtDate } from '../core/util.js';

const P = CONFIG.storagePrefix;
export const SLOT_KEYS = ['auto', 'slot1', 'slot2', 'slot3'];
export const SLOT_NAMES = { auto: '자동 저장', slot1: '슬롯 1', slot2: '슬롯 2', slot3: '슬롯 3' };

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
    fr.onload = () => { try { const d = JSON.parse(fr.result); resolve(deserialize(d.state || d)); } catch (e) { reject(e); } };
    fr.onerror = reject;
    fr.readAsText(file);
  });
}
export function describeSlot(info) {
  if (!info) return '비어 있음';
  return `${info.nick} (${info.team}) · ${fmtDate(info.date)}`;
}
