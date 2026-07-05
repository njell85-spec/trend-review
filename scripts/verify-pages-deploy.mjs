/**
 * verify-pages-deploy.mjs — GitHub Pages 배포 검증 + 자동 재시도
 *
 * 왜 필요한가: 파이프라인이 index.html 을 main 에 반영하면 GitHub 가 자체
 * "pages build and deployment" 워크플로우로 사이트를 배포하는데, 이 배포가
 * GitHub 측 일시 오류("Deployment failed, try again later")로 실패하면
 * 카카오 리포트 링크가 전날 데이터를 계속 보여준다 (2026-07-05 실제 발생).
 * 파이프라인 성공 ≠ 사이트 반영이므로, 배포 완료까지를 게이트로 확인한다.
 *
 * 동작:
 *   1. 원격 main HEAD 를 API 로 조회한다. 로컬 HEAD 가 아닌 원격 기준인 이유:
 *      GitHubPublisher 는 git push 실패 시 Contents API PUT 으로 폴백하는데,
 *      그 경우 배포되는 커밋은 원격에만 존재한다 (로컬 HEAD 와 sha 가 다름).
 *   2. 이번 실행에서 원격이 안 움직였으면(원격 HEAD == GITHUB_SHA) 즉시 통과.
 *   3. 그 커밋의 Pages 배포 런을 폴링. 실패로 끝나면 rerun-failed-jobs 로
 *      재실행 (새 attempt 기준 최대 RERUN_MAX회 — 폴링 지연으로 중복 카운트 금지).
 *   4. 제한 시간 내 성공을 못 보면 카카오 실패 알림 후 exit 1 (워크플로우 빨간불).
 *
 * 필요 권한: GITHUB_TOKEN 에 actions: write (재실행) + contents: read.
 * 보안상 이 스크립트는 LLM 파이프라인과 별도 잡에서 실행한다 (daily-review.yml 참고).
 */
import { KakaoNotifier } from '../src/agents/KakaoNotifier.js';
import { kstDateStr } from '../src/utils/dates.js';

const API = 'https://api.github.com';
const PAGES_WORKFLOW_PATH = 'dynamic/pages/pages-build-deployment';
const POLL_MS = 20_000;          // 폴링 간격
const APPEAR_MS = 3 * 60_000;    // Pages 런 출현 대기 한도 (push 후 수 초 내 생성됨)
const DEADLINE_MS = 15 * 60_000; // 전체 제한 시간
const RERUN_MAX = 3;             // 실패 배포 재실행 횟수 (새 attempt 기준)

