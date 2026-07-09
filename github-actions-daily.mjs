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
import { appendFileSync } from 'fs';
import { TrendReviewOrchestrator } from './src/orchestrator/TrendReviewOrchestrator.js';
import { KakaoNotifier } from './src/agents/KakaoNotifier.js';
import { runWithRetry } from './src/utils/retryPipeline.js';
import { llmTelemetry } from './src/utils/LLMClient.js';
import { kstDateStr } from './src/utils/dates.js';

const todayKST = kstDateStr();
console.log(`\n📅 Daily EM/CCM Trend Review — ${todayKST} (KST)\n`);

// Actions job summary — 소프트 실패(exit 0)도 초록 체크와 구분되게 기록한다.
function jobSummary(md) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  try { appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n'); } catch { /* non-fatal */ }
}

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
  const reason = `${outcome.label}${suffix}`;
  // exit 0 이라 잡은 초록색 — 어노테이션 + job summary 로 소프트 실패를 가시화
  console.log(`::warning::Trend Review 소프트 실패 (사이트 미변경): ${reason}`);
  jobSummary(`## ⚠️ Trend Review 소프트 실패 — ${todayKST}\n\n- 사유: **${reason}**\n- 사이트는 이전 상태를 유지합니다. 다음 스케줄에 재시도됩니다.`);
  await notifyFailure(reason);
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
  console.log('::warning::오늘 선정된 논문이 없습니다 (파이프라인은 정상 종료).');
  jobSummary(`## ⚠️ Trend Review — ${todayKST}\n\n선정된 논문이 없습니다 (검색/검증 결과 0편).`);
  process.exit(0);
}

const pagesUrl = `https://${process.env.GITHUB_OWNER}.github.io/${process.env.GITHUB_REPO}/`;
console.log(`\n🌐 GitHub Pages: ${pagesUrl}`);

// 이번 실행이 구독 CLI로 돌았는지 / API 폴백으로 넘어갔는지 (경로 피드백)
const llmRoute = llmTelemetry.label();
console.log(`🧭 LLM 실행 경로: ${llmRoute}  (구독=CLI, API=폴백)`);

// ── 카카오 나챗방 발송 (Secrets 설정 시) — 실패해도 파이프라인은 성공 처리 ─────
let kakaoStatus = '미설정';
try {
  const kakao = new KakaoNotifier();
  const r = await kakao.send({ dateStr: todayKST, topPaper: papers[0], pagesUrl, llmRoute });
  if (r.sent) {
    kakaoStatus = '발송 완료';
    console.log('💬 카카오 나챗방 리포트 발송 완료');
  }
} catch (err) {
  kakaoStatus = `발송 실패: ${err.message.slice(0, 120)}`;
  console.warn(`⚠️  카카오 발송 실패(파이프라인은 정상): ${err.message}`);
  // 카톡이 유일한 알림 채널이므로, 발송 실패는 잡 로그에서 반드시 눈에 띄어야 한다
  console.log(`::warning::카카오 발송 실패 — ${err.message.slice(0, 200)}`);
}

// ── Phase 2: Drive 아카이브 + 리빙 Doc (소프트 실패 — 코어에 영향 없음) ────────
let archiveStatus = '미설정';
try {
  const { ArchiveAgent } = await import('./src/agents/ArchiveAgent.js');
  const r = await new ArchiveAgent().run({ analysis: papers[0], todayKST });
  archiveStatus = r.ok
    ? `완료 (PDF ${r.pdf ? '적재' : '없음'} · Doc ${r.docUpdated ? '갱신' : '실패 — 다음 실행에서 재생성'})`
    : `건너뜀: ${r.reason}`;
  if (r.ok) console.log(`📚 Drive 아카이브 완료 (PDF ${r.pdf ? '적재' : '없음'})`);
} catch (err) {
  archiveStatus = `실패: ${err.message.slice(0, 120)}`;
  console.log(`::warning::Phase 2 아카이브 실패 — ${err.message.slice(0, 200)}`);
}

// ── 아카이브 저장 현황 패널(§4-E) 최신화 — ArchiveAgent 가 "그날 항목"을 analysis_archive
// 에 추가한 뒤라야 오늘 논문이 패널에 뜬다. publish()가 구운 패널은 하루 지연되므로 다시 굽는다. ──
try {
  const { GitHubPublisher } = await import('./src/utils/GitHubPublisher.js');
  const r = await new GitHubPublisher().refreshArchiveStatus(todayKST);
  if (r.updated) console.log(`📦 아카이브 저장 현황 패널 최신화 (${r.pushed ? '푸시 완료' : '로컬 커밋 — 후속 푸시 대기'})`);
} catch (err) {
  console.log(`::warning::아카이브 현황 최신화 실패 — ${err.message.slice(0, 200)}`);
}

// ── Phase 3: 영상 제작·비공개 업로드 (소프트 실패 · ENABLE_VIDEO=true 게이트) ────
// 기본 영어 2편(중간폼·숏폼) — 언어는 VIDEO_LANGS로 확장. 샘플 승인(REPORT_SPEC
// §4-F 게이트) 전에는 기본 비활성 — 승인 후 Variables로 켠다.
let videoStatus = '비활성';
if (process.env.ENABLE_VIDEO === 'true') {
  try {
    const { VideoAgent } = await import('./src/agents/VideoAgent.js');
    const r = await new VideoAgent().run({ analysis: papers[0], todayKST, pagesUrl });
    const okCnt = r.videos.filter((v) => v.videoId).length;
    videoStatus = `${okCnt}/${r.videos.length} 업로드`;
    if (okCnt < r.videos.length) {
      const failed = r.videos.filter((v) => v.error).map((v) => `${v.form}/${v.lang}`).join(', ');
      console.log(`::warning::영상 일부 실패 — ${failed}`);
    }
  } catch (err) {
    videoStatus = `실패: ${err.message.slice(0, 120)}`;
    console.log(`::warning::Phase 3 영상 실패 — ${err.message.slice(0, 200)}`);
  }
}

const top = papers[0];
jobSummary([
  `## ✅ Trend Review — ${todayKST}`,
  '',
  `- 선정: **${(top.title_ko || top.paper?.title || '').slice(0, 100)}** (PMID ${top.paper?.pmid ?? '—'})`,
  `- LLM 경로: ${llmRoute}`,
  `- 카카오: ${kakaoStatus}`,
  `- 아카이브: ${archiveStatus}`,
  `- 영상: ${videoStatus}`,
  `- 대시보드: ${pagesUrl}`,
].join('\n'));
