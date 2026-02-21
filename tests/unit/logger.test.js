/**
 * Production Logger Tests
 */

const { describe, it, expect, beforeEach } = require('@jest/globals');

// Require fresh logger each test
let logger;

beforeEach(() => {
  jest.resetModules();
  ({ logger } = require('../../api/lib/logger'));
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
      for (let i = 0; i < 600; i++) logger.info('X', `msg${i}`);
      expect(logger.entries.length).toBe(500);
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
});
