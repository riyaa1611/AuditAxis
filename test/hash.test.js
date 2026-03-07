'use strict';

const { computeSHA256 } = require('../util/hash');

describe('util/hash – computeSHA256', () => {

    it('returns a 64-char lowercase hex string', () => {
        const result = computeSHA256('hello');
        expect(result).toHaveLength(64);
        expect(result).toMatch(/^[a-f0-9]{64}$/);
    });

    it('produces correct SHA-256 for known input', () => {
        // echo -n "hello" | sha256sum
        expect(computeSHA256('hello'))
            .toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    });

    it('is deterministic', () => {
        const a = computeSHA256('test-input');
        const b = computeSHA256('test-input');
        expect(a).toBe(b);
    });

    it('differs for different inputs', () => {
        const a = computeSHA256('input-a');
        const b = computeSHA256('input-b');
        expect(a).not.toBe(b);
    });

    it('handles empty string', () => {
        const result = computeSHA256('');
        expect(result).toHaveLength(64);
        // SHA-256 of empty string
        expect(result).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });

    it('handles unicode input', () => {
        const result = computeSHA256('日本語テスト');
        expect(result).toHaveLength(64);
    });
});
