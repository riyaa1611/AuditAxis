'use strict';

const cds = require('@sap/cds');
const EventHandler = require('./srv/event-handler');
const TenantContext = require('./srv/tenant-context');
const ArchiveService = require('./srv/archive-service');
const EventRetry = require('./util/event-retry');
const { metricsMiddleware } = require('./util/telemetry');
const RateLimiter = require('./util/rate-limit');

/**
 * Custom CAP server bootstrap.
 * Registers middleware, Event Mesh subscriptions, scheduled jobs,
 * and multi-tenant isolation after the CAP runtime is fully served.
 */
cds.on('bootstrap', (app) => {
    // Prometheus metrics endpoint
    app.use(metricsMiddleware);

    // Rate limiting
    const rateLimiter = new RateLimiter();
    app.use(rateLimiter.middleware());
});

cds.on('served', async () => {
    const LOG = cds.log('auditaxis.server');

    // Register multi-tenant CDS handlers
    try {
        const tenantCtx = new TenantContext();
        tenantCtx.registerCdsHandlers();
        LOG.info('Multi-tenant isolation handlers registered');
    } catch (err) {
        LOG.error('Failed to register tenant context:', err.message);
    }

    // Register Event Mesh subscriptions
    try {
        const eventHandler = new EventHandler();
        await eventHandler.register();
        LOG.info('Event Mesh subscriptions registered successfully');
    } catch (err) {
        LOG.error('Failed to register Event Mesh subscriptions:', err.message);
    }

    // Scheduled jobs (lazy-load node-cron)
    try {
        const cron = require('node-cron');
        const archiveService = new ArchiveService();
        const eventRetry = new EventRetry();

        // Nightly archival at 02:00
        cron.schedule('0 2 * * *', async () => {
            LOG.info('Scheduled archival sweep started');
            try {
                await archiveService.archiveAll();
                LOG.info('Scheduled archival sweep completed');
            } catch (err) {
                LOG.error('Archival sweep failed:', err.message);
            }
        });

        // Retry failed events every 5 minutes
        cron.schedule('*/5 * * * *', async () => {
            try {
                await eventRetry.processRetries();
            } catch (err) {
                LOG.error('DLQ retry processing failed:', err.message);
            }
        });

        LOG.info('Scheduled jobs registered (archival @ 02:00, DLQ retry @ every 5m)');
    } catch (err) {
        LOG.warn('node-cron not available – scheduled jobs disabled:', err.message);
    }
});

module.exports = cds.server;
