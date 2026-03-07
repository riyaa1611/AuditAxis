'use strict';

/**
 * Telemetry module – provides OpenTelemetry-compatible distributed tracing,
 * Prometheus-format metrics, and latency tracking for the AuditAxis pipeline.
 *
 * Exposes a lightweight metrics registry since full OTel collector may not
 * always be available in BTP CF. Metrics are served at GET /metrics.
 */

// ─── Metrics Registry ───

const _counters = new Map();
const _histograms = new Map();
const _gauges = new Map();

class Counter {
    constructor(name, help) {
        this.name = name;
        this.help = help;
        this._values = new Map(); // labelHash -> { labels, value }
    }

    inc(labels = {}, delta = 1) {
        const key = _labelKey(labels);
        const entry = this._values.get(key) || { labels, value: 0 };
        entry.value += delta;
        this._values.set(key, entry);
    }

    collect() {
        const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
        for (const { labels, value } of this._values.values()) {
            lines.push(`${this.name}${_labelStr(labels)} ${value}`);
        }
        return lines.join('\n');
    }
}

class Histogram {
    constructor(name, help, buckets = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000]) {
        this.name = name;
        this.help = help;
        this.buckets = buckets;
        this._observations = new Map(); // labelHash -> { labels, values[] }
    }

    observe(labels = {}, value) {
        const key = _labelKey(labels);
        const entry = this._observations.get(key) || { labels, values: [] };
        entry.values.push(value);
        this._observations.set(key, entry);
    }

    /** Convenience: returns a function that, when called, records elapsed ms. */
    startTimer(labels = {}) {
        const start = process.hrtime.bigint();
        return () => {
            const elapsed = Number(process.hrtime.bigint() - start) / 1e6; // ms
            this.observe(labels, elapsed);
            return elapsed;
        };
    }

    collect() {
        const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
        for (const { labels, values } of this._observations.values()) {
            const sorted = [...values].sort((a, b) => a - b);
            const sum = values.reduce((s, v) => s + v, 0);
            for (const b of this.buckets) {
                const count = sorted.filter(v => v <= b).length;
                lines.push(`${this.name}_bucket${_labelStr({ ...labels, le: b })} ${count}`);
            }
            lines.push(`${this.name}_bucket${_labelStr({ ...labels, le: '+Inf' })} ${values.length}`);
            lines.push(`${this.name}_sum${_labelStr(labels)} ${sum.toFixed(2)}`);
            lines.push(`${this.name}_count${_labelStr(labels)} ${values.length}`);
        }
        return lines.join('\n');
    }
}

class Gauge {
    constructor(name, help) {
        this.name = name;
        this.help = help;
        this._values = new Map();
    }

    set(labels = {}, value) {
        this._values.set(_labelKey(labels), { labels, value });
    }

    inc(labels = {}, delta = 1) {
        const key = _labelKey(labels);
        const entry = this._values.get(key) || { labels, value: 0 };
        entry.value += delta;
        this._values.set(key, entry);
    }

    collect() {
        const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} gauge`];
        for (const { labels, value } of this._values.values()) {
            lines.push(`${this.name}${_labelStr(labels)} ${value}`);
        }
        return lines.join('\n');
    }
}

// ─── Helpers ───

function _labelKey(labels) {
    return Object.keys(labels).sort().map(k => `${k}=${labels[k]}`).join(',');
}

function _labelStr(labels) {
    const entries = Object.entries(labels);
    if (entries.length === 0) return '';
    return '{' + entries.map(([k, v]) => `${k}="${v}"`).join(',') + '}';
}

// ─── Pre-defined Metrics ───

const metrics = {
    eventsIngested: new Counter(
        'audit_events_ingested_total',
        'Total number of audit events ingested'
    ),
    pipelineLatency: new Histogram(
        'audit_pipeline_latency_ms',
        'End-to-end event processing pipeline latency in milliseconds'
    ),
    alertTriggerCount: new Counter(
        'alert_trigger_count',
        'Total number of alerts triggered'
    ),
    chainVerificationFailures: new Counter(
        'chain_verification_failures',
        'Number of hash chain verification failures'
    ),
    eventMeshConsumerLag: new Gauge(
        'event_mesh_consumer_lag',
        'Estimated consumer lag from Event Mesh'
    ),
    dbOperationLatency: new Histogram(
        'db_operation_latency_ms',
        'Database operation latency in milliseconds'
    ),
    alertDispatchLatency: new Histogram(
        'alert_dispatch_latency_ms',
        'Alert webhook dispatch latency in milliseconds'
    ),
    failedEvents: new Counter(
        'failed_events_total',
        'Total number of events that failed processing'
    ),
    activeQueueSize: new Gauge(
        'ingestion_queue_size',
        'Current size of the ingestion processing queue'
    )
};

// Register all
for (const m of Object.values(metrics)) {
    const registry = m instanceof Counter ? _counters :
                     m instanceof Histogram ? _histograms : _gauges;
    registry.set(m.name, m);
}

/**
 * Collect all metrics in Prometheus text exposition format.
 */
function collectMetrics() {
    const sections = [];
    for (const c of _counters.values()) sections.push(c.collect());
    for (const h of _histograms.values()) sections.push(h.collect());
    for (const g of _gauges.values()) sections.push(g.collect());
    return sections.join('\n\n') + '\n';
}

/**
 * Express middleware that exposes GET /metrics.
 */
function metricsMiddleware(req, res, next) {
    if (req.path === '/metrics' && req.method === 'GET') {
        res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
        res.send(collectMetrics());
        return;
    }
    next();
}

module.exports = {
    metrics,
    Counter,
    Histogram,
    Gauge,
    collectMetrics,
    metricsMiddleware
};
