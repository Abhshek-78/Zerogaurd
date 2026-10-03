require('dotenv').config();
const { Worker } = require('bullmq');
const mongoose = require('mongoose');
const AuditLedger = require('./ledger/AuditLedger');

const REDIS_CONFIG = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
  tls: process.env.REDIS_TLS === 'true' ? {} : undefined
};

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/zeroguard_db';

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log('[ZeroGuard Worker] Connected to MongoDB cloud ledger.');

  const auditWorker = new Worker(
    'audit-events',
    async (job) => {
      const eventData = job.data;
      const savedRecord = await AuditLedger.appendEntry(eventData);
      console.log(`[Ledger Appended] Seq #${savedRecord.sequenceId} | Hash: ${savedRecord.currentHash.substring(0, 12)}...`);
      return { status: 'persisted', sequenceId: savedRecord.sequenceId };
    },
    { connection: REDIS_CONFIG }
  );

  auditWorker.on('failed', (job, err) => {
    console.error(`[Worker Job Error] Job #${job?.id}:`, err);
  });
}

main().catch((err) => {
  console.error('[Worker Execution Error]:', err);
  process.exit(1);
});