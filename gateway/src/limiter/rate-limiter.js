const fs = require('fs');
const path = require('path');

class SlidingWindowLimiter {
  constructor(redisClient, windowMs = 10000, maxRequests = 5) {
    this.redis = redisClient;
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;

    const luaPath = path.join(__dirname, 'sliding-window.lua');
    if (!fs.existsSync(luaPath)) {
      console.error('[CRITICAL] sliding-window.lua not found at:', luaPath);
    }
    
    this.luaScript = fs.readFileSync(luaPath, 'utf8');
  }

  async isAllowed(clientId) {
    // Hardcode fallback key namespace for consistency
    const key = `ratelimit:${clientId}`;
    const now = Date.now();
    const requestId = `${now}-${Math.random().toString(36).substring(2, 7)}`;

    try {
      const result = await this.redis.eval(
        this.luaScript,
        1,
        key,
        now,
        this.windowMs,
        this.maxRequests,
        requestId
      );

      const allowedFlag = Number(result[0]);
      const remainingQuota = Number(result[1]);

      return {
        allowed: allowedFlag === 1,
        remaining: remainingQuota,
        limit: this.maxRequests
      };
    } catch (err) {
      console.error('[RateLimiter Error] Redis Lua evaluation error:', err);
      // Fallback open only on catastrophic Redis error
      return { allowed: true, remaining: 1, limit: this.maxRequests };
    }
  }
}

module.exports = SlidingWindowLimiter;