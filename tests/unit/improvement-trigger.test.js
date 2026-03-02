const trigger = require('../../api/lib/improvement-trigger');

const originalFetch = global.fetch;

describe('Improvement Trigger', () => {
  beforeEach(() => {
    trigger.init(() => null);
    delete process.env.IMPROVEMENT_ENABLED;
    delete process.env.CURSOR_API_KEY;
    delete process.env.IMPROVEMENT_TRIGGER_ON;
    delete process.env.IMPROVEMENT_SLOW_THRESHOLD;
    delete process.env.IMPROVEMENT_PERIODIC_EVERY;
    delete process.env.IMPROVEMENT_MIN_INTERVAL;
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('getConfig', () => {
    it('should return defaults when no env vars set', () => {
      const config = trigger.getConfig();
      expect(config.enabled).toBe(false);
      expect(config.apiKey).toBe('');
      expect(config.repo).toBe('https://github.com/asamaka/engzny');
      expect(config.ref).toBe('main');
      expect(config.model).toBe('claude-4-sonnet');
      expect(config.minInterval).toBe(1800);
      expect(config.triggerOn).toEqual(['error', 'slow']);
      expect(config.slowThreshold).toBe(25000);
      expect(config.periodicEvery).toBe(20);
    });

    it('should read from env vars', () => {
      process.env.IMPROVEMENT_ENABLED = 'true';
      process.env.CURSOR_API_KEY = 'test-key';
      process.env.IMPROVEMENT_TRIGGER_ON = 'error,slow,periodic';
      process.env.IMPROVEMENT_SLOW_THRESHOLD = '30000';
      const config = trigger.getConfig();
      expect(config.enabled).toBe(true);
      expect(config.apiKey).toBe('test-key');
      expect(config.triggerOn).toEqual(['error', 'slow', 'periodic']);
      expect(config.slowThreshold).toBe(30000);
    });
  });

  describe('evaluateReport', () => {
    it('should return null when disabled', async () => {
      const result = await trigger.evaluateReport({ outcome: 'error' });
      expect(result).toBeNull();
    });

    it('should return null when no API key', async () => {
      process.env.IMPROVEMENT_ENABLED = 'true';
      const result = await trigger.evaluateReport({ outcome: 'error' });
      expect(result).toBeNull();
    });

    it('should trigger on error', async () => {
      process.env.IMPROVEMENT_ENABLED = 'true';
      process.env.CURSOR_API_KEY = 'test-key';
      const result = await trigger.evaluateReport({
        outcome: 'error',
        error: 'JSON parse failed',
      });
      expect(result).not.toBeNull();
      expect(result.reason).toBe('pipeline_error');
      expect(result.detail).toBe('JSON parse failed');
    });

    it('should trigger on slow pipeline', async () => {
      process.env.IMPROVEMENT_ENABLED = 'true';
      process.env.CURSOR_API_KEY = 'test-key';
      const result = await trigger.evaluateReport({
        outcome: 'success',
        duration: 30000,
      });
      expect(result).not.toBeNull();
      expect(result.reason).toBe('slow_pipeline');
    });

    it('should not trigger on fast pipeline', async () => {
      process.env.IMPROVEMENT_ENABLED = 'true';
      process.env.CURSOR_API_KEY = 'test-key';
      process.env.IMPROVEMENT_TRIGGER_ON = 'slow';
      const result = await trigger.evaluateReport({
        outcome: 'success',
        duration: 5000,
      });
      expect(result).toBeNull();
    });

    it('should respect trigger_on config', async () => {
      process.env.IMPROVEMENT_ENABLED = 'true';
      process.env.CURSOR_API_KEY = 'test-key';
      process.env.IMPROVEMENT_TRIGGER_ON = 'periodic';
      const result = await trigger.evaluateReport({
        outcome: 'error',
        error: 'some error',
      });
      expect(result).toBeNull();
    });
  });

  describe('checkRateLimit', () => {
    it('should allow when no Redis', async () => {
      const result = await trigger.checkRateLimit();
      expect(result.allowed).toBe(true);
    });
  });

  describe('buildPrompt', () => {
    it('should include report data and trigger reason', () => {
      const prompt = trigger.buildPrompt(
        {
          requestId: 'test-123',
          outcome: 'error',
          error: 'parse failed',
          contentType: 'news',
          layoutType: 'editorial',
          duration: 15000,
          cards: [{ cardType: 'hero_summary' }],
        },
        { reason: 'pipeline_error', detail: 'parse failed' },
      );
      expect(prompt).toContain('pipeline_error');
      expect(prompt).toContain('parse failed');
      expect(prompt).toContain('test-123');
      expect(prompt).toContain('continuous-improvement.md');
    });
  });

  describe('getStatus', () => {
    it('should return safe config (no API key)', () => {
      process.env.CURSOR_API_KEY = 'secret-key-123';
      const status = trigger.getStatus();
      expect(status.hasApiKey).toBe(true);
      expect(status).not.toHaveProperty('apiKey');
    });
  });

  describe('onReportSaved', () => {
    it('should return null when disabled', async () => {
      const result = await trigger.onReportSaved({ outcome: 'error' });
      expect(result).toBeNull();
    });

    it('should not throw on any error', async () => {
      process.env.IMPROVEMENT_ENABLED = 'true';
      process.env.CURSOR_API_KEY = 'test-key';
      global.fetch = jest.fn().mockRejectedValue(new Error('network error'));
      const result = await trigger.onReportSaved({ outcome: 'error', error: 'test' });
      expect(result).toBeNull();
    });

    it('should return trigger entry on success', async () => {
      process.env.IMPROVEMENT_ENABLED = 'true';
      process.env.CURSOR_API_KEY = 'test-key';
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'bc_test123',
          status: 'CREATING',
          target: { url: 'https://cursor.com/agents?id=bc_test123' },
        }),
      });
      const result = await trigger.onReportSaved({
        requestId: 'req-abc',
        outcome: 'error',
        error: 'parse failed',
      });
      expect(result).not.toBeNull();
      expect(result.agentId).toBe('bc_test123');
      expect(result.reason).toBe('pipeline_error');
      expect(result.requestId).toBe('req-abc');
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });
});
