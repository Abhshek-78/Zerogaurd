const mongoose = require('mongoose');
const crypto = require('crypto');

const AuditSchema = new mongoose.Schema({
  sequenceId: { type: Number, required: true, unique: true, index: true },
  timestamp: { type: String, required: true },
  clientIp: { type: String, required: true },
  method: { type: String, required: true },
  url: { type: String, required: true },
  statusCode: { type: Number, required: true },
  action: { type: String, required: true },
  threatDetails: { type: Object, default: null },
  previousHash: { type: String, required: true },
  currentHash: { type: String, required: true }
});

const GENESIS_HASH = '0'.repeat(64);

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = canonicalize(value[key]);
      return result;
    }, {});
  }
  return value;
}

/**
 * Computes a deterministic SHA-256 hash for an audit log record
 */
AuditSchema.statics.calculateHash = function (data, previousHash) {
  const payloadString = JSON.stringify(canonicalize({
    sequenceId: data.sequenceId,
    timestamp: data.timestamp,
    clientIp: data.clientIp,
    method: data.method,
    url: data.url,
    statusCode: data.statusCode,
    action: data.action,
    threatDetails: data.threatDetails ?? null,
    previousHash
  }));
  return crypto.createHash('sha256').update(payloadString).digest('hex');
};

/**
 * Appends a new event entry into the immutable ledger chain
 */
AuditSchema.statics.appendEntry = async function (eventData) {
  // Find the latest entry in the ledger chain
  const lastEntry = await this.findOne().sort({ sequenceId: -1 }).exec();

  const sequenceId = lastEntry ? lastEntry.sequenceId + 1 : 1;
  const previousHash = lastEntry ? lastEntry.currentHash : GENESIS_HASH;

  const recordPayload = {
    sequenceId,
    timestamp: eventData.timestamp || new Date().toISOString(),
    clientIp: eventData.clientIp,
    method: eventData.method,
    url: eventData.url,
    statusCode: eventData.statusCode,
    action: eventData.action,
    threatDetails: eventData.threatDetails || null
  };

  const currentHash = this.calculateHash(recordPayload, previousHash);

  const newRecord = new this({
    ...recordPayload,
    previousHash,
    currentHash
  });

  return await newRecord.save();
};

/**
 * Audit verification tool: Scans entire database chain to verify cryptographic integrity
 */
AuditSchema.statics.verifyChainIntegrity = async function () {
  const records = await this.find().sort({ sequenceId: 1 }).exec();
  
  if (records.length === 0) {
    return { valid: true, totalRecords: 0, corruptedSequenceId: null };
  }

  let expectedPreviousHash = GENESIS_HASH;

  for (const [index, record] of records.entries()) {
    if (record.sequenceId !== index + 1) {
      return {
        valid: false,
        reason: 'INVALID_SEQUENCE',
        corruptedSequenceId: record.sequenceId
      };
    }

    // 1. Verify previous hash pointer matches expected link
    if (record.previousHash !== expectedPreviousHash) {
      return {
        valid: false,
        reason: 'BROKEN_HASH_LINK',
        corruptedSequenceId: record.sequenceId
      };
    }

    // 2. Re-calculate SHA-256 hash of record payload
    const recalculatedHash = this.calculateHash(record.toObject(), record.previousHash);
    if (recalculatedHash !== record.currentHash) {
      return {
        valid: false,
        reason: 'TAMPERED_PAYLOAD',
        corruptedSequenceId: record.sequenceId
      };
    }

    expectedPreviousHash = record.currentHash;
  }

  return { valid: true, totalRecords: records.length, corruptedSequenceId: null };
};

module.exports = mongoose.model('AuditLedger', AuditSchema);