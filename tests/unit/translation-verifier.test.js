const {
  parseTranslationVerification,
  normalizeTranslationVerification,
  createSkippedTranslationVerification,
} = require('../../api/agents/translation-verifier');

describe('TranslationVerifier helpers', () => {
  test('parseTranslationVerification extracts JSON response', () => {
    const parsed = parseTranslationVerification('{"normalizedTranslation":"Iran must remove mines"}');
    expect(parsed.normalizedTranslation).toBe('Iran must remove mines');
  });

  test('normalizeTranslationVerification detects high-severity override', () => {
    const preAnalysis = {
      language: 'ar',
      visibleClaim: 'Iran must remove nuclear weapons immediately',
    };

    const normalized = normalizeTranslationVerification({
      language: 'ar',
      normalizedTranslation: 'Iran must remove any mines it planted immediately',
      discrepancies: [
        { term: 'ألغام', issue: 'Means naval mines, not nuclear weapons', severity: 'high' },
      ],
      confidence: 'high',
    }, preAnalysis);

    expect(normalized.skipped).toBe(false);
    expect(normalized.shouldOverrideClaim).toBe(true);
    expect(normalized.discrepancies[0].severity).toBe('high');
  });

  test('createSkippedTranslationVerification preserves first-pass claim', () => {
    const skipped = createSkippedTranslationVerification({
      language: 'en',
      visibleClaim: 'English source claim',
    });

    expect(skipped.skipped).toBe(true);
    expect(skipped.normalizedTranslation).toBe('English source claim');
    expect(skipped.shouldOverrideClaim).toBe(false);
  });
});
