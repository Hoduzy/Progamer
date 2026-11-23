// ============================================================
//  경기 엔진 정합성 검사기
//  사용: node tools/validate-match.mjs [판 수=500] [--seed 접두어] [--verbose] [--no-scenes] [--max 5]
//  화면 없이 서로 다른 시드로 경기를 돌리며 매 틱 상태·이벤트를 검사한다.
//  검사 항목·통계는 tools/lib/match-checker.mjs. 위반이 하나라도 있으면 종료 코드 1.
// ============================================================
import { opts, makeGame, runChecked, printReport, violCount } from './lib/match-checker.mjs';

const args = process.argv.slice(2);
const N = Number(args.find(a => /^\d+$/.test(a)) || 500);
const PREFIX = args.includes('--seed') ? args[args.indexOf('--seed') + 1] : 'val';
opts.VERBOSE = args.includes('--verbose');
opts.SCENES = !args.includes('--no-scenes');
opts.MAXSHOW = args.includes('--max') ? Number(args[args.indexOf('--max') + 1]) : 4;

const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const seed = `${PREFIX}-${i}`;
  runChecked(makeGame(seed, opts.SCENES), seed);
}
const ok = printReport(((Date.now() - t0) / 1000).toFixed(1));
process.exit(violCount() === 0 ? 0 : 1);
