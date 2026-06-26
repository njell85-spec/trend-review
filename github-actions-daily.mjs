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

const todayKST = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
console.log(`\n📅 Daily EM/CCM Trend Review — ${todayKST} (KST)\n`);

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('❌ ANTHROPIC_API_KEY 환경변수가 없습니다. GitHub Secrets를 확인하세요.');
  process.exit(1);
}

const orchestrator = new TrendReviewOrchestrator({
  searchDays: 180,
  topN:       1,
});

const result = await orchestrator.run();
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

console.log(`\n🌐 GitHub Pages: https://${process.env.GITHUB_OWNER}.github.io/${process.env.GITHUB_REPO}/`);
