// 커뮤니티 글·댓글 검사
// 사용: node tools/validate-community.mjs [설정 수=5] [--show N]   설정: 1군 보통 / 2군 / 1군 잘함 / 1군 압도적 / 1군 실력 부족(주로 벤치)  (--show: 만들어진 글 N개를 보기 좋게 출력)
//  - 템플릿 개수 (제목 200 / 본문 150 / 댓글 500 / 대댓글 150 이상)
//  - 시즌 1개를 돌리며 만들어진 모든 글에 대해:
//    쿨타임 안 재사용 0 (제목 60글, 댓글 150개, 본문·대댓글도 설정값), 한 글 안 같은 댓글·대댓글 템플릿 0,
//    금지 표현(혐오·가족 욕·성적·협박) 0, 실제 선수 이름 0, 채워지지 않은 변수 0, 순한맛 필터 뒤 센 욕 0
//  - 가장 많이 쓰인 템플릿 상위 10개, 고닉 호감도 변화·이야기 글·싸움 스레드 통계
import { newWorld, createUserPlayer, signUserToTeam } from '../js/engine/state.js';
import { createSeason, beginDay, endDay, userRef, allMatches } from '../js/engine/season.js';
import { seasonTick, acceptOffer } from '../js/engine/career.js';
import { generatePosts, generateTopicPosts, seriesPostInfo, templateCounts, TPL, toneText, communityReact, fixedUserList } from '../js/engine/community.js';
import { CONFIG } from '../js/config.js';
import { BANNED, FIXED_USERS } from '../data/community/index.js';
import { BLOCKLIST } from '../data/names.js';

const args = process.argv.slice(2);
const N = Number(args.find(a => /^\d+$/.test(a)) || 5);
const SHOW = args.includes('--show') ? Number(args[args.indexOf('--show') + 1] || 3) : 0;
const CD = CONFIG.community.cooldown;
const MIN = { titles: 200, bodies: 150, comments: 500, replies: 150 };
// 실제 프로 선수·코치·해설 이름 (한글 표기) — 커뮤니티 문장에 나오면 안 됨
const REAL_KO = ['페이커', '쵸비', '케리아', '제우스', '구마유시', '쇼메이커', '캐니언', '데프트', '피넛', '도란', '쿠로', '클템', '단군', '전용준', '이현우', '앰비션', '베릴', '비디디', '리헨즈', '스맵', '벵기', '쿠비', '에포트', '표식', '킹겐', '클로저', '루시드', '페이즈', '딜라이트', '크로코', '룰러', '오너'];
const STRONG = /ㅅㅂ|ㅆㅂ|ㅈㄴ|개같이|정병|접어라/;

const viol = [];
const v = (kind, msg) => { if (viol.filter(x => x.kind === kind).length < 8) console.log(`  ✗ [${kind}] ${msg}`); viol.push({ kind, msg }); };
const useCount = {};
const stat = { posts: 0, comments: 0, replies: 0, fights: 0, stories: {}, kinds: {}, fixedComments: 0, grudging: 0, forced: 0 };

// 1) 템플릿 개수
const cnt = templateCounts();
for (const k of Object.keys(MIN)) if (cnt[k] < MIN[k]) v('개수', `${k} ${cnt[k]}개 < ${MIN[k]}`);
console.log(`템플릿: 제목 ${cnt.titles} · 본문 ${cnt.bodies} · 댓글 ${cnt.comments} · 대댓글 ${cnt.replies} · 고닉 ${FIXED_USERS.length}명`);

// 템플릿 원문에도 금지어·실명이 없어야 함
const allTpl = [...TPL.t, ...TPL.b, ...TPL.c, ...TPL.r];
for (const t of allTpl) checkText(t.text, `템플릿 ${t.id}`, true);
// 조건 태그 오타 검사
const KNOWN = new Set('win lose played bench good bad great awful pog comeback thrown stomp swept close cl lck intl playoff final streakW streakL patch rookie provoked humble rival baron elder fa academy grudging ks'.split(' '));
for (const t of allTpl) for (const n of [...t.need, ...t.not]) if (!KNOWN.has(n)) v('태그', `${t.id} 알 수 없는 태그 "${n}" (${t.text})`);
const KNOWN_VARS = new Set('선수 팀 상대팀 챔피언 스코어 KDA 평점 분 오브젝트 대회 라이벌 상대선수 포지션 장면 다른팀 다른팀2 순위 메타챔 패치 다음상대 연승 연패 국제대회 다른선수 고닉 대상'.split(' '));
for (const t of allTpl) for (const x of t.vars) if (!KNOWN_VARS.has(x)) v('변수', `${t.id} 알 수 없는 변수 {${x}}`);

