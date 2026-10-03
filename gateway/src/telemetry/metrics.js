const client = require('prom-client');

// Create a Registry to register the metrics
const register = new client.Registry();

// Add default metrics (CPU, Memory, Event Loop Lag)
client.collectDefaultMetrics({ register });

// 1. Counter: Total requests processed by action/status
const httpRequestCounter = new client.Counter({
  name: 'zeroguard_http_requests_total',
  help: 'Total number of HTTP requests processed by ZeroGuard Gateway',
  labelNames: ['method', 'status_code', 'action']
});

// 2. Histogram: Request Latency Overhead
const httpRequestDurationMs = new client.Histogram({
  name: 'zeroguard_http_request_duration_ms',
  help: 'HTTP request latency overhead in milliseconds',
  labelNames: ['method', 'action'],
  buckets: [1, 2, 5, 10, 25, 50, 100, 250, 500] // p50, p95, p99 distribution buckets
});

// 3. Gauge: Active Rate-Limited IPs
const blockedIpsGauge = new client.Gauge({
  name: 'zeroguard_blocked_ips_active',
  help: 'Number of active client IPs currently experiencing rate limiting'
});

register.registerMetric(httpRequestCounter);
register.registerMetric(httpRequestDurationMs);
register.registerMetric(blockedIpsGauge);

module.exports = {
  register,
  httpRequestCounter,
  httpRequestDurationMs,
  blockedIpsGauge
};