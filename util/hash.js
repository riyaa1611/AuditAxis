'use strict';

const crypto = require('crypto');

/**
 * Compute a SHA-256 hex digest of the given input string.
 *
 * @param {string} input – plaintext input
 * @returns {string} 64-char lowercase hex hash
 */
function computeSHA256(input) {
    return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

module.exports = { computeSHA256 };
