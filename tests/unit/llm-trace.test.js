const { TraceCollector } = require('../../api/lib/llm-trace');

describe('TraceCollector', () => {
  let collector;

  beforeEach(() => {
    collector = new TraceCollector('test-req-123');
  });

  test('should create with requestId', () => {
    expect(collector.requestId).toBe('test-req-123');
    expect(collector.getTraces()).toEqual([]);
  });

  test('should record a trace with all fields', () => {
    const trace = collector.record({
      phase: 'classify',
      agent: 'FastClassifier',
      model: 'claude-haiku-4-5-latest',
      duration: 2500,
      request: {
        userPrompt: 'Analyze this screenshot...',
        hasImage: true,
        imageMediaType: 'image/png',
        maxTokens: 2048,
      },
      response: {
        text: '{"contentType":"news"}',
        usage: { input_tokens: 1500, output_tokens: 200 },
        stopReason: 'end_turn',
      },
    });

    expect(trace.id).toBeDefined();
    expect(trace.timestamp).toBeDefined();
    expect(trace.phase).toBe('classify');
    expect(trace.agent).toBe('FastClassifier');
    expect(trace.model).toBe('claude-haiku-4-5-latest');
    expect(trace.duration).toBe(2500);
    expect(trace.request.userPrompt).toBe('Analyze this screenshot...');
    expect(trace.request.hasImage).toBe(true);
    expect(trace.response.text).toBe('{"contentType":"news"}');
    expect(trace.response.usage.input_tokens).toBe(1500);
    expect(trace.response.stopReason).toBe('end_turn');
    expect(trace.error).toBeNull();
  });

  test('should record error traces', () => {
    collector.record({
      phase: 'design',
      agent: 'LayoutDesigner',
      model: 'claude-sonnet-4-20250514',
      duration: 500,
      request: { userPrompt: 'Design layout...' },
      response: {},
      error: 'API rate limit exceeded',
    });

    const traces = collector.getTraces();
    expect(traces).toHaveLength(1);
    expect(traces[0].error).toBe('API rate limit exceeded');
  });

  test('should record card research traces with cardId/cardType', () => {
    collector.record({
      phase: 'research',
      agent: 'CardResearcher',
      model: 'claude-sonnet-4-20250514',
      duration: 3000,
      request: { userPrompt: 'Research this card...' },
      response: { text: '{"title":"Test"}', structured: { title: 'Test' } },
      cardId: 'card-1',
      cardType: 'hero_summary',
    });

    const traces = collector.getTraces();
    expect(traces[0].cardId).toBe('card-1');
    expect(traces[0].cardType).toBe('hero_summary');
    expect(traces[0].response.structured).toEqual({ title: 'Test' });
  });

  test('should collect multiple traces', () => {
    collector.record({ phase: 'classify', agent: 'FastClassifier', model: 'haiku', duration: 2000, request: {}, response: {} });
    collector.record({ phase: 'design', agent: 'LayoutDesigner', model: 'sonnet', duration: 15000, request: {}, response: {} });
    collector.record({ phase: 'research', agent: 'CardResearcher', model: 'sonnet', duration: 5000, request: {}, response: {}, cardId: 'card-1' });
    collector.record({ phase: 'research', agent: 'CardResearcher', model: 'sonnet', duration: 4000, request: {}, response: {}, cardId: 'card-2' });

    expect(collector.getTraces()).toHaveLength(4);
  });

  test('should generate summary with model list and token counts', () => {
    collector.record({
      phase: 'classify', agent: 'FastClassifier', model: 'claude-haiku-4-5-latest',
      duration: 2000, request: {},
      response: { usage: { input_tokens: 1000, output_tokens: 200 } },
    });
    collector.record({
      phase: 'design', agent: 'LayoutDesigner', model: 'claude-sonnet-4-20250514',
      duration: 15000, request: {},
      response: { usage: { input_tokens: 3000, output_tokens: 800 } },
    });
    collector.record({
      phase: 'research', agent: 'CardResearcher', model: 'claude-sonnet-4-20250514',
      duration: 5000, request: {},
      response: { usage: { input_tokens: 2000, output_tokens: 500 } },
    });

    const summary = collector.getSummary();
    expect(summary.traceCount).toBe(3);
    expect(summary.models).toContain('claude-haiku-4-5-latest');
    expect(summary.models).toContain('claude-sonnet-4-20250514');
    expect(summary.totalInputTokens).toBe(6000);
    expect(summary.totalOutputTokens).toBe(1500);
    expect(summary.totalLlmDuration).toBe(22000);
    expect(summary.byPhase.classify.count).toBe(1);
    expect(summary.byPhase.design.count).toBe(1);
    expect(summary.byPhase.research.count).toBe(1);
  });

  test('should track errors in summary by phase', () => {
    collector.record({
      phase: 'research', agent: 'CardResearcher', model: 'sonnet',
      duration: 500, request: {}, response: {}, error: 'timeout',
    });
    collector.record({
      phase: 'research', agent: 'CardResearcher', model: 'sonnet',
      duration: 3000, request: {}, response: {},
    });

    const summary = collector.getSummary();
    expect(summary.byPhase.research.errors).toBe(1);
    expect(summary.byPhase.research.count).toBe(2);
  });

  test('should truncate long prompts and outputs', () => {
    const longPrompt = 'x'.repeat(10000);
    const longOutput = 'y'.repeat(10000);

    collector.record({
      phase: 'design', agent: 'LayoutDesigner', model: 'sonnet',
      duration: 1000,
      request: { userPrompt: longPrompt },
      response: { text: longOutput },
    });

    const trace = collector.getTraces()[0];
    expect(trace.request.userPrompt.length).toBeLessThan(longPrompt.length);
    expect(trace.request.userPrompt).toContain('truncated');
    expect(trace.response.text.length).toBeLessThan(longOutput.length);
    expect(trace.response.text).toContain('truncated');
  });

  test('should handle missing/null fields gracefully', () => {
    const trace = collector.record({});

    expect(trace.phase).toBe('unknown');
    expect(trace.agent).toBe('unknown');
    expect(trace.model).toBe('unknown');
    expect(trace.duration).toBe(0);
    expect(trace.request.hasImage).toBe(false);
    expect(trace.response.text).toBeNull();
    expect(trace.toolCalls).toEqual([]);
    expect(trace.cardId).toBeNull();
    expect(trace.error).toBeNull();
  });

  test('should record tool calls', () => {
    collector.record({
      phase: 'design', agent: 'PipelineV3', model: 'opus',
      duration: 5000,
      request: { userPrompt: 'Analyze...' },
      response: { text: '' },
      toolCalls: [
        { name: 'classify', input: { contentType: 'news' } },
        { name: 'buildLayout', input: { layoutType: 'editorial' } },
      ],
    });

    const trace = collector.getTraces()[0];
    expect(trace.toolCalls).toHaveLength(2);
    expect(trace.toolCalls[0].name).toBe('classify');
    expect(trace.toolCalls[1].name).toBe('buildLayout');
  });

  test('should track pipelineOffset', () => {
    const trace = collector.record({
      phase: 'classify', agent: 'test', model: 'test',
      duration: 100, request: {}, response: {},
    });

    expect(trace.pipelineOffset).toBeGreaterThanOrEqual(0);
  });
});
