'use strict';

const { metrics, Counter, Histogram, Gauge, collectMetrics } = require('../util/telemetry');

describe('util/telemetry', () => {

    describe('Counter', () => {
        it('increments and collects Prometheus text', () => {
            const counter = new Counter('test_counter_1', 'A test counter');
            counter.inc({ type: 'a' });
            counter.inc({ type: 'a' });
            counter.inc({ type: 'b' }, 5);
            const output = counter.collect();
            expect(output).toContain('# TYPE test_counter_1 counter');
            expect(output).toContain('test_counter_1{type="a"} 2');
            expect(output).toContain('test_counter_1{type="b"} 5');
        });

        it('returns header lines even with no data', () => {
            const counter = new Counter('test_empty_c', 'Empty counter');
            const output = counter.collect();
            expect(output).toContain('# HELP test_empty_c');
        });
    });

    describe('Histogram', () => {
        it('records observations and produces bucket lines', () => {
            const hist = new Histogram('test_hist_1', 'A test histogram');
            hist.observe({ op: 'read' }, 50);
            hist.observe({ op: 'read' }, 150);
            const output = hist.collect();
            expect(output).toContain('# TYPE test_hist_1 histogram');
            expect(output).toContain('test_hist_1_count');
            expect(output).toContain('test_hist_1_sum');
        });

        it('provides a startTimer helper that records elapsed time', () => {
            const hist = new Histogram('test_hist_2', 'Timer histogram');
            const end = hist.startTimer({ op: 'write' });
            const elapsed = end();
            expect(typeof elapsed).toBe('number');
            expect(elapsed).toBeGreaterThanOrEqual(0);
            expect(hist.collect()).toContain('test_hist_2_count');
        });
    });

    describe('Gauge', () => {
        it('sets and overwrites values', () => {
            const gauge = new Gauge('test_gauge_1', 'A test gauge');
            gauge.set({ region: 'us' }, 42);
            expect(gauge.collect()).toContain('test_gauge_1{region="us"} 42');

            gauge.set({ region: 'us' }, 99);
            expect(gauge.collect()).toContain('99');
            // Should only have one entry for us
            expect(gauge.collect().match(/region="us"/g)).toHaveLength(1);
        });

        it('increments value', () => {
            const gauge = new Gauge('test_gauge_2', 'Inc gauge');
            gauge.inc({ k: 'v' });
            gauge.inc({ k: 'v' }, 4);
            expect(gauge.collect()).toContain('5');
        });
    });

    describe('Pre-defined metrics', () => {
        it('exports all expected metrics', () => {
            expect(metrics.eventsIngested).toBeInstanceOf(Counter);
            expect(metrics.pipelineLatency).toBeInstanceOf(Histogram);
            expect(metrics.alertTriggerCount).toBeInstanceOf(Counter);
            expect(metrics.chainVerificationFailures).toBeInstanceOf(Counter);
            expect(metrics.dbOperationLatency).toBeInstanceOf(Histogram);
            expect(metrics.alertDispatchLatency).toBeInstanceOf(Histogram);
            expect(metrics.failedEvents).toBeInstanceOf(Counter);
            expect(metrics.activeQueueSize).toBeInstanceOf(Gauge);
        });
    });

    describe('collectMetrics', () => {
        it('returns a string containing all metric sections', () => {
            const output = collectMetrics();
            expect(typeof output).toBe('string');
            expect(output).toContain('audit_events_ingested_total');
            expect(output).toContain('audit_pipeline_latency_ms');
        });
    });
});
