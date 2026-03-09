using auditaxis.db from '../db/schema';

/**
 * Primary OData V4 service exposing audit trail data.
 * AuditLog and AuditLogItem are insert-only (no UPDATE / DELETE).
 */
@path: '/api/audit'
service AuditService {

    // ──── Audit Log (immutable) ────
    @readonly
    entity AuditLogs as projection on db.AuditLog {
        *,
        items : redirected to AuditLogItems,
        alerts : redirected to Alerts
    } excluding { modifiedAt, modifiedBy }
    actions {
        /** Ingest a batch of audit events (system-to-system). */
        action ingestEvents(
            events : array of AuditEventPayload
        ) returns array of UUID;
    };

    @readonly
    entity AuditLogItems as projection on db.AuditLogItem;

    // ──── Configuration (admin-only write) ────
    entity ObjectConfigs as projection on db.ObjectConfig;

    // ──── Alert Rules ────
    entity AlertRules as projection on db.AlertRule;

    // ──── Alert Log (read-only for auditors) ────
    @readonly
    entity Alerts as projection on db.AlertLog {
        *,
        audit : redirected to AuditLogs,
        rule  : redirected to AlertRules
    };

    // ──── Hash Chains (read-only) ────
    @readonly
    entity HashChains as projection on db.HashChain;

    // ──── Dead Letter Queue (admin-only) ────
    @readonly
    entity FailedEvents as projection on db.FailedEventQueue;

    // ──── Archive Logs (read-only) ────
    @readonly
    entity ArchiveLogs as projection on db.ArchiveLog;

    // ──── Hash Segments (read-only) ────
    @readonly
    entity HashSegments as projection on db.HashSegment;

    // ──── Unbound Actions / Functions ────

    /** Verify integrity of the hash chain for a given object type. */
    function verifyChain(objectType : String) returns ChainVerificationResult;

    /** Generate an audit report for a date range. */
    action generateReport(
        objectType : String,
        from       : Timestamp,
        to         : Timestamp,
        format     : String // 'csv' | 'xlsx'
    ) returns LargeBinary;

    /** Get aggregated statistics. */
    function getStats() returns AuditStats;

    /** Get activity timeline for a specific user. */
    function getUserActivity(userId : String) returns array of UserActivityEntry;

    /** Get change timeline for a specific object. */
    function getObjectTimeline(objectKey : String) returns array of ObjectTimelineEntry;

    /** Retry a failed event from the dead letter queue. */
    action retryFailedEvent(eventId : UUID) returns Boolean;

    /** Manually trigger archival of old audit logs. */
    action triggerArchival(objectType : String) returns ArchivalResult;

    // ──── Types ────
    type AuditEventPayload {
        objectType      : String(128);
        objectKey       : String(256);
        userId          : String(64);
        timestamp       : Timestamp;
        changeType      : String(16);
        transactionCode : String(32);
        fields          : array of FieldChange;
    }

    type FieldChange {
        fieldName : String(128);
        oldValue  : String(1024);
        newValue  : String(1024);
    }

    type ChainVerificationResult {
        objectType : String(128);
        valid      : Boolean;
        totalLinks : Integer;
        brokenAt   : Integer;
        message    : String;
    }

    type AuditStats {
        totalEvents         : Integer;
        eventsPerObjectType : array of ObjectTypeStat;
        alertCounts         : AlertCountSummary;
        ingestionRatePerMin : Decimal;
    }

    type ObjectTypeStat {
        objectType : String(128);
        count      : Integer;
    }

    type AlertCountSummary {
        total : Integer;
        sent  : Integer;
        failed: Integer;
        pending: Integer;
    }

    type UserActivityEntry {
        auditId    : UUID;
        objectType : String(128);
        objectKey  : String(256);
        changeType : String(16);
        timestamp  : Timestamp;
        fieldCount : Integer;
    }

    type ObjectTimelineEntry {
        auditId         : UUID;
        userId          : String(64);
        userName        : String(256);
        changeType      : String(16);
        timestamp       : Timestamp;
        transactionCode : String(32);
        fieldCount      : Integer;
    }

    type ArchivalResult {
        archiveId   : UUID;
        recordCount : Integer;
        message     : String;
    }
}
