const { buildResearchQuery } = require('../../api/agents/deep-researcher');

describe('DeepResearcher query construction', () => {
  test('buildResearchQuery includes date anchors and pre-analysis hints', () => {
    const query = buildResearchQuery(
      {
        contentType: 'breaking_news',
        platform: 'Facebook',
        intent: 'Verify whether the claim is current and confirmed',
        topQuestions: ['Is this verified?'],
      },
      [
        {
          cardType: 'verification_card',
          placeholderData: { claim: 'Iran launched attacks every 90 minutes' },
        },
      ],
      {
        preAnalysis: {
          visibleClaim: 'Iran launched attacks every 90 minutes since last night',
          sourceAttribution: { name: 'Al Jazeera Egypt' },
          timeContext: { mentionedDate: 'March 15, 2026' },
          contentItems: [{ kind: 'post', summary: 'Arabic breaking-news post', prominence: 'primary' }],
        },
        translationVerification: {
          normalizedTranslation: 'Iran launched attacks every 90 minutes since last night',
          shouldOverrideClaim: true,
          keyTerms: [{ source: 'كل 90 دقيقة', translation: 'every 90 minutes' }],
        },
      }
    );

    expect(query).toContain('Current date anchor');
    expect(query).toContain('Visible source attribution');
    expect(query).toContain('March');
    expect(query).toContain('2026');
    expect(query).toContain('Iran launched attacks every 90 minutes since last night');
    expect(query).toContain('Al Jazeera Egypt');
  });
});
