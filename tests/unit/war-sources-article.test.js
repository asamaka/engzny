const W = require('../../api/lib/war-sources');

// Pure (no-network) coverage for the article-body extractor's HTML→text path —
// the layer that turns a fetched page into the clean prose the newsroom rewrite
// reads. Network fetching + Redis caching are integration concerns, not tested here.
describe('htmlToText (article-body extraction)', () => {
  const html = `<html><head><title>x</title>
    <script>var a={x:1};</script><style>.x{color:red}</style></head>
    <body><nav>Home About Subscribe</nav>
    <article>
      <p>Share</p>
      <p>Iran&#39;s Supreme Leader Ayatollah Khamenei said on Thursday the enemy was &quot;humiliated&quot; after recent setbacks, according to state television.</p>
      <p>Independent outlets reported the remarks came during the annual Khomeini anniversary ceremony &mdash; a routine address, not a new escalation.</p>
      <figure><figcaption>A short caption here</figcaption></figure>
    </article></body></html>`;

  test('keeps real paragraphs and drops nav/scripts/styles/captions', () => {
    const text = W.htmlToText(html);
    expect(text).toContain('Ayatollah Khamenei said on Thursday');
    expect(text).toContain('annual Khomeini anniversary ceremony');
    expect(text).not.toMatch(/var a=|color:red|Home About Subscribe/);
    expect(text).not.toContain('Share');          // <40-char fragment skipped
    expect(text).not.toContain('A short caption'); // <40-char fragment skipped
  });

  test('decodes HTML entities', () => {
    const text = W.htmlToText(html);
    expect(text).toContain("Iran's");   // &#39;
    expect(text).toContain('"humiliated"'); // &quot;
    expect(text).not.toMatch(/&#?\w+;/);    // no leftover raw entities
  });

  test('falls back to full tag-strip when there are no usable <p> blocks', () => {
    const noP = '<html><body><div>' + 'A real sentence of body copy that easily clears the minimum length threshold for extraction.'.repeat(2) + '</div></body></html>';
    const text = W.htmlToText(noP);
    expect(text).toContain('A real sentence of body copy');
    expect(text).not.toContain('<div>');
  });

  test('exports extractArticleText and returns null for Google-News redirect shells', async () => {
    expect(typeof W.extractArticleText).toBe('function');
    // news.google.com links are redirect shells with no body — short-circuits, no fetch.
    await expect(W.extractArticleText('https://news.google.com/rss/articles/abc')).resolves.toBeNull();
    await expect(W.extractArticleText('')).resolves.toBeNull();
  });
});
