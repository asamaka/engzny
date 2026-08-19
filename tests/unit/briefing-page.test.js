const request = require('supertest');

describe('public briefing page routes', () => {
  let app;
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.ANTHROPIC_API_KEY = 'sk-ant-api03-test-key-for-briefing-page';
    jest.resetModules();
    app = require('../../api/index');
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test.each(['/briefing', '/tv'])('serves the public briefing shell at %s', async (route) => {
    const res = await request(app).get(route).expect(200);
    expect(res.text).toContain('thinx.fun Briefing');
    expect(res.text).toContain('Responsive public mirror of the live Samsung TV briefing');
    expect(res.text).toContain('/api/tv/briefing');
  });
});
