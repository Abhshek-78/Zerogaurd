require('dotenv').config();
const Fastify = require('fastify');
const fastifyHttpProxy = require('@fastify/http-proxy');
const fastifyCors = require('@fastify/cors');
const Redis = require('ioredis');
const SlidingWindowLimiter = require('./limiter/rate-limiter');
const SignatureEngine = require('./sanitizer/signature-engine');
const AuditProducer = require('./pipeline/audit-producer');
const JailEngine = require('./limiter/jail-engine');
const CircuitBreaker = require('./resilience/circuit-breaker');
const { register, httpRequestCounter, httpRequestDurationMs } = require('./telemetry/metrics');

const app = Fastify({ logger: true });

// Environment configuration
const PORT = process.env.PORT || 8000;
const UPSTREAM_URL = process.env.UPSTREAM_URL || 'http://localhost:5000';
const REDIS_CONFIG = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
  tls: process.env.REDIS_TLS === 'true' ? {} : undefined // Required for SSL cloud connections
};

const start = async () => {
  try {
    // Enable CORS to allow the frontend dashboard domain
    await app.register(fastifyCors, {
      origin: process.env.CORS_ORIGIN || '*',
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
    });

    const redis = new Redis(REDIS_CONFIG);
    const rateLimiter = new SlidingWindowLimiter(redis, 10000, 10);
    const signatureEngine = new SignatureEngine();
    const auditProducer = new AuditProducer(REDIS_CONFIG);
    const jailEngine = new JailEngine(redis, 5, 300);
    const circuitBreaker = new CircuitBreaker(3, 10000);

    // Expose Prometheus endpoint
    app.get('/metrics', async (req, reply) => {
      reply.header('Content-Type', register.contentType);
      return await register.metrics();
    });

    // Security pre-handler hook
    app.addHook('preHandler', async (req, reply) => {
      const url = req.raw.url || req.url;
      if (url.startsWith('/metrics')) return;

      req.startTime = process.hrtime();

      let clientIp = req.headers['x-forwarded-for'] || req.ip || req.raw.socket.remoteAddress || '127.0.0.1';
      if (clientIp.includes(',')) clientIp = clientIp.split(',')[0].trim();
      req.clientIp = clientIp;

      // 1. IP Blacklist check
      const isBanned = await jailEngine.isJailed(clientIp);
      if (isBanned) {
        reply.code(403).send({ error: 'Forbidden', message: 'Your IP is temporarily jailed.', statusCode: 403 });
        return reply;
      }

      // 2. Rate limit check
      const { allowed, remaining, limit } = await rateLimiter.isAllowed(clientIp);
      reply.header('X-RateLimit-Limit', limit);
      reply.header('X-RateLimit-Remaining', remaining);

      if (!allowed) {
        await jailEngine.recordViolation(clientIp);
        reply.header('Retry-After', 10);
        httpRequestCounter.inc({ method: req.method, status_code: 429, action: 'BLOCKED_RATE_LIMIT' });
        auditProducer.logEvent({ clientIp, method: req.method, url: req.url, statusCode: 429, action: 'BLOCKED_RATE_LIMIT' });
        reply.code(429).send({ error: 'Too Many Requests', message: 'Rate limit exceeded.', statusCode: 429 });
        return reply;
      }

      // 3. Security signature check
      const payloadToInspect = { query: req.query || {}, body: req.body || {} };
      const { threatDetected, threatType, matchedValue } = signatureEngine.inspect(payloadToInspect);

      if (threatDetected) {
        await jailEngine.recordViolation(clientIp);
        httpRequestCounter.inc({ method: req.method, status_code: 403, action: 'BLOCKED_THREAT' });
        auditProducer.logEvent({ clientIp, method: req.method, url: req.url, statusCode: 403, action: 'BLOCKED_THREAT', threatDetails: { threatType, matchedValue } });
        reply.code(403).send({ error: 'Forbidden', message: `Security threat detected: ${threatType}`, statusCode: 403 });
        return reply;
      }
    });

    // Metrics tracking hook
    app.addHook('onResponse', async (req, reply) => {
      const url = req.raw.url || req.url;
      if (url.startsWith('/metrics')) return;

      if (req.startTime) {
        const diff = process.hrtime(req.startTime);
        const durationInMs = (diff[0] * 1e3) + (diff[1] * 1e-6);
        const action = reply.statusCode < 400 ? 'PASSED' : 'BLOCKED';
        httpRequestDurationMs.observe({ method: req.method, action }, durationInMs);

        if (reply.statusCode < 400) {
          httpRequestCounter.inc({ method: req.method, status_code: reply.statusCode, action: 'PASSED' });
          auditProducer.logEvent({ clientIp: req.clientIp || '127.0.0.1', method: req.method, url: req.url, statusCode: reply.statusCode, action: 'PASSED' });
        }
      }
    });

    // Upstream proxy registration
    await app.register(fastifyHttpProxy, {
      upstream: UPSTREAM_URL,
      prefix: '/',
      undici: true,
      replyOptions: {
        rewriteRequestHeaders: (originalReq, headers) => ({
          ...headers,
          'x-forwarded-by': 'ZeroGuard-Gateway'
        })
      }
    });

    await app.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`[ZeroGuard Gateway] Running on port ${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();