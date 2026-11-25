// 미니맵 연속 컷: 경기를 돌리며 미니맵을 일정 간격으로 캡처해 frames/ 에 PNG로 저장하고,
// 0~3분, 8~12분, 20~25분 구간을 각각 4x4 연속 컷 시트로 합친다.
// 사용: node tools/render-minimap.mjs [시드=7] [--out docs] [--tag after] [--trail 20] [--nav]
//   --out: 시트를 저장할 폴더 (기본 frames/)   --tag: 파일 이름 앞말   --trail: 이동 궤적 초   --nav: 이동 그래프 겹쳐 그리기
// 선수 위치: 엔진의 1초 단위 기록(g.secLog)이 있으면 그것, 없으면 틱마다 위치
import { createRequire } from 'module';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { RNG } from '../js/core/rng.js';
import { newMeta } from '../js/engine/meta.js';
import { createMatch, step } from '../js/engine/match.js';
import { makePlayer } from '../js/engine/players.js';
import { champsForPos } from '../data/champions.js';
import * as geo from '../js/engine/mapgeo.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const SEED = Number(args.find(a => /^\d+$/.test(a)) || 7);
const OUT = opt('--out', 'frames');
const TAG = opt('--tag', 'seed' + SEED);
const TRAIL = Number(opt('--trail', 20));
const NAV = args.includes('--nav');
const WINDOWS = [[0, 180, '0-3'], [480, 720, '8-12'], [1200, 1500, '20-25']];
const POS = ['TOP', 'JGL', 'MID', 'ADC', 'SUP'];

// ---------- 경기 (검사기와 같은 방식의 무작위 팀) ----------
function team(rng, id, target) {
  const players = POS.map(p => makePlayer(rng, { nick: id + p, pos: p, age: 21, target: target + rng.int(-4, 4) }));
  const used = new Set();
  const picks = POS.map(p => { let c, k = 0; do c = rng.pick(champsForPos(p)); while (used.has(c) && k++ < 50); used.add(c); return c; });
  players.forEach((pl, i) => { pl.champs[picks[i]] = rng.int(20, 95); });
  return { team: { id, code: id, name: id }, players, picks };
}
const rng = new RNG('render-' + SEED);
const meta = newMeta(rng, 2026);
const g = createMatch({ blue: team(rng, 'A', rng.int(74, 82)), red: team(rng, 'B', rng.int(74, 82)), seed: rng.int(1, 2 ** 30), meta, userPid: null, scenes: false });
const all = g.sides[0].players.concat(g.sides[1].players);

// 1초 단위 위치 기록
const track = [];          // [{t, ps:[[x,y,alive]...], waves, fights}]
const record = (t, ps) => track.push({ t, ps, waves: geo.LANES.map(l => ({ s: g.waves[l].s, n: g.waves[l].n || null })), fights: g.fights.map(f => f.center.slice()) });
record(0, all.map(p => [p.x, p.y, p.alive ? 1 : 0]));
const END = WINDOWS[WINDOWS.length - 1][1];
while (!g.over && g.t < END) {
  step(g);
  if (g.secLog && g.secLog.length) for (const s of g.secLog) record(s.t, s.ps);
  else record(g.t, all.map(p => [p.x, p.y, p.alive ? 1 : 0]));
}
const at = t => { let best = track[0]; for (const f of track) { if (f.t <= t) best = f; else break; } return best; };
const trailOf = (t, i) => track.filter(f => f.t > t - TRAIL && f.t <= t).map(f => [...f.ps[i].slice(0, 3), f.t]);

