class CircuitBreaker {
  constructor(failureThreshold = 5, cooldownMs = 10000) {
    this.failureThreshold = failureThreshold;
    this.cooldownMs = cooldownMs;
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF-OPEN
    this.failureCount = 0;
    this.nextAttempt = Date.now();
  }

  async execute(requestFn, fallbackFn) {
    if (this.state === 'OPEN') {
      if (Date.now() > this.nextAttempt) {
        this.state = 'HALF-OPEN';
      } else {
        return fallbackFn('Circuit breaker OPEN: Downstream service is currently isolated.');
      }
    }

    try {
      const response = await requestFn();
      if (this.state === 'HALF-OPEN') {
        this.state = 'CLOSED';
        this.failureCount = 0;
      }
      return response;
    } catch (err) {
      this.failureCount++;
      if (this.failureCount >= this.failureThreshold) {
        this.state = 'OPEN';
        this.nextAttempt = Date.now() + this.cooldownMs;
        console.error(` [CIRCUIT BREAKER TRIP] Downstream service isolated for ${this.cooldownMs / 1000}s`);
      }
      return fallbackFn('Downstream service failed or timed out.');
    }
  }
}

module.exports = CircuitBreaker;