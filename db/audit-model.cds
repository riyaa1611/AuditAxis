/**
 * Reusable types and aspects for the audit domain.
 */
namespace auditaxis.db;

// ---------- Reusable Types ----------

type ChangeType : String(16) enum {
    CREATE;
    UPDATE;
    DELETE;
}

type AlertStatus : String(32) enum {
    NEW;
    SENT;
    FAILED;
    ACKNOWLEDGED;
}

// ---------- Aspects ----------

/**
 * Aspect applied to entities that must never be mutated after creation.
 */
aspect immutable {
    @readonly createdAt  : Timestamp @cds.on.insert: $now;
    @readonly createdBy  : String(256) @cds.on.insert: $user;
}
