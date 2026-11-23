// Data Dragon 로딩·캐시 + 이미지 대체 그래픽
import { CONFIG } from '../config.js';
import { CHAMPIONS, applyOnlineNames } from '../../data/champions.js';
import { ITEMS, applyOnlineItemNames, applyOnlineSpellNames } from '../../data/items.js';
import { esc } from '../core/util.js';

const CDN = 'https://ddragon.leagueoflegends.com';
const KEY = CONFIG.storagePrefix + '.ddragon';
export const DD = { online: false, version: null, source: 'offline', mapOk: false };

function fetchJSON(url, ms = 6000) {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => ctl && ctl.abort(), ms);
  return fetch(url, ctl ? { signal: ctl.signal } : {}).then(r => { clearTimeout(timer); if (!r.ok) throw new Error(r.status); return r.json(); });
}

function loadCache() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } }
function saveCache(c) { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* 용량 초과 무시 */ } }

function applyCache(c) {
  DD.version = c.version;
  applyOnlineNames(c.champNames || {});
  applyOnlineItemNames(c.itemNames || {});
  applyOnlineSpellNames(c.spellNames || {});
  DD.validChamps = new Set(c.champIds || []);
  DD.validItems = new Set(c.itemIds || []);
}

export async function initAssets() {
  const cached = loadCache();
  try {
    const versions = await fetchJSON(`${CDN}/api/versions.json`, 5000);
    const ver = versions[0];
    if (cached && cached.version === ver && cached.champNames) {
      applyCache(cached); DD.online = true; DD.source = 'cache+online'; return DD;
    }
    const [champ, item, spell] = await Promise.all([
      fetchJSON(`${CDN}/cdn/${ver}/data/ko_KR/champion.json`),
      fetchJSON(`${CDN}/cdn/${ver}/data/ko_KR/item.json`).catch(() => null),
      fetchJSON(`${CDN}/cdn/${ver}/data/ko_KR/summoner.json`).catch(() => null),
    ]);
    const champNames = {};
    for (const k in champ.data) champNames[k] = champ.data[k].name;
    const itemNames = {};
    if (item) for (const id in ITEMS) if (item.data[id]) itemNames[id] = item.data[id].name;
    const spellNames = {};
    if (spell) for (const k in spell.data) spellNames[k] = spell.data[k].name;
    const c = { version: ver, savedAt: Date.now(), champNames, itemNames, spellNames, champIds: Object.keys(champ.data), itemIds: item ? Object.keys(item.data) : [] };
    saveCache(c);
    applyCache(c);
    DD.online = true; DD.source = 'online';
  } catch (e) {
    if (cached) { applyCache(cached); DD.online = true; DD.source = 'cache'; }
    else { DD.online = false; DD.source = 'offline'; }
  }
  return DD;
}

// ---------- URL ----------
export const champIconUrl = id => (DD.online && DD.version && (!DD.validChamps || !DD.validChamps.size || DD.validChamps.has(id)) ? `${CDN}/cdn/${DD.version}/img/champion/${id}.png` : null);
export const splashUrl = id => (DD.online && (!DD.validChamps || !DD.validChamps.size || DD.validChamps.has(id)) ? `${CDN}/cdn/img/champion/splash/${id}_0.jpg` : null);
export const itemIconUrl = id => (DD.online && DD.version && (!DD.validItems || !DD.validItems.size || DD.validItems.has(String(id))) ? `${CDN}/cdn/${DD.version}/img/item/${id}.png` : null);
export const spellIconUrl = id => (DD.online && DD.version ? `${CDN}/cdn/${DD.version}/img/spell/${id}.png` : null);
export const mapUrl = () => (DD.online && DD.version ? `${CDN}/cdn/${DD.version}/img/map/map11.png` : null);

