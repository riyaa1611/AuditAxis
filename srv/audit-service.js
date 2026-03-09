'use strict';

const cds = require('@sap/cds');
const { randomUUID } = require('crypto');
const HashChainEngine = require('./hashchain-engine');
const AlertEngine = require('./alert-engine');
const EnrichmentService = require('./enrichment-service');
const ReportService = require('./report-service');
const ArchiveService = require('./archive-service');
const { metrics } = require('../util/telemetry');
const EventRetry = require('../util/event-retry');

// Lazy-loaded p-queue (ESM module)
let PQueue;

/**
 * AuditService – main CAP service handler.
 *
 * Exposes OData V4 endpoints for querying audit records,
 * ingesting events, verifying hash chains, generating reports,
 * querying stats / user activity / object timelines, and managing
 * the dead-letter queue and archival.
 */
module.exports = class AuditServiceHandler extends cds.ApplicationService {

    async init() {
        const {
            AuditLogs, AuditLogItems, Alerts, HashChains,
            ObjectConfigs, AlertRules, FailedEvents, ArchiveLogs, HashSegments
        } = this.entities;

        this.hashChain = new HashChainEngine();
        this.alertEngine = new AlertEngine();
        this.enrichment = new EnrichmentService();
        this.reportService = new ReportService();
        this.archiveService = new ArchiveService();
        this.eventRetry = new EventRetry();

        // Async processing queue (lazy-init because p-queue is ESM)
        this._queue = null;
        this._initQueue();

        // ─── Reject mutating operations on immutable entities ───
        this.reject(['UPDATE', 'DELETE'], AuditLogs);
        this.reject(['UPDATE', 'DELETE'], AuditLogItems);
        this.reject(['UPDATE', 'DELETE'], Alerts);

        // ─── Fiori UI Virtual Fields ───
        this.after('READ', AuditLogs, (each) => {
            if (each.changeType) {
                if (each.changeType === 'CREATE') each.changeTypeCriticality = 3;
                else if (each.changeType === 'DELETE') each.changeTypeCriticality = 1;
                else if (each.changeType === 'UPDATE') each.changeTypeCriticality = 2;
                else each.changeTypeCriticality = 0;
            }
        });

        // ─── API Access Logging ───
        this.before('*', (req) => this._logAccess(req));

        // ─── Bound action: ingestEvents ───
        this.on('ingestEvents', async (req) => {
            return this._ingestEvents(req.data.events, req);
        });

        // ─── Function: verifyChain ───
        this.on('verifyChain', async (req) => {
            const { objectType } = req.data;
            const result = await this.hashChain.verifyChain(objectType);
            if (!result.valid) {
                metrics.chainVerificationFailures.inc({ objectType });
            }
            return result;
        });

        // ─── Action: generateReport ───
        this.on('generateReport', async (req) => {
            const { objectType, from, to, format } = req.data;
            return this.reportService.generate(objectType, from, to, format);
        });

        // ─── Function: getStats ───
        this.on('getStats', async () => {
            return this._getStats();
        });

        // ─── Function: getUserActivity ───
        this.on('getUserActivity', async (req) => {
            return this._getUserActivity(req.data.userId);
        });

        // ─── Function: getObjectTimeline ───
        this.on('getObjectTimeline', async (req) => {
            return this._getObjectTimeline(req.data.objectKey);
        });

        // ─── Action: retryFailedEvent ───
        this.on('retryFailedEvent', async (req) => {
            const { eventId } = req.data;
            return this._retryOne(eventId);
        });

        // ─── Action: triggerArchival ───
        this.on('triggerArchival', async (req) => {
            const { objectType } = req.data;
            return this.archiveService.archiveForObjectType(objectType, 90);
        });

        await super.init();
    }

    // ────────────────────────────────────────────────────
    //  Ingestion Pipeline
    // ────────────────────────────────────────────────────

    async _initQueue() {
        try {
            const mod = await import('p-queue');
            PQueue = mod.default;
            this._queue = new PQueue({ concurrency: 20 });
            this._queue.on('idle', () => metrics.activeQueueSize.set({}, 0));
        } catch {
            // p-queue not available – fall back to direct processing
            this._queue = null;
        }
    }

    async _ingestEvents(events, req) {
        if (!events || events.length === 0) {
            req.reject(400, 'No events provided');
        }

        const BATCH_SIZE = 50;
        const results = [];

        for (let i = 0; i < events.length; i += BATCH_SIZE) {
            const batch = events.slice(i, i + BATCH_SIZE);

            if (this._queue) {
                metrics.activeQueueSize.set({}, this._queue.size + batch.length);
                const batchResults = await Promise.all(
                    batch.map(evt =>
                        this._queue.add(() => this._processSingleEvent(evt, req))
                    )
                );
                results.push(...batchResults);
            } else {
                const batchResults = await Promise.all(
                    batch.map(evt => this._processSingleEvent(evt, req))
                );
                results.push(...batchResults);
            }
        }

        return results;
    }

    async _processSingleEvent(event, req) {
        const endTimer = metrics.pipelineLatency.startTimer({ objectType: event.objectType || 'unknown' });

        try {
            const db = cds.db;
            const { AuditLog, AuditLogItem } = cds.entities('auditaxis.db');

            // 1. Enrich
            const enriched = await this.enrichment.enrich(event);

            // 2. Hash chain
            const dbTimer = metrics.dbOperationLatency.startTimer({ operation: 'hashchain' });
            const { previousHash, currentHash } = await this.hashChain.computeLink(
                enriched.objectType,
                enriched
            );
            dbTimer();

            // 3. Persist
            const auditId = randomUUID();
            const entry = {
                auditId,
                objectType: enriched.objectType,
                objectKey: enriched.objectKey,
                userId: enriched.userId,
                userName: enriched.userName || enriched.userId,
                timestamp: enriched.timestamp || new Date().toISOString(),
                changeType: enriched.changeType,
                transactionCode: enriched.transactionCode || '',
                previousHash,
                currentHash,
                tenantId: enriched.tenantId || ''
            };

            const items = (enriched.fields || []).map(f => ({
                itemId: randomUUID(),
                audit_auditId: auditId,
                fieldName: f.fieldName,
                oldValue: f.oldValue || '',
                newValue: f.newValue || '',
                tenantId: enriched.tenantId || ''
            }));

            const dbPersistTimer = metrics.dbOperationLatency.startTimer({ operation: 'persist' });
            await db.run(INSERT.into(AuditLog).entries(entry));
            if (items.length > 0) {
                await db.run(INSERT.into(AuditLogItem).entries(items));
            }
            dbPersistTimer();

            // 4. Alert evaluation (fire-and-forget)
            this.alertEngine.evaluate(entry, items).catch(err => {
                console.error('[AuditAxis] Alert evaluation failed:', err.message);
            });

            metrics.eventsIngested.inc({ objectType: enriched.objectType });
            endTimer();
            return auditId;

        } catch (err) {
            endTimer();
            // Route to DLQ
            await this.eventRetry.enqueue(event, err).catch(dlqErr => {
                console.error('[AuditAxis] DLQ enqueue failed:', dlqErr.message);
            });
            throw err;
        }
    }

    // ────────────────────────────────────────────────────
    //  Stats / Activity / Timeline APIs
    // ────────────────────────────────────────────────────

    async _getStats() {
        const db = cds.db;
        const { AuditLog, AlertLog } = cds.entities('auditaxis.db');

        const [totalResult, perTypeResult, alertResult, recentCount] = await Promise.all([
            db.run(SELECT.one.from(AuditLog).columns('count(*) as cnt')),
            db.run(SELECT.from(AuditLog).columns('objectType', 'count(*) as cnt').groupBy('objectType')),
            db.run(SELECT.from(AlertLog).columns('status', 'count(*) as cnt').groupBy('status')),
            db.run(
                SELECT.one.from(AuditLog)
                    .columns('count(*) as cnt')
                    .where({ timestamp: { '>=': new Date(Date.now() - 60000).toISOString() } })
            )
        ]);

        const alertMap = {};
        let alertTotal = 0;
        for (const row of alertResult) {
            alertMap[row.status.toLowerCase()] = row.cnt;
            alertTotal += row.cnt;
        }

        return {
            totalEvents: totalResult?.cnt || 0,
            eventsPerObjectType: perTypeResult.map(r => ({ objectType: r.objectType, count: r.cnt })),
            alertCounts: {
                total: alertTotal,
                sent: alertMap.sent || 0,
                failed: alertMap.failed || 0,
                pending: (alertMap.new || 0)
            },
            ingestionRatePerMin: recentCount?.cnt || 0
        };
    }

    async _getUserActivity(userId) {
        const db = cds.db;
        const { AuditLog, AuditLogItem } = cds.entities('auditaxis.db');

        const logs = await db.run(
            SELECT.from(AuditLog)
                .where({ userId })
                .orderBy('timestamp desc')
                .limit(200)
        );

        if (logs.length === 0) return [];

        const auditIds = logs.map(l => l.auditId);
        const items = await db.run(
            SELECT.from(AuditLogItem)
                .columns('audit_auditId', 'count(*) as cnt')
                .where({ audit_auditId: { in: auditIds } })
                .groupBy('audit_auditId')
        );
        const countMap = new Map(items.map(i => [i.audit_auditId, i.cnt]));

        return logs.map(l => ({
            auditId: l.auditId,
            objectType: l.objectType,
            objectKey: l.objectKey,
            changeType: l.changeType,
            timestamp: l.timestamp,
            fieldCount: countMap.get(l.auditId) || 0
        }));
    }

    async _getObjectTimeline(objectKey) {
        const db = cds.db;
        const { AuditLog, AuditLogItem } = cds.entities('auditaxis.db');

        const logs = await db.run(
            SELECT.from(AuditLog)
                .where({ objectKey })
                .orderBy('timestamp desc')
                .limit(500)
        );

        if (logs.length === 0) return [];

        const auditIds = logs.map(l => l.auditId);
        const items = await db.run(
            SELECT.from(AuditLogItem)
                .columns('audit_auditId', 'count(*) as cnt')
                .where({ audit_auditId: { in: auditIds } })
                .groupBy('audit_auditId')
        );
        const countMap = new Map(items.map(i => [i.audit_auditId, i.cnt]));

        return logs.map(l => ({
            auditId: l.auditId,
            userId: l.userId,
            userName: l.userName,
            changeType: l.changeType,
            timestamp: l.timestamp,
            transactionCode: l.transactionCode,
            fieldCount: countMap.get(l.auditId) || 0
        }));
    }

    // ────────────────────────────────────────────────────
    //  DLQ Retry (single)
    // ────────────────────────────────────────────────────

    async _retryOne(eventId) {
        const db = cds.db;
        const { FailedEventQueue } = cds.entities('auditaxis.db');

        const item = await db.run(
            SELECT.one.from(FailedEventQueue).where({ eventId })
        );
        if (!item) return false;

        try {
            const event = JSON.parse(item.payload);
            await this._processSingleEvent(event, { reject: () => {} });
            await db.run(UPDATE(FailedEventQueue).set({ status: 'RESOLVED' }).where({ eventId }));
            return true;
        } catch {
            return false;
        }
    }

    // ────────────────────────────────────────────────────
    //  API Access Logging
    // ────────────────────────────────────────────────────

    async _logAccess(req) {
        // Only log significant operations, not every internal CDS event
        if (!req.event || !req.user) return;
        try {
            const db = cds.db;
            const { ApiAccessLog } = cds.entities('auditaxis.db');
            if (!ApiAccessLog) return;

            await db.run(INSERT.into(ApiAccessLog).entries({
                accessId: randomUUID(),
                userId: req.user.id || 'anonymous',
                tenantId: req.user.tenant || '',
                endpoint: req.event,
                method: req.method || req.event,
                statusCode: 200,
                ip: req.req?.ip || '',
                userAgent: req.req?.headers?.['user-agent'] || ''
            }));
        } catch {
            // Non-critical – don't block the request
        }
    }
};
