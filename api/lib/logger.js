/**
 * Production Logger
 *
 * Lightweight structured logging for Vercel serverless.
 * - In-memory ring buffer (survives within a single function invocation / warm container)
 * - Structured JSON entries with timestamps, levels, context
 * - Queryable via /api/debug/logs endpoint
 * - Auto-captures pipeline lifecycle events for retroactive debugging
 *
 * Note: Vercel serverless functions share memory within warm containers,
 * so logs persist across requests within the same container lifecycle.
 * For cold starts, logs begin fresh. This is acceptable for debugging
 * recent failures - the failure and its context will be in the same container.
 */

const MAX_ENTRIES = 500;
const MAX_ERRORS = 100;

class ProdLogger {
  constructor() {
    this.entries = [];
    this.errors = [];
    this.pipelines = new Map(); // requestId -> pipeline trace
    this.startTime = Date.now();
  }

  /**
   * Core log method
   */
  _log(level, category, message, meta = {}) {
    const entry = {
      ts: new Date().toISOString(),
      level,
      cat: category,
      msg: message,
      ...meta,
    };

    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.shift();
    }

    if (level === 'error') {
      this.errors.push(entry);
      if (this.errors.length > MAX_ERRORS) {
        this.errors.shift();
      }
    }

    // Also write to stdout for Vercel's built-in log drain
    const logFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    logFn(`[${category}] ${message}`, meta.err ? `| ${meta.err}` : '', meta.dur ? `| ${meta.dur}ms` : '');
  }

  info(category, message, meta) { this._log('info', category, message, meta); }
  warn(category, message, meta) { this._log('warn', category, message, meta); }
  error(category, message, meta) { this._log('error', category, message, meta); }

  /**
   * Start tracking a pipeline request
   */
  startPipeline(requestId, meta = {}) {
    const trace = {
      requestId,
      startedAt: new Date().toISOString(),
      startMs: Date.now(),
      phases: [],
      events: [],
      error: null,
      completed: false,
      ...meta,
    };
    this.pipelines.set(requestId, trace);

    // Limit stored pipelines
    if (this.pipelines.size > 50) {
      const oldest = this.pipelines.keys().next().value;
      this.pipelines.delete(oldest);
    }

    this.info('Pipeline', `Started ${requestId}`, { requestId, ...meta });
    return trace;
  }

  /**
   * Record a pipeline phase (designing, researching, etc.)
   */
  pipelinePhase(requestId, phase, meta = {}) {
    const trace = this.pipelines.get(requestId);
    if (trace) {
      const elapsed = Date.now() - trace.startMs;
      trace.phases.push({ phase, elapsed, ts: new Date().toISOString(), ...meta });
    }
    this.info('Pipeline', `${requestId} → ${phase}`, { requestId, ...meta });
  }

  /**
   * Record a pipeline event (blueprint sent, card populated, etc.)
   */
  pipelineEvent(requestId, event, meta = {}) {
    const trace = this.pipelines.get(requestId);
    if (trace) {
      const elapsed = Date.now() - trace.startMs;
      trace.events.push({ event, elapsed, ts: new Date().toISOString(), ...meta });
    }
  }

  /**
   * Record pipeline completion
   */
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

  /**
   * Record pipeline error
   */
  pipelineError(requestId, error, meta = {}) {
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

  /**
   * Record a client-reported error
   */
  clientError(errorData) {
    this._log('error', 'Client', errorData.message || 'Unknown client error', {
      userAgent: errorData.userAgent,
      url: errorData.url,
      state: errorData.state,
      streamEvents: errorData.streamEvents,
      elapsed: errorData.elapsed,
    });
  }

  /**
   * Get recent logs with optional filters
   */
  query({ level, category, limit = 50, since } = {}) {
    let results = [...this.entries];

    if (level) {
      results = results.filter(e => e.level === level);
    }
    if (category) {
      results = results.filter(e => e.cat === category);
    }
    if (since) {
      const sinceDate = new Date(since);
      results = results.filter(e => new Date(e.ts) >= sinceDate);
    }

    return results.slice(-limit);
  }

  /**
   * Get full summary for the debug endpoint
   */
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
      })),
      recentLogs: this.entries.slice(-30),
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

// Singleton instance - persists across requests in warm Vercel containers
const logger = new ProdLogger();

module.exports = { logger };
