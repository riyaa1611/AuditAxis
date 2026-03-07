'use strict';

const cds = require('@sap/cds');
const { stringify } = require('csv-stringify/sync');

const LOG_COMPONENT = 'auditaxis.reports';

/**
 * ReportService – generates audit trail reports for a date range
 * in CSV or Excel (XLSX) format.
 */
class ReportService {

    /**
     * Generate a report as a binary buffer.
     *
     * @param {string} objectType – filter by object type (null = all)
     * @param {string} from       – ISO timestamp lower bound
     * @param {string} to         – ISO timestamp upper bound
     * @param {string} format     – 'csv' or 'xlsx'
     * @returns {Buffer}
     */
    async generate(objectType, from, to, format) {
        const LOG = cds.log(LOG_COMPONENT);
        const records = await this._queryRecords(objectType, from, to);

        LOG.info(`Report: ${records.length} records, format=${format}`);

        if (format === 'xlsx') {
            return this._toExcel(records);
        }
        return this._toCsv(records);
    }

    /**
     * Query audit records within the given bounds.
     */
    async _queryRecords(objectType, from, to) {
        const db = cds.db;
        const { AuditLog, AuditLogItem } = cds.entities('auditaxis.db');

        const filters = [];
        if (objectType) filters.push({ objectType });
        if (from) filters.push({ timestamp: { '>=': from } });
        if (to) filters.push({ timestamp: { '<=': to } });

        let query = SELECT.from(AuditLog);
        for (const f of filters) {
            query = query.where(f);
        }
        query = query.orderBy('timestamp asc');

        const logs = await db.run(query);

        // Attach items
        if (logs.length > 0) {
            const auditIds = logs.map(l => l.auditId);
            const items = await db.run(
                SELECT.from(AuditLogItem).where({ audit_auditId: { in: auditIds } })
            );

            const itemMap = new Map();
            for (const item of items) {
                const list = itemMap.get(item.audit_auditId) || [];
                list.push(item);
                itemMap.set(item.audit_auditId, list);
            }

            for (const log of logs) {
                log._items = itemMap.get(log.auditId) || [];
            }
        }

        return logs;
    }

    /**
     * Flatten records to CSV.
     */
    _toCsv(records) {
        const rows = this._flatten(records);
        const csv = stringify(rows, {
            header: true,
            columns: [
                'auditId', 'objectType', 'objectKey', 'userId', 'userName',
                'timestamp', 'changeType', 'transactionCode', 'previousHash',
                'currentHash', 'fieldName', 'oldValue', 'newValue'
            ]
        });
        return Buffer.from(csv, 'utf-8');
    }

    /**
     * Build Excel workbook via exceljs.
     */
    async _toExcel(records) {
        const ExcelJS = require('exceljs');
        const wb = new ExcelJS.Workbook();
        wb.creator = 'AuditAxis';
        wb.created = new Date();

        const ws = wb.addWorksheet('Audit Report');
        ws.columns = [
            { header: 'Audit ID', key: 'auditId', width: 38 },
            { header: 'Object Type', key: 'objectType', width: 20 },
            { header: 'Object Key', key: 'objectKey', width: 30 },
            { header: 'User ID', key: 'userId', width: 16 },
            { header: 'User Name', key: 'userName', width: 24 },
            { header: 'Timestamp', key: 'timestamp', width: 24 },
            { header: 'Change Type', key: 'changeType', width: 12 },
            { header: 'Tx Code', key: 'transactionCode', width: 12 },
            { header: 'Prev Hash', key: 'previousHash', width: 20 },
            { header: 'Curr Hash', key: 'currentHash', width: 20 },
            { header: 'Field', key: 'fieldName', width: 20 },
            { header: 'Old Value', key: 'oldValue', width: 24 },
            { header: 'New Value', key: 'newValue', width: 24 }
        ];

        // Style header row
        ws.getRow(1).font = { bold: true };

        const rows = this._flatten(records);
        for (const row of rows) ws.addRow(row);

        return wb.xlsx.writeBuffer();
    }

    /**
     * Flatten log + items into one row per field change.
     */
    _flatten(records) {
        const rows = [];
        for (const log of records) {
            const base = {
                auditId: log.auditId,
                objectType: log.objectType,
                objectKey: log.objectKey,
                userId: log.userId,
                userName: log.userName,
                timestamp: log.timestamp,
                changeType: log.changeType,
                transactionCode: log.transactionCode,
                previousHash: log.previousHash,
                currentHash: log.currentHash
            };

            const items = log._items || [];
            if (items.length === 0) {
                rows.push({ ...base, fieldName: '', oldValue: '', newValue: '' });
            } else {
                for (const item of items) {
                    rows.push({
                        ...base,
                        fieldName: item.fieldName,
                        oldValue: item.oldValue,
                        newValue: item.newValue
                    });
                }
            }
        }
        return rows;
    }
}

module.exports = ReportService;
