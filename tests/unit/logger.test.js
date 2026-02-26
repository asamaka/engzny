/**
 * Production Logger Tests
 */

const { describe, it, expect, beforeEach } = require('@jest/globals');

let logger, formatDuration;

beforeEach(() => {
  jest.resetModules();
  ({ logger, formatDuration } = require('../../api/lib/logger'));
});

describe('ProdLogger', () => {
  describe('Basic logging', () => {
    it('should store log entries', () => {
      logger.info('Test', 'hello');
      logger.warn('Test', 'warning');
      logger.error('Test', 'bad', { err: 'fail' });

      const logs = logger.query();
      expect(logs.length).toBe(3);
      expect(logs[0].level).toBe('info');
      expect(logs[1].level).toBe('warn');
      expect(logs[2].level).toBe('error');
    });

    it('should filter by level', () => {
      logger.info('A', 'info1');
      logger.error('B', 'err1');
      logger.info('A', 'info2');

      const errors = logger.query({ level: 'error' });
      expect(errors.length).toBe(1);
      expect(errors[0].msg).toBe('err1');
    });

    it('should filter by category', () => {
      logger.info('Pipeline', 'start');
      logger.info('SSE', 'connected');
      logger.info('Pipeline', 'end');

      const pipeline = logger.query({ category: 'Pipeline' });
      expect(pipeline.length).toBe(2);
    });

    it('should respect limit', () => {
      for (let i = 0; i < 20; i++) logger.info('X', `msg${i}`);
      const limited = logger.query({ limit: 5 });
      expect(limited.length).toBe(5);
      expect(limited[0].msg).toBe('msg15'); // last 5
    });

    it('should enforce ring buffer max', () => {
      for (let i = 0; i < 1100; i++) logger.info('X', `msg${i}`);
      expect(logger.entries.length).toBe(1000);
    });
  });

  describe('Pipeline tracking', () => {
    it('should track pipeline lifecycle', () => {
      logger.startPipeline('req-1', { imageSize: '120KB' });
      logger.pipelinePhase('req-1', 'designing');
      logger.pipelinePhase('req-1', 'blueprint', { cardCount: 5 });
      logger.pipelineEvent('req-1', 'card', { cardId: 'c1' });
      logger.pipelineComplete('req-1', { layoutType: 'editorial' });

      const summary = logger.getSummary();
      expect(summary.pipelineStats.total).toBe(1);
      expect(summary.pipelineStats.completed).toBe(1);
      expect(summary.pipelineStats.failed).toBe(0);
      expect(summary.recentPipelines[0].requestId).toBe('req-1');
      expect(summary.recentPipelines[0].completed).toBe(true);
      expect(summary.recentPipelines[0].phases.length).toBe(2);
    });

    it('should track pipeline errors', () => {
      logger.startPipeline('req-2');
      logger.pipelinePhase('req-2', 'designing');
      logger.pipelineError('req-2', new Error('LLM timeout'));

      const summary = logger.getSummary();
      expect(summary.pipelineStats.failed).toBe(1);
      expect(summary.recentPipelines[0].error).toBe('LLM timeout');
    });

    it('should limit stored pipelines', () => {
      for (let i = 0; i < 60; i++) {
        logger.startPipeline(`req-${i}`);
      }
      // Should keep max 50
      expect(logger.pipelines.size).toBeLessThanOrEqual(50);
    });
  });

  describe('Client error reporting', () => {
    it('should store client errors', () => {
      logger.clientError({
        message: 'Stream ended without blueprint',
        userAgent: 'Mozilla/5.0',
        elapsed: 12000,
        streamEvents: [{ event: 'connected', elapsed: 100 }],
      });

      const errors = logger.query({ level: 'error', category: 'Client' });
      expect(errors.length).toBe(1);
      expect(errors[0].msg).toBe('Stream ended without blueprint');
    });
  });

  describe('Summary', () => {
    it('should return full summary', () => {
      logger.info('Test', 'hello');
      logger.startPipeline('r1');
      logger.pipelineComplete('r1');

      const summary = logger.getSummary();
      expect(summary).toHaveProperty('uptime');
      expect(summary).toHaveProperty('totalLogs');
      expect(summary).toHaveProperty('totalErrors');
      expect(summary).toHaveProperty('recentErrors');
      expect(summary).toHaveProperty('pipelineStats');
      expect(summary).toHaveProperty('recentPipelines');
      expect(summary).toHaveProperty('recentLogs');
    });

    it('should calculate average duration', () => {
      logger.startPipeline('r1');
      logger.pipelines.get('r1').startMs = Date.now() - 5000;
      logger.pipelineComplete('r1');

      logger.startPipeline('r2');
      logger.pipelines.get('r2').startMs = Date.now() - 3000;
      logger.pipelineComplete('r2');

      const summary = logger.getSummary();
      expect(summary.pipelineStats.avgDurationMs).toBeGreaterThan(2000);
    });
  });

  describe('Activity logging', () => {
    it('should log activity entries', () => {
      logger.logActivity('page_view', { page: 'hub', ua: 'mobile' });
      logger.logActivity('upload', { requestId: 'abc', imageSize: '200KB' });

      const logs = logger.query({ category: 'Activity' });
      expect(logs.length).toBe(2);
      expect(logs[0].msg).toBe('page_view');
      expect(logs[1].msg).toBe('upload');
    });

    it('should log activity on pipeline start', () => {
      logger.startPipeline('req-act-1', { imageSize: '100KB' });
      const activityLogs = logger.query({ category: 'Activity' });
      expect(activityLogs.length).toBe(1);
      expect(activityLogs[0].msg).toBe('pipeline_started');
    });

    it('should log activity on pipeline complete', () => {
      logger.startPipeline('req-act-2');
      logger.pipelineComplete('req-act-2', { cardCount: 4, layoutType: 'editorial' });
      const activityLogs = logger.query({ category: 'Activity' });
      expect(activityLogs.length).toBe(2);
      expect(activityLogs[1].msg).toBe('pipeline_completed');
    });

    it('should log activity on pipeline error', () => {
      logger.startPipeline('req-act-3');
      logger.pipelineError('req-act-3', new Error('timeout'));
      const activityLogs = logger.query({ category: 'Activity' });
      expect(activityLogs.length).toBe(2);
      expect(activityLogs[1].msg).toBe('pipeline_failed');
    });
  });

  describe('Redis persistence', () => {
    it('should start without Redis (hasRedis = false)', () => {
      expect(logger.hasRedis).toBe(false);
    });

    it('should handle initRedis with null gracefully', async () => {
      await logger.initRedis(null);
      expect(logger.hasRedis).toBe(false);
    });

    it('should return memory-only flag when no Redis', async () => {
      const dashboard = await logger.getPersistedDashboard();
      expect(dashboard.persistence).toBe('memory-only');
    });

    it('should return memory-only flag in persisted summary', async () => {
      const summary = await logger.getPersistedSummary();
      expect(summary.persistence).toBe('memory-only');
    });

    it('should return empty arrays for persisted reads without Redis', async () => {
      expect(await logger.getPersistedPipelines()).toEqual([]);
      expect(await logger.getPersistedSessions()).toEqual([]);
      expect(await logger.getPersistedErrors()).toEqual([]);
      expect(await logger.getPersistedRequests()).toEqual([]);
      expect(await logger.getPersistedActivity()).toEqual([]);
    });

    it('should return null for persisted counters without Redis', async () => {
      expect(await logger.getPersistedCounters()).toBe(null);
    });

    it('should initialize with mock Redis client', async () => {
      const mockRedis = {
        ping: jest.fn().mockResolvedValue('PONG'),
        pipeline: jest.fn().mockReturnValue({
          lpush: jest.fn().mockReturnThis(),
          ltrim: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue([]),
        }),
        hincrby: jest.fn().mockResolvedValue(1),
        hgetall: jest.fn().mockResolvedValue({ requests: '5', pipelines: '2' }),
        lrange: jest.fn().mockResolvedValue([]),
      };

      await logger.initRedis(mockRedis);
      expect(logger.hasRedis).toBe(true);
    });

    it('should persist errors to Redis when available', async () => {
      const pipelineMock = {
        lpush: jest.fn().mockReturnThis(),
        ltrim: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      };
      const mockRedis = {
        ping: jest.fn().mockResolvedValue('PONG'),
        pipeline: jest.fn().mockReturnValue(pipelineMock),
        hincrby: jest.fn().mockResolvedValue(1),
        hgetall: jest.fn().mockResolvedValue({}),
        lrange: jest.fn().mockResolvedValue([]),
      };

      await logger.initRedis(mockRedis);
      logger.error('Test', 'redis error test');

      expect(mockRedis.pipeline).toHaveBeenCalled();
      expect(pipelineMock.lpush).toHaveBeenCalled();
    });

    it('should persist pipeline on completion', async () => {
      const pipelineMock = {
        lpush: jest.fn().mockReturnThis(),
        ltrim: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      };
      const mockRedis = {
        ping: jest.fn().mockResolvedValue('PONG'),
        pipeline: jest.fn().mockReturnValue(pipelineMock),
        hincrby: jest.fn().mockResolvedValue(1),
        hgetall: jest.fn().mockResolvedValue({}),
        lrange: jest.fn().mockResolvedValue([]),
      };

      await logger.initRedis(mockRedis);
      logger.startPipeline('redis-pipe-1', { imageSize: '50KB' });
      logger.pipelineComplete('redis-pipe-1', { cardCount: 3 });

      // Pipeline persist should have been called (activity + pipeline itself)
      const lpushCalls = pipelineMock.lpush.mock.calls;
      const pipelineKeys = lpushCalls.map(c => c[0]);
      expect(pipelineKeys).toContain('thinx:logs:pipelines');
    });

    it('should read persisted counters', async () => {
      const mockRedis = {
        ping: jest.fn().mockResolvedValue('PONG'),
        pipeline: jest.fn().mockReturnValue({
          lpush: jest.fn().mockReturnThis(),
          ltrim: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue([]),
        }),
        hincrby: jest.fn().mockResolvedValue(1),
        hgetall: jest.fn().mockResolvedValue({
          requests: '42',
          pipelines: '10',
          pipelineErrors: '2',
          clientErrors: '1',
          sseDisconnects: '0',
        }),
        lrange: jest.fn().mockResolvedValue([]),
      };

      await logger.initRedis(mockRedis);
      const counters = await logger.getPersistedCounters();
      expect(counters.requests).toBe(42);
      expect(counters.pipelines).toBe(10);
      expect(counters.pipelineErrors).toBe(2);
    });
  });

  describe('formatDuration', () => {
    it('should format seconds', () => {
      expect(formatDuration(5000)).toBe('5s');
    });

    it('should format minutes and seconds', () => {
      expect(formatDuration(125000)).toBe('2m 5s');
    });

    it('should format hours and minutes', () => {
      expect(formatDuration(3725000)).toBe('1h 2m');
    });

    it('should format days and hours', () => {
      expect(formatDuration(90000000)).toBe('1d 1h');
    });

    it('should handle zero', () => {
      expect(formatDuration(0)).toBe('?');
    });

    it('should handle NaN', () => {
      expect(formatDuration(NaN)).toBe('?');
    });
  });

  describe('HTTP request logging', () => {
    it('should track request count', () => {
      logger.logRequest({ method: 'GET', path: '/', status: 200, duration: 10 });
      logger.logRequest({ method: 'POST', path: '/api/hub/v2/start', status: 200, duration: 50 });
      expect(logger.counters.requests).toBe(2);
    });

    it('should store request entries', () => {
      logger.logRequest({ method: 'GET', path: '/', status: 200, duration: 10, userAgent: 'Mozilla' });
      expect(logger.requests.length).toBe(1);
      expect(logger.requests[0].method).toBe('GET');
      expect(logger.requests[0].path).toBe('/');
    });
  });

  describe('Client session reports', () => {
    it('should store client session reports', () => {
      logger.clientReport({
        requestId: 'test-123',
        outcome: 'success',
        totalDuration: 15000,
        uploadDuration: 2000,
      });
      expect(logger.clientSessions.length).toBe(1);
      expect(logger.clientSessions[0].outcome).toBe('success');
    });

    it('should correlate with pipeline trace', () => {
      logger.startPipeline('corr-1');
      logger.pipelineComplete('corr-1');
      logger.clientReport({ requestId: 'corr-1', outcome: 'success', totalDuration: 8000 });

      const trace = logger.pipelines.get('corr-1');
      expect(trace.clientReport).toBeDefined();
      expect(trace.clientReport.outcome).toBe('success');
    });
  });

  describe('SSE disconnect tracking', () => {
    it('should increment disconnect counter', () => {
      logger.sseDisconnect('disc-1');
      logger.sseDisconnect('disc-2');
      expect(logger.counters.sseDisconnects).toBe(2);
    });
  });

  describe('Dashboard', () => {
    it('should return dashboard with all sections', () => {
      const dashboard = logger.getDashboard();
      expect(dashboard).toHaveProperty('status');
      expect(dashboard).toHaveProperty('uptime');
      expect(dashboard).toHaveProperty('counters');
      expect(dashboard).toHaveProperty('serverSide');
      expect(dashboard).toHaveProperty('clientSide');
      expect(dashboard).toHaveProperty('recentRequests');
    });

    it('should show HEALTHY when no issues', () => {
      const dashboard = logger.getDashboard();
      expect(dashboard.status).toBe('HEALTHY');
    });
  });
});
