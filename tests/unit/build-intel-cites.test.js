const { stripCites } = require('../../scripts/build-intel');

// The newsroom rewrite runs with web_search on, which makes the model emit inline
// <cite index="…"> tags and bracketed footnote markers. Those are display artifacts
// — the TV/phone render these fields as escaped text, so raw tags would leak to
// users. stripCites must reduce them to clean prose.
describe('stripCites (newsroom citation cleanup)', () => {
  test('removes <cite> tags but keeps the wrapped prose', () => {
    const s = '<cite index="3-5,5-4">The WFP warns 6.1 million face hunger</cite> from the war; <cite index="8-12">inflation hit 115%</cite>.';
    expect(stripCites(s)).toBe('The WFP warns 6.1 million face hunger from the war; inflation hit 115%.');
  });

  test('removes bracketed footnote markers', () => {
    expect(stripCites('Iran fired seven missiles [3-14]; six were intercepted [1, 2].'))
      .toBe('Iran fired seven missiles; six were intercepted.');
  });

  test('leaves clean prose untouched and is type-safe', () => {
    expect(stripCites('Israel struck a Lebanese army vehicle on Saturday.'))
      .toBe('Israel struck a Lebanese army vehicle on Saturday.');
    expect(stripCites(undefined)).toBeUndefined();
    expect(stripCites(null)).toBeNull();
  });
});
