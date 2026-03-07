'use strict';

const cds = require('@sap/cds');

const LOG_COMPONENT = 'auditaxis.ratelimit';

/**
 * Rate-limiting middleware using a sliding-window counter per user.
 * Stores counters in memory (suitable for single-instance; use Redis
 * for multi-instance deployments).
 *
 * Default: 100 requests/min per user.
 * Report generation and other heavy endpoints get stricter limits.
 */
class RateLimiter {

    /**
     * @param {{ windowMs?: number, maxRequests?: number, strictPaths?: Object.<string,number> }} opts
     */
    constructor(opts = {}) {
        this.windowMs = opts.windowMs || 60000;       // 1 min
        this.maxRequests = opts.maxRequests || 100;
        this.strictPaths = opts.strictPaths || {
            '/api/audit/generateReport': 10,
            '/api/audit/verifyChain': 20
        };

        /** @type {Map<string, { count: number, resetAt: number }>} */
        this._windows = new Map();

        // Periodic cleanup every 2 minutes
        this._cleanupInterval = setInterval(() => this._cleanup(), 120000);
        if (this._cleanupInterval.unref) this._cleanupInterval.unref();
    }

    /**
     * Express middleware function.
     */
    middleware() {
        return (req, res, next) => {
            const userId = this._extractUserId(req);
            if (!userId) return next(); // unauthenticated requests handled by XSUAA

            const limit = this._resolveLimit(req.path);
            const key = `${userId}::${req.path}`;
            const now = Date.now();

            let window = this._windows.get(key);
            if (!window || now > window.resetAt) {
                window = { count: 0, resetAt: now + this.windowMs };
                this._windows.set(key, window);
            }

            window.count++;

            // Set standard rate-limit headers
            res.set('X-RateLimit-Limit', String(limit));
            res.set('X-RateLimit-Remaining', String(Math.max(0, limit - window.count)));
            res.set('X-RateLimit-Reset', String(Math.ceil(window.resetAt / 1000)));

            if (window.count > limit) {
                const LOG = cds.log(LOG_COMPONENT);
                LOG.warn(`Rate limit exceeded for user ${userId} on ${req.path}`);
                res.status(429).json({
                    error: {
                        code: '429',
                        message: 'Too many requests. Please try again later.'
                    }
                });
                return;
            }

            next();
        };
    }

    /**
     * Resolve the applicable limit for a given path.
     */
    _resolveLimit(path) {
        for (const [pattern, limit] of Object.entries(this.strictPaths)) {
            if (path.includes(pattern)) return limit;
        }
        return this.maxRequests;
    }

    /**
     * Extract user ID from the request (XSUAA JWT or mocked auth).
     */
    _extractUserId(req) {
        if (req.user && req.user.id) return req.user.id;
        if (req.authInfo && req.authInfo.getEmail) return req.authInfo.getEmail();
        return null;
    }

    /**
     * Remove expired windows.
     */
    _cleanup() {
        const now = Date.now();
        for (const [key, window] of this._windows) {
            if (now > window.resetAt) this._windows.delete(key);
        }
    }

    destroy() {
        clearInterval(this._cleanupInterval);
    }
}

module.exports = RateLimiter;
