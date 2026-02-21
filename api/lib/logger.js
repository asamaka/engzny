/**
 * Production Logger
 *
 * Structured logging for Vercel serverless with full observability:
 * - In-memory ring buffer (persists within warm container)
 * - Pipeline lifecycle tracing (skeleton → design → research → complete)
 * - HTTP request logging (method, path, status, duration)
 * - Client telemetry collection (what the user saw, timing, errors)
 * - Queryable via /api/debug/* endpoints
 */

const MAX_ENTRIES = 1000;
const MAX_ERRORS = 200;
const MAX_REQUESTS = 200;
const MAX_CLIENT_SESSIONS = 100;

class ProdLogger {
  constructor() {
    this.entries = [];
    this.errors = [];
    this.pipelines = new Map();
    this.requests = [];          // HTTP request log
    this.clientSessions = [];    // Full client telemetry reports
    this.startTime = Date.now();
    this.counters = { requests: 0, pipelines: 0, pipelineErrors: 0, clientErrors: 0, sseDisconnects: 0 };
  }

  _log(level, category, message, meta = {}) {
    const entry = {
      ts: new Date().toISOString(),
      level,
      cat: category,
      msg: message,
      ...meta,
    };

    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries.shift();

    if (level === 'error') {
      this.errors.push(entry);
      if (this.errors.length > MAX_ERRORS) this.errors.shift();
    }

    const logFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    logFn(`[${category}] ${message}`, meta.err ? `| ${meta.err}` : '', meta.dur ? `| ${meta.dur}ms` : '');
  }

  info(category, message, meta) { this._log('info', category, message, meta); }
  warn(category, message, meta) { this._log('warn', category, message, meta); }
  error(category, message, meta) { this._log('error', category, message, meta); }

  // ── HTTP Request Logging ──────────────────────────────────────
  logRequest({ method, path, status, duration, userAgent, ip, requestId, error }) {
    this.counters.requests++;
    const entry = {
      ts: new Date().toISOString(),
      method,
      path,
      status,
      dur: duration,
      ua: userAgent,
      ip,
      requestId: requestId || null,
      error: error || null,
    };
    this.requests.push(entry);
    if (this.requests.length > MAX_REQUESTS) this.requests.shift();
  }

  // ── Pipeline Tracking ─────────────────────────────────────────
  startPipeline(requestId, meta = {}) {
    this.counters.pipelines++;
    const trace = {
      requestId,
      startedAt: new Date().toISOString(),
      startMs: Date.now(),
      phases: [],
      events: [],
      error: null,
      completed: false,
      clientReport: null,
      ...meta,
    };
    this.pipelines.set(requestId, trace);
    if (this.pipelines.size > 50) {
      const oldest = this.pipelines.keys().next().value;
      this.pipelines.delete(oldest);
    }
    this.info('Pipeline', `Started ${requestId}`, { requestId, ...meta });
    return trace;
  }

  pipelinePhase(requestId, phase, meta = {}) {
    const trace = this.pipelines.get(requestId);
    if (trace) {
      const elapsed = Date.now() - trace.startMs;
      trace.phases.push({ phase, elapsed, ts: new Date().toISOString(), ...meta });
    }
    this.info('Pipeline', `${requestId} → ${phase}`, { requestId, ...meta });
  }

  pipelineEvent(requestId, event, meta = {}) {
    const trace = this.pipelines.get(requestId);
    if (trace) {
      const elapsed = Date.now() - trace.startMs;
      trace.events.push({ event, elapsed, ts: new Date().toISOString(), ...meta });
    }
  }

  pipelineComplete(requestId, meta = {}) {
    const trace = this.pipelines.get(requestId);
    if (trace) {
      trace.completed = true;
      trace.duration = Date.now() - trace.startMs;
      trace.completedAt = new Date().toISOString();
      Object.assign(trace, meta);
    }
    this.info('Pipeline', `Completed ${requestId}`, { requestId, dur: trace?.duration, ...meta });
  }

