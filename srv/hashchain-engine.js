'use strict';

const cds = require('@sap/cds');
const { randomUUID } = require('crypto');
const { computeSHA256 } = require('../util/hash');
const { verifyChainIntegrity } = require('../util/verification');
const { metrics } = require('../util/telemetry');

const LOG_COMPONENT = 'auditaxis.hashchain';
const SEGMENT_SIZE = 1000;

/**
 * HashChainEngine – maintains an append-only SHA-256 hash chain
 * per object type so that any retroactive tampering with audit records
 * can be detected.
 *
 * Chain formula:
 *   currentHash = SHA256( canonicalPayload + previousHash )
 */
class HashChainEngine {

    /**
     * Compute the next link in the hash chain for the given object type.
     *
     * @param {string} objectType  – the business object type (e.g. "SalesOrder")
     * @param {object} payload     – the audit event data to hash
     * @returns {{ previousHash: string, currentHash: string }}
     */
    async computeLink(objectType, payload) {
        const db = cds.db;
        const { HashChain } = cds.entities('auditaxis.db');
        const LOG = cds.log(LOG_COMPONENT);

        // Fetch the current head of the chain (SELECT FOR UPDATE semantics in HANA)
        let chain = await db.run(
            SELECT.one.from(HashChain).where({ objectType })
        );

        const previousHash = chain ? chain.lastHash : '0'.repeat(64);

        // Build canonical string to hash
        const canonical = this._canonicalize(payload);
        const currentHash = computeSHA256(canonical + previousHash);

        const newSequence = chain ? chain.sequence + 1 : 1;

        if (chain) {
            // Advance the chain
            await db.run(
                UPDATE(HashChain)
                    .set({ lastHash: currentHash, sequence: newSequence })
                    .where({ chainId: chain.chainId })
            );
        } else {
            // First entry – initialise chain
            await db.run(
                INSERT.into(HashChain).entries({
                    chainId: randomUUID(),
                    objectType,
                    lastHash: currentHash,
                    sequence: 1
                })
            );
        }

        // Create hash segment checkpoint every SEGMENT_SIZE records
        if (newSequence % SEGMENT_SIZE === 0) {
            await this._createSegment(objectType, newSequence, currentHash);
        }

        LOG.info(`Chain [${objectType}] updated -> seq ${newSequence}`);
        return { previousHash, currentHash };
    }

    /**
     * Verify the hash chain for a given object type.
     * Uses segment-based optimisation: first validates segment boundary hashes,
     * then only performs full traversal if segments pass.
     */
    async verifyChain(objectType) {
        const db = cds.db;
        const { AuditLog, HashSegment } = cds.entities('auditaxis.db');

        // Attempt segment-based verification first
        const segments = await db.run(
            SELECT.from(HashSegment)
                .where({ objectType })
                .orderBy('endSequence asc')
        );

        if (segments.length > 0) {
            // Verify segments are contiguous and boundary hashes match
            for (let i = 1; i < segments.length; i++) {
                if (segments[i].startHash !== segments[i - 1].endHash) {
                    metrics.chainVerificationFailures.inc({ objectType });
                    return { valid: false, error: `Segment gap at sequence ${segments[i].endSequence}`, brokenAtSequence: segments[i].endSequence };
                }
            }
        }

        // Full traversal verification
        const records = await db.run(
            SELECT.from(AuditLog)
                .where({ objectType })
                .orderBy('timestamp asc')
        );

        const result = verifyChainIntegrity(records);
        if (!result.valid) {
            metrics.chainVerificationFailures.inc({ objectType });
        }
        return result;
    }

    /**
     * Create a segment checkpoint for optimised future verification.
     */
    async _createSegment(objectType, endSequence, endHash) {
        const db = cds.db;
        const { HashSegment } = cds.entities('auditaxis.db');

        const startSequence = endSequence - SEGMENT_SIZE + 1;

        // Get hash at start of this segment
        const { AuditLog } = cds.entities('auditaxis.db');
        const startRecord = await db.run(
            SELECT.one.from(AuditLog)
                .where({ objectType })
                .orderBy('timestamp asc')
                .limit(1, startSequence - 1)
        );

        await db.run(
            INSERT.into(HashSegment).entries({
                segmentId: randomUUID(),
                objectType,
                startSequence,
                endSequence,
                startHash: startRecord?.previousHash || '0'.repeat(64),
                endHash,
                recordCount: SEGMENT_SIZE
            })
        );
    }

    /**
     * Build a deterministic canonical string representation of the event
     * for hashing. Keys are sorted alphabetically.
     */
    _canonicalize(payload) {
        const relevant = {
            objectType: payload.objectType,
            objectKey: payload.objectKey,
            userId: payload.userId,
            changeType: payload.changeType,
            timestamp: payload.timestamp,
            fields: (payload.fields || []).map(f => ({
                fieldName: f.fieldName,
                oldValue: f.oldValue || '',
                newValue: f.newValue || ''
            }))
        };
        return JSON.stringify(relevant, Object.keys(relevant).sort());
    }
}

module.exports = HashChainEngine;
