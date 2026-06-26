/**
 * Circuit Breaker — prevents cascading failures in agent-to-service calls.
 * States: CLOSED (normal) → OPEN (failing) → HALF_OPEN (recovery probe)
 */
export class CircuitBreaker {
  static STATES = { CLOSED: 'CLOSED', OPEN: 'OPEN', HALF_OPEN: 'HALF_OPEN' };

  constructor(name, options = {}) {
    this.name = name;
    this.state = CircuitBreaker.STATES.CLOSED;
    this.failureThreshold = options.failureThreshold ?? Number(process.env.CB_FAILURE_THRESHOLD ?? 5);
    this.recoveryTimeoutMs = options.recoveryTimeoutMs ?? Number(process.env.CB_RECOVERY_TIMEOUT_MS ?? 60_000);
    this.successThreshold = options.successThreshold ?? 2;

    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.stats = { calls: 0, successes: 0, failures: 0, rejected: 0 };
  }

  get isOpen() { return this.state === CircuitBreaker.STATES.OPEN; }
  get isClosed() { return this.state === CircuitBreaker.STATES.CLOSED; }
  get isHalfOpen() { return this.state === CircuitBreaker.STATES.HALF_OPEN; }

  async execute(fn) {
    this.stats.calls++;
    this._checkRecovery();

    if (this.isOpen) {
      this.stats.rejected++;
      throw new CircuitOpenError(`Circuit [${this.name}] is OPEN — service unavailable`);
    }

    try {
      const result = await fn();
      this._onSuccess();
      return result;
    } catch (err) {
      this._onFailure();
      throw err;
    }
  }

  _checkRecovery() {
    if (
      this.isOpen &&
      this.lastFailureTime &&
      Date.now() - this.lastFailureTime >= this.recoveryTimeoutMs
    ) {
      this.state = CircuitBreaker.STATES.HALF_OPEN;
      this.successCount = 0;
    }
  }

  _onSuccess() {
    this.stats.successes++;
    this.failureCount = 0;

    if (this.isHalfOpen) {
      this.successCount++;
      if (this.successCount >= this.successThreshold) {
        this.state = CircuitBreaker.STATES.CLOSED;
        this.successCount = 0;
      }
    }
  }

  _onFailure() {
    this.stats.failures++;
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (
      this.isClosed && this.failureCount >= this.failureThreshold ||
      this.isHalfOpen
    ) {
      this.state = CircuitBreaker.STATES.OPEN;
    }
  }

  reset() {
    this.state = CircuitBreaker.STATES.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
  }

  getStatus() {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      stats: { ...this.stats },
    };
  }
}

export class CircuitOpenError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CircuitOpenError';
  }
}