function checkText(s, where, tpl = false) {
  const low = s.toLowerCase();
  for (const b of BANNED) if (s.includes(b)) v('금지 표현', `"${b}" — ${where}: ${s}`);
  for (const r of REAL_KO) if (s.includes(r)) v('실명', `"${r}" — ${where}: ${s}`);
  if (!tpl) {
    for (const w of low.split(/[^a-z0-9]+/)) if (w.length >= 3 && /[a-z]/.test(w) && BLOCKLIST.has(w)) v('실명', `"${w}" — ${where}: ${s}`);
    if (/\{[^{}]+\}/.test(s)) v('변수 누락', `${where}: ${s}`);
    if (STRONG.test(toneText(s, 'mild'))) v('순한맛', `${where}: ${toneText(s, 'mild')}`);
    if (!s.trim()) v('빈 문장', where);
  }
}

// 2) 시즌 돌리기
let seqs = { t: [], b: [], c: [], r: [] };
const runSeqs = [];
const shown = [];
function record(posts) {
  for (const p of posts) {
    stat.posts++; stat.kinds[p.story ? 'story:' + p.story : p.kind] = (stat.kinds[p.story ? 'story:' + p.story : p.kind] || 0) + 1;
    if (p.story) stat.stories[p.story] = (stat.stories[p.story] || 0) + 1;
    seqs.t.push(p.tid); if (p.bid) seqs.b.push(p.bid);
    useCount[p.tid] = (useCount[p.tid] || 0) + 1; if (p.bid) useCount[p.bid] = (useCount[p.bid] || 0) + 1;
    checkText(p.title, `제목(${p.kind})`); checkText(p.body, `본문(${p.kind})`); checkText(p.who, '닉네임');
    const inPost = new Set(), inPostR = new Set();
    let fight = false;
    for (const c of p.comments) {
      stat.comments++; if (c.uid) stat.fixedComments++; if (c.stance === 'grudging') stat.grudging++;
      seqs.c.push(c.tid); useCount[c.tid] = (useCount[c.tid] || 0) + 1;
      if (inPost.has(c.tid)) v('글 안 중복 댓글', `${p.title} — ${c.text}`);
      inPost.add(c.tid);
      checkText(c.text, `댓글(${c.stance})`); checkText(c.who, '닉네임');
      for (const r of c.replies) {
        stat.replies++;
        seqs.r.push(r.tid); useCount[r.tid] = (useCount[r.tid] || 0) + 1;
        if (inPostR.has(r.tid)) v('글 안 중복 대댓글', `${p.title} — ${r.text}`);
        inPostR.add(r.tid);
        if (['vsAnti', 'vsFan', 'team', 'escalate'].includes(r.type)) fight = true;
        checkText(r.text, `대댓글(${r.type})`);
      }
    }
    if (fight) stat.fights++;
    if (shown.length < SHOW) shown.push(p);
  }
}

for (let run = 0; run < N; run++) {
  const { state, rng } = newWorld('comm-' + (run + 1));
  const pos = ['MID', 'TOP', 'ADC', 'JGL', 'SUP'][run % 5];
  createUserPlayer(state, rng, { nick: ['Starling', 'Kestrel', 'Lumiy', 'Sable', 'Quill'][run % 5], pos, age: 18, style: '캐리형', mains: [] });
  // 번갈아: LCK 1군 / CL 2군
  if (run % 5 !== 1) signUserToTeam(state, rng, ['KT', 'DK', 'NS', 'GEN', 'BRO'][run % 5], 'main', { salary: 1.5e8, endSeason: state.year, buyout: 3e8, starter: true });
  else signUserToTeam(state, rng, 'DRX', 'academy', { salary: 3e7, endSeason: state.year, buyout: 1e8, starter: false });
  // 실제로 경기에 나가야 내 활약·부진·안티·팬 글이 나오므로 주전급으로 만든다 (설정마다 실력 차이)
  const me = state.players[state.user.pid];
  for (const k in me.stats) me.stats[k] = [84, 72, 90, 99, 68][run % 5] + rng.int(-3, 3);
  if (run % 5 === 3) { me.form = 10; }
  state.user.trust = 85; state.user.scrimScore = 80;
  createSeason(state, rng);
  const done = new Set();
  const favor0 = Object.fromEntries(fixedUserList(state).map(u => [u.id, u.favor]));
  let guard = 0, series = 0;
  while (guard++ < 400) {
    beginDay(state, rng);
    const day = state.date;
    const res = endDay(state, rng);
    const ref = userRef(state);
    for (const m of allMatches(state)) {
      if (!m.done || done.has(m.id) || m.date !== day || !ref || !m.teams.includes(ref)) continue;
      done.add(m.id);
      series++;
      const info = seriesPostInfo(state, m);
      // 승리 인터뷰 흉내 (호감도·도발/겸손 태그 검사용)
      if (info.played && info.win && rng.chance(0.6)) communityReact(state, rng.pick(['humble', 'humble', 'team', 'team', 'provoke']), info);
      record(generatePosts(state, rng, info));
    }
    if (res.patch) record(generateTopicPosts(state, rng, 'patch'));
    if (rng.chance(0.004)) communityReact(state, 'controversy');
    const evs = seasonTick(state, rng);
    if (state.fa && state.fa.status !== 'signed' && state.fa.offers.length) {
      const best = state.fa.offers.filter(o => o.status === 'open').sort((a, b) => b.salary - a.salary)[0];
      if (best) acceptOffer(state, rng, best.id);
    }
    if (evs.some(e => e.type === 'newSeasonReady')) break;
  }
  stat.forced += state.commLog ? state.commLog.forced || 0 : 0;
  if (process.env.DBG) console.log('   seq 엔진', JSON.stringify(state.commLog.seq), '검사기', JSON.stringify({ t: seqs.t.length, b: seqs.b.length, c: seqs.c.length, r: seqs.r.length }));
  runSeqs.push(seqs); seqs = { t: [], b: [], c: [], r: [] };
  const fav = fixedUserList(state);
  const moves = fav.filter(u => Math.abs(u.favor - favor0[u.id]) >= 1).map(u => `${u.nick} ${favor0[u.id]}→${Math.round(u.favor)}`);
  const ms = state.user.matchLog;
  console.log(`설정 ${run + 1}: ${pos} ${run % 5 !== 1 ? '1군' : '2군'} · 시리즈 ${series} · 경기 ${ms.length}+ · 평균 평점 ${(ms.reduce((a, m) => a + m.rating, 0) / Math.max(1, ms.length)).toFixed(2)} · 세이브 커뮤니티 기록 ${(JSON.stringify(state.commLog).length / 1024).toFixed(1)}KB`);
  console.log(`   고닉 호감도 변화: ${moves.slice(0, 8).join(', ')}${moves.length > 8 ? ` 외 ${moves.length - 8}명` : ''}`);
}