  pipelineError(requestId, error, meta = {}) {
    this.counters.pipelineErrors++;
    const trace = this.pipelines.get(requestId);
    if (trace) {
      trace.error = {
        message: error.message,
        stack: error.stack?.split('\n').slice(0, 5).join('\n'),
        ...meta,
      };
      trace.duration = Date.now() - trace.startMs;
      trace.failedAt = new Date().toISOString();
    }
    this.error('Pipeline', `Failed ${requestId}: ${error.message}`, {
      requestId,
      err: error.message,
      dur: trace?.duration,
      ...meta,
    });
  }

  // ── Client Telemetry ──────────────────────────────────────────
  clientError(errorData) {
    this.counters.clientErrors++;
    this._log('error', 'Client', errorData.message || 'Unknown client error', {
      userAgent: errorData.userAgent,
      url: errorData.url,
      requestId: errorData.requestId,
      state: errorData.state,
      streamEvents: errorData.streamEvents,
      elapsed: errorData.elapsed,
      type: errorData.type,
    });
  }

  /**
   * Record a full client session report (sent on success AND failure).
   * Correlates with server-side pipeline trace via requestId.
   */
  clientReport(report) {
    const entry = {
      ts: new Date().toISOString(),
      ...report,
    };
    this.clientSessions.push(entry);
    if (this.clientSessions.length > MAX_CLIENT_SESSIONS) this.clientSessions.shift();

    // Attach to pipeline trace if we have a matching requestId
    if (report.requestId) {
      const trace = this.pipelines.get(report.requestId);
      if (trace) {
        trace.clientReport = entry;
      }
    }

    const outcome = report.outcome || 'unknown';
    const dur = report.totalDuration ? `${Math.round(report.totalDuration / 1000)}s` : '?';
    this.info('ClientReport', `${report.requestId || '?'} ${outcome} (${dur})`, {
      requestId: report.requestId,
      outcome,
      dur: report.totalDuration,
    });
  }

  sseDisconnect(requestId) {
    this.counters.sseDisconnects++;
    this.warn('SSE', 'Client disconnected', { requestId });
  }

  // ── Queries ───────────────────────────────────────────────────
  query({ level, category, limit = 50, since } = {}) {
    let results = [...this.entries];
    if (level) results = results.filter(e => e.level === level);
    if (category) results = results.filter(e => e.cat === category);
    if (since) {
      const sinceDate = new Date(since);
      results = results.filter(e => new Date(e.ts) >= sinceDate);
    }
    return results.slice(-limit);
  }

  getSummary() {
    const now = Date.now();
    const recentPipelines = [...this.pipelines.values()]
      .sort((a, b) => (b.startMs || 0) - (a.startMs || 0))
      .slice(0, 20);

    const failedPipelines = recentPipelines.filter(p => p.error);
    const completedPipelines = recentPipelines.filter(p => p.completed);
    const avgDuration = completedPipelines.length
      ? Math.round(completedPipelines.reduce((s, p) => s + (p.duration || 0), 0) / completedPipelines.length)
      : null;

    return {
      uptime: Math.round((now - this.startTime) / 1000),
      uptimeHuman: formatDuration(now - this.startTime),
      totalLogs: this.entries.length,
      totalErrors: this.errors.length,
      counters: this.counters,
      recentErrors: this.errors.slice(-10),
      pipelineStats: {
        total: this.pipelines.size,
        completed: completedPipelines.length,
        failed: failedPipelines.length,
        avgDurationMs: avgDuration,
      },
      recentPipelines: recentPipelines.map(p => ({
        requestId: p.requestId,
        startedAt: p.startedAt,
        completed: p.completed,
        duration: p.duration,
        error: p.error?.message || null,
        phases: p.phases,
        eventCount: p.events?.length || 0,
        imageSize: p.imageSize,
        mediaType: p.mediaType,
        method: p.method,
        clientReport: p.clientReport ? {
          outcome: p.clientReport.outcome,
          totalDuration: p.clientReport.totalDuration,
          uploadDuration: p.clientReport.uploadDuration,
          firstEventDelay: p.clientReport.firstEventDelay,
          eventsReceived: p.clientReport.eventsReceived?.length,
          retries: p.clientReport.retries,
          userAgent: p.clientReport.userAgent,
        } : null,
      })),
      recentLogs: this.entries.slice(-30),
    };
  }

