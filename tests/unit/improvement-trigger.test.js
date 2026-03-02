const trigger = require('../../api/lib/improvement-trigger');

const originalFetch = global.fetch;

describe('Improvement Trigger', () => {
  beforeEach(() => {
    trigger.init(() => null);
    delete process.env.IMPROVEMENT_ENABLED;
    delete process.env.GITHUB_DISPATCH_TOKEN;
    delete process.env.IMPROVEMENT_TRIGGER_ON;
    delete process.env.IMPROVEMENT_SLOW_THRESHOLD;
    delete process.env.IMPROVEMENT_PERIODIC_EVERY;
    delete process.env.IMPROVEMENT_MIN_INTERVAL;
    delete process.env.IMPROVEMENT_REPO_OWNER;
    delete process.env.IMPROVEMENT_REPO_NAME;
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('getConfig', () => {
    it('should return defaults when no env vars set', () => {
      const config = trigger.getConfig();
      expect(config.enabled).toBe(false);
      expect(config.githubToken).toBe('');
      expect(config.repoOwner).toBe('asamaka');
      expect(config.repoName).toBe('engzny');
      expect(config.minInterval).toBe(1800);
      expect(config.triggerOn).toEqual(['error', 'slow']);
      expect(config.slowThreshold).toBe(25000);
      expect(config.periodicEvery).toBe(20);
    });

    it('should read from env vars', () => {
      process.env.IMPROVEMENT_ENABLED = 'true';
      process.env.GITHUB_DISPATCH_TOKEN = 'ghp_test';
      process.env.IMPROVEMENT_TRIGGER_ON = 'error,slow,periodic';
      process.env.IMPROVEMENT_SLOW_THRESHOLD = '30000';
      process.env.IMPROVEMENT_REPO_OWNER = 'myorg';
      process.env.IMPROVEMENT_REPO_NAME = 'myrepo';
      const config = trigger.getConfig();
      expect(config.enabled).toBe(true);
      expect(config.githubToken).toBe('ghp_test');
      expect(config.triggerOn).toEqual(['error', 'slow', 'periodic']);
      expect(config.slowThreshold).toBe(30000);
      expect(config.repoOwner).toBe('myorg');
      expect(config.repoName).toBe('myrepo');
    });
  });

  describe('evaluateReport', () => {
    it('should return null when disabled', async () => {
      const result = await trigger.evaluateReport({ outcome: 'error' });
      expect(result).toBeNull();
    });

    it('should return null when no GitHub token', async () => {
      process.env.IMPROVEMENT_ENABLED = 'true';
      const result = await trigger.evaluateReport({ outcome: 'error' });
      expect(result).toBeNull();
    });

    it('should trigger on error', async () => {
      process.env.IMPROVEMENT_ENABLED = 'true';
      process.env.GITHUB_DISPATCH_TOKEN = 'ghp_test';
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
      process.env.GITHUB_DISPATCH_TOKEN = 'ghp_test';
      const result = await trigger.evaluateReport({
        outcome: 'success',
        duration: 30000,
      });
      expect(result).not.toBeNull();
      expect(result.reason).toBe('slow_pipeline');
    });

    it('should not trigger on fast pipeline', async () => {
      process.env.IMPROVEMENT_ENABLED = 'true';
      process.env.GITHUB_DISPATCH_TOKEN = 'ghp_test';
      process.env.IMPROVEMENT_TRIGGER_ON = 'slow';
      const result = await trigger.evaluateReport({
        outcome: 'success',
        duration: 5000,
      });
      expect(result).toBeNull();
    });

    it('should respect trigger_on config', async () => {
      process.env.IMPROVEMENT_ENABLED = 'true';
      process.env.GITHUB_DISPATCH_TOKEN = 'ghp_test';
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

  describe('buildReportSummary', () => {
    it('should extract relevant fields', () => {
      const summary = trigger.buildReportSummary({
        requestId: 'test-123',
        outcome: 'error',
        error: 'parse failed',
        contentType: 'news',
        layoutType: 'editorial',
        duration: 15000,
        cards: [{ cardType: 'hero_summary' }, { cardType: 'info_list' }],
        llmTraceSummary: { totalTokens: 5000 },
        thumb: 'base64data',
      });
      expect(summary.requestId).toBe('test-123');
      expect(summary.outcome).toBe('error');
      expect(summary.error).toBe('parse failed');
      expect(summary.cardTypes).toEqual(['hero_summary', 'info_list']);
      expect(summary.llmTraceSummary).toEqual({ totalTokens: 5000 });
      expect(summary).not.toHaveProperty('thumb');
      expect(summary).not.toHaveProperty('cards');
    });
  });

  describe('getStatus', () => {
    it('should return safe config (no tokens exposed)', () => {
      process.env.GITHUB_DISPATCH_TOKEN = 'ghp_secret_token_123';
      const status = trigger.getStatus();
      expect(status.hasGithubToken).toBe(true);
      expect(status).not.toHaveProperty('githubToken');
      expect(status.repo).toBe('asamaka/engzny');
    });
  });

  describe('onReportSaved', () => {
    it('should return null when disabled', async () => {
      const result = await trigger.onReportSaved({ outcome: 'error' });
      expect(result).toBeNull();
    });

    it('should not throw on network error', async () => {
      process.env.IMPROVEMENT_ENABLED = 'true';
      process.env.GITHUB_DISPATCH_TOKEN = 'ghp_test';
      global.fetch = jest.fn().mockRejectedValue(new Error('network error'));
      const result = await trigger.onReportSaved({ outcome: 'error', error: 'test' });
      expect(result).toBeNull();
    });

    it('should dispatch to GitHub on trigger', async () => {
      process.env.IMPROVEMENT_ENABLED = 'true';
      process.env.GITHUB_DISPATCH_TOKEN = 'ghp_test';
      global.fetch = jest.fn().mockResolvedValue({ ok: true });

      const result = await trigger.onReportSaved({
        requestId: 'req-abc',
        outcome: 'error',
        error: 'parse failed',
        contentType: 'news',
        cards: [{ cardType: 'hero_summary' }],
      });

      expect(result).not.toBeNull();
      expect(result.method).toBe('github_dispatch');
      expect(result.reason).toBe('pipeline_error');
      expect(result.requestId).toBe('req-abc');

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, opts] = global.fetch.mock.calls[0];
      expect(url).toBe('https://api.github.com/repos/asamaka/engzny/dispatches');
      expect(opts.method).toBe('POST');
      expect(opts.headers['Authorization']).toBe('Bearer ghp_test');

      const body = JSON.parse(opts.body);
      expect(body.event_type).toBe('improvement-trigger');
      expect(body.client_payload.reason).toBe('pipeline_error');
      expect(body.client_payload.report.requestId).toBe('req-abc');
    });

    it('should not include raw tokens in dispatch payload', async () => {
      process.env.IMPROVEMENT_ENABLED = 'true';
      process.env.GITHUB_DISPATCH_TOKEN = 'ghp_test';
      global.fetch = jest.fn().mockResolvedValue({ ok: true });

      await trigger.onReportSaved({
        requestId: 'req-sec',
        outcome: 'error',
        error: 'test',
      });

      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      const payloadStr = JSON.stringify(body.client_payload);
      expect(payloadStr).not.toContain('ghp_test');
    });
  });

  describe('manualTrigger', () => {
    it('should throw when no token configured', async () => {
      await expect(trigger.manualTrigger()).rejects.toThrow('GITHUB_DISPATCH_TOKEN not configured');
    });

    it('should dispatch manual trigger to GitHub', async () => {
      process.env.GITHUB_DISPATCH_TOKEN = 'ghp_test';
      global.fetch = jest.fn().mockResolvedValue({ ok: true });

      const result = await trigger.manualTrigger({ focus: 'optimize prompts' });
      expect(result.method).toBe('github_dispatch');
      expect(result.reason).toBe('manual');
      expect(result.detail).toBe('optimize prompts');

      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(body.event_type).toBe('improvement-trigger');
      expect(body.client_payload.reason).toBe('manual');
      expect(body.client_payload.detail).toBe('optimize prompts');
    });
  });
});
