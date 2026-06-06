const W = require('../../api/lib/war-sources');

// The targeted YouTube search opens the video pool to the whole web, so clips now
// span global wires, sensational aggregators, foreign-language desks and random
// individuals — and vary wildly in length (vertical Shorts → multi-hour replays).
// channelTier + duration helpers let the builder finetune selection on QUALITY
// once the covers-the-story bar is met.

describe('channelTier — source reputation', () => {
  test('tier 1: global wires and flagship broadcasters', () => {
    for (const c of ['Reuters', 'Associated Press', 'AP Archive', 'Al Jazeera English', 'BBC News', 'CNN', 'FRANCE 24 English', 'DW News', 'NBC News', 'The Guardian', 'Bloomberg', 'MS NOW']) {
      expect(W.channelTier(c)).toBe(1);
    }
  });
  test('tier 2: solid secondary outlets', () => {
    for (const c of ['TRT World', 'The Hill', 'USA TODAY', 'DD India', 'Roya News English', 'Euronews']) {
      expect(W.channelTier(c)).toBe(2);
    }
  });
  test('tier 3: sensational aggregators, foreign desks, individuals, unknown', () => {
    for (const c of ['Times Now', 'WION', 'CRUX', 'India Today', 'Oneindia News', 'Srijan Kalam', 'Today’s Extreme News', 'POS KUPANG', 'CNN-News18', 'CRUX and CNN-News18', 'moneycontrol', '']) {
      expect(W.channelTier(c)).toBe(3);
    }
  });
});

describe('parseDurationText', () => {
  test('parses m:ss and h:mm:ss', () => {
    expect(W.parseDurationText('0:42')).toBe(42);
    expect(W.parseDurationText('3:15')).toBe(195);
    expect(W.parseDurationText('1:02:33')).toBe(3753);
  });
  test('null for live/short/unknown markers', () => {
    expect(W.parseDurationText('')).toBeNull();
    expect(W.parseDurationText('LIVE')).toBeNull();
    expect(W.parseDurationText(undefined)).toBeNull();
  });
});

describe('durationFit — TV-card suitability', () => {
  test('penalises sub-minute Shorts and long bulletins, rewards the 1.5–20 min sweet spot', () => {
    expect(W.durationFit(30)).toBe(0);    // Short / teaser
    expect(W.durationFit(180)).toBe(3);   // ideal news clip
    expect(W.durationFit(900)).toBe(3);   // 15 min segment
    expect(W.durationFit(2400)).toBe(1);  // 40 min bulletin / livestream replay
  });
  test('unknown duration (broadcaster RSS) is neutral-good, not penalised', () => {
    expect(W.durationFit(null)).toBe(2);
  });
});