  /**
   * At-a-glance dashboard: designed for quick curl/browser check.
   */
  getDashboard() {
    const now = Date.now();
    const pipelines = [...this.pipelines.values()].sort((a, b) => (b.startMs || 0) - (a.startMs || 0));
    const recent5 = pipelines.slice(0, 5);
    const recentClient5 = this.clientSessions.slice(-5).reverse();

    const completedPipelines = pipelines.filter(p => p.completed);
    const failedPipelines = pipelines.filter(p => p.error);
    const avgDesignTime = completedPipelines.length
      ? Math.round(completedPipelines.reduce((s, p) => {
          const designPhase = p.phases?.find(ph => ph.phase === 'blueprint');
          return s + (designPhase?.elapsed || 0);
        }, 0) / completedPipelines.length)
      : null;

    // Detect stuck pipelines (started > 60s ago, not completed, no error)
    const stuckPipelines = pipelines.filter(p => !p.completed && !p.error && (now - p.startMs > 60000));

    // Client success rate from session reports
    const successReports = this.clientSessions.filter(r => r.outcome === 'success');
    const failedReports = this.clientSessions.filter(r => r.outcome !== 'success');

    return {
      status: stuckPipelines.length > 0 ? 'DEGRADED' : failedPipelines.length > 0 ? 'WARNINGS' : 'HEALTHY',
      uptime: formatDuration(now - this.startTime),
      counters: this.counters,

      serverSide: {
        recentPipelines: recent5.map(p => ({
          id: p.requestId,
          status: p.completed ? 'done' : p.error ? 'FAILED' : 'running',
          age: formatDuration(now - p.startMs),
          duration: p.duration ? `${(p.duration / 1000).toFixed(1)}s` : null,
          designTime: (() => { const bp = p.phases?.find(ph => ph.phase === 'blueprint'); return bp ? `${(bp.elapsed / 1000).toFixed(1)}s` : null; })(),
          cards: (() => { const cardEvents = p.events?.filter(e => e.event === 'card') || []; return `${cardEvents.length}/${p.cardCount || '?'}`; })(),
          error: p.error?.message || null,
          method: p.method || 'POST',
          imageSize: p.imageSize,
        })),
        avgDesignTime: avgDesignTime ? `${(avgDesignTime / 1000).toFixed(1)}s` : null,
        stuckCount: stuckPipelines.length,
      },

      clientSide: {
        totalReports: this.clientSessions.length,
        successCount: successReports.length,
        failedCount: failedReports.length,
        recentSessions: recentClient5.map(r => ({
          requestId: r.requestId,
          outcome: r.outcome,
          totalDuration: r.totalDuration ? `${(r.totalDuration / 1000).toFixed(1)}s` : null,
          uploadTime: r.uploadDuration ? `${(r.uploadDuration / 1000).toFixed(1)}s` : null,
          firstEvent: r.firstEventDelay ? `${(r.firstEventDelay / 1000).toFixed(1)}s` : null,
          eventsReceived: r.eventsReceived?.length || 0,
          retries: r.retries || 0,
          error: r.error || null,
          ua: r.userAgent ? (r.userAgent.includes('Mobile') ? 'mobile' : 'desktop') : '?',
          age: r.ts ? formatDuration(now - new Date(r.ts).getTime()) : '?',
        })),
        recentErrors: this.errors
          .filter(e => e.cat === 'Client')
          .slice(-5)
          .reverse()
          .map(e => ({ msg: e.msg, requestId: e.requestId, age: formatDuration(now - new Date(e.ts).getTime()) })),
      },

      recentRequests: this.requests.slice(-10).reverse().map(r => ({
        method: r.method,
        path: r.path,
        status: r.status,
        dur: r.dur ? `${r.dur}ms` : null,
        age: formatDuration(now - new Date(r.ts).getTime()),
      })),
    };
  }
}

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

const logger = new ProdLogger();

module.exports = { logger };
