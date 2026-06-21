const H = require('../../api/lib/hormuz');

describe('hormuz: ship classification', () => {
  test('maps AIS type codes to coarse classes', () => {
    expect(H.shipClass(80)).toBe('tanker');
    expect(H.shipClass(89)).toBe('tanker');
    expect(H.shipClass(70)).toBe('cargo');
    expect(H.shipClass(60)).toBe('passenger');
    expect(H.shipClass(35)).toBe('military');
    expect(H.shipClass(30)).toBe('fishing');
    expect(H.shipClass(52)).toBe('service');
    expect(H.shipClass(0)).toBe('other');
    expect(H.shipClass(undefined)).toBe('other');
  });
});

describe('hormuz: normalizeAis', () => {
  test('parses a PositionReport envelope', () => {
    const m = H.normalizeAis({
      MessageType: 'PositionReport',
      MetaData: { MMSI: 123456789, time_utc: '2026-06-20 10:00:00.000000 +0000 UTC' },
      Message: { PositionReport: { Latitude: 26.5, Longitude: 56.2, Sog: 12.3, Cog: 270, NavigationalStatus: 0, UserID: 123456789 } },
    });
    expect(m.kind).toBe('pos');
    expect(m.mmsi).toBe('123456789');
    expect(m.lat).toBeCloseTo(26.5); expect(m.lon).toBeCloseTo(56.2);
    expect(m.sog).toBeCloseTo(12.3); expect(m.cog).toBe(270);
    expect(m.t).toBe(Date.parse('2026-06-20T10:00:00.000Z'));
  });
  test('parses a ShipStaticData envelope and strips AIS padding', () => {
    const m = H.normalizeAis({
      MessageType: 'ShipStaticData',
      MetaData: { MMSI: 555 },
      Message: { ShipStaticData: { UserID: 555, Name: 'FRONT ALTAIR@@@', Type: 80, Destination: 'FUJAIRAH ' } },
    });
    expect(m.kind).toBe('static');
    expect(m.name).toBe('FRONT ALTAIR'); // @ padding stripped, internal space kept
    expect(m.type).toBe(80);
    expect(m.dest).toBe('FUJAIRAH');
  });
  test('returns null for irrelevant/garbage', () => {
    expect(H.normalizeAis(null)).toBeNull();
    expect(H.normalizeAis({ MessageType: 'Other' })).toBeNull();
  });
});

describe('hormuz: mergeMessages + pruning', () => {
  const now = 1_700_000_000_000;
  test('appends points, dedupes bursts, attaches static info', () => {
    let s = H.emptyStore(now - 1000);
    s = H.mergeMessages(s, [
      { kind: 'static', mmsi: '1', name: 'TANKER X', type: 80, dest: 'JEBEL ALI' },
      { kind: 'pos', mmsi: '1', t: now - 60000, lat: 26.5, lon: 57.0, sog: 12, cog: 280 },
      { kind: 'pos', mmsi: '1', t: now - 59000, lat: 26.5, lon: 57.0, sog: 12, cog: 280 }, // burst dupe (no gap/move)
      { kind: 'pos', mmsi: '1', t: now, lat: 26.5, lon: 56.5, sog: 11, cog: 280 },
    ], now);
    expect(s.vessels['1'].cls).toBe('tanker');
    expect(s.vessels['1'].name).toBe('TANKER X'); // merge stores the (already-normalized) name verbatim
    expect(s.vessels['1'].track.length).toBe(2); // burst dupe folded
  });
  test('drops points older than 48h and removes empty vessels', () => {
    let s = H.emptyStore(now - 100 * 3600 * 1000);
    s = H.mergeMessages(s, [
      { kind: 'pos', mmsi: '9', t: now - 50 * 3600 * 1000, lat: 26.5, lon: 57.0, sog: 5 }, // >48h old
    ], now);
    expect(s.vessels['9']).toBeUndefined();
  });
});

describe('hormuz: analyzeVessel direction + transit', () => {
  const t0 = 1_700_000_000_000;
  const mk = (lons) => ({ track: lons.map((lon, i) => ({ t: t0 + i * 600000, lat: 26.6, lon, sog: 12, cog: 270 })) });

  test('westbound = inbound (into the Persian Gulf)', () => {
    const a = H.analyzeVessel(mk([57.2, 56.8, 56.3, 55.9])); // moving west
    expect(a.moving).toBe(true);
    expect(a.direction).toBe('inbound');
    expect(a.transit).toBe(true);
    expect(a.dist).toBeGreaterThan(6);
  });
  test('eastbound = outbound (out to the Gulf of Oman)', () => {
    const a = H.analyzeVessel(mk([55.9, 56.3, 56.8, 57.2]));
    expect(a.direction).toBe('outbound');
    expect(a.transit).toBe(true);
  });
  test('anchored vessel is stationary, not a transit', () => {
    const v = { track: [0, 1, 2, 3].map(i => ({ t: t0 + i * 600000, lat: 26.5, lon: 56.5, sog: 0.1, cog: 0 })) };
    const a = H.analyzeVessel(v);
    expect(a.moving).toBe(false);
    expect(a.direction).toBe('stationary');
    expect(a.transit).toBe(false);
  });
});

describe('hormuz: summarize', () => {
  const now = 1_700_000_000_000;
  function storeWith(vessels) { return { startedAt: now - 24 * 3600 * 1000, updatedAt: now, vessels }; }
  test('counts movers, classes, directions and transits', () => {
    const mkTrack = (lons, sog = 12) => lons.map((lon, i) => ({ t: now - (lons.length - 1 - i) * 600000, lat: 26.6, lon, sog }));
    const s = storeWith({
      '1': { mmsi: '1', name: 'T1', type: 80, cls: 'tanker', dest: 'X', track: mkTrack([57.2, 56.6, 55.9]) }, // inbound transit
      '2': { mmsi: '2', name: 'C1', type: 70, cls: 'cargo', dest: 'Y', track: mkTrack([55.9, 56.6, 57.2]) },  // outbound transit
      '3': { mmsi: '3', name: 'A1', type: 80, cls: 'tanker', dest: 'Z', track: mkTrack([56.5, 56.5, 56.5], 0.1) }, // anchored
    });
    const out = H.summarize(s, now);
    expect(out.counts.total).toBe(3);
    expect(out.counts.moving).toBe(2);
    expect(out.counts.byClass.tanker).toBe(2);
    expect(out.counts.byDirection.inbound).toBe(1);
    expect(out.counts.byDirection.outbound).toBe(1);
    expect(out.transits.last48h).toBe(2);
    expect(out.transits.last24h).toBe(2);
    expect(out.movers.length).toBe(2); // anchored excluded from the map
    expect(out.movers[0].track.length).toBeGreaterThan(1);
  });
});

describe('hormuz: computeVerdict bands', () => {
  test('warming up before enough coverage', () => {
    expect(H.computeVerdict(2, 0, 0).state).toBe('WARMING_UP');
  });
  test('open / reduced / severe / closed by ratio', () => {
    expect(H.computeVerdict(48, 80, 0.8).state).toBe('OPEN');
    expect(H.computeVerdict(48, 40, 0.4).state).toBe('REDUCED');
    expect(H.computeVerdict(48, 12, 0.12).state).toBe('SEVERELY_REDUCED');
    expect(H.computeVerdict(48, 1, 0.01).state).toBe('CLOSED');
  });
});

describe('hormuz: haversineNm', () => {
  test('~1 degree of longitude at the equator is ~60 nm', () => {
    expect(H.haversineNm({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(60, 0);
  });
});
