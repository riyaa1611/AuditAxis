namespace auditaxis.db;

using { cuid, managed } from '@sap/cds/common';

// ─── Multi-Tenant Aspect ───
aspect tenantScoped {
    tenantId : String(36) @title: 'Tenant ID';
}

/**
 * Core audit trail entity – immutable record of every change captured from S/4HANA.
 * Each record participates in a SHA-256 hash chain for tamper detection.
 */
entity AuditLog : cuid, managed, tenantScoped {
    key auditId         : UUID;
        objectType      : String(128)  @title: 'Object Type';
        objectKey       : String(256)  @title: 'Object Key';
        userId          : String(64)   @title: 'User ID';
        userName        : String(256)  @title: 'User Name';
        timestamp       : Timestamp    @title: 'Change Timestamp';
        changeType      : String(16)   @title: 'Change Type'; // CREATE, UPDATE, DELETE
        transactionCode : String(32)   @title: 'Transaction Code';
        previousHash    : String(64)   @title: 'Previous Hash';
        currentHash     : String(64)   @title: 'Current Hash';
        // Navigation
        items           : Composition of many AuditLogItem on items.audit = $self;
        alerts          : Association to many AlertLog on alerts.audit = $self;
}

/**
 * Field-level change details for each audit log entry.
 */
entity AuditLogItem : cuid, tenantScoped {
    key itemId    : UUID;
        audit     : Association to AuditLog @title: 'Audit Log';
        fieldName : String(128)            @title: 'Field Name';
        oldValue  : String(1024)           @title: 'Old Value';
        newValue  : String(1024)           @title: 'New Value';
}

/**
 * Configuration controlling which object types / fields are monitored
 * and how long records are retained.
 */
entity ObjectConfig : managed, tenantScoped {
    key objectType      : String(128) @title: 'Object Type';
    key clientId        : String(4)   @title: 'Client ID';
        monitoredFields : LargeString @title: 'Monitored Fields (CSV)';
        retentionPeriod : Integer     @title: 'Retention (days)';
        active          : Boolean default true @title: 'Active';
}

/**
 * Rules that trigger alerts when specific change patterns are detected.
 */
entity AlertRule : cuid, managed, tenantScoped {
    key ruleId        : UUID;
        objectType    : String(128) @title: 'Object Type';
        fieldName     : String(128) @title: 'Field Name';
        changeType    : String(16)  @title: 'Change Type';
        notifyChannel : String(512) @title: 'Webhook URL';
        description   : String(512) @title: 'Rule Description';
        active        : Boolean default true @title: 'Active';
}

/**
 * Log of triggered alerts with timestamps.
 */
entity AlertLog : cuid, managed, tenantScoped {
    key alertId     : UUID;
        audit       : Association to AuditLog @title: 'Audit Entry';
        rule        : Association to AlertRule @title: 'Alert Rule';
        triggeredAt : Timestamp               @title: 'Triggered At';
        status      : String(32) default 'NEW'@title: 'Status'; // NEW, SENT, FAILED
        message     : String(1024)            @title: 'Alert Message';
}

/**
 * Hash chain head per object type – stores the last known hash
 * so new records can be chained.
 */
entity HashChain : managed, tenantScoped {
    key chainId    : UUID;
        objectType : String(128) @title: 'Object Type';
        lastHash   : String(64)  @title: 'Last Hash';
        sequence   : Integer     @title: 'Sequence No';
}

// ─── Dead Letter Queue (failed event ingestion) ───

entity FailedEventQueue : cuid, managed, tenantScoped {
    key eventId      : UUID;
        payload      : LargeString  @title: 'Event Payload (JSON)';
        errorMessage : String(2048) @title: 'Error Message';
        retryCount   : Integer default 0 @title: 'Retry Count';
        maxRetries   : Integer default 5 @title: 'Max Retries';
        nextRetryAt  : Timestamp    @title: 'Next Retry At';
        status       : String(32) default 'PENDING' @title: 'Status'; // PENDING, RETRYING, DEAD, RESOLVED
        createdAt    : Timestamp    @cds.on.insert: $now;
}

// ─── Archive Log ───

entity ArchiveLog : cuid, managed, tenantScoped {
    key archiveId       : UUID;
        archiveDate     : Date        @title: 'Archive Date';
        objectType      : String(128) @title: 'Object Type';
        recordCount     : Integer     @title: 'Records Archived';
        storageLocation : String(1024)@title: 'Storage Location';
        status          : String(32) default 'COMPLETED' @title: 'Status';
        fileSizeBytes   : Integer64   @title: 'File Size (bytes)';
}

// ─── Hash Segment (optimized verification) ───

entity HashSegment : cuid, managed, tenantScoped {
    key segmentId    : UUID;
        objectType   : String(128) @title: 'Object Type';
        startSequence: Integer     @title: 'Start Sequence';
        endSequence  : Integer     @title: 'End Sequence';
        startAuditId : UUID        @title: 'Start Audit ID';
        endAuditId   : UUID        @title: 'End Audit ID';
        segmentHash  : String(64)  @title: 'Segment Hash';
        recordCount  : Integer     @title: 'Records in Segment';
}

// ─── API Access Audit Log (security hardening) ───

entity ApiAccessLog : cuid {
    key accessId    : UUID;
        userId      : String(64)   @title: 'User ID';
        tenantId    : String(36)   @title: 'Tenant ID';
        endpoint    : String(512)  @title: 'Endpoint';
        method      : String(10)   @title: 'HTTP Method';
        statusCode  : Integer      @title: 'Response Status';
        ip          : String(45)   @title: 'Client IP';
        userAgent   : String(512)  @title: 'User Agent';
        timestamp   : Timestamp    @cds.on.insert: $now;
}
