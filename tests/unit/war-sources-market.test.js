const W = require('../../api/lib/war-sources');

// A market signal's headline price (prob/delta) and its chart (history) must come
// from the SAME source. The bug: prob was taken from the Gamma snapshot
// (m.probability) while the chart used CLOB prices-history — they drift apart
// (e.g. 16% vs 50%), so a card's big number disagreed with its own chart and with
// the detail view. enrichSpikesWithHistory must derive prob from the history tail.
describe('enrichSpikesWithHistory — price stays in sync with the chart', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  // Build a 30-hour CLOB series climbing 0.16 → 0.50 (so the chart ends at 50%).
  function fakeHistory() {
    const now = Math.floor(Date.now() / 1000);
    const h = [];
    for (let i = 29; i >= 0; i--) {
      const p = 0.16 + ((29 - i) / 29) * (0.50 - 0.16); // 0.16 → 0.50
      h.push({ t: now - i * 3600, p: Math.round(p * 1000) / 1000 });
    }
    return h;
  }

  test('prob follows the CLOB history last point, NOT the stale Gamma probability', async () => {
    const hist = fakeHistory();
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ history: hist }) }));

    const candidate = {
      id: 'm1', conditionId: 'c1', question: 'Will X happen?',
      yesToken: 'tok-1', probability: 0.16,   // stale Gamma snapshot — must NOT win
      volume: '1.2M', byDate: 'by Dec 31, 2026',
    };
    const out = await W.enrichSpikesWithHistory([candidate], { threshold: 0.03, max: 4 });
    expect(out).toHaveLength(1);
    const sig = out[0];

    const chartLast = Math.round(hist[hist.length - 1].p * 100); // 50
    expect(sig.prob).toBe(chartLast + '%');                       // 50%, not 16%
    expect(sig.prob).not.toBe('16%');
    // the chart series the client plots must agree with the headline number
    const histLast = Math.round(sig.history[sig.history.length - 1] * 100);
    expect(histLast).toBe(chartLast);
    // probColor is derived from the same (correct) price
    expect(sig.probColor).toBe('amber'); // 50% → amber (>15 and <60)
    // a rising series yields a positive 24h delta
    expect(sig.deltaColor).toBe('green');
    expect(sig.delta).toMatch(/^\+\d+ pts$/);
  });

  test('falls back to the Gamma probability only when there is no history', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ history: [] }) }));
    const candidate = {
      id: 'm2', conditionId: 'c2', question: 'Will Y happen?',
      yesToken: 'tok-2', probability: 0.72, delta24h: 0.10, volume: '900K',
    };
    const out = await W.enrichSpikesWithHistory([candidate], { threshold: 0.03, max: 4 });
    expect(out).toHaveLength(1);
    expect(out[0].prob).toBe('72%');         // no history → Gamma snapshot is the only source
    expect(out[0].history).toEqual([]);
  });
});
