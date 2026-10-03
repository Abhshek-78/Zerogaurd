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

const {
  register,
  httpRequestCounter,
  httpRequestDurationMs
} = require('./telemetry/metrics');

const app = Fastify({
  logger: true,
});

// ======================================================
// Environment Configuration
// ======================================================

const PORT = Number(process.env.PORT) || 8000;

const UPSTREAM_URL =
  process.env.UPSTREAM_URL || 'http://localhost:5000';

const REDIS_CONFIG = {
  host: process.env.REDIS_HOST || '127.0.0.1',

  port: Number(process.env.REDIS_PORT) || 6379,

  password: process.env.REDIS_PASSWORD || undefined,

  tls:
    process.env.REDIS_TLS === 'true'
      ? {}
      : undefined,
};

// ======================================================
// Start Server
// ======================================================

const start = async () => {
  try {
    // ==================================================
    // CORS
    // ==================================================

    await app.register(fastifyCors, {
      origin: process.env.CORS_ORIGIN || '*',

      methods: [
        'GET',
        'POST',
        'PUT',
        'PATCH',
        'DELETE',
        'OPTIONS',
        'HEAD',
      ],

      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Requested-With',
      ],
    });

    // ==================================================
    // Redis
    // ==================================================

    const redis = new Redis(REDIS_CONFIG);

    redis.on('connect', () => {
      app.log.info('Redis connected');
    });

    redis.on('error', (err) => {
      app.log.error(
        {
          err,
        },
        'Redis connection error'
      );
    });

    // ==================================================
    // Security Components
    // ==================================================

    const rateLimiter = new SlidingWindowLimiter(
      redis,
      10000,
      10
    );

    const signatureEngine = new SignatureEngine();

    const auditProducer = new AuditProducer(
      REDIS_CONFIG
    );

    const jailEngine = new JailEngine(
      redis,
      5,
      300
    );

    // Keep this available for future resilience logic.
    const circuitBreaker = new CircuitBreaker(
      3,
      10000
    );

    // Prevent unused-variable warnings if linting is enabled.
    void circuitBreaker;

    // ==================================================
    // Prometheus Metrics Endpoint
    // ==================================================

    app.get('/metrics', async (req, reply) => {
      reply.header(
        'Content-Type',
        register.contentType
      );

      return await register.metrics();
    });

    // ==================================================
    // Security Pre-Handler
    // ==================================================

    app.addHook(
      'preHandler',
      async (req, reply) => {
        const url =
          req.raw.url || req.url;

        // Do not apply security processing to
        // Prometheus metrics.
        if (url.startsWith('/metrics')) {
          return;
        }

        // ----------------------------------------------
        // Request Start Time
        // ----------------------------------------------

        req.startTime = process.hrtime();

        // ----------------------------------------------
        // Client IP
        // ----------------------------------------------

        let clientIp =
          req.headers['x-forwarded-for'] ||
          req.ip ||
          req.raw.socket?.remoteAddress ||
          '127.0.0.1';

        if (clientIp.includes(',')) {
          clientIp = clientIp
            .split(',')[0]
            .trim();
        }

        req.clientIp = clientIp;

        // ----------------------------------------------
        // 1. IP Jail / Blacklist Check
        // ----------------------------------------------

        const isBanned =
          await jailEngine.isJailed(clientIp);

        if (isBanned) {
          reply.code(403);

          return reply.send({
            error: 'Forbidden',

            message:
              'Your IP is temporarily jailed.',

            statusCode: 403,
          });
        }

        // ----------------------------------------------
        // 2. Rate Limiting
        // ----------------------------------------------

        const {
          allowed,
          remaining,
          limit,
        } = await rateLimiter.isAllowed(
          clientIp
        );

        reply.header(
          'X-RateLimit-Limit',
          limit
        );

        reply.header(
          'X-RateLimit-Remaining',
          remaining
        );

        if (!allowed) {
          await jailEngine.recordViolation(
            clientIp
          );

          reply.header(
            'Retry-After',
            10
          );

          httpRequestCounter.inc({
            method: req.method,

            status_code: 429,

            action: 'BLOCKED_RATE_LIMIT',
          });

          auditProducer.logEvent({
            clientIp,

            method: req.method,

            url: req.url,

            statusCode: 429,

            action: 'BLOCKED_RATE_LIMIT',
          });

          reply.code(429);

          return reply.send({
            error: 'Too Many Requests',

            message:
              'Rate limit exceeded.',

            statusCode: 429,
          });
        }

        // ----------------------------------------------
        // 3. Security Signature Inspection
        // ----------------------------------------------

        const payloadToInspect = {
          query: req.query || {},

          body: req.body || {},
        };

        const {
          threatDetected,
          threatType,
          matchedValue,
        } = signatureEngine.inspect(
          payloadToInspect
        );

        if (threatDetected) {
          await jailEngine.recordViolation(
            clientIp
          );

          httpRequestCounter.inc({
            method: req.method,

            status_code: 403,

            action: 'BLOCKED_THREAT',
          });

          auditProducer.logEvent({
            clientIp,

            method: req.method,

            url: req.url,

            statusCode: 403,

            action: 'BLOCKED_THREAT',

            threatDetails: {
              threatType,

              matchedValue,
            },
          });

          reply.code(403);

          return reply.send({
            error: 'Forbidden',

            message:
              `Security threat detected: ${threatType}`,

            statusCode: 403,
          });
        }
      }
    );

    // ==================================================
    // Response Metrics / Audit
    // ==================================================

    app.addHook(
      'onResponse',
      async (req, reply) => {
        const url =
          req.raw.url || req.url;

        if (url.startsWith('/metrics')) {
          return;
        }

        if (!req.startTime) {
          return;
        }

        const diff = process.hrtime(
          req.startTime
        );

        const durationInMs =
          diff[0] * 1e3 +
          diff[1] * 1e-6;

        const action =
          reply.statusCode < 400
            ? 'PASSED'
            : 'BLOCKED';

        // ----------------------------------------------
        // Response Duration
        // ----------------------------------------------

        httpRequestDurationMs.observe(
          {
            method: req.method,

            action,
          },

          durationInMs
        );

        // ----------------------------------------------
        // Successful Request
        // ----------------------------------------------

        if (reply.statusCode < 400) {
          httpRequestCounter.inc({
            method: req.method,

            status_code:
              reply.statusCode,

            action: 'PASSED',
          });

          auditProducer.logEvent({
            clientIp:
              req.clientIp ||
              '127.0.0.1',

            method: req.method,

            url: req.url,

            statusCode:
              reply.statusCode,

            action: 'PASSED',
          });
        }
      }
    );

    // ==================================================
    // UPSTREAM API PROXY
    // ==================================================
    //
    // IMPORTANT:
    //
    // Do NOT use:
    //
    // prefix: '/'
    //
    // because that creates a root wildcard proxy route
    // and can cause:
    //
    // FST_ERR_DUPLICATED_ROUTE
    //
    // Use /api instead.
    // ==================================================

    await app.register(
      fastifyHttpProxy,
      {
        upstream: UPSTREAM_URL,

        prefix: '/api',

        undici: true,

        replyOptions: {
          rewriteRequestHeaders: (
            originalReq,
            headers
          ) => {
            return {
              ...headers,

              'x-forwarded-by':
                'ZeroGuard-Gateway',

              'x-forwarded-for':
                originalReq.headers[
                  'x-forwarded-for'
                ] ||
                originalReq.socket
                  ?.remoteAddress ||
                '',

              'x-forwarded-proto':
                originalReq.headers[
                  'x-forwarded-proto'
                ] ||
                'http',
            };
          },
        },
      }
    );

    // ==================================================
    // Start Server
    // ==================================================

    await app.listen({
      port: PORT,

      host: '0.0.0.0',
    });

    app.log.info(
      `[ZeroGuard Gateway] Running on port ${PORT}`
    );

    app.log.info(
      `[ZeroGuard Gateway] Upstream: ${UPSTREAM_URL}`
    );

    app.log.info(
      `[ZeroGuard Gateway] API Proxy: /api`
    );

  } catch (err) {
    app.log.error(
      {
        err,
      },
      'Failed to start ZeroGuard Gateway'
    );

    process.exit(1);
  }
};

// ======================================================
// Start Application
// ======================================================

start();