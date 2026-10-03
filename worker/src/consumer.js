require('dotenv').config();
const { Worker } = require('bullmq');
const mongoose = require('mongoose');
const AuditLedger = require('./ledger/AuditLedger');

/**
 * Configure Redis connection for BullMQ.
 * Handles full URIs (rediss://...) as well as host/port/password parameters.
 */
function buildRedisConnection() {
  // Option A: If REDIS_URL is provided (e.g., Upstash full connection string)
  if (process.env.REDIS_URL) {
    let redisUrl = process.env.REDIS_URL.trim();
    
    // Convert ioredis/rediss syntax for BullMQ parser compatibility
    if (redisUrl.startsWith('rediss://')) {
      return {
        url: redisUrl,
        tls: { rejectUnauthorized: false }
      };
    }
    return { url: redisUrl };
  }

  // Option B: If discrete host, port, password parameters are used
  // Clean host parameter in case protocol prefix was accidentally passed
  let host = (process.env.REDIS_HOST || '127.0.0.1')
    .replace(/^rediss?:\/\//, '')
    .split('@')
    .pop()
    .split(':')[0];

  const config = {
    host,
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null // Required by BullMQ
  };

  // Upstash cloud requires TLS/SSL enabled
  if (process.env.REDIS_TLS === 'true' || host.includes('upstash.io')) {
    config.tls = { rejectUnauthorized: false };
  }

  return config;
}

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/zeroguard_db';

async function main() {
  console.log('[ZeroGuard Worker] Initializing worker service...');

  // 1. Connect to MongoDB Ledger Database
  try {
    await mongoose.connect(MONGO_URI);
    console.log('[ZeroGuard Worker] Successfully connected to MongoDB cloud ledger.');
  } catch (err) {
    console.error('[ZeroGuard Worker] MongoDB Connection Error:', err);
    process.exit(1);
  }

  const connectionConfig = buildRedisConnection();

  // 2. Initialize BullMQ Worker Consumer on the 'audit-events' queue
  const auditWorker = new Worker(
    'audit-events',
    async (job) => {
      const eventData = job.data;

      // Append record to SHA-256 block-chained ledger
      const savedRecord = await AuditLedger.appendEntry(eventData);

      console.log(
        `[Ledger Appended] Seq #${savedRecord.sequenceId} | Hash: ${savedRecord.currentHash.substring(0, 12)}... | Action: ${savedRecord.action}`
      );

      return { status: 'persisted', sequenceId: savedRecord.sequenceId };
    },
    { connection: connectionConfig }
  );

  auditWorker.on('ready', () => {
    console.log('[ZeroGuard Worker] BullMQ Consumer is connected and listening for audit events.');
  });

  auditWorker.on('completed', (job) => {
    // Processed successfully
  });

  auditWorker.on('failed', (job, err) => {
    console.error(`[ZeroGuard Worker] Job #${job?.id} processing failed:`, err.message);
  });

  auditWorker.on('error', (err) => {
    console.error('[ZeroGuard Worker] BullMQ Engine Error:', err.message);
  });
}

main().catch((err) => {
  console.error('[ZeroGuard Worker] Fatal Execution Error:', err);
  process.exit(1);
});