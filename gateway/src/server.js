const Fastify = require('fastify');
const fastifyHttpProxy = require('@fastify/http-proxy');
const Redis = require('ioredis');
const SlidingWindowLimiter = require('./limiter/rate-limiter');
const SignatureEngine = require('./sanitizer/signature-engine');
const AuditProducer = require('./pipeline/audit-producer');

const app = Fastify({ logger: true });

const PORT = 8000;
const UPSTREAM_URL = 'http://localhost:5000';
const REDIS_CONFIG = { host: '127.0.0.1', port: 6379 };

const redis = new Redis(REDIS_CONFIG);
const rateLimiter = new SlidingWindowLimiter(redis, 10000, 5);
const signatureEngine = new SignatureEngine();
const auditProducer = new AuditProducer(REDIS_CONFIG);

// Pre-handler hook for Rate-Limiting & Payload Sanitization
app.addHook('preHandler', async (req, reply) => {
  let clientIp = req.headers['x-forwarded-for'] || req.ip || req.raw.socket.remoteAddress || '127.0.0.1';
  if (clientIp === '::1' || clientIp === '::ffff:127.0.0.1') {
    clientIp = '127.0.0.1';
  }

  req.clientIp = clientIp; // Attach to request object

  // 1. Rate Limiting Check
  const { allowed, remaining, limit } = await rateLimiter.isAllowed(clientIp);
  reply.header('X-RateLimit-Limit', limit);
  reply.header('X-RateLimit-Remaining', remaining);

  if (!allowed) {
    reply.header('Retry-After', 10);
    
    // Async fire-and-forget log event for rate-limited traffic
    auditProducer.logEvent({
      clientIp,
      method: req.method,
      url: req.url,
      statusCode: 429,
      action: 'BLOCKED_RATE_LIMIT'
    });

    reply.code(429).send({
      error: 'Too Many Requests',
      message: 'Rate limit exceeded.',
      statusCode: 429
    });
    return reply;
  }

  // 2. Payload Inspection Check
  const payloadToInspect = { query: req.query || {}, body: req.body || {} };
  const { threatDetected, threatType, matchedValue } = signatureEngine.inspect(payloadToInspect);

  if (threatDetected) {
    auditProducer.logEvent({
      clientIp,
      method: req.method,
      url: req.url,
      statusCode: 403,
      action: 'BLOCKED_THREAT',
      threatDetails: { threatType, matchedValue }
    });

    reply.code(403).send({
      error: 'Forbidden',
      message: `Security threat detected: ${threatType}`,
      statusCode: 403
    });
    return reply;
  }
});

// Hook runs asynchronously AFTER response is sent to client
app.addHook('onResponse', async (req, reply) => {
  if (reply.statusCode < 400) {
    auditProducer.logEvent({
      clientIp: req.clientIp || '127.0.0.1',
      method: req.method,
      url: req.url,
      statusCode: reply.statusCode,
      action: 'PASSED'
    });
  }
});

app.register(fastifyHttpProxy, {
  upstream: UPSTREAM_URL,
  prefix: '/',
  replyOptions: {
    rewriteRequestHeaders: (originalReq, headers) => {
      return { ...headers, 'x-forwarded-by': 'ZeroGuard-Gateway' };
    }
  }
});

const start = async () => {
  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`[ZeroGuard Gateway] Running on http://localhost:${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();