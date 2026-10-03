require('dotenv').config();

const { Worker } = require('bullmq');
const mongoose = require('mongoose');

const AuditLedger = require('./ledger/AuditLedger');

// ======================================================
// Environment Validation
// ======================================================

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error(
    '[ZeroGuard Worker] ERROR: MONGO_URI environment variable is not set.'
  );

  process.exit(1);
}

// ======================================================
// Redis Configuration
// ======================================================

const REDIS_CONFIG = {
  host: process.env.REDIS_HOST || '127.0.0.1',

  port: Number(process.env.REDIS_PORT) || 6379,

  password:
    process.env.REDIS_PASSWORD || undefined,

  tls:
    process.env.REDIS_TLS === 'true'
      ? {}
      : undefined,
};

// ======================================================
// Main Worker
// ======================================================

async function main() {
  try {
    // ==================================================
    // MongoDB Connection
    // ==================================================

    console.log(
      '[ZeroGuard Worker] Connecting to MongoDB...'
    );

    await mongoose.connect(MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
    });

    console.log(
      '[ZeroGuard Worker] Connected to MongoDB cloud ledger.'
    );

    // ==================================================
    // BullMQ Audit Worker
    // ==================================================

    const auditWorker = new Worker(
      'audit-events',

      async (job) => {
        try {
          const eventData = job.data;

          console.log(
            `[Processing Audit Job] Job #${job.id}`
          );

          const savedRecord =
            await AuditLedger.appendEntry(
              eventData
            );

          console.log(
            `[Ledger Appended] Seq #${savedRecord.sequenceId} | Hash: ${savedRecord.currentHash.substring(0, 12)}...`
          );

          return {
            status: 'persisted',

            sequenceId:
              savedRecord.sequenceId,
          };
        } catch (err) {
          console.error(
            `[Audit Job Processing Error] Job #${job.id}:`,
            err
          );

          throw err;
        }
      },

      {
        connection: REDIS_CONFIG,

        // Optional BullMQ worker settings
        concurrency: 5,
      }
    );

    // ==================================================
    // Worker Events
    // ==================================================

    auditWorker.on(
      'ready',
      () => {
        console.log(
          '[ZeroGuard Worker] BullMQ worker is ready.'
        );
      }
    );

    auditWorker.on(
      'completed',
      (job) => {
        console.log(
          `[Worker Job Completed] Job #${job.id}`
        );
      }
    );

    auditWorker.on(
      'failed',
      (job, err) => {
        console.error(
          `[Worker Job Error] Job #${job?.id}:`,
          err
        );
      }
    );

    auditWorker.on(
      'error',
      (err) => {
        console.error(
          '[ZeroGuard Worker] BullMQ error:',
          err
        );
      }
    );

    // ==================================================
    // Graceful Shutdown
    // ==================================================

    const shutdown = async (signal) => {
      console.log(
        `[ZeroGuard Worker] Received ${signal}. Shutting down...`
      );

      try {
        await auditWorker.close();

        await mongoose.connection.close();

        console.log(
          '[ZeroGuard Worker] Shutdown completed.'
        );

        process.exit(0);
      } catch (err) {
        console.error(
          '[ZeroGuard Worker] Shutdown error:',
          err
        );

        process.exit(1);
      }
    };

    process.on(
      'SIGTERM',
      () => shutdown('SIGTERM')
    );

    process.on(
      'SIGINT',
      () => shutdown('SIGINT')
    );
  } catch (err) {
    console.error(
      '[ZeroGuard Worker] Startup failed:',
      err
    );

    process.exit(1);
  }
}

// ======================================================
// Start
// ======================================================

main();