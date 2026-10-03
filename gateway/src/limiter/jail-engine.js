class JailEngine {
  constructor(redisClient, threshold = 3, banDurationSec = 900) {
    this.redis = redisClient;
    this.threshold = threshold; // Max violations before ban
    this.banDurationSec = banDurationSec; // Ban time (15 mins)
  }

  async recordViolation(clientIp) {
    const violationKey = `violations:${clientIp}`;
    const jailKey = `jailed:${clientIp}`;

    const count = await this.redis.incr(violationKey);
    if (count === 1) {
      await this.redis.expire(violationKey, 60); // Reset violation count after 60s
    }

    if (count >= this.threshold) {
      await this.redis.set(jailKey, 'BANNED', 'EX', this.banDurationSec);
      console.warn(` [AUTO-JAIL] Client IP ${clientIp} jailed for ${this.banDurationSec}s due to repeated violations!`);
    }
  }

  async isJailed(clientIp) {
    const jailKey = `jailed:${clientIp}`;
    const status = await this.redis.get(jailKey);
    return status === 'BANNED';
  }
}

module.exports = JailEngine;