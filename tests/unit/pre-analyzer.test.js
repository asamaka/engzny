const {
  parsePreAnalysis,
  normalizePreAnalysis,
  createFallbackPreAnalysis,
} = require('../../api/agents/pre-analyzer');

describe('PreAnalyzer helpers', () => {
  test('parsePreAnalysis extracts JSON from code fences', () => {
    const parsed = parsePreAnalysis('```json\n{"language":"ar","visibleClaim":"Test"}\n```');
    expect(parsed).toEqual({ language: 'ar', visibleClaim: 'Test' });
  });

  test('normalizePreAnalysis adds derived defaults', () => {
    const normalized = normalizePreAnalysis({
      language: 'AR',
      visibleClaim: 'Literal translated claim',
      sourceAttribution: { name: 'Al Jazeera', type: 'news_outlet', confidence: 'high' },
      namedPeople: ['Benjamin Netanyahu'],
      namedOrganizations: [{ name: 'IRGC', confidence: 'medium' }],
      locationHints: ['Israel'],
      contentItems: [{ kind: 'post', summary: 'Main post', prominence: 'primary' }],
    });

    expect(normalized.language).toBe('ar');
    expect(normalized.requiresTranslationVerification).toBe(true);
    expect(normalized.sourceAttribution.name).toBe('Al Jazeera');
    expect(normalized.namedPeople[0]).toEqual({ name: 'Benjamin Netanyahu', confidence: 'low' });
    expect(normalized.contentItems[0].summary).toBe('Main post');
  });

  test('createFallbackPreAnalysis is safe and English-first', () => {
    const fallback = createFallbackPreAnalysis();
    expect(fallback.language).toBe('en');
    expect(fallback.requiresTranslationVerification).toBe(false);
    expect(fallback.namedPeople).toEqual([]);
    expect(fallback.sourceAttribution.type).toBe('unknown');
  });
});
