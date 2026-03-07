'use strict';

const { computeSHA256 } = require('./hash');

/**
 * Re-compute and verify an ordered array of AuditLog records to confirm
 * the integrity of the hash chain.
 *
 * @param {object[]} records – AuditLog records ordered by timestamp ASC
 * @returns {{ objectType: string, valid: boolean, totalLinks: number, brokenAt: number|null, message: string }}
 */
function verifyChainIntegrity(records) {
    if (!records || records.length === 0) {
        return {
            objectType: '',
            valid: true,
            totalLinks: 0,
            brokenAt: null,
            message: 'No records to verify.'
        };
    }

    const objectType = records[0].objectType;
    let previousHash = '0'.repeat(64); // genesis previous hash

    for (let i = 0; i < records.length; i++) {
        const rec = records[i];

        // Validate stored previousHash matches expected chain value
        if (rec.previousHash !== previousHash) {
            return {
                objectType,
                valid: false,
                totalLinks: records.length,
                brokenAt: i + 1,
                message: `Chain broken at sequence ${i + 1}: expected previousHash ${previousHash}, found ${rec.previousHash}`
            };
        }

        // Re-compute the hash from canonical payload + previousHash
        const canonical = _canonicalize(rec);
        const expectedHash = computeSHA256(canonical + previousHash);

        if (rec.currentHash !== expectedHash) {
            return {
                objectType,
                valid: false,
                totalLinks: records.length,
                brokenAt: i + 1,
                message: `Chain broken at sequence ${i + 1}: currentHash mismatch (expected ${expectedHash}, found ${rec.currentHash})`
            };
        }

        previousHash = rec.currentHash;
    }

    return {
        objectType,
        valid: true,
        totalLinks: records.length,
        brokenAt: null,
        message: `All ${records.length} records verified successfully.`
    };
}

/**
 * Build the same canonical string used during ingestion.
 * Must stay in sync with HashChainEngine._canonicalize().
 */
function _canonicalize(record) {
    const relevant = {
        objectType: record.objectType,
        objectKey: record.objectKey,
        userId: record.userId,
        changeType: record.changeType,
        timestamp: record.timestamp,
        fields: [] // fields are not stored on the header; chain is header-only
    };
    return JSON.stringify(relevant, Object.keys(relevant).sort());
}

module.exports = { verifyChainIntegrity };
