'use strict';

const cds = require('@sap/cds');
const { randomUUID } = require('crypto');
const { metrics } = require('./telemetry');

const LOG_COMPONENT = 'auditaxis.retry';

/**
 * EventRetry – manages a dead-letter queue with exponential backoff retry
 * for events that fail during the ingestion pipeline.
 *
 * Flow:
 *  1. On failure, event + error are inserted into FailedEventQueue
 *  2. A periodic sweep retries PENDING events whose nextRetryAt has passed
 *  3. After maxRetries, status flips to DEAD
 */
class EventRetry {

    /**
     * @param {{ maxRetries?: number, baseDelayMs?: number, maxDelayMs?: number }} opts
     */
    constructor(opts = {}) {
        this.maxRetries = opts.maxRetries || 5;
        this.baseDelayMs = opts.baseDelayMs || 2000;    // 2 s
        this.maxDelayMs = opts.maxDelayMs || 300000;     // 5 min
    }

    /**
     * Enqueue a failed event into the dead-letter table.
     */
    async enqueue(event, error) {
        const db = cds.db;
        const { FailedEventQueue } = cds.entities('auditaxis.db');
        const LOG = cds.log(LOG_COMPONENT);

        const eventId = randomUUID();
        const nextRetryAt = new Date(Date.now() + this.baseDelayMs).toISOString();

        await db.run(
            INSERT.into(FailedEventQueue).entries({
                eventId,
                payload: JSON.stringify(event),
                errorMessage: String(error.message || error).substring(0, 2048),
                retryCount: 0,
                maxRetries: this.maxRetries,
                nextRetryAt,
                status: 'PENDING',
                tenantId: event.tenantId || ''
            })
        );

        metrics.failedEvents.inc({ objectType: event.objectType || 'unknown' });
        LOG.warn(`Event enqueued for retry: ${eventId} – ${error.message}`);
        return eventId;
    }

    /**
     * Process all retryable events. Called periodically by the cron scheduler.
     *
     * @param {Function} processFn – async fn(event) that re-runs the pipeline
     * @returns {{ retried: number, succeeded: number, dead: number }}
     */
    async processRetries(processFn) {
        const db = cds.db;
        const { FailedEventQueue } = cds.entities('auditaxis.db');
        const LOG = cds.log(LOG_COMPONENT);

        const now = new Date().toISOString();
        const pending = await db.run(
            SELECT.from(FailedEventQueue)
                .where({ status: 'PENDING', nextRetryAt: { '<=': now } })
                .limit(100)
        );

        let retried = 0, succeeded = 0, dead = 0;

        for (const item of pending) {
            retried++;
            const newRetryCount = item.retryCount + 1;

            try {
                const event = JSON.parse(item.payload);
                await db.run(
                    UPDATE(FailedEventQueue)
                        .set({ status: 'RETRYING', retryCount: newRetryCount })
                        .where({ eventId: item.eventId })
                );

                await processFn(event);

                // Success – mark resolved
                await db.run(
                    UPDATE(FailedEventQueue)
                        .set({ status: 'RESOLVED' })
                        .where({ eventId: item.eventId })
                );
                succeeded++;
                LOG.info(`Retry succeeded for event ${item.eventId}`);
            } catch (err) {
                if (newRetryCount >= item.maxRetries) {
                    // Move to dead letter
                    await db.run(
                        UPDATE(FailedEventQueue)
                            .set({
                                status: 'DEAD',
                                retryCount: newRetryCount,
                                errorMessage: String(err.message).substring(0, 2048)
                            })
                            .where({ eventId: item.eventId })
                    );
                    dead++;
                    LOG.error(`Event ${item.eventId} moved to DEAD after ${newRetryCount} retries`);
                } else {
                    // Schedule next retry with exponential backoff
                    const delay = Math.min(
                        this.baseDelayMs * Math.pow(2, newRetryCount),
                        this.maxDelayMs
                    );
                    const nextRetry = new Date(Date.now() + delay).toISOString();
                    await db.run(
                        UPDATE(FailedEventQueue)
                            .set({
                                status: 'PENDING',
                                retryCount: newRetryCount,
                                nextRetryAt: nextRetry,
                                errorMessage: String(err.message).substring(0, 2048)
                            })
                            .where({ eventId: item.eventId })
                    );
                    LOG.warn(`Retry ${newRetryCount}/${item.maxRetries} failed for ${item.eventId}, next at ${nextRetry}`);
                }
            }
        }

        return { retried, succeeded, dead };
    }
}

module.exports = EventRetry;
