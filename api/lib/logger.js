/**
 * Production Logger with Persistent Storage
 *
 * Two-tier observability for Vercel serverless:
 *
 * Tier 1 — In-memory ring buffer (fast, current instance only)
 * Tier 2 — Redis persistence via Upstash (survives cold starts, shared across instances)
 *
 * When Redis is configured, critical data (pipeline traces, client sessions, errors,
 * counters) is persisted and available across all function instances and cold starts.
 * In-memory buffers still serve as fast cache for the current warm instance.
 */

const MAX_ENTRIES = 1000;
const MAX_ERRORS = 200;
const MAX_REQUESTS = 200;
const MAX_CLIENT_SESSIONS = 100;

const REDIS_KEYS = {
  PIPELINES: 'thinx:logs:pipelines',
  SESSIONS: 'thinx:logs:sessions',
  ERRORS: 'thinx:logs:errors',
  REQUESTS: 'thinx:logs:requests',
  COUNTERS: 'thinx:logs:counters',
  ACTIVITY: 'thinx:logs:activity',
};

const REDIS_LIMITS = {
  PIPELINES: 100,
  SESSIONS: 200,
  ERRORS: 200,
  REQUESTS: 500,
  ACTIVITY: 1000,
};

class ProdLogger {
  constructor() {
    this.entries = [];
    this.errors = [];
    this.pipelines = new Map();
    this.requests = [];
    this.clientSessions = [];
    this.activityLog = [];
    this.startTime = Date.now();
    this.counters = { requests: 0, pipelines: 0, pipelineErrors: 0, clientErrors: 0, sseDisconnects: 0 };
    this._redis = null;
    this._redisReady = false;
  }

  /**
   * Initialize Redis persistence. Call once at startup when Redis is available.
   */
  async initRedis(redisClient) {
    if (!redisClient) return;
    this._redis = redisClient;
    try {
      await redisClient.ping();
      this._redisReady = true;
      this._log('info', 'Logger', 'Redis persistence initialized');
    } catch (err) {
      this._redisReady = false;
      console.warn('[Logger] Redis init failed, falling back to in-memory only:', err.message);
    }
  }

  get hasRedis() {
    return !!(this._redisReady && this._redis);
  }

  // ── Fire-and-forget Redis writes ──────────────────────────────

  _persistToRedis(key, entry, limit) {
    if (!this.hasRedis) return;
    const serialized = JSON.stringify(entry);
    this._redis.pipeline()
      .lpush(key, serialized)
      .ltrim(key, 0, limit - 1)
      .exec()
      .catch(err => console.warn('[Logger] Redis write error:', err.message));
  }

  _incrementCounter(field, amount = 1) {
    if (!this.hasRedis) return;
    this._redis.hincrby(REDIS_KEYS.COUNTERS, field, amount)
      .catch(err => console.warn('[Logger] Redis counter error:', err.message));
  }

  // ── Core Logging ──────────────────────────────────────────────

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
      this._persistToRedis(REDIS_KEYS.ERRORS, entry, REDIS_LIMITS.ERRORS);
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
    this._incrementCounter('requests');
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

