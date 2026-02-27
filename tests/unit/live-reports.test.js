const liveReports = require('../../api/lib/live-reports');

describe('Live Reports', () => {
  beforeEach(() => {
    liveReports.init(() => null); // memory-only mode
  });

  afterEach(() => {
    liveReports._resetForTest();
  });

  describe('saveLiveReport', () => {
    it('should save and retrieve a report', async () => {
      const data = {
        contentType: 'news',
        layoutType: 'editorial',
        cardCount: 5,
        duration: 21000,
        outcome: 'success',
        imageSize: '2290KB',
        cards: [{ id: 'hero', cardType: 'hero_summary', data: { title: 'Test' } }],
      };
      const entry = await liveReports.saveLiveReport('abc123', data);
      expect(entry.requestId).toBe('abc123');
      expect(entry.createdAt).toBeDefined();
      expect(entry.expiresAt).toBeDefined();
      expect(entry.outcome).toBe('success');

      const retrieved = await liveReports.getLiveReport('abc123');
      expect(retrieved).not.toBeNull();
      expect(retrieved.requestId).toBe('abc123');
      expect(retrieved.cards).toHaveLength(1);
      expect(retrieved.cards[0].data.title).toBe('Test');
    });

    it('should return null for non-existent report', async () => {
      const report = await liveReports.getLiveReport('nonexistent');
      expect(report).toBeNull();
    });

    it('should include expiry time 1 hour in the future', async () => {
      const before = Date.now();
      await liveReports.saveLiveReport('exp1', { outcome: 'success' });
      const after = Date.now();

      const report = await liveReports.getLiveReport('exp1');
      const expiresAt = new Date(report.expiresAt).getTime();
      expect(expiresAt).toBeGreaterThanOrEqual(before + 3600 * 1000 - 100);
      expect(expiresAt).toBeLessThanOrEqual(after + 3600 * 1000 + 100);
    });
  });

  describe('listLiveReports', () => {
    it('should list reports in reverse chronological order', async () => {
      await liveReports.saveLiveReport('first', { outcome: 'success', layoutType: 'simple' });
      await liveReports.saveLiveReport('second', { outcome: 'success', layoutType: 'editorial' });

      const list = await liveReports.listLiveReports();
      expect(list).toHaveLength(2);
      expect(list[0].requestId).toBe('second');
      expect(list[1].requestId).toBe('first');
    });

    it('should return summary data without full card content', async () => {
      await liveReports.saveLiveReport('summary1', {
        outcome: 'success',
        layoutType: 'editorial',
        cardCount: 3,
        cards: [{ id: 'c1', data: { title: 'Big card content' } }],
        thumb: 'base64data',
      });

      const list = await liveReports.listLiveReports();
      expect(list[0].requestId).toBe('summary1');
      expect(list[0].layoutType).toBe('editorial');
      expect(list[0].cardCount).toBe(3);
      expect(list[0].hasThumb).toBe(true);
      expect(list[0].cards).toBeUndefined();
      expect(list[0].thumb).toBeUndefined();
    });
  });

  describe('getLiveReportThumb', () => {
    it('should return thumbnail data', async () => {
      await liveReports.saveLiveReport('thumb1', { thumb: 'base64thumbdata' });
      const thumb = await liveReports.getLiveReportThumb('thumb1');
      expect(thumb).toBe('base64thumbdata');
    });

    it('should return null when no thumbnail', async () => {
      await liveReports.saveLiveReport('nothumb', { outcome: 'success' });
      const thumb = await liveReports.getLiveReportThumb('nothumb');
      expect(thumb).toBeNull();
    });
  });
});
