'use strict';

const cds = require('@sap/cds');
const EnrichmentCache = require('../util/enrichment-cache');

const LOG_COMPONENT = 'auditaxis.enrichment';

/**
 * EnrichmentService – augments raw audit events with organisational context
 * by looking up user information from a connected S/4HANA system or
 * a local user-info cache.
 *
 * Caching is used aggressively to avoid repeated calls to the back-end.
 */
class EnrichmentService {

    constructor() {
        this.cache = new EnrichmentCache({ ttlMs: 5 * 60 * 1000 }); // 5 min TTL
    }

    /**
     * Enrich a raw event payload with user fullname, roles and org context.
     * Returns a new object (original is not mutated).
     */
    async enrich(event) {
        const LOG = cds.log(LOG_COMPONENT);
        const enriched = { ...event };

        try {
            const userInfo = await this._resolveUser(event.userId);
            enriched.userName = userInfo.fullName || event.userId;
            enriched.userRoles = userInfo.roles || [];
            enriched.orgUnit = userInfo.orgUnit || '';
        } catch (err) {
            LOG.warn(`User enrichment failed for ${event.userId}: ${err.message}`);
            enriched.userName = event.userId;
            enriched.userRoles = [];
            enriched.orgUnit = '';
        }

        return enriched;
    }

    /**
     * Resolve user info – cache-first, then remote lookup.
     */
    async _resolveUser(userId) {
        if (!userId) return { fullName: 'UNKNOWN', roles: [], orgUnit: '' };

        const cached = this.cache.get(`user:${userId}`);
        if (cached) return cached;

        const userInfo = await this._fetchUserFromRemote(userId);
        this.cache.set(`user:${userId}`, userInfo);
        return userInfo;
    }

    /**
     * Fetch user info from connected S/4HANA or IDP.
     * In production this would call the S/4 Business Partner API or SCIM endpoint.
     * Falls back to a minimal record when the remote service is unavailable.
     */
    async _fetchUserFromRemote(userId) {
        const LOG = cds.log(LOG_COMPONENT);
        try {
            // Attempt to use a configured external service binding
            const userSrv = await cds.connect.to('S4_USER_API').catch(() => null);
            if (userSrv) {
                const result = await userSrv.get(`/Users('${encodeURIComponent(userId)}')`);
                if (result) {
                    return {
                        fullName: result.FullName || result.PersonFullName || userId,
                        roles: result.Roles || [],
                        orgUnit: result.OrganizationalUnit || ''
                    };
                }
            }
        } catch (err) {
            LOG.warn(`Remote user lookup failed for ${userId}: ${err.message}`);
        }

        // Fallback – return minimal record
        return { fullName: userId, roles: [], orgUnit: '' };
    }
}

module.exports = EnrichmentService;
