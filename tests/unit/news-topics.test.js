const NT = require('../../api/lib/news-topics');

describe('news-topics (structured scope/relevance config)', () => {
  afterEach(() => { delete process.env.INTEL_SCOPE; });

  it('exposes the default Mideast-conflict scope with the Lebanon front first-class', () => {
    const scope = NT.activeScope();
    expect(scope.id).toBe('mideast-conflict');
    const fronts = scope.topics.map(t => t.id);
    expect(fronts).toContain('levant');
    const levant = scope.topics.find(t => t.id === 'levant');
    expect(levant.keywords).toEqual(expect.arrayContaining(['lebanon', 'hezbollah', 'beirut']));
  });

  it('fallbackRegex matches Lebanon-front items (the historically-missed case)', () => {
    const re = NT.fallbackRegex();
    expect(re.test('Israel strikes Beirut as Hezbollah clash grows')).toBe(true);
    expect(re.test('Iran nuclear enrichment talks resume')).toBe(true);
    expect(re.test('Local Egyptian football derby ends in a draw')).toBe(false);
  });

  it('relevancePrompt is generated from the scope (no hard-coded IRAN WAR string)', () => {
    const p = NT.relevancePrompt('headlines');
    expect(p).toContain('IRAN WATCH');
    expect(p.toLowerCase()).toContain('lebanon');
    expect(p).toContain('Comma-separated numbers only');
  });

  it('marketSelectionPrompt asks for a JSON array of indices', () => {
    expect(NT.marketSelectionPrompt()).toContain('JSON array of index numbers');
  });

  it('allKeywords is a de-duped union across fronts', () => {
    const kw = NT.allKeywords();
    expect(new Set(kw).size).toBe(kw.length);
    expect(kw).toEqual(expect.arrayContaining(['lebanon', 'hormuz', 'nuclear']));
  });

  it('INTEL_SCOPE selects a scope, falling back to default for unknown ids', () => {
    process.env.INTEL_SCOPE = 'does-not-exist';
    expect(NT.activeScope().id).toBe('mideast-conflict');
  });
});
