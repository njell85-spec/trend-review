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
import { runWithRetry } from './src/utils/retryPipeline.js';

const todayKST = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
console.log(`\n📅 Daily EM/CCM Trend Review — ${todayKST} (KST)\n`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 재시도 정책 (상세 로직은 src/utils/retryPipeline.js) ─────────────────────
// claude 구독 CLI가 세션 한도(429)에 걸리면 그 시간대엔 계속 실패한다. 세션 창은
// 약 5시간마다 리셋되므로, 일정 간격(기본 60분)으로 최대 N회(기본 3회) 재시도해
// 리셋 창을 노린다. 반대로 워크스페이스 신뢰 미설정·CLI 미설치 같은 "결정적" 오류는
// 기다려도 동일하게 실패하므로 즉시 중단하고 알린다.
// 값은 GitHub Actions Variables(SESSION_RETRY_MAX / SESSION_RETRY_DELAY_MIN)로 조정 가능.
const envNum = (v, d) => {
  const n = Number(v);
  return v != null && v !== '' && Number.isFinite(n) ? n : d;
};
const MAX_ATTEMPTS = Math.max(1, envNum(process.env.SESSION_RETRY_MAX, 3));
const RETRY_DELAY_MS = Math.max(0, envNum(process.env.SESSION_RETRY_DELAY_MIN, 60)) * 60_000;

async function notifyFailure(reasonLabel) {
  try {
    const r = await new KakaoNotifier().sendFailure({ dateStr: todayKST, reason: reasonLabel });
    if (r.sent) console.log('💬 카카오 실패 알림 발송 완료');
  } catch (err) {
    console.warn(`⚠️  카카오 실패 알림 전송 실패(무시): ${err.message}`);
  }
}

// 시작 지터(첫 시도 전 1회만): 고정 cron 초에 NCBI를 동시에 때리지 않도록 0~90초 랜덤 지연.
const jitterMs = Math.floor(Math.random() * 90_000);
console.log(`⏳ startup jitter ${(jitterMs / 1000).toFixed(0)}s (NCBI 부하 분산)`);
await sleep(jitterMs);

// 소프트 실패: 일시 장애로 죽어도 워크플로우를 빨갛게 만들지 않고 기존 사이트를 그대로
// 둔 채 종료(exit 0). 단, 재시도 가치가 있는 실패는 간격을 두고 최대 MAX_ATTEMPTS회 재시도.
const outcome = await runWithRetry(
  () => new TrendReviewOrchestrator({ searchDays: 180, topN: 1 }),
  {
    maxAttempts: MAX_ATTEMPTS,
    delayMs: RETRY_DELAY_MS,
    onAttempt: (attempt) => console.log(`\n▶️  파이프라인 시도 ${attempt}/${MAX_ATTEMPTS}`),
    onFail: ({ attempt, label, message }) => {
      console.warn(`⚠️  시도 ${attempt}/${MAX_ATTEMPTS} 실패: ${label}`);
      console.warn(`   (${message.slice(0, 300)})`);
    },
    onRetry: ({ delayMs }) =>
      console.warn(`   ${delayMs / 60_000}분 후 재시도합니다 (한도 리셋 창 대기).`),
  },
);

if (!outcome.ok) {
  // 결정적 오류이거나 마지막 시도까지 실패 → 소프트 스킵 + 정확한 사유로 알림.
  console.warn('   사이트는 변경되지 않았습니다.');
  const suffix = outcome.retryable ? ` — ${MAX_ATTEMPTS}회 재시도 후에도 실패` : '';
  await notifyFailure(`${outcome.label}${suffix}`);
  process.exit(0);
}

const papers = outcome.result.topPapers ?? [];

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
