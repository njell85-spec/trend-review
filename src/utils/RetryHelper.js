/**
 * Exponential backoff retry with jitter.
 * Respects circuit breaker state — stops retrying if circuit is open.
 */
export class RetryHelper {
  constructor(options = {}) {
    this.maxAttempts = Math.max(1, options.maxAttempts ?? Number(process.env.RETRY_MAX_ATTEMPTS ?? 3));
    this.baseDelayMs = options.baseDelayMs ?? Number(process.env.RETRY_BASE_DELAY_MS ?? 1_000);
    this.maxDelayMs = options.maxDelayMs ?? 30_000;
    this.jitter = options.jitter !== false;
    this.retryableErrors = options.retryableErrors ?? null; // null = retry all
  }

  _delay(attempt) {
    const exponential = Math.min(this.baseDelayMs * 2 ** (attempt - 1), this.maxDelayMs);
    return this.jitter
      ? exponential * (0.5 + Math.random() * 0.5)
      : exponential;
  }

  _isRetryable(err) {
    if (err.name === 'CircuitOpenError') return false;
    if (!this.retryableErrors) return true;
    // e 는 에러 클래스일 수도, 문자열 코드('ECONNRESET')·숫자 상태(429)일 수도 있다
    return this.retryableErrors.some(
      (e) => (typeof e === 'function' && err instanceof e) || err.code === e || err.status === e
    );
  }

  async execute(fn, { label = 'operation', onRetry } = {}) {
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        return await fn(attempt);
      } catch (err) {
        if (attempt === this.maxAttempts || !this._isRetryable(err)) throw err;

        const delay = this._delay(attempt);
        if (onRetry) onRetry({ attempt, label, err, delay });
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
}
