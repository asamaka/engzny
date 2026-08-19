const request = require('supertest');

const mockRunPipelineV20 = jest.fn();

jest.mock('@anthropic-ai/sdk', () => ({
  default: jest.fn(() => ({
    messages: {
      create: jest.fn(),
      stream: jest.fn(),
    },
  })),
}));

jest.mock('../../api/agents/orchestrator-v2-0', () => ({
  runPipelineV20: mockRunPipelineV20,
}));

describe('Pipeline 2.0 SSE flow', () => {
  let app;
  let originalEnv;

  const TEST_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.ANTHROPIC_API_KEY = 'sk-ant-api03-test-key-for-pipeline-2-0';

    jest.resetModules();
    mockRunPipelineV20.mockReset();

    jest.mock('@anthropic-ai/sdk', () => ({
      default: jest.fn(() => ({
        messages: {
          create: jest.fn(),
          stream: jest.fn(),
        },
      })),
    }));
    jest.mock('../../api/agents/orchestrator-v2-0', () => ({
      runPipelineV20: mockRunPipelineV20,
    }));

    app = require('../../api/index');
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test('keeps stream open after complete until settled', async () => {
    mockRunPipelineV20.mockImplementation(async ({
      onBlueprint,
      onLayoutUpdate,
      onCardPopulated,
      onComplete,
      onCardUpdate,
      onSettled,
    }) => {
      onBlueprint({
        contentAnalysis: { contentType: 'breaking_news' },
        layout: { type: 'breaking_news', columns: 2 },
        cards: [{ id: 'hero', cardType: 'hero_summary' }],
      });

      onLayoutUpdate({
        contentAnalysis: { contentType: 'breaking_news' },
        layout: { type: 'breaking_news', columns: 2 },
        cards: [{ id: 'hero', cardType: 'hero_summary', populatedData: { title: 'Headline', subtitle: 'Initial subtitle' } }],
      });

      onCardPopulated({
        cardId: 'hero',
        cardType: 'hero_summary',
        data: { title: 'Headline', subtitle: 'Initial subtitle' },
        completedCount: 1,
        totalCount: 1,
      });

      onComplete({
        layout: { type: 'breaking_news', columns: 2 },
        contentAnalysis: { contentType: 'breaking_news' },
        meta: { pipeline: 'llm2', pendingResearch: true, uiReadyDuration: 1200 },
      });

      onCardUpdate({
        cardId: 'hero',
        cardType: 'hero_summary',
        data: { title: 'Headline', subtitle: 'Refined after research' },
        source: 'research',
      });

      onSettled({
        layout: { type: 'breaking_news', columns: 2 },
        contentAnalysis: { contentType: 'breaking_news' },
        cards: [{ id: 'hero', cardType: 'hero_summary', data: { title: 'Headline', subtitle: 'Refined after research' } }],
        _meta: { pipeline: 'llm2', totalDuration: 1800, pendingResearch: false },
      });
    });

    const res = await request(app)
      .post('/api/hub/v2/analyze')
      .send({ image: TEST_IMAGE, pipeline: 'llm2' })
      .set('Accept', 'text/event-stream')
      .buffer(true)
      .parse((res, callback) => {
        let data = '';
        let done = false;
        res.on('data', (chunk) => {
          data += chunk.toString();
          if (!done && data.includes('event: settled')) {
            done = true;
            res.destroy();
            callback(null, data);
          }
        });
        res.on('end', () => {
          if (!done) {
            done = true;
            callback(null, data);
          }
        });
        setTimeout(() => {
          if (!done) {
            done = true;
            res.destroy();
            callback(null, data);
          }
        }, 5000);
      });

    const stream = res.body;
    expect(stream).toContain('event: connected');
    expect(stream).toContain('event: blueprint');
    expect(stream).toContain('event: layout_update');
    expect(stream).toContain('event: card');
    expect(stream).toContain('event: complete');
    expect(stream).toContain('"pendingResearch":true');
    expect(stream).toContain('event: card_update');
    expect(stream).toContain('Refined after research');
    expect(stream).toContain('event: settled');

    const completeIndex = stream.indexOf('event: complete');
    const updateIndex = stream.indexOf('event: card_update');
    const settledIndex = stream.indexOf('event: settled');

    expect(completeIndex).toBeGreaterThan(-1);
    expect(updateIndex).toBeGreaterThan(completeIndex);
    expect(settledIndex).toBeGreaterThan(updateIndex);
  });
});
