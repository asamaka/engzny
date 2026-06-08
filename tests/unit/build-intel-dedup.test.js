const { headlinesDuplicate, dedupeStories } = require('../../scripts/build-intel');

// The cinematic intel wall surfaced multiple near-identical "Israel, Iran trade
// strikes ..." segments because the per-segment newsroom rewrite (Sonnet) ran in
// isolation and converged distinct facets onto the day's dominant macro-event.
// dedupeStories is the deterministic last line of defense: among the FINAL ordered
// stories it drops any whose headline reads as the same story as a higher-priority
// one — while keeping genuinely distinct angles (markets, Trump diplomacy, Houthis).
// The fixtures below are the real headlines from the 2026-06-08 09:00 run.
describe('headlinesDuplicate', () => {
  test('catches a shared lead clause via the leading-prefix signal', () => {
    // Both open "Israel, Iran trade strikes ..." — the identical lead clause.
    expect(headlinesDuplicate(
      'Israel, Iran trade strikes; drone downed over Tehran.',
      'Israel, Iran trade strikes as fragile ceasefire collapses.',
    )).toBe(true);
  });

  test('keeps a distinct angle that merely shares the same actors', () => {
    // Same actors, different lead/angle (Trump diplomacy) — must NOT be a duplicate.
    expect(headlinesDuplicate(
      'Israel, Iran trade strikes; drone downed over Tehran.',
      'Israel strikes Iran hours after Trump urges restraint.',
    )).toBe(false);
  });

  test('keeps the markets angle distinct from the strike-exchange lead', () => {
    expect(headlinesDuplicate(
      'Israel, Iran trade strikes; drone downed over Tehran.',
      'Asia stocks plunge as Iran-Israel trade fresh strikes.',
    )).toBe(false);
  });

  test('keeps clearly unrelated stories distinct', () => {
    expect(headlinesDuplicate(
      'Houthis declare total ban on Israeli ships in Red Sea.',
      'Iran, Iraq, Syria shut airspace after missile exchange.',
    )).toBe(false);
  });

  test('catches a reordered restatement via Jaccard overlap', () => {
    expect(headlinesDuplicate(
      'Iran fires missiles at Israeli bases after Beirut strike.',
      'After a Beirut strike, Iran fires missiles at Israeli bases.',
    )).toBe(true);
  });

  test('is type-safe and ignores empty headlines', () => {
    expect(headlinesDuplicate('', 'Israel, Iran trade strikes.')).toBe(false);
    expect(headlinesDuplicate(undefined, null)).toBe(false);
  });
});

describe('dedupeStories', () => {
  test('drops only the lower-priority near-duplicate, keeping distinct angles', () => {
    const stories = [
      { id: 'iran-composite-war-warning', headline: 'Israel, Iran trade strikes; drone downed over Tehran.' },
      { id: 'iran-israel-regional-escalation', headline: 'Israel, Iran trade strikes as fragile ceasefire collapses.' },
      { id: 'iran-trump-deal-pressure', headline: 'Israel strikes Iran hours after Trump urges restraint.' },
      { id: 'oil-markets-iran-war', headline: 'Asia stocks plunge as Iran-Israel trade fresh strikes.' },
      { id: 'houthi-red-sea-ban', headline: 'Houthis declare total ban on Israeli ships in Red Sea.' },
      { id: 'iran-airspace-closures', headline: 'Iran, Iraq, Syria shut airspace after missile exchange.' },
      { id: 'gaza-ceasefire-violations', headline: 'Israel halts Gaza aid after Iran missile strikes.' },
    ];
    const { kept, dropped } = dedupeStories(stories);
    // The two parallel "Israel, Iran trade strikes ..." segments collapse to one;
    // everything else (a genuinely distinct angle) survives.
    expect(dropped.map(s => s.id)).toEqual(['iran-israel-regional-escalation']);
    expect(kept.map(s => s.id)).toEqual([
      'iran-composite-war-warning',
      'iran-trump-deal-pressure',
      'oil-markets-iran-war',
      'houthi-red-sea-ban',
      'iran-airspace-closures',
      'gaza-ceasefire-violations',
    ]);
  });

  test('keeps the first occurrence (highest display priority) of a duplicate cluster', () => {
    const stories = [
      { id: 'a', headline: 'Iran fires missiles at Israeli bases after Beirut strike.' },
      { id: 'b', headline: 'Iran fires missiles at Israeli bases overnight.' },
    ];
    const { kept, dropped } = dedupeStories(stories);
    expect(kept.map(s => s.id)).toEqual(['a']);
    expect(dropped.map(s => s.id)).toEqual(['b']);
  });

  test('a distinct wall passes through untouched', () => {
    const stories = [
      { id: 'a', headline: 'Houthis declare total ban on Israeli ships in Red Sea.' },
      { id: 'b', headline: 'Oil surges past $97 as war rattles Asian markets.' },
      { id: 'c', headline: 'Trump urges Netanyahu not to hit back after strikes.' },
    ];
    const { kept, dropped } = dedupeStories(stories);
    expect(dropped).toHaveLength(0);
    expect(kept).toHaveLength(3);
  });
});
