'use strict';

const RateLimiter = require('../util/rate-limit');

describe('util/rate-limit – RateLimiter', () => {

    let limiter;

    afterEach(() => {
        if (limiter) limiter.destroy();
    });

    it('creates a middleware function', () => {
        limiter = new RateLimiter();
        const mw = limiter.middleware();
        expect(typeof mw).toBe('function');
    });

    it('allows requests under the limit', () => {
        limiter = new RateLimiter({ maxRequests: 3, windowMs: 60000 });
        const mw = limiter.middleware();

        const mockReq = { user: { id: 'user1' }, path: '/api/test' };
        const mockRes = { set: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() };
        const next = jest.fn();

        mw(mockReq, mockRes, next);
        expect(next).toHaveBeenCalledTimes(1);
        expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('rejects requests over the limit with 429', () => {
        limiter = new RateLimiter({ maxRequests: 2, windowMs: 60000 });
        const mw = limiter.middleware();

        const mockReq = { user: { id: 'user1' }, path: '/api/test' };
        const mockRes = { set: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() };
        const next = jest.fn();

        mw(mockReq, mockRes, next);
        mw(mockReq, mockRes, next);
        mw(mockReq, mockRes, next); // should be rejected
        expect(mockRes.status).toHaveBeenCalledWith(429);
    });

    it('sets rate-limit headers', () => {
        limiter = new RateLimiter({ maxRequests: 10, windowMs: 60000 });
        const mw = limiter.middleware();

        const mockReq = { user: { id: 'user1' }, path: '/api/test' };
        const headers = {};
        const mockRes = {
            set: jest.fn((k, v) => { headers[k] = v; }),
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
        };
        const next = jest.fn();

        mw(mockReq, mockRes, next);
        expect(headers['X-RateLimit-Limit']).toBe('10');
        expect(headers['X-RateLimit-Remaining']).toBe('9');
    });

    it('tracks separate limits per user', () => {
        limiter = new RateLimiter({ maxRequests: 1, windowMs: 60000 });
        const mw = limiter.middleware();

        const next = jest.fn();
        const res = { set: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() };

        mw({ user: { id: 'a' }, path: '/test' }, res, next);
        mw({ user: { id: 'b' }, path: '/test' }, res, next);
        // Both should succeed (different users)
        expect(next).toHaveBeenCalledTimes(2);
    });

    it('applies strict limits for configured paths', () => {
        limiter = new RateLimiter({ maxRequests: 100, strictPaths: { '/heavy': 1 } });
        const mw = limiter.middleware();

        const res = { set: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() };
        const next = jest.fn();

        mw({ user: { id: 'u1' }, path: '/heavy' }, res, next);
        mw({ user: { id: 'u1' }, path: '/heavy' }, res, next);
        expect(res.status).toHaveBeenCalledWith(429);
    });

    it('skips rate limiting for unauthenticated requests', () => {
        limiter = new RateLimiter({ maxRequests: 1 });
        const mw = limiter.middleware();

        const res = { set: jest.fn() };
        const next = jest.fn();

        mw({ path: '/test' }, res, next);
        mw({ path: '/test' }, res, next);
        // Both pass because no user
        expect(next).toHaveBeenCalledTimes(2);
    });
});
