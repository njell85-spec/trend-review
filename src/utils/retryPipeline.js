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
