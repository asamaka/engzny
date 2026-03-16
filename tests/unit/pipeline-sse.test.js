/**
 * Pipeline SSE Endpoint Tests
 *
 * Tests the /api/hub/v2/analyze SSE endpoint mechanics:
 * - Stream setup and event delivery
 * - Error handling (catch block scoping)
 * - Blueprint and card event flow
 * - Graceful error propagation to client
 */

const { describe, it, expect, beforeEach, afterEach } = require('@jest/globals');
const request = require('supertest');

// Mock the Anthropic SDK before requiring anything that uses it
const mockCreate = jest.fn();
const mockStream = {
  on: jest.fn(),
  finalMessage: jest.fn(),
};

jest.mock('@anthropic-ai/sdk', () => ({
  default: jest.fn(() => ({
    messages: {
      create: mockCreate,
      stream: jest.fn(() => mockStream),
    },
  })),
}));

// Mock both orchestrators to control pipeline behavior
const mockRunPipeline = jest.fn();
jest.mock('../../api/agents/orchestrator-v2', () => ({
  runPipeline: mockRunPipeline,
}));
jest.mock('../../api/agents/orchestrator-v2-0', () => ({
  runPipelineV20: mockRunPipeline,
}));

describe('Pipeline SSE Endpoint', () => {
  let app;
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.ANTHROPIC_API_KEY = 'sk-ant-api03-test-key-for-pipeline-tests';

    // Reset mocks
    mockRunPipeline.mockReset();
    mockCreate.mockReset();

    // Clear module cache to get fresh app with mocks
    jest.resetModules();

    // Re-mock after resetModules
    jest.mock('@anthropic-ai/sdk', () => ({
      default: jest.fn(() => ({
        messages: {
          create: mockCreate,
          stream: jest.fn(() => mockStream),
        },
      })),
    }));

    jest.mock('../../api/agents/orchestrator-v2', () => ({
      runPipeline: mockRunPipeline,
    }));
    jest.mock('../../api/agents/orchestrator-v2-0', () => ({
      runPipelineV20: mockRunPipeline,
    }));

    app = require('../../api/index');
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // 1x1 red PNG pixel as base64 for test payloads
  const TEST_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

  describe('Successful pipeline flow', () => {
    it('should send connected event when pipeline starts', async () => {
      // Pipeline runs forever (we abort early)
      mockRunPipeline.mockImplementation(() => new Promise(() => {}));

      const res = await request(app)
        .post('/api/hub/v2/analyze')
        .send({ image: TEST_IMAGE })
        .set('Accept', 'text/event-stream')
        .buffer(true)
        .parse((res, callback) => {
          let data = '';
          let done = false;
          res.on('data', (chunk) => {
            data += chunk.toString();
            // Abort after receiving the full connected event (event + data lines)
            if (!done && data.includes('event: connected') && data.includes('"Pipeline started"')) {
              done = true;
              res.destroy();
              callback(null, data);
            }
          });
          // Timeout safety
          setTimeout(() => {
            if (!done) { done = true; res.destroy(); callback(null, data); }
          }, 3000);
        });

      expect(res.body).toContain('event: connected');
      expect(res.body).toContain('Pipeline started');
    });

    it('should deliver blueprint event from pipeline', async () => {
      const testBlueprint = {
        contentAnalysis: { contentType: 'test' },
        layout: { type: 'simple', columns: 1 },
        cards: [{ id: 'card-1', cardType: 'hero_summary' }],
      };

      mockRunPipeline.mockImplementation(async ({ onBlueprint, onComplete }) => {
        onBlueprint(testBlueprint);
        onComplete({
          layout: testBlueprint.layout,
          contentAnalysis: testBlueprint.contentAnalysis,
          _meta: { totalDuration: 100 },
        });
      });

      const res = await request(app)
        .post('/api/hub/v2/analyze')
        .send({ image: TEST_IMAGE })
        .set('Accept', 'text/event-stream')
        .buffer(true)
        .parse((res, callback) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk.toString(); });
          let done = false;
          res.on('end', () => { if (!done) { done = true; callback(null, data); } });
          setTimeout(() => { if (!done) { done = true; res.destroy(); callback(null, data); } }, 5000);
        });

      expect(res.body).toContain('event: connected');
      expect(res.body).toContain('event: blueprint');
      expect(res.body).toContain('event: complete');
      expect(res.body).toContain('hero_summary');
    });

    it('should deliver card events from pipeline', async () => {
      mockRunPipeline.mockImplementation(async ({ onBlueprint, onCardPopulated, onComplete }) => {
        onBlueprint({
          contentAnalysis: { contentType: 'test' },
          layout: { type: 'simple', columns: 1 },
          cards: [
            { id: 'card-1', cardType: 'hero_summary' },
            { id: 'card-2', cardType: 'info_list' },
          ],
        });
        onCardPopulated({ cardId: 'card-1', cardType: 'hero_summary', data: { title: 'Test' } });
        onCardPopulated({ cardId: 'card-2', cardType: 'info_list', data: { title: 'Details' } });
        onComplete({
          layout: { type: 'simple' },
          contentAnalysis: {},
          _meta: { totalDuration: 200 },
        });
      });

      const res = await request(app)
        .post('/api/hub/v2/analyze')
        .send({ image: TEST_IMAGE })
        .set('Accept', 'text/event-stream')
        .buffer(true)
        .parse((res, callback) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk.toString(); });
          let done = false;
          res.on('end', () => { if (!done) { done = true; callback(null, data); } });
          setTimeout(() => { if (!done) { done = true; res.destroy(); callback(null, data); } }, 5000);
        });

      // Count card events
      const cardEvents = (res.body.match(/event: card/g) || []).length;
      expect(cardEvents).toBe(2);
      expect(res.body).toContain('event: complete');
    });
  });

  describe('Error handling', () => {
    it('should return JSON error when image is missing (before SSE headers)', async () => {
      const res = await request(app)
        .post('/api/hub/v2/analyze')
        .send({})
        .expect(500);

      expect(res.body.error).toBe('Pipeline failed');
    });

    it('should return JSON error when image is invalid (before SSE headers)', async () => {
      const res = await request(app)
        .post('/api/hub/v2/analyze')
        .send({ image: 'not-a-valid-image' })
        .expect(500);

      expect(res.body.error).toBe('Pipeline failed');
    });

    it('should send SSE error event when pipeline calls onError', async () => {
      mockRunPipeline.mockImplementation(async ({ onError }) => {
        onError(new Error('Layout designer failed: rate limit'));
      });

      const res = await request(app)
        .post('/api/hub/v2/analyze')
        .send({ image: TEST_IMAGE })
        .set('Accept', 'text/event-stream')
        .buffer(true)
        .parse((res, callback) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk.toString(); });
          let done = false;
          res.on('end', () => { if (!done) { done = true; callback(null, data); } });
          setTimeout(() => { if (!done) { done = true; res.destroy(); callback(null, data); } }, 5000);
        });

      expect(res.body).toContain('event: connected');
      expect(res.body).toContain('event: error');
      expect(res.body).toContain('rate limit');
    });

    it('should send SSE error event when pipeline throws (catch block scoping test)', async () => {
      // This is the critical test for the scoping bug fix
      // Previously, if runPipeline threw (rather than calling onError),
      // the catch block would crash with ReferenceError because
      // sendEvent/endStream/keepAlive were block-scoped to the try block
      mockRunPipeline.mockImplementation(async () => {
        throw new Error('Unexpected pipeline crash');
      });

      const res = await request(app)
        .post('/api/hub/v2/analyze')
        .send({ image: TEST_IMAGE })
        .set('Accept', 'text/event-stream')
        .buffer(true)
        .parse((res, callback) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk.toString(); });
          let done = false;
          res.on('end', () => { if (!done) { done = true; callback(null, data); } });
          setTimeout(() => { if (!done) { done = true; res.destroy(); callback(null, data); } }, 5000);
        });

      // The critical assertion: error event should be sent, not a hang
      expect(res.body).toContain('event: connected');
      expect(res.body).toContain('event: error');
      expect(res.body).toContain('Unexpected pipeline crash');
    });

    it('should return 500 JSON when API key is missing', async () => {
      delete process.env.ANTHROPIC_API_KEY;

      // Need to reload the module to pick up env change
      jest.resetModules();
      jest.mock('@anthropic-ai/sdk', () => ({
        default: jest.fn(() => {
          throw new Error('ANTHROPIC_API_KEY is required');
        }),
      }));
      jest.mock('../../api/agents/orchestrator-v2', () => ({
        runPipeline: mockRunPipeline,
      }));
      jest.mock('../../api/agents/orchestrator-v2-0', () => ({
        runPipelineV20: mockRunPipeline,
      }));

      // The ClaudeAdapter will throw during construction when API key is missing
      // But the endpoint itself checks process.env.ANTHROPIC_API_KEY first
      const freshApp = require('../../api/index');

      const res = await request(freshApp)
        .post('/api/hub/v2/analyze')
        .send({ image: TEST_IMAGE })
        .expect(500);

      expect(res.body.error).toBe('API Configuration Missing');
    });
  });

  describe('Input validation', () => {
    it('should reject requests with no body', async () => {
      const res = await request(app)
        .post('/api/hub/v2/analyze')
        .send({})
        .expect(500);

      expect(res.body.error).toBe('Pipeline failed');
    });

    it('should accept valid base64 PNG data URL', async () => {
      mockRunPipeline.mockImplementation(async ({ onBlueprint, onComplete }) => {
        onBlueprint({
          contentAnalysis: { contentType: 'test' },
          layout: { type: 'simple', columns: 1 },
          cards: [{ id: 'card-1', cardType: 'hero_summary' }],
        });
        onComplete({ layout: {}, contentAnalysis: {}, _meta: {} });
      });

      const res = await request(app)
        .post('/api/hub/v2/analyze')
        .send({ image: TEST_IMAGE })
        .set('Accept', 'text/event-stream')
        .buffer(true)
        .parse((res, callback) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk.toString(); });
          let done = false;
          res.on('end', () => { if (!done) { done = true; callback(null, data); } });
          setTimeout(() => { if (!done) { done = true; res.destroy(); callback(null, data); } }, 5000);
        });

      expect(res.body).toContain('event: blueprint');
    });
  });
});
