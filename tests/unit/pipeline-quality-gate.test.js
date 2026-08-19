const {
  sanitizeUrl,
  runPipelineQualityGate,
  reconcileFactCheckData,
  reconcileVerificationData,
} = require('../../api/lib/pipeline-quality-gate');

describe('Pipeline quality gate', () => {
  test('sanitizeUrl strips commentary appended to URL', () => {
    expect(sanitizeUrl('https://example.com/story (photo of Pedro Sanchez)'))
      .toBe('https://example.com/story');
  });

  test('reconcileFactCheckData fixes contradictory verified/low confidence', () => {
    const result = reconcileFactCheckData({
      claim: 'Test claim',
      verdict: 'verified',
      confidence: 'low',
    });

    expect(result.changed).toBe(true);
    expect(result.data.verdict).toBe('needs_context');
    expect(result.data.confidence).toBe('low');
  });

  test('reconcileVerificationData computes status from sources', () => {
    const result = reconcileVerificationData({
      sources: [
        { name: 'Reuters', status: 'confirmed' },
        { name: 'BBC', status: 'not_yet_reported' },
      ],
      status: 'searching',
    });

    expect(result.changed).toBe(true);
    expect(result.data.status).toBe('partially_verified');
  });

  test('runPipelineQualityGate converts org-like person card to source card', () => {
    const gate = runPipelineQualityGate([
      {
        id: 'hero',
        cardType: 'hero_summary',
        populatedData: { title: 'Main Headline', subtitle: 'Story subtitle' },
      },
      {
        id: 'person-1',
        cardType: 'person_card',
        populatedData: { name: 'Al Jazeera Egypt Bureau', role: 'News outlet bureau' },
      },
    ], {
      preAnalysis: {
        sourceAttribution: { name: 'Al Jazeera Egypt', type: 'news_outlet' },
      },
    });

    const converted = gate.cards.find((card) => card.id === 'person-1');
    expect(converted.cardType).toBe('source_card');
    expect(converted.populatedData.name).toBe('Al Jazeera Egypt Bureau');
  });

  test('runPipelineQualityGate replaces repetitive did_you_know fact', () => {
    const gate = runPipelineQualityGate([
      {
        id: 'hero',
        cardType: 'hero_summary',
        populatedData: { title: 'Melbourne Wins Best City', subtitle: 'Melbourne ranked best city in the world' },
      },
      {
        id: 'dyk',
        cardType: 'did_you_know_card',
        populatedData: { fact: 'Melbourne ranked best city in the world', emoji: '🌆' },
      },
    ]);

    const didYouKnow = gate.cards.find((card) => card.id === 'dyk');
    expect(didYouKnow.populatedData.fact).not.toBe('Melbourne ranked best city in the world');
  });
});
