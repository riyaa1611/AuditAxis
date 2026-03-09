using AuditService as service from '../../srv/audit-service';

// ═══════════════════════════════════════════════════════════════════
//  Fiori Elements Annotations for AuditLogs – List Report + Object Page
// ═══════════════════════════════════════════════════════════════════

annotate service.AuditLogs with @(
    UI: {
        // ── Selection Fields (filter bar) ──
        SelectionFields: [
            objectType,
            changeType,
            userId,
            timestamp,
            transactionCode
        ],

        // ── Line Item (table columns) ──
        LineItem: [
            { $Type: 'UI.DataField', Value: auditId,         Label: 'Audit ID' },
            { $Type: 'UI.DataField', Value: objectType,      Label: 'Object Type' },
            { $Type: 'UI.DataField', Value: objectKey,        Label: 'Object Key' },
            { $Type: 'UI.DataField', Value: userId,           Label: 'User ID' },
            { $Type: 'UI.DataField', Value: userName,         Label: 'User Name' },
            { $Type: 'UI.DataField', Value: timestamp,        Label: 'Timestamp',
              @UI.Importance: #High },
            { $Type: 'UI.DataField', Value: changeType,       Label: 'Change Type',
              Criticality: 3 },
            { $Type: 'UI.DataField', Value: transactionCode,  Label: 'Tx Code' }
        ],

        // ── Object Page Header ──
        HeaderInfo: {
            TypeName:       'Audit Log Entry',
            TypeNamePlural: 'Audit Log Entries',
            Title:          { $Type: 'UI.DataField', Value: auditId },
            Description:    { $Type: 'UI.DataField', Value: objectType }
        },

        // ── Header Facets ──
        HeaderFacets: [
            {
                $Type:  'UI.ReferenceFacet',
                Target: '@UI.FieldGroup#Header',
                Label:  'Overview'
            }
        ],

        FieldGroup#Header: {
            Data: [
                { $Type: 'UI.DataField', Value: changeType,       Label: 'Change Type' },
                { $Type: 'UI.DataField', Value: userId,           Label: 'User ID' },
                { $Type: 'UI.DataField', Value: timestamp,        Label: 'Timestamp' },
                { $Type: 'UI.DataField', Value: transactionCode,  Label: 'Tx Code' }
            ]
        },

        // ── Object Page Facets (sections) ──
        Facets: [
            {
                $Type:  'UI.ReferenceFacet',
                Target: '@UI.FieldGroup#General',
                Label:  'General Information'
            },
            {
                $Type:  'UI.ReferenceFacet',
                Target: '@UI.FieldGroup#HashChain',
                Label:  'Hash Chain'
            },
            {
                $Type:  'UI.ReferenceFacet',
                Target: 'items/@UI.LineItem',
                Label:  'Field Changes'
            },
            {
                $Type:  'UI.ReferenceFacet',
                Target: 'alerts/@UI.LineItem',
                Label:  'Triggered Alerts'
            }
        ],

        FieldGroup#General: {
            Data: [
                { $Type: 'UI.DataField', Value: objectType,      Label: 'Object Type' },
                { $Type: 'UI.DataField', Value: objectKey,        Label: 'Object Key' },
                { $Type: 'UI.DataField', Value: userId,           Label: 'User ID' },
                { $Type: 'UI.DataField', Value: userName,         Label: 'User Name' },
                { $Type: 'UI.DataField', Value: changeType,       Label: 'Change Type' },
                { $Type: 'UI.DataField', Value: transactionCode,  Label: 'Transaction Code' },
                { $Type: 'UI.DataField', Value: timestamp,        Label: 'Timestamp' }
            ]
        },

        FieldGroup#HashChain: {
            Data: [
                { $Type: 'UI.DataField', Value: previousHash, Label: 'Previous Hash' },
                { $Type: 'UI.DataField', Value: currentHash,  Label: 'Current Hash' }
            ]
        }
    }
);

// Virtual criticality for changeType (used in LineItem)
annotate service.AuditLogs with {
    changeType @(
        Common.ValueList: {
            CollectionPath: 'AuditLogs',
            Parameters: [
                { $Type: 'Common.ValueListParameterInOut', ValueListProperty: 'changeType', LocalDataProperty: changeType }
            ]
        }
    );
};

