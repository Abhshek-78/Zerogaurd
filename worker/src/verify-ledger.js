const mongoose = require('mongoose');
const AuditLedger = require('./ledger/AuditLedger');

const MONGO_URI = 'mongodb://127.0.0.1:27017/zeroguard_db';

async function runVerification() {
  await mongoose.connect(MONGO_URI);
  console.log('[Audit Integrity Scanner] Verifying cryptographic hash chain...');

  const result = await AuditLedger.verifyChainIntegrity();

  if (result.valid) {
    console.log(` [INTEGRITY CHECK PASSED] All ${result.totalRecords} audit entries are authentic and untampered.`);
  } else {
    console.error(` [TAMPER ALERT] Chain broken at Sequence ID: ${result.corruptedSequenceId}! Reason: ${result.reason}`);
  }

  await mongoose.disconnect();
}

runVerification();