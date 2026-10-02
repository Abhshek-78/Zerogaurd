const { Queue } = require('bullmq');

class AuditProducer {
  constructor(redisOptions) {
    // Queue name for proxy audit events
    this.auditQueue = new Queue('audit-events', {
      connection: redisOptions,
      defaultJobOptions: {
        attempts: 3, // Retry 3 times on failure
        backoff: {
          type: 'exponential',
          delay: 1000 // 1s, 2s, 4s retry backoff
        },
        removeOnComplete: true, // Keep Redis memory clean
        removeOnFail: 1000     // Keep last 1000 failed logs for inspection
      }
    });
  }

  /**
   * Pushes a request event to the BullMQ stream asynchronously
   */
  async logEvent(eventData) {
    try {
      await this.auditQueue.add('log-request', {
        ...eventData,
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      console.error('[AuditProducer Error] Failed to push event to queue:', err);
    }
  }
}

module.exports = AuditProducer;