// ---------- 그리기 (헤드리스 브라우저 캔버스) ----------
mkdirSync('frames', { recursive: true });
mkdirSync(OUT, { recursive: true });
let mapData = null;
const mapFile = 'frames/.map11.png';
try {
  if (!existsSync(mapFile)) {
    const base = 'https://ddragon.leagueoflegends.com';
    try {
      const vs = await (await fetch(base + '/api/versions.json')).json();
      writeFileSync(mapFile, Buffer.from(await (await fetch(`${base}/cdn/${vs[0]}/img/map/map11.png`)).arrayBuffer()));
    } catch {
      // Node fetch가 프록시를 못 쓰는 환경: curl로
      const { execFileSync } = await import('node:child_process');
      const vs = JSON.parse(execFileSync('curl', ['-sfL', base + '/api/versions.json'], { encoding: 'utf8' }));
      execFileSync('curl', ['-sfL', '-o', mapFile, `${base}/cdn/${vs[0]}/img/map/map11.png`]);
    }
  }
  mapData = 'data:image/png;base64,' + readFileSync(mapFile).toString('base64');
} catch { mapData = null; }
let navEdges = null;
if (NAV) { try { const N = await import('../data/navgraph.js'); navEdges = N.EDGES.map(([a, b]) => [N.NODES[a].slice(0, 2), N.NODES[b].slice(0, 2)]); } catch { navEdges = null; } }

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(`<canvas id="c" width="384" height="384"></canvas><img id="m">`);
await page.evaluate(async src => { if (!src) return; const im = document.getElementById('m'); im.src = src; await im.decode(); }, mapData);
const fmt = t => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.round(t % 60)).padStart(2, '0')}`;
const lanePts = Object.fromEntries(geo.LANES.map(l => [l, Array.from({ length: 41 }, (_, i) => geo.pointOnLane(l, i / 40))]));
const LETTER = { TOP: 'T', JGL: 'J', MID: 'M', ADC: 'A', SUP: 'S' };
const sides = all.map(p => p.side), letters = all.map(p => LETTER[p.pos]);

async function frame(t) {
  const f = at(t);
  const trails = all.map((_, i) => trailOf(t, i));
  const waves = f.waves.map((w, li) => ({ pt: geo.pointOnLane(geo.LANES[li], w.s), n: w.n }));
  return page.evaluate(({ f, trails, waves, label, sides, letters, nav }) => {
    const c = document.getElementById('c'), x = c.getContext('2d'), W = c.width;
    const im = document.getElementById('m');
    x.fillStyle = '#0c2419'; x.fillRect(0, 0, W, W);
    if (im.complete && im.naturalWidth) x.drawImage(im, 0, 0, W, W);
    if (nav) { x.strokeStyle = 'rgba(255,255,255,.35)'; x.lineWidth = 1; for (const [a, b] of nav) { x.beginPath(); x.moveTo(a[0] * W, a[1] * W); x.lineTo(b[0] * W, b[1] * W); x.stroke(); } }
    // 웨이브
    for (const w of waves) {
      const r = w.n ? 2 + Math.min(6, (w.n[0] + w.n[1]) / 6) : 3;
      x.fillStyle = 'rgba(255,230,120,.9)'; x.beginPath(); x.arc(w.pt[0] * W, w.pt[1] * W, r, 0, 7); x.fill();
    }
    for (const fc of f.fights) { x.strokeStyle = 'rgba(255,80,80,.9)'; x.lineWidth = 2; x.beginPath(); x.arc(fc[0] * W, fc[1] * W, 14, 0, 7); x.stroke(); }
    // 궤적
    trails.forEach((tr, i) => {
      const col = sides[i] === 0 ? '90,170,255' : '255,100,100';
      for (let k = 1; k < tr.length; k++) {
        if (!tr[k][2] || !tr[k - 1][2]) continue;
        // 귀환·순간이동·부활처럼 한 번에 멀리 옮겨진 구간은 잇지 않는다 (간격 1초당 0.04 넘게)
        if (Math.hypot(tr[k][0] - tr[k - 1][0], tr[k][1] - tr[k - 1][1]) > Math.max(0.05, (tr[k][3] - tr[k - 1][3]) * 0.04)) continue;
        x.strokeStyle = `rgba(${col},${0.15 + 0.6 * k / tr.length})`; x.lineWidth = 2;
        x.beginPath(); x.moveTo(tr[k - 1][0] * W, tr[k - 1][1] * W); x.lineTo(tr[k][0] * W, tr[k][1] * W); x.stroke();
      }
    });
    // 선수
    f.ps.forEach((p, i) => {
      const [px, py, al] = p;
      x.globalAlpha = al ? 1 : 0.35;
      x.fillStyle = sides[i] === 0 ? '#2f7bff' : '#e8454b';
      x.beginPath(); x.arc(px * W, py * W, 8, 0, 7); x.fill();
      x.strokeStyle = '#fff'; x.lineWidth = 1.5; x.stroke();
      x.fillStyle = '#fff'; x.font = 'bold 10px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(al ? letters[i] : '✝', px * W, py * W + 0.5);
      x.globalAlpha = 1;
    });
    x.fillStyle = 'rgba(0,0,0,.6)'; x.fillRect(0, 0, 70, 22);
    x.fillStyle = '#ffe680'; x.font = 'bold 15px sans-serif'; x.textAlign = 'left'; x.textBaseline = 'top'; x.fillText(label, 6, 4);
    return c.toDataURL('image/png');
  }, { f, trails, waves, label: fmt(t), sides, letters, nav: navEdges });
}

for (const [a, b, name] of WINDOWS) {
  const times = Array.from({ length: 16 }, (_, i) => Math.round(a + (b - a) * (i + 1) / 16));
  const urls = [];
  for (const t of times) {
    const url = await frame(t);
    urls.push(url);
    writeFileSync(`frames/${TAG}_${name}_${String(t).padStart(4, '0')}.png`, Buffer.from(url.split(',')[1], 'base64'));
  }
  const sheet = await page.evaluate(async urls => {
    const S = 256, c = document.createElement('canvas'); c.width = S * 4; c.height = S * 4;
    const x = c.getContext('2d');
    for (let i = 0; i < urls.length; i++) {
      const im = new Image(); im.src = urls[i]; await im.decode();
      x.drawImage(im, (i % 4) * S, Math.floor(i / 4) * S, S, S);
      x.strokeStyle = '#000'; x.strokeRect((i % 4) * S, Math.floor(i / 4) * S, S, S);
    }
    return c.toDataURL('image/png');
  }, urls);
  const file = `${OUT}/${TAG}_${name}.png`;
  writeFileSync(file, Buffer.from(sheet.split(',')[1], 'base64'));
  console.log('시트', file, `(${times.length}컷, ${fmt(a)}~${fmt(b)})`);
}
await browser.close();
console.log(`기록 ${track.length}개 (${g.secLog ? '1초 단위' : '틱 단위'}) · 경기 ${g.over ? '종료' : '진행 중'} ${fmt(g.t)}`);