const token = process.env.GITHUB_TOKEN;
const repoFull = process.env.GITHUB_REPOSITORY; // Actions 기본 제공 'owner/repo'
const baseline = process.env.GITHUB_SHA || '';  // 워크플로우 트리거 시점의 main HEAD
if (!token || !repoFull || !baseline) {
  console.error('❌ GITHUB_TOKEN / GITHUB_REPOSITORY / GITHUB_SHA 미설정 — 배포 검증 불가');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function apiGet(path) {
  const res = await fetch(`${API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${path}`);
  return res.json();
}

// 재실행 요청. 반환: 'accepted' | 'already-running' | HTTP 상태코드(거부)
async function requestRerun(runId) {
  const res = await fetch(`${API}/repos/${repoFull}/actions/runs/${runId}/rerun-failed-jobs`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (res.ok) return 'accepted';
  if (res.status === 409) return 'already-running'; // 이미 재실행 중
  return res.status; // 403/422 등 — 권한·정책 문제, 기다려도 안 풀림
}

// 검증 대상 커밋의 가장 최근 Pages 배포 런 (head_sha 서버측 필터)
async function findPagesRun(sha) {
  const data = await apiGet(`/repos/${repoFull}/actions/runs?head_sha=${sha}&per_page=10`);
  return (data.workflow_runs || []).find((r) => r.path === PAGES_WORKFLOW_PATH) || null;
}

async function notifyAndFail(reason) {
  console.error(`❌ Pages 배포 검증 실패: ${reason}`);
  try {
    const r = await new KakaoNotifier().sendFailure({
      dateStr: kstDateStr(),
      reason: `대시보드 배포 확인 실패 — ${reason}`,
    });
    if (r.sent) console.log('💬 카카오 실패 알림 발송 완료');
  } catch (err) {
    console.warn(`⚠️  카카오 실패 알림 전송 실패(무시): ${err.message}`);
  }
  process.exit(1);
}

// ── 검증 대상 결정: 원격 main HEAD ───────────────────────────────────────────
let target;
try {
  target = (await apiGet(`/repos/${repoFull}/branches/main`)).commit.sha;
} catch (err) {
  await notifyAndFail(`원격 main 조회 실패 (${err.message})`);
}

if (target === baseline) {
  console.log(`✅ 이번 실행에서 main 변동 없음 (${baseline.slice(0, 7)}) — 배포 검증 생략`);
  process.exit(0);
}
console.log(`🔎 Pages 배포 검증 시작 — 대상 ${target.slice(0, 7)} (baseline ${baseline.slice(0, 7)})`);

// ── 폴링 루프 ────────────────────────────────────────────────────────────────
const start = Date.now();
let rerunsIssued = 0;      // 실제로 접수된 재실행 요청 수
let handledAttempt = 0;    // 재실행을 이미 걸어 둔 (실패) attempt 번호

while (Date.now() - start < DEADLINE_MS) {
  let run;
  try {
    run = await findPagesRun(target);
  } catch (err) {
    console.warn(`⚠️  런 조회 실패(재시도): ${err.message}`);
    await sleep(POLL_MS);
    continue;
  }

  if (!run) {
    // push 후 수 초 내 생성되므로, 오래 안 보이면 Pages 설정 문제 — 빨리 알린다.
    if (Date.now() - start > APPEAR_MS) {
      await notifyAndFail(`커밋 ${target.slice(0, 7)} 의 Pages 배포 런이 ${APPEAR_MS / 60_000}분간 미출현 — Pages 설정 확인 필요`);
    }
    console.log('… Pages 런이 아직 없음 — 대기');
    await sleep(POLL_MS);
    continue;
  }

  if (run.status !== 'completed') {
    console.log(`… 배포 진행 중 (run ${run.id}, attempt ${run.run_attempt}, status ${run.status})`);
    await sleep(POLL_MS);
    continue;
  }

  if (run.conclusion === 'success') {
    console.log(`✅ Pages 배포 성공 확인 (run ${run.id}, attempt ${run.run_attempt})`);
    process.exit(0);
  }

  // 실패로 완료 — 이미 재실행을 걸어 둔 attempt 면 API 반영 지연이므로 그냥 대기.
  if (run.run_attempt <= handledAttempt) {
    console.log(`… 재실행 반영 대기 (attempt ${run.run_attempt} 처리됨)`);
    await sleep(POLL_MS);
    continue;
  }

  if (rerunsIssued >= RERUN_MAX) {
    await notifyAndFail(`재실행 ${RERUN_MAX}회 후에도 실패 (run ${run.id}, attempt ${run.run_attempt})`);
  }

  console.warn(`🔁 배포 실패(conclusion=${run.conclusion}, attempt ${run.run_attempt}) — 재실행 요청 ${rerunsIssued + 1}/${RERUN_MAX}`);
  let result;
  try {
    result = await requestRerun(run.id);
  } catch (err) {
    console.warn(`⚠️  재실행 요청 실패(재시도): ${err.message}`); // 네트워크 오류 — 카운트하지 않음
    await sleep(POLL_MS);
    continue;
  }
  if (result === 'accepted') {
    rerunsIssued += 1;
    handledAttempt = run.run_attempt;
  } else if (result === 'already-running') {
    handledAttempt = run.run_attempt;
  } else {
    // 권한/정책 거부 — 재시도 무의미. 원인을 그대로 알린다.
    await notifyAndFail(`재실행 요청 거부 HTTP ${result} — 워크플로우 actions:write 권한 확인 필요`);
  }
  await sleep(POLL_MS);
}

await notifyAndFail(`제한 시간(${DEADLINE_MS / 60_000}분) 내 성공 확인 불가 — 재실행이 진행 중일 수 있으니 Actions 탭 확인`);
