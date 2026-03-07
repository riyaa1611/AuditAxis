'use strict';

const cds = require('@sap/cds');
const { randomUUID } = require('crypto');
const { createGzip } = require('zlib');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const fs = require('fs');
const path = require('path');

const LOG_COMPONENT = 'auditaxis.archive';

/**
 * ArchiveService – identifies audit log records past their retention period,
 * exports them to compressed JSON files, records the archival in ArchiveLog,
 * and deletes the archived source records.
 *
 * Storage: local filesystem in production you'd swap for SAP Object Store
 * or an S3-compatible service binding.
 */
class ArchiveService {

    constructor() {
        this.archiveDir = process.env.ARCHIVE_DIR || path.join(process.cwd(), 'archives');
    }

    /**
     * Run archival for all object types (called by cron).
     */
    async archiveAll() {
        const LOG = cds.log(LOG_COMPONENT);
        const configs = await this._loadConfigs();
        const results = [];

        for (const cfg of configs) {
            if (!cfg.retentionPeriod || cfg.retentionPeriod <= 0) continue;
            try {
                const result = await this.archiveForObjectType(cfg.objectType, cfg.retentionPeriod);
                if (result) results.push(result);
            } catch (err) {
                LOG.error(`Archival failed for ${cfg.objectType}: ${err.message}`);
            }
        }

        LOG.info(`Archival sweep complete: ${results.length} object types processed`);
        return results;
    }

    /**
     * Archive records for a specific object type.
     *
     * @param {string} objectType
     * @param {number} retentionDays – records older than this are archived
     * @returns {{ archiveId: string, recordCount: number, message: string } | null}
     */
    async archiveForObjectType(objectType, retentionDays) {
        const db = cds.db;
        const { AuditLog, AuditLogItem, ArchiveLog } = cds.entities('auditaxis.db');
        const LOG = cds.log(LOG_COMPONENT);

        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - retentionDays);
        const cutoffISO = cutoff.toISOString();

        // Find records past retention
        const records = await db.run(
            SELECT.from(AuditLog)
                .where({ objectType, timestamp: { '<': cutoffISO } })
                .orderBy('timestamp asc')
        );

        if (records.length === 0) {
            LOG.info(`No records to archive for ${objectType}`);
            return null;
        }

        // Fetch related items
        const auditIds = records.map(r => r.auditId);
        const items = await db.run(
            SELECT.from(AuditLogItem).where({ audit_auditId: { in: auditIds } })
        );

        const itemMap = new Map();
        for (const item of items) {
            const list = itemMap.get(item.audit_auditId) || [];
            list.push(item);
            itemMap.set(item.audit_auditId, list);
        }

        // Attach items to records
        for (const rec of records) {
            rec._items = itemMap.get(rec.auditId) || [];
        }

        // Write compressed JSON archive
        const archiveId = randomUUID();
        const filename = `archive_${objectType}_${archiveId}.json.gz`;
        const filePath = path.join(this.archiveDir, filename);

        await this._ensureDir(this.archiveDir);

        const jsonStr = JSON.stringify(records, null, 0);
        const fileSize = await this._writeCompressed(jsonStr, filePath);

        // Record in ArchiveLog
        await db.run(
            INSERT.into(ArchiveLog).entries({
                archiveId,
                archiveDate: new Date().toISOString().split('T')[0],
                objectType,
                recordCount: records.length,
                storageLocation: filePath,
                status: 'COMPLETED',
                fileSizeBytes: fileSize
            })
        );

        // Delete archived items then logs
        if (items.length > 0) {
            await db.run(DELETE.from(AuditLogItem).where({ audit_auditId: { in: auditIds } }));
        }
        await db.run(DELETE.from(AuditLog).where({ auditId: { in: auditIds } }));

        LOG.info(`Archived ${records.length} records for ${objectType} -> ${filename}`);
        return {
            archiveId,
            recordCount: records.length,
            message: `Archived ${records.length} records to ${filename}`
        };
    }

    /**
     * Write a string as gzip-compressed file. Returns file size in bytes.
     */
    async _writeCompressed(content, filePath) {
        const input = Readable.from([content]);
        const gzip = createGzip();
        const output = fs.createWriteStream(filePath);
        await pipeline(input, gzip, output);
        const stat = fs.statSync(filePath);
        return stat.size;
    }

    async _ensureDir(dir) {
        await fs.promises.mkdir(dir, { recursive: true });
    }

    async _loadConfigs() {
        const { ObjectConfig } = cds.entities('auditaxis.db');
        return cds.db.run(SELECT.from(ObjectConfig).where({ active: true }));
    }
}

module.exports = ArchiveService;
