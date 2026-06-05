/**
 * news-topics.js — the structured "what are we covering" registry.
 *
 * Previously the pipeline hard-coded its scope in many places: a literal
 * "IRAN WAR" string inside the Haiku relevance prompt, a one-off `IRAN_FALLBACK`
 * regex, and a `MARKET_KEYWORDS` array. That made the feed brittle — a Lebanon
 * strike only counted as news if it happened to match one of those hand-written
 * tokens, and adding a new front meant editing several files.
 *
 * This module makes the scope DATA. One active "scope" is a labelled set of
 * fronts (topics), each with its own keywords. The relevance prompt, the regex
 * fallback, the market-selection prompt, and the eval harness's ground-truth
 * brief are all GENERATED from this structure. Adding/retiring a front, or
 * switching the whole dashboard to a different story, is a config edit — and
 * `INTEL_SCOPE` can override the active scope without touching code.
 */

// A scope = the dashboard's subject. `topics` are its fronts; the relevance
// model treats ALL of them as in-scope (so the Lebanon/Levant front is a
// first-class citizen, not an "Iran proxy" afterthought).
const SCOPES = {
  'mideast-conflict': {
    id: 'mideast-conflict',
    label: 'IRAN WATCH',
    // Used verbatim by the relevance LLM and the eval ground-truth brief.
    description:
      'the Iran-centered Middle East conflict and every active front around it — ' +
      'direct Iran-Israel / US-Iran fighting, the Lebanon/Hezbollah front, the Gulf ' +
      'and Strait of Hormuz, the nuclear program and ceasefire diplomacy, and the ' +
      'oil/energy and regional fallout that flows from the war.',
    topics: [
      { id: 'iran-core', label: 'Iran-Israel / US-Iran fighting',
        keywords: ['iran', 'iranian', 'tehran', 'irgc', 'khamenei', 'isfahan', 'natanz', 'revolutionary guard', 'pezeshkian'] },
      { id: 'levant', label: 'Lebanon / Hezbollah front',
        keywords: ['lebanon', 'lebanese', 'beirut', 'hezbollah', 'berri', 'litani', 'naqoura', 'nasrallah', 'south lebanon', 'unifil'] },
      { id: 'israel-gaza', label: 'Israel & Gaza spillover',
        keywords: ['israel', 'israeli', 'netanyahu', 'idf', 'gaza', 'west bank', 'tel aviv', 'houthi', 'yemen'] },
      { id: 'gulf-hormuz', label: 'Gulf & Strait of Hormuz',
        keywords: ['hormuz', 'strait', 'persian gulf', 'bandar abbas', 'tanker', 'blockade', 'kuwait', 'uae', 'qatar', 'bahrain'] },
      { id: 'nuclear-diplomacy', label: 'Nuclear program & ceasefire diplomacy',
        keywords: ['nuclear', 'enrichment', 'iaea', 'ceasefire', 'peace talks', 'negotiation', 'witkoff', 'sanctions', 'frozen assets'] },
      { id: 'energy-fallout', label: 'Oil shock & regional fallout',
        keywords: ['oil price', 'crude', 'brent', 'opec', 'energy', 'freight', 'refinery', 'pipeline', 'inflation'] },
    ],
  },
};

const DEFAULT_SCOPE = 'mideast-conflict';

function activeScope() {
  return SCOPES[process.env.INTEL_SCOPE || DEFAULT_SCOPE] || SCOPES[DEFAULT_SCOPE];
}

// De-duped union of every front's keywords for the active scope.
function allKeywords(scope = activeScope()) {
  return [...new Set((scope.topics || []).flatMap(t => t.keywords || []))];
}

function escapeRegex(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Regex fallback used when the relevance LLM is unavailable. Generated from the
// scope so it always matches the same fronts the prompt describes (no drift).
function fallbackRegex(scope = activeScope()) {
  const words = allKeywords(scope);
  return words.length ? new RegExp(words.map(escapeRegex).join('|'), 'i') : /$a/;
}

// Compact "front: a, b, c" lines for prompts.
function frontLines(scope = activeScope(), perFront = 8) {
  return (scope.topics || [])
    .map(t => `- ${t.label}: ${(t.keywords || []).slice(0, perFront).join(', ')}`)
    .join('\n');
}

// The headline/video relevance-filter instruction (replaces the hard-coded
// "Filter ... for an IRAN WAR dashboard" string in war-sources.js).
function relevancePrompt(type, scope = activeScope()) {
  return (
    `Filter ${type} for a ${scope.label} dashboard. Return ONLY the line numbers relevant to ` +
    `${scope.description}\n\nIN SCOPE — any of these fronts counts (a strike, casualty, ` +
    `diplomatic move, or market move on ANY front is in scope):\n${frontLines(scope)}\n\n` +
    `Exclude items with no connection to the conflict above (unrelated wars, US domestic ` +
    `politics, crypto, sports, entertainment). Comma-separated numbers only. If none, return NONE.`
  );
}

// The Polymarket selection instruction (replaces the inline market prompt).
function marketSelectionPrompt(scope = activeScope()) {
  return (
    `Select prediction markets for a ${scope.label} TV dashboard. Include ANYTHING tied to ` +
    `${scope.description}\n\nFronts that matter:\n${frontLines(scope, 6)}\n\n` +
    `Exclude: unrelated conflicts (e.g. Ukraine-Russia unless directly Iran-linked), US ` +
    `domestic politics, crypto, sports, entertainment. Return ONLY a JSON array of index numbers.`
  );
}

// A short scope brief for the eval harness's "what SHOULD we be covering" call.
function scopeBrief(scope = activeScope()) {
  return { id: scope.id, label: scope.label, description: scope.description, fronts: (scope.topics || []).map(t => t.label) };
}

module.exports = {
  SCOPES, DEFAULT_SCOPE, activeScope,
  allKeywords, fallbackRegex, frontLines,
  relevancePrompt, marketSelectionPrompt, scopeBrief,
};