// ---------- 대체 그래픽 ----------
function hashColor(s) {
  let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360}, 45%, 38%)`;
}
function initials(name) {
  const s = String(name || '?').replace(/\s/g, '');
  return /[가-힣]/.test(s) ? s.slice(0, 2) : s.slice(0, 2).toUpperCase();
}
export function fbHTML(text, color, size, cls = '') {
  const fs = Math.max(9, Math.round(size * (String(text).length > 2 ? 0.3 : 0.38)));
  return `<span class="fb ${cls}" style="width:${size}px;height:${size}px;background:${color};font-size:${fs}px">${esc(text)}</span>`;
}
// 이미지 실패 시 대체 그래픽으로 교체
if (typeof window !== 'undefined') {
  window.__fb = img => {
    const span = document.createElement('span');
    const size = img.width || parseInt(img.getAttribute('width')) || 32;
    span.outerHTML; // noop
    span.className = 'fb ' + (img.dataset.cls || '');
    span.style.cssText = `width:${size}px;height:${size}px;background:${img.dataset.fbc};font-size:${Math.max(9, Math.round(size * 0.36))}px`;
    span.textContent = img.dataset.fbt;
    img.replaceWith(span);
  };
}
function imgOr(url, size, text, color, cls = '', extra = '') {
  if (!url) return fbHTML(text, color, size, cls);
  return `<img class="ic ${cls}" src="${url}" width="${size}" height="${size}" loading="lazy" draggable="false" data-fbt="${esc(text)}" data-fbc="${color}" data-cls="${cls}" onerror="window.__fb(this)" ${extra}>`;
}

export function champIcon(id, size = 32, cls = '') {
  const c = CHAMPIONS[id];
  return imgOr(champIconUrl(id), size, initials(c ? c.name : id), hashColor(id), cls, `alt="${esc(c ? c.name : id)}"`);
}
export function itemIcon(id, size = 20) {
  const it = ITEMS[id];
  return imgOr(itemIconUrl(id), size, initials(it ? it.name : id), '#3a3320', 'sq', `title="${esc(it ? it.name : id)}"`);
}
export function spellIcon(id, size = 18, cls = '') {
  return imgOr(spellIconUrl(id), size, id.replace('Summoner', '').slice(0, 1), '#334', 'sq ' + cls);
}
export function teamLogo(team, size = 36) {
  if (!team) return fbHTML('?', '#333', size);
  const url = `assets/teams/${team.code}.png`;
  return `<img class="ic logo" src="${url}" width="${size}" height="${size}" draggable="false" data-fbt="${esc(team.code)}" data-fbc="${team.color || '#335'}" onerror="window.__fb(this)">`;
}
export function playerPhoto(isUser, nick, color, size = 64) {
  if (!isUser) return fbHTML(initials(nick), color || hashColor(nick), size);
  return `<img class="ic" src="assets/player/me.png" width="${size}" height="${size}" draggable="false" data-fbt="${esc(initials(nick))}" data-fbc="${color || '#5a4a12'}" onerror="window.__fb(this)">`;
}
export function splashStyle(id) {
  const u = splashUrl(id);
  return u ? `background-image:url('${u}')` : '';
}

// 오프라인 미니맵 (코드로 그린 3라인 맵)
export function fallbackMapSVG() {
  return `<svg class="mm-bg" viewBox="0 0 100 100" preserveAspectRatio="none">
    <defs><radialGradient id="mmg" cx="50%" cy="50%" r="70%"><stop offset="0" stop-color="#1d4a35"/><stop offset="1" stop-color="#0c2419"/></radialGradient></defs>
    <rect width="100" height="100" fill="url(#mmg)"/>
    <path d="M10 92 L92 10" stroke="#1b5f8a" stroke-width="7" opacity=".55"/>
    <g fill="none" stroke="#c9b27a" stroke-width="4.2" stroke-linecap="round" opacity=".55">
      <path d="M11.5 88.5 L8.5 72 L7.5 30 L10 10 L30 7.5 L72 8.5 L88.5 11.5"/>
      <path d="M11.5 88.5 L30 70 L50 50 L70 30 L88.5 11.5"/>
      <path d="M11.5 88.5 L28 91.5 L70 92.5 L90 90 L92.5 70 L91.5 28 L88.5 11.5"/>
    </g>
    <g fill="#0f2e20" opacity=".9">
      <ellipse cx="27" cy="50" rx="9" ry="12"/><ellipse cx="50" cy="76" rx="12" ry="8"/>
      <ellipse cx="73" cy="50" rx="9" ry="12"/><ellipse cx="50" cy="24" rx="12" ry="8"/>
    </g>
    <circle cx="67.5" cy="70" r="4" fill="#0b3550" stroke="#3fa0ff" stroke-width=".6"/>
    <circle cx="32.5" cy="30" r="4" fill="#2a1145" stroke="#a66bff" stroke-width=".6"/>
    <rect x="0" y="80" width="20" height="20" fill="#163a6a" opacity=".55"/>
    <rect x="80" y="0" width="20" height="20" fill="#6a1626" opacity=".55"/>
  </svg>`;
}