    this._persistToRedis(REDIS_KEYS.REQUESTS, entry, REDIS_LIMITS.REQUESTS);
  }

  // ── Activity Log (high-level events for usage tracking) ───────

  logActivity(action, details = {}) {
    const entry = {
      ts: new Date().toISOString(),
      action,
      ...details,
    };
    this.activityLog.push(entry);
    if (this.activityLog.length > MAX_ENTRIES) this.activityLog.shift();
    this._persistToRedis(REDIS_KEYS.ACTIVITY, entry, REDIS_LIMITS.ACTIVITY);
    this.info('Activity', action, details);
  }

  // ── Pipeline Tracking ─────────────────────────────────────────

  startPipeline(requestId, meta = {}) {
    this.counters.pipelines++;
    this._incrementCounter('pipelines');
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
    this.logActivity('pipeline_started', { requestId, ...meta });
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
      this._persistPipeline(trace);
    }
    this.logActivity('pipeline_completed', {
      requestId,
      duration: trace?.duration,
      cardCount: meta.cardCount,
      layoutType: meta.layoutType,
    });
  }

  pipelineError(requestId, error, meta = {}) {
    this.counters.pipelineErrors++;
    this._incrementCounter('pipelineErrors');
    const trace = this.pipelines.get(requestId);
    if (trace) {
      trace.error = {
        message: error.message,
        stack: error.stack?.split('\n').slice(0, 5).join('\n'),
        ...meta,
      };
      trace.duration = Date.now() - trace.startMs;
      trace.failedAt = new Date().toISOString();
      this._persistPipeline(trace);
    }
    this.error('Pipeline', `Failed ${requestId}: ${error.message}`, {
      requestId,
      err: error.message,
      dur: trace?.duration,
      ...meta,
    });
    this.logActivity('pipeline_failed', { requestId, error: error.message, duration: trace?.duration });
  }

  _persistPipeline(trace) {
    if (!this.hasRedis) return;
    const serializable = { ...trace };
    delete serializable.startMs;
    if (serializable.clientReport) {
      delete serializable.clientReport.eventsReceived;
    }
    this._persistToRedis(REDIS_KEYS.PIPELINES, serializable, REDIS_LIMITS.PIPELINES);
  }

  // ── Client Telemetry ──────────────────────────────────────────

  clientError(errorData) {
    this.counters.clientErrors++;
    this._incrementCounter('clientErrors');
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

  clientReport(report) {
    const entry = {
      ts: new Date().toISOString(),
      ...report,
    };
    this.clientSessions.push(entry);
    if (this.clientSessions.length > MAX_CLIENT_SESSIONS) this.clientSessions.shift();

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

    const sessionEntry = { ...entry };
    delete sessionEntry.eventsReceived;
    this._persistToRedis(REDIS_KEYS.SESSIONS, sessionEntry, REDIS_LIMITS.SESSIONS);
  }

  sseDisconnect(requestId) {
    this.counters.sseDisconnects++;
    this._incrementCounter('sseDisconnects');
    this.warn('SSE', 'Client disconnected', { requestId });
  }

  // ── Persistent Reads (Redis) ──────────────────────────────────

  async getPersistedCounters() {
    if (!this.hasRedis) return null;
    try {
      const raw = await this._redis.hgetall(REDIS_KEYS.COUNTERS);
      if (!raw || Object.keys(raw).length === 0) return null;
      return {
        requests: parseInt(raw.requests || '0', 10),
        pipelines: parseInt(raw.pipelines || '0', 10),
        pipelineErrors: parseInt(raw.pipelineErrors || '0', 10),
        clientErrors: parseInt(raw.clientErrors || '0', 10),
        sseDisconnects: parseInt(raw.sseDisconnects || '0', 10),
      };
    } catch (err) {
      console.warn('[Logger] Redis read counters error:', err.message);
      return null;
    }
  }

  async _readRedisList(key, limit = 50) {
    if (!this.hasRedis) return [];
    try {
      const raw = await this._redis.lrange(key, 0, limit - 1);
      return raw.map(item => {
        if (typeof item === 'string') {
          try { return JSON.parse(item); } catch { return item; }
        }
        return item;
      });
    } catch (err) {
      console.warn(`[Logger] Redis read ${key} error:`, err.message);
      return [];
    }
  }

  async getPersistedPipelines(limit = 20) {
    const redis = await this._readRedisList(REDIS_KEYS.PIPELINES, limit);
    if (redis.length > 0) return redis;
    return [...this.pipelines.values()]
      .sort((a, b) => (b.startMs || 0) - (a.startMs || 0))
      .slice(0, limit)
      .map(p => { const c = { ...p }; delete c.startMs; return c; });
  }

  async getPersistedSessions(limit = 20) {
    const redis = await this._readRedisList(REDIS_KEYS.SESSIONS, limit);
    if (redis.length > 0) return redis;
    return this.clientSessions.slice(-limit).reverse();
  }

  async getPersistedErrors(limit = 20) {
    const redis = await this._readRedisList(REDIS_KEYS.ERRORS, limit);
    if (redis.length > 0) return redis;
    return this.errors.slice(-limit).reverse();
  }

  async getPersistedRequests(limit = 50) {
    const redis = await this._readRedisList(REDIS_KEYS.REQUESTS, limit);
    if (redis.length > 0) return redis;
    return this.requests.slice(-limit).reverse();
  }

  async getPersistedActivity(limit = 50) {
    const redis = await this._readRedisList(REDIS_KEYS.ACTIVITY, limit);
    if (redis.length > 0) return redis;
    return this.activityLog.slice(-limit).reverse();
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
   * Persistent summary: merges in-memory data with Redis-persisted data.
   * Use this instead of getSummary() in debug endpoints.
   */
  async getPersistedSummary() {
    const memSummary = this.getSummary();
    if (!this.hasRedis) return { ...memSummary, persistence: 'memory-only' };

    try {
      const [counters, pipelines, sessions, errors, activity] = await Promise.all([
        this.getPersistedCounters(),
        this.getPersistedPipelines(20),
        this.getPersistedSessions(20),
        this.getPersistedErrors(20),
        this.getPersistedActivity(50),
      ]);

      const completedPipelines = pipelines.filter(p => p.completed);
      const failedPipelines = pipelines.filter(p => p.error);
      const avgDuration = completedPipelines.length
        ? Math.round(completedPipelines.reduce((s, p) => s + (p.duration || 0), 0) / completedPipelines.length)
        : null;

      return {
        ...memSummary,
        persistence: 'redis',
        allTimeCounters: counters || memSummary.counters,
        persistedPipelines: pipelines.map(p => ({
          requestId: p.requestId,
          startedAt: p.startedAt,
          completedAt: p.completedAt || p.failedAt,
          completed: p.completed,
          duration: p.duration,
          error: p.error?.message || null,
          phases: p.phases,
          eventCount: p.events?.length || 0,
          imageSize: p.imageSize,
          layoutType: p.layout?.type || p.layoutType,
          cardCount: p.cardCount,
        })),
        persistedPipelineStats: {
          total: pipelines.length,
          completed: completedPipelines.length,
          failed: failedPipelines.length,
          avgDurationMs: avgDuration,
        },
        persistedSessions: sessions,
        persistedErrors: errors,
        recentActivity: activity,
      };
    } catch (err) {
      console.warn('[Logger] Redis read error in getPersistedSummary:', err.message);
      return { ...memSummary, persistence: 'redis-error', redisError: err.message };
    }
  }

  /**
   * Persistent dashboard: merges in-memory with Redis for at-a-glance view.
   */
  async getPersistedDashboard() {
    const memDash = this.getDashboard();
    if (!this.hasRedis) return { ...memDash, persistence: 'memory-only' };

    try {
      const [counters, pipelines, sessions, errors, requests] = await Promise.all([
        this.getPersistedCounters(),
        this.getPersistedPipelines(10),
        this.getPersistedSessions(10),
        this.getPersistedErrors(10),
        this.getPersistedRequests(20),
      ]);

      const now = Date.now();
      const completedPipelines = pipelines.filter(p => p.completed);
      const failedPipelines = pipelines.filter(p => p.error);
      const avgDesignTime = completedPipelines.length
        ? Math.round(completedPipelines.reduce((s, p) => {
            const bp = p.phases?.find(ph => ph.phase === 'blueprint');
            return s + (bp?.elapsed || 0);
          }, 0) / completedPipelines.length)
        : null;

      const successSessions = sessions.filter(s => s.outcome === 'success');
      const clientErrors = errors.filter(e => e.cat === 'Client');

      return {
        status: memDash.status,
        uptime: memDash.uptime,
        persistence: 'redis',
        counters: counters || memDash.counters,

        serverSide: {
          recentPipelines: pipelines.slice(0, 5).map(p => ({
            id: p.requestId,
            status: p.completed ? 'done' : p.error ? 'FAILED' : 'running',
            startedAt: p.startedAt,
            duration: p.duration ? `${(p.duration / 1000).toFixed(1)}s` : null,
            designTime: (() => { const bp = p.phases?.find(ph => ph.phase === 'blueprint'); return bp ? `${(bp.elapsed / 1000).toFixed(1)}s` : null; })(),
            cards: (() => { const cardEvents = p.events?.filter(e => e.event === 'card' || e.event === 'card_update' || e.event === 'card_add') || []; const uniqueCards = new Set(cardEvents.map(e => e.cardId).filter(Boolean)); return `${uniqueCards.size}/${p.cardCount || '?'}`; })(),
            error: p.error?.message || null,
            method: p.method || 'POST',
            imageSize: p.imageSize,
          })),
          avgDesignTime: avgDesignTime ? `${(avgDesignTime / 1000).toFixed(1)}s` : null,
          stuckCount: memDash.serverSide.stuckCount,
        },

        clientSide: {
          totalReports: sessions.length,
          successCount: successSessions.length,
          failedCount: sessions.length - successSessions.length,
          recentSessions: sessions.slice(0, 5).map(r => ({
            requestId: r.requestId,
            outcome: r.outcome,
            totalDuration: r.totalDuration ? `${(r.totalDuration / 1000).toFixed(1)}s` : null,
            uploadTime: r.uploadDuration ? `${(r.uploadDuration / 1000).toFixed(1)}s` : null,
            firstEvent: r.firstEventDelay ? `${(r.firstEventDelay / 1000).toFixed(1)}s` : null,
            retries: r.retries || 0,
            error: r.error || null,
            ua: r.userAgent ? (r.userAgent.includes('Mobile') ? 'mobile' : 'desktop') : '?',
            age: r.ts ? formatDuration(now - new Date(r.ts).getTime()) : '?',
          })),
          recentErrors: clientErrors.slice(0, 5).map(e => ({
            msg: e.msg,
            requestId: e.requestId,
            age: e.ts ? formatDuration(now - new Date(e.ts).getTime()) : '?',
          })),
        },

        recentRequests: requests.slice(0, 10).map(r => ({
          method: r.method,
          path: r.path,
          status: r.status,
          dur: r.dur ? `${r.dur}ms` : null,
          age: r.ts ? formatDuration(now - new Date(r.ts).getTime()) : '?',
        })),
      };
    } catch (err) {
      console.warn('[Logger] Redis read error in getPersistedDashboard:', err.message);
      return { ...memDash, persistence: 'redis-error', redisError: err.message };
    }
  }

  /**
   * At-a-glance dashboard (in-memory only, kept for backward compat).
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

    const stuckPipelines = pipelines.filter(p => !p.completed && !p.error && (now - p.startMs > 60000));
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
          cards: (() => { const cardEvents = p.events?.filter(e => e.event === 'card' || e.event === 'card_update' || e.event === 'card_add') || []; const uniqueCards = new Set(cardEvents.map(e => e.cardId).filter(Boolean)); return `${uniqueCards.size}/${p.cardCount || '?'}`; })(),
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
  if (!ms || isNaN(ms)) return '?';
  const abs = Math.abs(ms);
  const s = Math.floor(abs / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

const logger = new ProdLogger();

module.exports = { logger, REDIS_KEYS, formatDuration };
