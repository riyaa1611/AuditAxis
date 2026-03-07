'use strict';

const cds = require('@sap/cds');
const HashChainEngine = require('./hashchain-engine');
const AlertEngine = require('./alert-engine');
const EnrichmentService = require('./enrichment-service');
const EventRetry = require('../util/event-retry');
const { metrics } = require('../util/telemetry');
const { randomUUID } = require('crypto');

/**
 * Event Handler – subscribes to SAP Event Mesh topics and processes
 * incoming CloudEvent messages representing S/4HANA business object changes.
 *
 * Topic pattern: sap/s4/beh/<ObjectType>/<version>/changed
 */
class EventHandler {

    constructor() {
        this.hashChain = new HashChainEngine();
        this.alertEngine = new AlertEngine();
        this.enrichment = new EnrichmentService();
        this.eventRetry = new EventRetry();
    }

    /**
     * Register Event Mesh subscriptions during CAP bootstrap.
     * Called from a cds.on('served') hook or directly in custom server.js.
     */
    async register() {
        const messaging = await cds.connect.to('messaging');
        const LOG = cds.log('auditaxis.events');

        // Subscribe to all monitored object change topics
        const configs = await this._loadActiveConfigs();
        for (const cfg of configs) {
            const topic = `sap/s4/beh/${cfg.objectType}/v1/changed`;
            LOG.info(`Subscribing to topic: ${topic}`);

            messaging.on(topic, async (msg) => {
                await this._handleMessage(msg, cfg.objectType, LOG);
            });
        }

        // Catch-all for generic audit topic
        messaging.on('auditaxis/ingest', async (msg) => {
            await this._handleGenericIngest(msg, LOG);
        });
    }

    /**
     * Handle an incoming CloudEvent from a specific object-type topic.
     */
    async _handleMessage(msg, objectType, LOG) {
        try {
            const payload = this._parseCloudEvent(msg);
            payload.objectType = objectType;

            await this._processEvent(payload, LOG);
            metrics.eventsIngested.inc({ objectType });
            LOG.info(`Processed event for ${objectType}/${payload.objectKey}`);
        } catch (err) {
            LOG.error(`Error processing event for ${objectType}:`, err.message);
            // Route to DLQ
            await this.eventRetry.enqueue({ objectType, raw: msg.data }, err).catch(dlqErr => {
                LOG.error('DLQ enqueue failed:', dlqErr.message);
            });
            metrics.failedEvents.inc({ objectType });
        }
    }

    /**
     * Handle a generic ingest message that carries the objectType inside the payload.
     */
    async _handleGenericIngest(msg, LOG) {
        try {
            const payload = typeof msg.data === 'string' ? JSON.parse(msg.data) : msg.data;
            await this._processEvent(payload, LOG);
            metrics.eventsIngested.inc({ objectType: payload.objectType || 'generic' });
            LOG.info(`Processed generic ingest for ${payload.objectType}/${payload.objectKey}`);
        } catch (err) {
            LOG.error('Error processing generic ingest:', err.message);
            await this.eventRetry.enqueue({ raw: msg.data }, err).catch(dlqErr => {
                LOG.error('DLQ enqueue failed:', dlqErr.message);
            });
            metrics.failedEvents.inc({ objectType: 'generic' });
        }
    }

    /**
     * Full processing pipeline for one event.
     */
    async _processEvent(event, LOG) {
        const endTimer = metrics.pipelineLatency.startTimer({ objectType: event.objectType || 'unknown' });
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

        // 4. Evaluate alerts (non-blocking)
        this.alertEngine.evaluate(entry, items).catch(err => {
            LOG.error('Alert evaluation failed:', err.message);
        });

        endTimer();
    }

    /**
     * Extract relevant fields from a CloudEvents-compliant message.
     */
    _parseCloudEvent(msg) {
        const data = msg.data || msg;
        return {
            objectKey: data.objectKey || data.KEY || '',
            userId: data.userId || data.CHANGEDBY || '',
            timestamp: data.timestamp || data.CHANGEDAT || new Date().toISOString(),
            changeType: data.changeType || data.event || 'UPDATE',
            transactionCode: data.transactionCode || data.TCODE || '',
            fields: data.fields || data.changes || []
        };
    }

    /**
     * Load active ObjectConfig entries from the database.
     */
    async _loadActiveConfigs() {
        const { ObjectConfig } = cds.entities('auditaxis.db');
        return cds.db.run(
            SELECT.from(ObjectConfig).where({ active: true })
        );
    }
}

module.exports = EventHandler;
