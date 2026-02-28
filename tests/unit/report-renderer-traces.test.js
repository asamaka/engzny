const { renderLlmTracesHtml, esc, fmtMs } = require('../../api/lib/report-renderer');

describe('renderLlmTracesHtml', () => {
  test('should return empty string when no traces', () => {
    expect(renderLlmTracesHtml({})).toBe('');
    expect(renderLlmTracesHtml({ llmTraces: [] })).toBe('');
  });

  test('should render summary stats', () => {
    const report = {
      llmTraces: [
        {
          id: 't1', phase: 'classify', agent: 'FastClassifier',
          model: 'claude-haiku-4-5-latest', duration: 2500,
          request: { userPrompt: 'Analyze...', hasImage: true },
          response: { text: '{}', usage: { input_tokens: 1000, output_tokens: 200 } },
          toolCalls: [], error: null,
        },
      ],
      llmTraceSummary: {
        traceCount: 1,
        models: ['claude-haiku-4-5-latest'],
        totalInputTokens: 1000,
        totalOutputTokens: 200,
        totalLlmDuration: 2500,
        byPhase: { classify: { count: 1, duration: 2500, errors: 0 } },
      },
    };

    const html = renderLlmTracesHtml(report);
    expect(html).toContain('LLM Calls');
    expect(html).toContain('Models Used');
    expect(html).toContain('Input Tokens');
    expect(html).toContain('Output Tokens');
  });

  test('should render model badges with correct classes', () => {
    const report = {
      llmTraces: [
        {
          id: 't1', phase: 'classify', agent: 'FastClassifier',
          model: 'claude-haiku-4-5-latest', duration: 2000,
          request: {}, response: {}, toolCalls: [], error: null,
        },
        {
          id: 't2', phase: 'design', agent: 'LayoutDesigner',
          model: 'claude-sonnet-4-20250514', duration: 15000,
          request: {}, response: {}, toolCalls: [], error: null,
        },
      ],
      llmTraceSummary: {
        traceCount: 2,
        models: ['claude-haiku-4-5-latest', 'claude-sonnet-4-20250514'],
        totalInputTokens: 0, totalOutputTokens: 0,
        totalLlmDuration: 17000,
        byPhase: {},
      },
    };

    const html = renderLlmTracesHtml(report);
    expect(html).toContain('model-haiku');
    expect(html).toContain('model-sonnet');
  });

  test('should render phase badges', () => {
    const report = {
      llmTraces: [
        { id: 't1', phase: 'classify', agent: 'FC', model: 'haiku', duration: 1000, request: {}, response: {}, toolCalls: [], error: null },
        { id: 't2', phase: 'design', agent: 'LD', model: 'sonnet', duration: 5000, request: {}, response: {}, toolCalls: [], error: null },
        { id: 't3', phase: 'research', agent: 'CR', model: 'sonnet', duration: 3000, request: {}, response: {}, toolCalls: [], error: null, cardId: 'card-1', cardType: 'hero_summary' },
      ],
      llmTraceSummary: { traceCount: 3, models: [], totalInputTokens: 0, totalOutputTokens: 0, totalLlmDuration: 9000, byPhase: {} },
    };

    const html = renderLlmTracesHtml(report);
    expect(html).toContain('CLASSIFY');
    expect(html).toContain('DESIGN');
    expect(html).toContain('RESEARCH');
    expect(html).toContain('card-1');
  });

  test('should render error traces with error styling', () => {
    const report = {
      llmTraces: [
        {
          id: 't1', phase: 'research', agent: 'CardResearcher',
          model: 'sonnet', duration: 500,
          request: { userPrompt: 'Research card...' },
          response: {},
          toolCalls: [],
          error: 'API rate limit exceeded',
        },
      ],
      llmTraceSummary: { traceCount: 1, models: ['sonnet'], totalInputTokens: 0, totalOutputTokens: 0, totalLlmDuration: 500, byPhase: {} },
    };

    const html = renderLlmTracesHtml(report);
    expect(html).toContain('trace-error');
    expect(html).toContain('API rate limit exceeded');
  });

  test('should render prompt and output sections', () => {
    const report = {
      llmTraces: [
        {
          id: 't1', phase: 'design', agent: 'LayoutDesigner',
          model: 'sonnet', duration: 10000,
          timestamp: '2026-02-28T12:00:00Z',
          pipelineOffset: 5000,
          request: { userPrompt: 'You are a layout designer...', hasImage: true, imageMediaType: 'image/png', maxTokens: 4096 },
          response: { text: '{"contentAnalysis":{"contentType":"news"}}', usage: { input_tokens: 3000, output_tokens: 800 }, stopReason: 'end_turn' },
          toolCalls: [],
          error: null,
        },
      ],
      llmTraceSummary: { traceCount: 1, models: ['sonnet'], totalInputTokens: 3000, totalOutputTokens: 800, totalLlmDuration: 10000, byPhase: {} },
    };

    const html = renderLlmTracesHtml(report);
    expect(html).toContain('Prompt');
    expect(html).toContain('+ IMAGE');
    expect(html).toContain('Output');
    expect(html).toContain('You are a layout designer...');
    expect(html).toContain('contentAnalysis');
    expect(html).toContain('end_turn');
  });

  test('should render tool calls', () => {
    const report = {
      llmTraces: [
        {
          id: 't1', phase: 'design', agent: 'PipelineV3',
          model: 'opus', duration: 5000,
          request: { userPrompt: 'Analyze...' },
          response: { text: '' },
          toolCalls: [
            { name: 'classify', input: { contentType: 'news' } },
            { name: 'buildLayout', input: { layoutType: 'editorial' }, output: 'OK' },
          ],
          error: null,
        },
      ],
      llmTraceSummary: { traceCount: 1, models: ['opus'], totalInputTokens: 0, totalOutputTokens: 0, totalLlmDuration: 5000, byPhase: {} },
    };

    const html = renderLlmTracesHtml(report);
    expect(html).toContain('Tool Calls (2)');
    expect(html).toContain('classify');
    expect(html).toContain('buildLayout');
  });
});
