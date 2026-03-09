/** @type {import('jest').Config} */
module.exports = {
    testEnvironment: 'node',
    testMatch: ['**/test/**/*.test.js'],
    collectCoverageFrom: [
        'util/**/*.js',
        'srv/**/*.js',
        '!srv/enrichment-service.js'
    ]
};
