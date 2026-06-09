const {
  videoFresherThan, videoQueryFor, videoCoversSegment, distinctiveTokens, reconcileLayoutModules, videoCard,
} = require('../../scripts/build-intel');

// The video pipeline now has three layers that kill the recurring-event mismatch
// (a clip of an EARLIER similar strike attaching to a NEW one): a freshness floor, a
// more specific search query, a tighter "covers" gate, and a batched Opus review.
// These cover the pure pieces of that.

describe('videoFresherThan — a clip must postdate the event (and be datable)', () => {
  const floor = Date.parse('2026-06-09T00:00:00Z');
  test('rejects a clip published before the event was first reported', () => {
    // A 2-day-old clip of an earlier similar strike predates today's event.
    expect(videoFresherThan({ publishedAt: '2026-06-07T12:00:00Z' }, floor)).toBe(false);
  });
  test('accepts a clip published at/after the floor', () => {
    expect(videoFresherThan({ publishedAt: '2026-06-09T06:00:00Z' }, floor)).toBe(true);
  });
  test('rejects an undated clip (no timestamp to show, no way to verify freshness)', () => {
    expect(videoFresherThan({ publishedAt: null }, floor)).toBe(false);
    expect(videoFresherThan({}, floor)).toBe(false);
  });
  test('with no floor, any DATED clip passes but undated still fails', () => {
    expect(videoFresherThan({ publishedAt: '2020-01-01T00:00:00Z' }, 0)).toBe(true);
    expect(videoFresherThan({ publishedAt: null }, 0)).toBe(false);
  });
});

describe('videoQueryFor — specific multi-keyword query, not 2-3 generic words', () => {
  const seg = {
    headline: 'Iran strikes Kuwait airport in overnight barrage.',
    brief: 'Ballistic missiles struck the international terminal; casualties reported.',
  };
  const q = videoQueryFor(seg);
  test('keeps the full headline (no early truncation at the period)', () => {
    expect(q).toContain('Kuwait');
    expect(q).toContain('airport');
    expect(q.endsWith('.')).toBe(false);   // trailing period stripped
  });
  test('appends distinctive subject tokens from the brief for specificity', () => {
    expect(q).toContain('ballistic');
    expect(q.length).toBeGreaterThan(seg.headline.length);
  });
  test('is bounded in length', () => {
    expect(q.length).toBeLessThanOrEqual(160);
  });
});

describe('expanded generic vocabulary — leaders/deal/ceasefire are not distinctive', () => {
  test('pervasive political/diplomatic words are treated as scope-generic', () => {
    const toks = distinctiveTokens('Trump Netanyahu ceasefire deal talks pause truce');
    for (const w of ['trump', 'netanyahu', 'ceasefire', 'deal', 'talk', 'pause', 'truce']) {
      expect(toks.has(w)).toBe(false);
    }
  });
  test('front-specific subjects stay distinctive', () => {
    const toks = distinctiveTokens('Hormuz Apache helicopter Kuwait IAEA Hezbollah');
    for (const w of ['hormuz', 'apache', 'helicopter', 'kuwait', 'iaea', 'hezbollah']) {
      expect(toks.has(w)).toBe(true);
    }
  });
  test('a generic deal/leaders clip no longer "covers" an off-event story', () => {
    // The real bug: this clip landed on an Apache-crash / Hormuz story.
    const clip = { title: 'Trump says Iran deal could be signed within days' };
    const seg = {
      headline: 'Apache crew safe after Monday crash near Hormuz',
      aiSummary: 'A US Army Apache helicopter crashed near the Strait of Hormuz as Trump pursues an Iran deal; the crew is safe.',
    };
    expect(videoCoversSegment(clip, seg)).toBeLessThan(2);
  });
  test('a clip that covers the exact event still scores', () => {
    const clip = { title: 'Apache helicopter crashes near Strait of Hormuz, crew reported safe' };
    const seg = {
      headline: 'Apache crew safe after Monday crash near Hormuz',
      aiSummary: 'A US Army Apache helicopter crashed near the Strait of Hormuz; the crew is safe.',
    };
    expect(videoCoversSegment(clip, seg)).toBeGreaterThanOrEqual(2);
  });
});

describe('reconcileLayoutModules — modules follow the post-curation video/timeline set', () => {
  test('drops the videos module when curation removed all videos', () => {
    const st = { hasMarket: false, drilldown: { videos: [], timeline: [], layout: { modules: ['summary', 'videos', 'sources'] } } };
    reconcileLayoutModules(st);
    expect(st.drilldown.layout.modules).not.toContain('videos');
    expect(st.drilldown.layout.modules).toContain('summary');
  });
  test('drops the timeline module when fewer than 2 dated steps survive', () => {
    const st = { hasMarket: false, drilldown: { videos: [{ videoId: 'a' }], timeline: [{ time: 'Jun 4', cap: 'x' }], layout: { modules: ['summary', 'timeline', 'videos'], showTimeline: true } } };
    reconcileLayoutModules(st);
    expect(st.drilldown.layout.modules).not.toContain('timeline');
    expect(st.drilldown.layout.showTimeline).toBe(false);
  });
  test('adds the videos module back when curation added videos', () => {
    const st = { hasMarket: false, drilldown: { videos: [{ videoId: 'a' }, { videoId: 'b' }], timeline: [], layout: { modules: ['summary', 'sources'] } } };
    reconcileLayoutModules(st);
    expect(st.drilldown.layout.modules).toContain('videos');
  });
  test('always keeps summary and caps at 5 modules', () => {
    const st = { hasMarket: true, drilldown: { videos: [{ videoId: 'a' }], timeline: [{ time: 'Jun 4', cap: 'x' }, { time: 'Jun 5', cap: 'y' }], layout: { modules: ['marketImpact', 'videos', 'timeline', 'sources', 'keyQuote', 'statCallouts'], showTimeline: true } } };
    reconcileLayoutModules(st);
    expect(st.drilldown.layout.modules).toContain('summary');
    expect(st.drilldown.layout.modules.length).toBeLessThanOrEqual(5);
  });
});

describe('videoCard — always carries a thumbnail + publishedAt for the timestamp', () => {
  test('builds a clean card and defaults the thumbnail URL', () => {
    const card = videoCard({ videoId: 'XYZ', title: 'T', channel: 'Reuters', publishedAt: '2026-06-09T06:00:00Z', durationSec: 120, covers: 5, tier: 1 });
    expect(card).toEqual({
      videoId: 'XYZ', title: 'T', channel: 'Reuters',
      thumbnailUrl: 'https://i.ytimg.com/vi/XYZ/hqdefault.jpg',
      publishedAt: '2026-06-09T06:00:00Z', durationSec: 120,
    });
    expect(card.covers).toBeUndefined();   // scoring fields stripped from the bundle
  });
});