// ═══════════════════════════════════════════════════════════════════
//  AuditLogItems – sub-table on Object Page
// ═══════════════════════════════════════════════════════════════════

annotate service.AuditLogItems with @(
    UI: {
        LineItem: [
            { $Type: 'UI.DataField', Value: fieldName, Label: 'Field' },
            { $Type: 'UI.DataField', Value: oldValue,  Label: 'Old Value' },
            { $Type: 'UI.DataField', Value: newValue,  Label: 'New Value' }
        ]
    }
);

// ═══════════════════════════════════════════════════════════════════
//  Alerts – List Report
// ═══════════════════════════════════════════════════════════════════

annotate service.Alerts with @(
    UI: {
        SelectionFields: [ status, triggeredAt ],
        LineItem: [
            { $Type: 'UI.DataField', Value: alertId,     Label: 'Alert ID' },
            { $Type: 'UI.DataField', Value: audit.objectType, Label: 'Object Type' },
            { $Type: 'UI.DataField', Value: audit.objectKey,  Label: 'Object Key' },
            { $Type: 'UI.DataField', Value: triggeredAt,  Label: 'Triggered At' },
            { $Type: 'UI.DataField', Value: status,       Label: 'Status' },
            { $Type: 'UI.DataField', Value: message,      Label: 'Message' }
        ],
        HeaderInfo: {
            TypeName:       'Alert',
            TypeNamePlural: 'Alerts',
            Title:          { $Type: 'UI.DataField', Value: alertId },
            Description:    { $Type: 'UI.DataField', Value: status }
        }
    }
);

// ═══════════════════════════════════════════════════════════════════
//  ObjectConfigs – List Report for admin
// ═══════════════════════════════════════════════════════════════════

annotate service.ObjectConfigs with @(
    UI: {
        SelectionFields: [ objectType, active ],
        LineItem: [
            { $Type: 'UI.DataField', Value: objectType,      Label: 'Object Type' },
            { $Type: 'UI.DataField', Value: clientId,         Label: 'Client ID' },
            { $Type: 'UI.DataField', Value: monitoredFields,  Label: 'Monitored Fields' },
            { $Type: 'UI.DataField', Value: retentionPeriod,  Label: 'Retention (days)' },
            { $Type: 'UI.DataField', Value: active,           Label: 'Active' }
        ],
        HeaderInfo: {
            TypeName:       'Object Configuration',
            TypeNamePlural: 'Object Configurations',
            Title:          { $Type: 'UI.DataField', Value: objectType },
            Description:    { $Type: 'UI.DataField', Value: clientId }
        },
        Facets: [
            {
                $Type:  'UI.ReferenceFacet',
                Target: '@UI.FieldGroup#Config',
                Label:  'Configuration Details'
            }
        ],
        FieldGroup#Config: {
            Data: [
                { $Type: 'UI.DataField', Value: objectType,      Label: 'Object Type' },
                { $Type: 'UI.DataField', Value: clientId,         Label: 'Client' },
                { $Type: 'UI.DataField', Value: monitoredFields,  Label: 'Monitored Fields' },
                { $Type: 'UI.DataField', Value: retentionPeriod,  Label: 'Retention Period (days)' },
                { $Type: 'UI.DataField', Value: active,           Label: 'Active' }
            ]
        }
    }
);

// ═══════════════════════════════════════════════════════════════════
//  AlertRules – List Report for admin
// ═══════════════════════════════════════════════════════════════════

annotate service.AlertRules with @(
    UI: {
        SelectionFields: [ objectType, changeType, active ],
        LineItem: [
            { $Type: 'UI.DataField', Value: ruleId,        Label: 'Rule ID' },
            { $Type: 'UI.DataField', Value: objectType,    Label: 'Object Type' },
            { $Type: 'UI.DataField', Value: fieldName,     Label: 'Field Name' },
            { $Type: 'UI.DataField', Value: changeType,    Label: 'Change Type' },
            { $Type: 'UI.DataField', Value: description,   Label: 'Description' },
            { $Type: 'UI.DataField', Value: active,        Label: 'Active' }
        ],
        HeaderInfo: {
            TypeName:       'Alert Rule',
            TypeNamePlural: 'Alert Rules',
            Title:          { $Type: 'UI.DataField', Value: description },
            Description:    { $Type: 'UI.DataField', Value: objectType }
        }
    }
);
