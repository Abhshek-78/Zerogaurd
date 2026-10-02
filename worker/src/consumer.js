const { Worker } = require('bullmq');
const mongoose = require('mongoose');
const AuditLedger = require('./ledger/AuditLedger');

const REDIS_CONFIG = { host: '127.0.0.1', port: 6379 };
const MONGO_URI = 'mongodb://127.0.0.1:27017/zeroguard_db';

async function main() {
  // Connect to MongoDB Docker container
  await mongoose.connect(MONGO_URI);
  console.log('[ZeroGuard Worker] Successfully connected to MongoDB ledger database.');

  // Initialize BullMQ Worker consumer
  const auditWorker = new Worker(
    'audit-events',
    async (job) => {
      const eventData = job.data;

      // Append record to SHA-256 chained ledger
      const savedRecord = await AuditLedger.appendEntry(eventData);

      console.log(`[Ledger Appended] Seq #${savedRecord.sequenceId} | Hash: ${savedRecord.currentHash.substring(0, 12)}... | Action: ${savedRecord.action}`);
      return { status: 'persisted', sequenceId: savedRecord.sequenceId };
    },
    { connection: REDIS_CONFIG }
  );

  auditWorker.on('failed', (job, err) => {
    console.error(`[Worker Job Error] Job #${job?.id}:`, err);
  });
}

main().catch((err) => {
  console.error('[Worker Initialization Error]:', err);
  process.exit(1);
});