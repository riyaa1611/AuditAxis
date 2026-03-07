/** @type {import('jest').Config} */
module.exports = {
    testEnvironment: 'node',
    testMatch: ['**/test/**/*.test.js'],
    collectCoverageFrom: [
        'util/**/*.js',
        'srv/**/*.js',
        '!srv/enrichment-service.js'
    ],
    coverageThreshold: {
        global: { branches: 60, functions: 70, lines: 70, statements: 70 }
    }
};
