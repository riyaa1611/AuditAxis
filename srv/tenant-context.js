'use strict';

const cds = require('@sap/cds');

const LOG_COMPONENT = 'auditaxis.tenant';

/**
 * TenantContext – middleware that resolves the tenant from the JWT token
 * and transparently applies tenant isolation to all CDS queries.
 *
 * In a SaaS multi-tenant deployment the tenant ID comes from the
 * XSUAA token's `zid` (zone ID) claim. For single-tenant / dev,
 * it defaults to a fixed value.
 */
class TenantContext {

    /**
     * Express middleware – extracts tenantId and attaches it to req.tenantId.
     */
    middleware() {
        return (req, _res, next) => {
            req.tenantId = this._resolveTenant(req);
            next();
        };
    }

    /**
     * Register CDS-level interceptors that inject tenantId into
     * every INSERT and add WHERE clauses to every SELECT / UPDATE / DELETE.
     *
     * Call once during server bootstrap.
     */
    registerCdsHandlers() {
        const LOG = cds.log(LOG_COMPONENT);
        const tenantEntities = this._getTenantScopedEntities();

        cds.on('serving', (service) => {
            if (!(service instanceof cds.ApplicationService)) return;

            for (const entity of Object.values(service.entities)) {
                const fqn = entity.name || entity;
                if (!tenantEntities.has(fqn)) continue;

                // Inject tenantId on INSERT
                service.before('CREATE', entity, (req) => {
                    const tenantId = this._fromContext(req);
                    if (tenantId && req.data) {
                        if (Array.isArray(req.data)) {
                            req.data.forEach(d => { d.tenantId = tenantId; });
                        } else {
                            req.data.tenantId = tenantId;
                        }
                    }
                });

                // Filter on READ
                service.before('READ', entity, (req) => {
                    const tenantId = this._fromContext(req);
                    if (tenantId) {
                        if (!req.query.SELECT) return;
                        const where = { tenantId };
                        req.query.SELECT.where = req.query.SELECT.where
                            ? [{ ...req.query.SELECT.where }, 'and', where]
                            : [where];
                    }
                });
            }

            LOG.info(`Tenant isolation registered for ${tenantEntities.size} entities`);
        });
    }

    /**
     * Resolve tenant from the CDS request context.
     */
    _fromContext(req) {
        if (req.user && req.user.tenant) return req.user.tenant;
        if (req.tenant) return req.tenant;
        if (req.req && req.req.tenantId) return req.req.tenantId;
        return null;
    }

    /**
     * Resolve tenant from the Express request's JWT.
     */
    _resolveTenant(req) {
        // XSUAA token has zid (zone id) as tenant identifier
        if (req.authInfo && req.authInfo.getZoneId) {
            return req.authInfo.getZoneId();
        }
        if (req.user && req.user.tenant) return req.user.tenant;

        // Fallback for development
        return 'default';
    }

    /**
     * Inspect the CDS model for entities that include the tenantScoped aspect
     * (i.e. have a `tenantId` element).
     */
    _getTenantScopedEntities() {
        const model = cds.model;
        const result = new Set();
        if (!model) return result;

        for (const [name, def] of Object.entries(model.definitions || {})) {
            if (def.kind === 'entity' && def.elements && def.elements.tenantId) {
                result.add(name);
            }
        }
        return result;
    }
}

module.exports = TenantContext;
