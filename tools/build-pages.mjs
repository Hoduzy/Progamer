// GitHub Pages 배포 준비
//  1) assets/ 아래 실제 파일 목록 → js/assetList.js (없는 이미지를 요청해 404가 나지 않게)
//  2) 모든 JS/HTML/CSS의 상대 경로가 실제 파일과 대소문자까지 일치하는지, "/"로 시작하는 절대 경로가 없는지 검사
//  3) sw.js의 캐시 파일 목록과 버전(파일 내용 해시)을 갱신
// 사용: node tools/build-pages.mjs [--check]   (--check: 파일을 고치지 않고 검사만, 바뀔 내용이 있으면 실패)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');
const problems = [];
const rel = p => path.relative(ROOT, p).split(path.sep).join('/');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
// 대소문자까지 정확히 존재하는지
function existsExact(abs) {
  const parts = path.relative(ROOT, abs).split(path.sep);
  let cur = ROOT;
  for (const part of parts) {
    if (part === '..' || part === '.') { cur = path.join(cur, part); continue; }
    if (!fs.existsSync(cur) || !fs.statSync(cur).isDirectory()) return false;
    if (!fs.readdirSync(cur).includes(part)) return false;
    cur = path.join(cur, part);
  }
  return fs.existsSync(cur);
}

// ---------- 1) 자산 목록 ----------
const IMG = /\.(png|jpe?g|webp|gif|svg)$/i;
const assetFiles = walk(path.join(ROOT, 'assets')).filter(f => IMG.test(f)).map(f => rel(f).replace(/^assets\//, '')).sort();
// 팀 로고 파일 이름 대소문자 검사
const teamSrc = fs.readFileSync(path.join(ROOT, 'data/teams.js'), 'utf8');
const codes = [...teamSrc.matchAll(/code:\s*'([^']+)'/g)].map(m => m[1]);
for (const f of assetFiles.filter(f => f.startsWith('teams/'))) {
  const base = f.slice(6).replace(/\.png$/i, '');
  if (!/\.png$/.test(f)) problems.push(`assets/${f}: 팀 로고는 소문자 확장자 .png여야 합니다`);
  if (!codes.includes(base)) {
    const ci = codes.find(c => c.toLowerCase() === base.toLowerCase());
    problems.push(ci ? `assets/${f}: 대소문자가 팀 코드와 다릅니다 → ${ci}.png` : `assets/${f}: data/teams.js에 없는 팀 코드`);
  }
}
const assetJs = `// 자동 생성: node tools/build-pages.mjs — 직접 고치지 마세요\n// assets/ 아래 실제로 있는 이미지 (없는 파일은 요청하지 않고 대체 그래픽을 씁니다)\nexport const ASSET_FILES = new Set(${JSON.stringify(assetFiles, null, 0)});\n`;

function writeIfChanged(file, content) {
  const p = path.join(ROOT, file);
  const old = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  if (old === content) return false;
  if (CHECK) { problems.push(`${file}: 최신이 아닙니다 — node tools/build-pages.mjs 를 실행하세요`); return true; }
  fs.writeFileSync(p, content);
  return true;
}
const assetChanged = writeIfChanged('js/assetList.js', assetJs);

// ---------- 2) 경로 검사 ----------
const SRC = [...walk(path.join(ROOT, 'js')), ...walk(path.join(ROOT, 'data')), ...walk(path.join(ROOT, 'css')), path.join(ROOT, 'index.html'), path.join(ROOT, 'sw.js'), path.join(ROOT, 'manifest.json')]
  .filter(f => /\.(m?js|html|css|json)$/.test(f) && fs.existsSync(f));
for (const f of SRC) {
  const src = fs.readFileSync(f, 'utf8');
  const refs = [];   // [경로, 기준 폴더]  (import는 그 파일 기준, HTML 속성은 index.html 기준)
  const here = path.dirname(f);
  for (const m of src.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])([^'"]+)\1/g)) refs.push([m[2], here]);
  for (const m of src.matchAll(/\b(?:src|href)\s*=\s*(['"])([^'"$`{]+)\1/g)) if (!m[2].startsWith('assets/')) refs.push([m[2], ROOT]);
  if (f.endsWith('.css')) for (const m of src.matchAll(/(?<![\w-])url\(\s*['"]?([^'")$]+)['"]?\s*\)/g)) refs.push([m[1], here]);
  if (f.endsWith('manifest.json')) for (const m of src.matchAll(/"src"\s*:\s*"([^"]+)"/g)) refs.push([m[1], ROOT]);
  for (const [r, base] of refs) {
    if (/^(https?:|data:|blob:|#|mailto:)/.test(r)) continue;
    if (r.startsWith('/')) { problems.push(`${rel(f)}: 절대 경로 "${r}" — 상대 경로로 바꿔야 Pages 하위 주소에서 동작합니다`); continue; }
    if (r === '' || r === '.' || r === './') continue;
    const target = path.resolve(base, r.split(/[?#]/)[0]);
    if (!existsExact(target)) problems.push(`${rel(f)}: "${r}" 파일이 없습니다 (대소문자 확인)`);
  }
  // 문자열 안의 "/assets/..." 같은 절대 경로
  for (const m of src.matchAll(/['"`]\/(assets|js|css|data|icons)\//g)) problems.push(`${rel(f)}: 절대 경로 "${m[0].slice(1)}…"`);
}

// ---------- 3) 서비스 워커 ----------
const DEPLOY = ['index.html', 'manifest.json', 'css', 'js', 'data', 'assets', 'icons'];
const files = [];
for (const d of DEPLOY) {
  const p = path.join(ROOT, d);
  if (!fs.existsSync(p)) continue;
  if (fs.statSync(p).isDirectory()) files.push(...walk(p)); else files.push(p);
}
const deploy = files.map(rel).filter(f => !/\.md$/i.test(f)).sort();
// 버전 = 배포 파일 내용 해시 (내용이 같으면 버전도 같음 → 불필요한 업데이트 알림 없음)
const h = crypto.createHash('sha256');
for (const f of deploy) { h.update(f); h.update(fs.readFileSync(path.join(ROOT, f))); }
const version = h.digest('hex').slice(0, 12);
const swPath = path.join(ROOT, 'sw.js');
const sw = fs.readFileSync(swPath, 'utf8');
const block = `// BUILD:BEGIN (node tools/build-pages.mjs 가 채움)\nconst VERSION = '${version}';\nconst FILES = ${JSON.stringify(['./', ...deploy], null, 0).replace(/","/g, '",\n  "').replace(/^\[/, '[\n  ').replace(/\]$/, ',\n]')};\n// BUILD:END`;
const newSw = sw.replace(/\/\/ BUILD:BEGIN[\s\S]*?\/\/ BUILD:END/, block);
if (newSw === sw && !sw.includes(`'${version}'`)) problems.push('sw.js: BUILD 표시를 찾지 못했습니다');
const fail = () => { console.error('문제 ' + problems.length + '건:\n  ' + problems.join('\n  ')); process.exit(1); };
if (problems.length) fail();
const swChanged = writeIfChanged('sw.js', newSw);
if (problems.length) fail();
console.log(`배포 파일 ${deploy.length}개, 자산 이미지 ${assetFiles.length}개, 버전 ${version}${CHECK ? ' (검사만)' : ''}${assetChanged || swChanged ? ' — 갱신됨' : ''}`);
