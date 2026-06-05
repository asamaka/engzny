const E = require('../../api/lib/intel-eval');

// Fixed "now" so age-based scores are deterministic.
const NOW = Date.parse('2026-06-05T20:00:00Z');
const hAgo = (h) => new Date(NOW - h * 3600000).toISOString();

function story({ id, headline, brief = '', newestSourceAt, firstReportedAt, label = 'updated', at } = {}) {
  return {
    id, headline, brief,
    freshness: { label, at: at || newestSourceAt || firstReportedAt },
    meta: { firstReportedAt, newestSourceAt },
    drilldown: { aiSummary: brief, sources: newestSourceAt ? [{ publishedAt: newestSourceAt }] : [], videos: [] },
  };
}

describe('intel-eval pure scoring', () => {
  describe('overlap / tokens', () => {
    it('scores token overlap by the smaller set', () => {
      const a = E.tokens('Israel strikes Lebanon ceasefire');
      const b = E.tokens('Israel strikes Lebanon despite ceasefire Berri calls deal rigged');
      expect(E.overlap(a, b)).toBeGreaterThanOrEqual(0.75);
      expect(E.overlap(E.tokens('apple banana'), E.tokens('israel lebanon'))).toBe(0);
    });
  });

  describe('scoreCoverage', () => {
    const stories = [
      story({ id: 's-lebanon', headline: 'Israel strikes Lebanon despite ceasefire', newestSourceAt: hAgo(4) }),
      story({ id: 's-hormuz', headline: 'Strait of Hormuz blockade odds fall', newestSourceAt: hAgo(6) }),
    ];

    it('matches covered events and lists importance-sorted misses', () => {
      const events = [
        { title: 'Israel strikes Lebanon overnight near Beirut', importance: 5, front: 'levant' },
        { title: 'Iran resumes uranium enrichment at Natanz', importance: 4, front: 'nuclear-diplomacy' },
        { title: 'Hormuz shipping insurance spikes again', importance: 2 },
      ];
      const cov = E.scoreCoverage(stories, events);
      const coveredTitles = cov.covered.map(c => c.title);
      expect(coveredTitles).toContain('Israel strikes Lebanon overnight near Beirut');
      // The Natanz enrichment event is genuinely missing from the wall.
      expect(cov.missed.map(m => m.title)).toContain('Iran resumes uranium enrichment at Natanz');
      // Misses are importance-sorted (the 4/5 before the 2/5).
      expect(cov.missed[0].importance).toBeGreaterThanOrEqual(cov.missed[cov.missed.length - 1].importance);
      expect(cov.score).toBeGreaterThan(0);
      expect(cov.score).toBeLessThan(100);
    });

    it('returns full recall when nothing is missed', () => {
      const cov = E.scoreCoverage(stories, [{ title: 'Hormuz blockade odds fall sharply', importance: 3 }]);
      expect(cov.score).toBe(100);
      expect(cov.missed).toHaveLength(0);
    });
  });

  describe('scoreFreshness', () => {
    it('rewards recent sources and flags dishonest "old" labels', () => {
      const recent = [story({ id: 'a', headline: 'x', newestSourceAt: hAgo(3) })];
      expect(E.scoreFreshness(recent, NOW).score).toBeGreaterThan(80);

      // Newest source is 3h old but the story is stamped 2 days ago -> mislabeled.
      const mislabeled = [story({ id: 'b', headline: 'y', newestSourceAt: hAgo(3), label: 'first reported', at: hAgo(48) })];
      const f = E.scoreFreshness(mislabeled, NOW);
      expect(f.mislabeled).toHaveLength(1);
      expect(f.labelHonesty).toBeLessThan(1);
    });
  });

  describe('scoreStaleness', () => {
    it('counts the fraction of the wall older than the threshold', () => {
      const stories = [
        story({ id: 'fresh', headline: 'a', newestSourceAt: hAgo(2) }),
        story({ id: 'old', headline: 'b', newestSourceAt: hAgo(40) }),
      ];
      const s = E.scoreStaleness(stories, NOW, 24);
      expect(s.staleFraction).toBeCloseTo(0.5, 5);
      expect(s.stale.map(x => x.id)).toEqual(['old']);
      expect(s.score).toBe(50);
    });
  });

  describe('scoreMarketAlignment', () => {
    it('measures how many real market questions are on the rail', () => {
      const signals = [{ question: 'Will the US blockade of the Strait of Hormuz be lifted by June 15?' }];
      const real = ['Will the Strait of Hormuz blockade be lifted by mid June?', 'Will Iran and the US sign a ceasefire by July?'];
      const m = E.scoreMarketAlignment(signals, real);
      expect(m.realCovered.length).toBe(1);
      expect(m.realMissed.length).toBe(1);
      expect(m.score).toBe(50);
    });
  });

  describe('computeMetrics + compositeScore', () => {
    it('produces a weighted composite in 0..100', () => {
      const bundle = {
        generatedAt: hAgo(1),
        stories: [story({ id: 's-lebanon', headline: 'Israel strikes Lebanon despite ceasefire', newestSourceAt: hAgo(4) })],
        signals: [{ question: 'Will the Hormuz blockade be lifted by June 15?' }],
      };
      const gt = {
        events: [{ title: 'Israel strikes Lebanon near Beirut overnight', importance: 5 }],
        marketQuestions: ['Will the Hormuz blockade be lifted by mid June?'],
      };
      const m = E.computeMetrics(bundle, gt, NOW);
      expect(m.composite).toBeGreaterThan(0);
      expect(m.composite).toBeLessThanOrEqual(100);
      expect(m.coverage.score).toBe(100);
    });
  });

  describe('feedDigest', () => {
    it('renders stories + market rail for the judge, flagging missing images', () => {
      const bundle = {
        stories: [story({ id: 's1', headline: 'Israel strikes Lebanon', brief: 'b', newestSourceAt: hAgo(4) })],
        signals: [{ question: 'Hormuz blockade lifted by June 15?', prob: '43%', delta: '-3 pts' }],
      };
      const d = E.feedDigest(bundle);
      expect(d.stories).toContain('id=s1');
      expect(d.stories).toContain('Israel strikes Lebanon');
      expect(d.stories).toContain('image: NONE'); // story has no image field
      expect(d.sigs).toContain('Hormuz blockade lifted');
    });
  });

  describe('reconcileWorldviews', () => {
    it('marks cross-confirmed stories high-confidence and single-provider ones low', () => {
      const gemini = { provider: 'gemini', situation: 'g', marketQuestions: ['Hormuz lifted by June 15?'],
        topHeadlines: [{ title: 'Hezbollah rejects ceasefire deal', summary: 'short', importance: 5, front: 'levant' },
                       { title: 'Iran-US talks deadlock over frozen assets', summary: 'x', importance: 4 }] };
      const opus = { provider: 'opus', situation: 'o', marketQuestions: ['Iran ceasefire by July?'],
        topHeadlines: [{ title: 'Hezbollah rejects the Washington ceasefire truce', summary: 'a much longer summary', importance: 4, front: 'levant' },
                       { title: 'Global oil crisis: IEA largest disruption ever', summary: 'y', importance: 4 }] };
      const r = E.reconcileWorldviews([gemini, opus]);
      expect(r.providersUsed).toEqual(['gemini', 'opus']);
      const lebanon = r.topHeadlines.find(h => /hezbollah/i.test(h.title));
      expect(lebanon.confidence).toBe('high');
      expect(lebanon.providers.sort()).toEqual(['gemini', 'opus']);
      expect(lebanon.summary).toBe('a much longer summary'); // keeps the richer summary
      expect(r.topHeadlines[0]).toBe(lebanon); // cross-confirmed sorts first
      const oil = r.topHeadlines.find(h => /oil/i.test(h.title));
      expect(oil.confidence).toBe('low');
      expect(r.marketQuestions).toHaveLength(2); // unioned
    });

    it('single provider yields medium confidence (no cross-check available)', () => {
      const only = { provider: 'gemini', situation: 'g', marketQuestions: [],
        topHeadlines: [{ title: 'Some real story', importance: 3 }] };
      const r = E.reconcileWorldviews([only]);
      expect(r.topHeadlines[0].confidence).toBe('medium');
    });
  });

  describe('summarize', () => {
    it('extracts a compact trend-line entry', () => {
      const report = {
        evaluatedAt: hAgo(0), snapshotGeneratedAt: hAgo(1),
        scores: { composite: 72, coverage: 80, freshness: 70, staleness: 60, marketAlignment: 75 },
        reflection: { grade: 'B' },
        coverage: { missed: [{ title: 'Missed thing' }] },
      };
      const s = E.summarize(report);
      expect(s.composite).toBe(72);
      expect(s.grade).toBe('B');
      expect(s.missedCount).toBe(1);
      expect(s.topMiss).toBe('Missed thing');
    });
  });
});
