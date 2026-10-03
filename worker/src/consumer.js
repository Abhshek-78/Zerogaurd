require('dotenv').config();
const http = require('http'); // 1. Import http
const { Worker } = require('bullmq');
const mongoose = require('mongoose');
const AuditLedger = require('./ledger/AuditLedger');

function buildRedisConnection() {
  if (process.env.REDIS_URL) {
    let redisUrl = process.env.REDIS_URL.trim();
    if (redisUrl.startsWith('rediss://')) {
      return {
        url: redisUrl,
        tls: {},
        maxRetriesPerRequest: null
      };
    }
    return { url: redisUrl, maxRetriesPerRequest: null };
  }

  let host = (process.env.REDIS_HOST || '127.0.0.1')
    .replace(/^rediss?:\/\//, '')
    .split('@')
    .pop()
    .split(':')[0];

  const config = {
    host,
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null
  };

  if (process.env.REDIS_TLS === 'true' || host.includes('upstash.io')) {
    config.tls = {};
  }

  return config;
}

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/zeroguard_db';

async function main() {
  console.log('[ZeroGuard Worker] Initializing worker service...');

  const PORT = Number(process.env.PORT) || 10000;
  const healthServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'healthy', service: 'zeroguard-worker' }));
  });
  await new Promise((resolve, reject) => {
    healthServer.once('error', reject);
    healthServer.listen(PORT, resolve);
  });
  console.log(`[ZeroGuard Worker] Health check endpoint listening on port ${PORT}`);

  try {
    await mongoose.connect(MONGO_URI);
    console.log('[ZeroGuard Worker] Successfully connected to MongoDB cloud ledger.');
  } catch (err) {
    console.error('[ZeroGuard Worker] MongoDB Connection Error:', err);
    process.exit(1);
  }

  const connectionConfig = buildRedisConnection();

  const auditWorker = new Worker(
    'audit-events',
    async (job) => {
      const eventData = job.data;
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