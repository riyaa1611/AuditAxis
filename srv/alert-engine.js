'use strict';

const cds = require('@sap/cds');
const { randomUUID } = require('crypto');
const { metrics } = require('../util/telemetry');

const LOG_COMPONENT = 'auditaxis.alerts';

/**
 * AlertEngine – evaluates alert rules against incoming audit events
 * and dispatches notifications through configured webhook channels
 * (Microsoft Teams, Slack, generic HTTP).
 */
class AlertEngine {

    /**
     * Evaluate all active rules against an incoming audit entry + items.
     * Matching rules produce AlertLog records and trigger webhook calls.
     *
     * @param {object}   auditEntry – the persisted AuditLog record
     * @param {object[]} auditItems – the persisted AuditLogItem records
     */
    async evaluate(auditEntry, auditItems) {
        const db = cds.db;
        const { AlertRule, AlertLog } = cds.entities('auditaxis.db');
        const LOG = cds.log(LOG_COMPONENT);

        // Load matching rules
        const rules = await db.run(
            SELECT.from(AlertRule).where({
                active: true,
                and: {
                    objectType: auditEntry.objectType,
                    or: { objectType: '*' }
                }
            })
        );

        for (const rule of rules) {
            if (!this._matches(rule, auditEntry, auditItems)) continue;

            metrics.alertTriggerCount.inc({ objectType: auditEntry.objectType, ruleId: rule.ruleId });
            const alertId = randomUUID();
            const alertMsg = this._buildMessage(rule, auditEntry, auditItems);

            // Persist alert log
            await db.run(
                INSERT.into(AlertLog).entries({
                    alertId,
                    audit_auditId: auditEntry.auditId,
                    rule_ruleId: rule.ruleId,
                    triggeredAt: new Date().toISOString(),
                    status: 'NEW',
                    message: alertMsg,
                    tenantId: auditEntry.tenantId || ''
                })
            );

            // Send notification (non-blocking)
            this._sendNotification(rule.notifyChannel, alertMsg, alertId, db, AlertLog, LOG)
                .catch(err => LOG.error(`Notification failed for alert ${alertId}:`, err.message));
        }
    }

    /**
     * Check whether a rule matches the given audit entry and items.
     */
    _matches(rule, auditEntry, auditItems) {
        // Match changeType (empty rule.changeType means "any")
        if (rule.changeType && rule.changeType !== auditEntry.changeType) {
            return false;
        }

        // Match fieldName against items (empty rule.fieldName means "any field")
        if (rule.fieldName) {
            const fieldMatch = auditItems.some(item => item.fieldName === rule.fieldName);
            if (!fieldMatch) return false;
        }

        return true;
    }

    /**
     * Build a human-readable alert message.
     */
    _buildMessage(rule, auditEntry, auditItems) {
        const changedFields = auditItems.map(i => i.fieldName).join(', ');
        return [
            `[AuditAxis Alert] Rule: ${rule.description || rule.ruleId}`,
            `Object: ${auditEntry.objectType} / ${auditEntry.objectKey}`,
            `Change: ${auditEntry.changeType} by ${auditEntry.userName} (${auditEntry.userId})`,
            `Fields: ${changedFields || 'N/A'}`,
            `Time: ${auditEntry.timestamp}`
        ].join('\n');
    }

    /**
     * Send webhook notification and update alert status.
     */
    async _sendNotification(webhookUrl, message, alertId, db, AlertLog, LOG) {
        if (!webhookUrl) return;

        const endTimer = metrics.alertDispatchLatency.startTimer({ channel: 'webhook' });
        try {
            // Dynamic import of https to avoid blocking startup
            const https = require('https');
            const url = new URL(webhookUrl);

            const body = JSON.stringify(this._formatWebhookPayload(url.hostname, message));
            const options = {
                hostname: url.hostname,
                port: url.port || 443,
                path: url.pathname + url.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body)
                },
                timeout: 10000
            };

            await new Promise((resolve, reject) => {
                const req = https.request(options, (res) => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve();
                    } else {
                        reject(new Error(`Webhook returned HTTP ${res.statusCode}`));
                    }
                });
                req.on('error', reject);
                req.on('timeout', () => { req.destroy(); reject(new Error('Webhook timeout')); });
                req.write(body);
                req.end();
            });

            await db.run(
                UPDATE(AlertLog).set({ status: 'SENT' }).where({ alertId })
            );
            endTimer();
            LOG.info(`Alert ${alertId} notification sent successfully`);
        } catch (err) {
            endTimer();
            await db.run(
                UPDATE(AlertLog).set({ status: 'FAILED' }).where({ alertId })
            );
            throw err;
        }
    }

    /**
     * Format the payload for common webhook providers.
     */
    _formatWebhookPayload(hostname, message) {
        // Teams-compatible Adaptive Card / MessageCard
        if (hostname.includes('webhook.office.com') || hostname.includes('microsoft')) {
            return {
                '@type': 'MessageCard',
                summary: 'AuditAxis Alert',
                themeColor: 'FF0000',
                title: 'AuditAxis Compliance Alert',
                text: message
            };
        }
        // Slack-compatible payload
        if (hostname.includes('hooks.slack.com')) {
            return { text: message };
        }
        // Generic webhook
        return { source: 'AuditAxis', message };
    }
}

module.exports = AlertEngine;
