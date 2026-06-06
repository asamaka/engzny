const { sanitizeTimeline, isConcreteTime, videoCoversSegment, distinctiveTokens } = require('../../scripts/build-intel');

// These deterministic gates enforce two editorial rules the LLM stages only
// "intend": a timeline must be a genuine, exactly-timestamped sequence, and a
// video must COVER the segment's specific story (not just be regionally relevant).
// Cases are drawn from a real feed snapshot where both rules were being violated.

describe('isConcreteTime — exact timestamp gate', () => {
  test('accepts clock times and specific dates', () => {
    expect(isConcreteTime('Fri 22:00')).toBe(true);
    expect(isConcreteTime('Sat 01:30')).toBe(true);
    expect(isConcreteTime('Jun 4')).toBe(true);
    expect(isConcreteTime('Jun 13 2025')).toBe(true);
    expect(isConcreteTime('Jun 8-12')).toBe(true);
    expect(isConcreteTime('2026-02-28')).toBe(true);
  });
  test('rejects vague buckets and bare weekdays', () => {
    expect(isConcreteTime('Fri evening')).toBe(false);
    expect(isConcreteTime('Fri afternoon')).toBe(false);
    expect(isConcreteTime('Sat AM')).toBe(false);
    expect(isConcreteTime('Sat')).toBe(false);
    expect(isConcreteTime('recently')).toBe(false);
    expect(isConcreteTime('')).toBe(false);
  });
});

describe('sanitizeTimeline — only genuine, datable sequences survive', () => {
  test('drops a timeline with no concrete timestamps', () => {
    // Real "Iran fires 7 missiles" story: all vague, just restating the headline.
    expect(sanitizeTimeline([
      { time: 'Fri evening', cap: 'Iran launches 7 missiles at Kuwait, Bahrain' },
      { time: 'Fri afternoon', cap: 'US shoots down 4 Iranian drones' },
      { time: 'Fri afternoon', cap: 'US strikes radar at Goruk' },
      { time: 'NOW', cap: 'All missiles intercepted or failed', now: true },
    ])).toEqual([]);
  });
  test('keeps a clock-stamped strike chronology', () => {
    const out = sanitizeTimeline([
      { time: 'Fri 22:00', cap: 'Iran launches 7 missiles' },
      { time: 'Fri 14:00', cap: 'US strikes Iranian radar sites' },
      { time: 'Thu 16:00', cap: "Trump: 'honored' to meet Leader" },
      { time: 'NOW', cap: 'Ceasefire holds but talks stalled', now: true },
    ]);
    expect(out).toHaveLength(4);
    expect(out[out.length - 1].now).toBe(true);
  });
  test('keeps a dated multi-day chronology (IAEA)', () => {
    expect(sanitizeTimeline([
      { time: 'Jun 13 2025', cap: 'Israel strikes Natanz, Esfahan, Fordow' },
      { time: 'Feb 28 2026', cap: 'U.S.-Israel conflict begins' },
      { time: 'Jun 4', cap: 'Grossi reports 97-day blackout' },
      { time: 'Jun 8-12', cap: 'IAEA Board session, Vienna', now: true },
    ])).toHaveLength(4);
  });
  test('drops a single-event "sequence" (only NOW + one point)', () => {
    expect(sanitizeTimeline([
      { time: 'Thu Jun 5', cap: 'WFP: 6.1M face acute hunger' },
      { time: 'NOW', cap: 'Iran reports 115% food inflation', now: true },
    ])).toEqual([]);
  });
  test('dedups restated steps and is type-safe', () => {
    expect(sanitizeTimeline(null)).toEqual([]);
    expect(sanitizeTimeline([
      { time: 'Jun 4', cap: 'Same event' },
      { time: 'Jun 5', cap: 'Same event' }, // duplicate cap -> dropped, leaves <2
    ])).toEqual([]);
  });
});

describe('videoCoversSegment — covers the story, not "relevant by nature"', () => {
  const inflation = { headline: 'Iran faces hunger, triple-digit inflation as war enters 100 days', aiSummary: 'WFP warns of acute hunger; Iran reports 115% food inflation.' };
  const generalKilled = { headline: 'Israeli strike kills Lebanese general, 2 soldiers despite truce', aiSummary: 'A strike killed a Lebanese army general and two soldiers.' };
  const aoun = { headline: 'Lebanese president rebukes Iran; FM fires back on X', aiSummary: 'Aoun told CNN Iran is using Lebanon; Araghchi fired back.' };

  test('rejects a generic regional clip on an off-story segment', () => {
    // This Lebanon humanitarian clip was really attached to the Iran-inflation story.
    const clip = { title: 'UN Warns of a Deepening Humanitarian Catastrophe in Lebanon' };
    expect(videoCoversSegment(clip, inflation)).toBe(0);
  });

  test('rejects a same-region clip that does not cover the specific event', () => {
    // "Israel strikes Lebanon after Hezbollah rejects ceasefire" does NOT cover a
    // strike that killed a named general — shares only generic war/region tokens.
    const clip = { title: 'Israel continues strikes on Lebanon after Hezbollah rejects ceasefire' };
    expect(videoCoversSegment(clip, generalKilled)).toBeLessThan(2);
  });

  test('accepts a clip that covers the exact story', () => {
    const clip = { title: "Iran Rejects Aoun's Claims Over Lebanon Amid Ceasefire Row" };
    expect(videoCoversSegment(clip, aoun)).toBeGreaterThanOrEqual(2);
  });

  test('distinctive tokens exclude the scope-generic vocabulary', () => {
    const toks = distinctiveTokens('Iran Israel war strikes Hezbollah Hormuz IAEA');
    expect(toks.has('iran')).toBe(false);   // umbrella actor -> generic
    expect(toks.has('israel')).toBe(false); // universal actor -> generic
    expect(toks.has('war')).toBe(false);    // editorial filler -> generic
    expect(toks.has('hezbollah')).toBe(true); // front-specific -> distinctive
    expect(toks.has('hormuz')).toBe(true);
    expect(toks.has('iaea')).toBe(true);
  });
});
