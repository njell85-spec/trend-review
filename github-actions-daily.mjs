/**
 * github-actions-daily.mjs
 * GitHub Actions 전용 일일 파이프라인 실행기
 *
 * 환경변수 (GitHub Secrets에서 주입):
 *   ANTHROPIC_API_KEY  — Claude API (필수)
 *   PUBMED_API_KEY     — PubMed E-utilities (선택)
 *   PUBMED_EMAIL       — PubMed 이메일 (선택)
 *   GITHUB_TOKEN       — 자동 제공 (GitHub Pages 배포용)
 *   GITHUB_OWNER       — 자동 제공 (github.repository_owner)
 *   GITHUB_REPO        — 자동 제공 (github.event.repository.name)
 */
import 'dotenv/config';
import { TrendReviewOrchestrator } from './src/orchestrator/TrendReviewOrchestrator.js';
import { KakaoNotifier } from './src/agents/KakaoNotifier.js';

const todayKST = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
console.log(`\n📅 Daily EM/CCM Trend Review — ${todayKST} (KST)\n`);

// 시작 지터: 고정 cron 초에 NCBI를 동시에 때리지 않도록 0~90초 랜덤 지연.
const jitterMs = Math.floor(Math.random() * 90_000);
console.log(`⏳ startup jitter ${(jitterMs / 1000).toFixed(0)}s (NCBI 부하 분산)`);
await new Promise((r) => setTimeout(r, jitterMs));

const orchestrator = new TrendReviewOrchestrator({
  searchDays: 180,
  topN:       1,
});

// 소프트 실패: PubMed 다운 등 일시 장애로 죽어도 워크플로우를 빨갛게 만들지 않고
// 기존 사이트를 그대로 둔 채 "오늘은 건너뜀"으로 깔끔히 종료(exit 0).
let result;
try {
  result = await orchestrator.run();
} catch (err) {
  console.warn(`⚠️  오늘 실행 실패(소프트 스킵): ${err.message}`);
  console.warn('   사이트는 변경되지 않았습니다. 내일 다시 시도합니다.');
  process.exit(0);
}

const papers = result.topPapers ?? [];

console.log(`\n✅ 파이프라인 완료: ${papers.length}편 선정`);
papers.forEach((p, i) =>
  console.log(
    `  ${i + 1}. [${p.clinicalApplicabilityScore ?? '—'}점] ${(p.paper?.title ?? '').slice(0, 80)}`
  )
);

if (!papers.length) {
  console.warn('⚠️  오늘 선정된 논문이 없습니다.');
  process.exit(0);
}

const pagesUrl = `https://${process.env.GITHUB_OWNER}.github.io/${process.env.GITHUB_REPO}/`;
console.log(`\n🌐 GitHub Pages: ${pagesUrl}`);

// ── 카카오 나챗방 발송 (Secrets 설정 시) — 실패해도 파이프라인은 성공 처리 ─────
try {
  const kakao = new KakaoNotifier();
  const r = await kakao.send({ dateStr: todayKST, screened: 300, topPaper: papers[0], pagesUrl });
  if (r.sent) console.log('💬 카카오 나챗방 리포트 발송 완료');
} catch (err) {
  console.warn(`⚠️  카카오 발송 실패(파이프라인은 정상): ${err.message}`);
}