// 3) 쿨타임 검사: 같은 템플릿이 쿨타임 안에서 다시 쓰였는지 (순서대로 기록된 사용 목록에서)
// 설정(세이브)마다 따로 검사
function checkCooldown(list, cd, label) {
  const last = {};
  list.forEach((id, i) => {
    if (last[id] !== undefined && i - last[id] < cd) v('쿨타임', `${label} ${id} — ${i - last[id]}번째 만에 재사용 (기준 ${cd})`);
    last[id] = i;
  });
}
for (const sq of runSeqs) {
  checkCooldown(sq.t, CD.t, '제목');
  checkCooldown(sq.b, CD.b, '본문');
  checkCooldown(sq.c, CD.c, '댓글');
  checkCooldown(sq.r, CD.r, '대댓글');
}
if (stat.forced) v('쿨타임', `조건에 맞는 템플릿이 모두 쿨타임이라 가장 오래된 것을 다시 쓴 횟수 ${stat.forced}`);

// 4) 통계
console.log(`\n글 ${stat.posts} · 댓글 ${stat.comments} (고닉 ${stat.fixedComments}, 마지못해 인정 ${stat.grudging}) · 대댓글 ${stat.replies} · 싸움 스레드 있는 글 ${stat.fights} (${(stat.fights / Math.max(1, stat.posts) * 100).toFixed(0)}%)`);
console.log('글 종류: ' + Object.entries(stat.kinds).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · '));
console.log(`쿨타임이 다 차서 오래된 템플릿을 다시 쓴 횟수: ${stat.forced}`);
console.log('고닉 이야기 글: ' + (Object.entries(stat.stories).map(([k, n]) => `${k} ${n}`).join(' · ') || '없음'));
const byId = Object.fromEntries(allTpl.map(t => [t.id, t]));
const top = Object.entries(useCount).sort((a, b) => b[1] - a[1]).slice(0, 10);
console.log('\n가장 많이 쓰인 템플릿 상위 10개:');
top.forEach(([id, n], i) => console.log(`  ${String(i + 1).padStart(2)}. ${String(n).padStart(3)}회  [${id.split('.').slice(0, 2).join('.')}] ${byId[id] ? byId[id].text : id}`));
const unused = { t: 0, b: 0, c: 0, r: 0 };
for (const t of allTpl) if (!useCount[t.id]) unused[t.src]++;
console.log(`한 번도 안 쓰인 템플릿: 제목 ${unused.t} · 본문 ${unused.b} · 댓글 ${unused.c} · 대댓글 ${unused.r}`);

if (SHOW) {
  console.log('\n--- 글 예시 ---');
  for (const p of shown) {
    console.log(`\n[${p.kind}${p.story ? ':' + p.story : ''}] ${p.title}  (${p.who})\n  ${p.body}`);
    for (const c of p.comments) {
      console.log(`  - ${c.who}: ${c.text}   <${c.stance}>`);
      for (const r of c.replies) console.log(`      ㄴ ${r.who}: ${r.text}   <${r.type}>`);
    }
  }
}

const kinds = {};
for (const x of viol) kinds[x.kind] = (kinds[x.kind] || 0) + 1;
console.log(`\n위반 ${viol.length}건${viol.length ? ' — ' + Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(', ') : ''}`);
console.log(viol.length ? '결과: 실패 ✗' : '결과: 통과 ✓');
process.exit(viol.length ? 1 : 0);
