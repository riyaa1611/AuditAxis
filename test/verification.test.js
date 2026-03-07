'use strict';

const { computeSHA256 } = require('../util/hash');
const { verifyChainIntegrity } = require('../util/verification');

/**
 * Helper – build a valid chain of N records for a given objectType.
 */
function buildValidChain(objectType, count) {
    const records = [];
    let previousHash = '0'.repeat(64);

    for (let i = 0; i < count; i++) {
        const record = {
            objectType,
            objectKey: `KEY-${i}`,
            userId: `USER-${i}`,
            changeType: 'UPDATE',
            timestamp: new Date(Date.now() + i * 1000).toISOString(),
            fields: []
        };

        const canonical = JSON.stringify({
            objectType: record.objectType,
            objectKey: record.objectKey,
            userId: record.userId,
            changeType: record.changeType,
            timestamp: record.timestamp,
            fields: []
        }, ['changeType', 'fields', 'objectKey', 'objectType', 'timestamp', 'userId']);

        const currentHash = computeSHA256(canonical + previousHash);

        records.push({
            ...record,
            previousHash,
            currentHash
        });

        previousHash = currentHash;
    }

    return records;
}

describe('util/verification – verifyChainIntegrity', () => {

    it('returns valid: true for empty array', () => {
        const result = verifyChainIntegrity([]);
        expect(result.valid).toBe(true);
        expect(result.totalLinks).toBe(0);
    });

    it('returns valid: true for null input', () => {
        const result = verifyChainIntegrity(null);
        expect(result.valid).toBe(true);
    });

    it('verifies a single-record chain', () => {
        const chain = buildValidChain('SalesOrder', 1);
        const result = verifyChainIntegrity(chain);
        expect(result.valid).toBe(true);
        expect(result.totalLinks).toBe(1);
    });

    it('verifies a multi-record chain', () => {
        const chain = buildValidChain('SalesOrder', 10);
        const result = verifyChainIntegrity(chain);
        expect(result.valid).toBe(true);
        expect(result.totalLinks).toBe(10);
    });

    it('detects tampered currentHash', () => {
        const chain = buildValidChain('SalesOrder', 5);
        // Tamper with a record in the middle
        chain[2].currentHash = 'a'.repeat(64);

        const result = verifyChainIntegrity(chain);
        expect(result.valid).toBe(false);
        expect(result.brokenAt).toBe(3);
    });

    it('detects tampered previousHash', () => {
        const chain = buildValidChain('SalesOrder', 5);
        chain[3].previousHash = 'b'.repeat(64);

        const result = verifyChainIntegrity(chain);
        expect(result.valid).toBe(false);
        expect(result.brokenAt).toBe(4);
    });

    it('detects tampered payload data', () => {
        const chain = buildValidChain('SalesOrder', 3);
        // Change a field without recomputing the hash
        chain[1].userId = 'HACKER';

        const result = verifyChainIntegrity(chain);
        expect(result.valid).toBe(false);
        expect(result.brokenAt).toBe(2);
    });

    it('returns the correct objectType', () => {
        const chain = buildValidChain('PurchaseOrder', 2);
        const result = verifyChainIntegrity(chain);
        expect(result.objectType).toBe('PurchaseOrder');
    });

    it('provides descriptive error message on failure', () => {
        const chain = buildValidChain('Material', 3);
        chain[1].currentHash = 'f'.repeat(64);

        const result = verifyChainIntegrity(chain);
        expect(result.message).toContain('Chain broken');
        expect(result.message).toContain('sequence 2');
    });
});
