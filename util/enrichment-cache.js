'use strict';

/**
 * EnrichmentCache – simple in-memory TTL cache used by the EnrichmentService
 * to reduce redundant calls to S/4HANA user APIs.
 *
 * Not suitable for multi-instance deployments; consider Redis in that case.
 */
class EnrichmentCache {

    /**
     * @param {{ ttlMs?: number, maxSize?: number }} opts
     */
    constructor(opts = {}) {
        this._ttlMs = opts.ttlMs || 5 * 60 * 1000;   // default 5 min
        this._maxSize = opts.maxSize || 10000;
        /** @type {Map<string, { value: any, expiresAt: number }>} */
        this._store = new Map();
    }

    /**
     * Retrieve a cached value, or undefined if absent / expired.
     */
    get(key) {
        const entry = this._store.get(key);
        if (!entry) return undefined;

        if (Date.now() > entry.expiresAt) {
            this._store.delete(key);
            return undefined;
        }
        return entry.value;
    }

    /**
     * Store a value with the configured TTL.
     */
    set(key, value) {
        // Evict oldest entries when full (simple FIFO)
        if (this._store.size >= this._maxSize) {
            const oldest = this._store.keys().next().value;
            this._store.delete(oldest);
        }
        this._store.set(key, {
            value,
            expiresAt: Date.now() + this._ttlMs
        });
    }

    /**
     * Remove a specific key.
     */
    delete(key) {
        this._store.delete(key);
    }

    /**
     * Clear all entries.
     */
    clear() {
        this._store.clear();
    }

    /**
     * Current number of entries (including possibly expired ones).
     */
    get size() {
        return this._store.size;
    }
}

module.exports = EnrichmentCache;
