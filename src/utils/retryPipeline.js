/**
 * retryPipeline — 데일리 파이프라인을 "재시도 가치 있는 실패"에 한해 재시도.
 *
 * claude 구독 CLI가 세션 한도(429)에 걸리면 그 시간대엔 계속 실패한다. 세션 창은
 * 약 5시간마다 리셋되므로, 일정 간격(기본 60분)으로 최대 N회(기본 3회) 재시도해
 * 리셋 창을 노린다. 반대로 워크스페이스 신뢰 미설정·CLI 미설치 같은 "결정적" 오류는
 * 기다려도 동일하게 실패하므로 즉시 중단한다.
 *
 * github-actions-daily.mjs 에서 파묻혀 있던 로직을 분리해 단독 테스트가 가능하도록 함.
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 세션 한도/429 판별 — LLMClient·classifyFailure 가 같은 기준을 공유한다 (드리프트 방지)
const SESSION_LIMIT_RE = /session limit|"?api_error_status"?\s*[:=]\s*429|(?:^|[^\d])429(?:[^\d]|$)/i;
export const isSessionRateLimit = (message) => SESSION_LIMIT_RE.test(String(message ?? ''));

// 실패 메시지로 (재시도 가치 / 사람이 읽을 사유)를 분류.
export function classifyFailure(message = '') {
  const m = String(message);
  if (isSessionRateLimit(m))
    return { retryable: true, label: 'Claude 세션 한도(429)' };
  // 인증 실패(401·API키 무효·OAuth 토큰 만료)는 기다려도 동일하게 실패하는 결정적 오류.
  // 재시도로 러너 시간(기본 60분×3회)만 낭비하지 말고 즉시 중단하고, 사람이 바로 조치할 수
  // 있게 '재발급 필요' 사유로 알린다. (2026-07-20~ 데일리 장애: 비활성화된 ANTHROPIC_API_KEY가
  // CLI로 새어들어가 401 → "일시적일 수 있음"으로 오분류되어 매일 2.5시간 헛재시도.)
  if (/api_error_status["']?\s*[:=]\s*401|\b401\b|failed to authenticate|authentication_error|invalid[\s_-]*(?:x-)?api[\s_-]*key|api key is invalid|unauthorized/i.test(m))
    return { retryable: false, label: 'claude 인증 실패 — 구독 토큰/API 키 재발급 필요' };
  if (/not been trusted|hasTrustDialogAccepted/i.test(m))
    return { retryable: false, label: 'claude CLI 워크스페이스 신뢰 미설정 (설정 확인 필요)' };
  if (/ENOENT|spawn error|command not found/i.test(m))
    return { retryable: false, label: 'claude CLI 미설치/미인증 (설정 확인 필요)' };
  return { retryable: true, label: 'claude CLI 오류(일시적일 수 있음)' };
}

/**
 * @param {() => { run: () => Promise<any> }} makePipeline  매 시도마다 새 파이프라인 생성
 * @param {object} opts
 * @param {number} opts.maxAttempts   최대 시도 횟수 (기본 3)
 * @param {number} opts.delayMs       재시도 전 대기(ms) (기본 60분)
 * @param {function} opts.sleepFn     대기 함수 (테스트 주입용)
 * @param {function} opts.onAttempt   (attempt) => void
 * @param {function} opts.onRetry     ({attempt, delayMs, label}) => void
 * @param {function} opts.onFail      ({attempt, label, retryable, message}) => void
 * @returns {Promise<{ok:true,result,attempt} | {ok:false,retryable,label,error,attempt}>}
 */
export async function runWithRetry(makePipeline, {
  maxAttempts = 3,
  delayMs = 60 * 60_000,
  sleepFn = sleep,
  onAttempt = () => {},
  onRetry = () => {},
  onFail = () => {},
} = {}) {
  maxAttempts = Math.max(1, Number(maxAttempts) || 1); // 0/NaN → undefined 반환 방지
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    onAttempt(attempt);
    try {
      const result = await makePipeline().run();
      return { ok: true, result, attempt };
    } catch (err) {
      const { retryable, label } = classifyFailure(err?.message);
      const last = attempt === maxAttempts;
      onFail({ attempt, label, retryable, message: String(err?.message ?? '') });

      // delayMs>=0 로 게이트 — delayMs===0(즉시 재시도 의도)도 재시도를 유지한다.
      // (과거 delayMs>0 조건은 delay 0 설정 시 재시도를 통째로 비활성화했다.)
      if (retryable && !last && delayMs >= 0) {
        onRetry({ attempt, delayMs, label });
        if (delayMs > 0) await sleepFn(delayMs);
        continue;
      }
      return { ok: false, retryable, label, error: err, attempt };
    }
  }
}
