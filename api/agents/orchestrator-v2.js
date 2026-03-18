/**
 * Orchestrator v2 — 3-Milestone Progressive Pipeline
 *
 * Milestone 1 — Hero Card (< 3 seconds):
 *   Haiku classifies screenshot → hero card with title, screenshot image,
 *   and "Investigating" status pill. Skeleton cards visible.
 *
 * Milestone 2 — Live Cards + Deep Research:
 *   Two parallel streams:
 *   2a. Haiku Enhancement: Populates all skeleton cards from screenshot
 *       using tool_use loop (~12-18s).
 *   2b. Sonar Deep Research: Web-grounded fact-checking in parallel.
 *   Cards appear live via SSE as Haiku populates them.
 *
 * Milestone 3 — Complete:
 *   Enhancement and research finished. Research findings wired to
 *   verification cards. Hero status pill updates to
 *   "Confirmed" or "Unconfirmed". No more changes.
 */

const { fastClassify } = require('./fast-classifier');
const { enhance } = require('./sonnet-enhancer');
const { deepResearch } = require('./deep-researcher');
const { geminiAnalyze, toBlueprintAndCards } = require('./gemini-analyzer');
const { isGeminiAvailable } = require('../llm');
const { logger } = require('../lib/logger');
const { TraceCollector } = require('../lib/llm-trace');

function stripFabricatedImageUrls(data) {
  if (!data || typeof data !== 'object') return data;
  const cleaned = { ...data };
  delete cleaned.imageUrl;
  delete cleaned.photoUrl;
  return cleaned;
}

function isValidUrl(url) {
  if (!url || typeof url !== 'string') return false;
  if (/\s/.test(url)) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

const ORG_ROLE_KEYWORDS = new Set([
  'news organization', 'news source', 'news outlet', 'news agency',
  'media organization', 'media outlet', 'media company', 'media group',
  'publication', 'publisher', 'broadcaster', 'network',
  'government body', 'military organization', 'political party',
  'organization', 'institution', 'agency', 'bureau',
  'breaking news', 'news / breaking news',
]);

const ORG_NAME_PATTERNS = [
  /\b(News|Bureau|Channel|International|Network|Agency|Organisation|Organization|Guard|Corps|Authority|Ministry|Committee|Foundation|Institute|Council|Commission|Association|Federation|Union)\b/i,
  /\b(Al Jazeera|CNN|BBC|Reuters|AP News|Fox News|MSNBC|NBC|CBS|ABC|Sky News|France 24|RT|NHK|Xinhua|TASS|DW|NPR)\b/i,
  /\b(New York Times|Washington Post|Guardian|Financial Times|Wall Street Journal|Times of Israel|Jerusalem Post|Haaretz)\b/i,
];

const GENERIC_TITLE_PATTERNS = [
  /^(the\s+)?(president|prime minister|minister|chairman|secretary|director|leader|commander|spokesperson|official|ambassador|governor|mayor|chancellor)\b/i,
  /^(japanese|chinese|russian|american|british|french|german|iranian|israeli|indian|turkish|saudi|egyptian|iraqi|syrian)\s+(president|prime minister|minister|official|leader|commander|ambassador|spokesman)\b/i,
];

function isLikelyNotAPerson(name, role) {
  if (ORG_ROLE_KEYWORDS.has(role.trim())) return true;
  for (const keyword of ORG_ROLE_KEYWORDS) {
    if (role.includes(keyword)) return true;
  }

  for (const pattern of ORG_NAME_PATTERNS) {
    if (pattern.test(name)) return true;
  }

  for (const pattern of GENERIC_TITLE_PATTERNS) {
    if (pattern.test(name)) return true;
  }

  const nameParts = name.split(/\s+/).filter(p => p.length > 1);
  if (nameParts.length === 1 && name.length > 3) {
    if (/^[A-Z]/.test(name) && !/^[A-Z][a-z]+$/.test(name)) return true;
  }

  return false;
}

function guessSourceType(role) {
  if (/news|media|press|broadcast|journal/i.test(role)) return 'news_agency';
  if (/government|official|ministry/i.test(role)) return 'official';
  if (/military|guard|army|force/i.test(role)) return 'official';
  return 'news_agency';
}

const RESEARCH_WORTHY_TYPES = new Set([
  'breaking_news', 'news', 'emergency', 'sports', 'science',
  'health', 'finance', 'tech', 'social_media',
  'report_significant_event', 'significant_event',
]);

/**
 * Create a generic skeleton blueprint for instant display.
 */
function createSkeletonBlueprint() {
  return {
    contentAnalysis: {
      contentType: 'analyzing',
      platform: null,
      intent: 'Analyzing screenshot...',
      topQuestions: [],
    },
    layout: { type: 'simple', columns: 1, reason: 'Skeleton layout while analyzing' },
    cards: [
      {
        id: 'skeleton-hero',
        cardType: 'hero_summary',
        gridPosition: { row: 1, column: 1, columnSpan: 1, rowSpan: 1 },
        researchBrief: '',
        placeholderData: { title: 'Analyzing screenshot...', subtitle: 'Identifying content and designing layout' },
        status: 'placeholder',
      },
      {
        id: 'skeleton-2',
        cardType: 'info_list',
        gridPosition: { row: 2, column: 1, columnSpan: 1, rowSpan: 1 },
        researchBrief: '',
        placeholderData: {},
        status: 'placeholder',
      },
      {
        id: 'skeleton-3',
        cardType: 'info_list',
        gridPosition: { row: 3, column: 1, columnSpan: 1, rowSpan: 1 },
        researchBrief: '',
        placeholderData: {},
        status: 'placeholder',
      },
    ],
  };
}

/**
 * Normalize a verification source array in place: convert strings/URLs to objects.
 * LLM may return sources as ["Al Jazeera", "https://..."] instead of [{name, status}].
 */
function normalizeSourceArray(sources) {
  for (let i = 0; i < sources.length; i++) {
    if (typeof sources[i] === 'string') {
      const s = sources[i];
      if (s.startsWith('http')) {
        try {
          sources[i] = { name: new URL(s).hostname.replace(/^www\./, ''), url: s, status: 'checking' };
        } catch (_) {
          sources[i] = { name: s, url: s, status: 'checking' };
        }
      } else {
        sources[i] = { name: s, status: 'checking' };
      }
    }
  }
  return sources;
}

const KNOWN_SOURCE_NAMES = {
  'reuters.com': 'Reuters', 'apnews.com': 'AP News',
  'bbc.com': 'BBC', 'bbc.co.uk': 'BBC',
  'cnn.com': 'CNN', 'aljazeera.com': 'Al Jazeera',
  'nytimes.com': 'NY Times', 'theguardian.com': 'The Guardian',
  'washingtonpost.com': 'Washington Post', 'france24.com': 'France 24',
  'dw.com': 'DW', 'rt.com': 'RT', 'indiatoday.in': 'India Today',
  'lemonde.fr': 'Le Monde', 'spiegel.de': 'Der Spiegel',
  'abc.net.au': 'ABC Australia', 'elpais.com': 'El País',
  'kurdistan24.net': 'Kurdistan24', 'timesofisrael.com': 'Times of Israel',
  'latimes.com': 'LA Times', 'theworld.org': 'The World',
  'youtube.com': 'YouTube', 'wikipedia.org': 'Wikipedia',
  'en.wikipedia.org': 'Wikipedia',
  'tribune.com.pk': 'Tribune Pakistan', 'dawn.com': 'Dawn',
  'geo.tv': 'Geo News', 'thenews.com.pk': 'The News International',
  'haaretz.com': 'Haaretz', 'jpost.com': 'Jerusalem Post',
  'ynetnews.com': 'Ynet News',
  'nhk.or.jp': 'NHK', 'japantimes.co.jp': 'Japan Times',
  'scmp.com': 'South China Morning Post',
  'hindustantimes.com': 'Hindustan Times', 'thehindu.com': 'The Hindu',
  'ndtv.com': 'NDTV', 'timesofindia.indiatimes.com': 'Times of India',
  'foxnews.com': 'Fox News', 'nbcnews.com': 'NBC News',
  'abcnews.go.com': 'ABC News', 'cbsnews.com': 'CBS News',
  'politico.com': 'Politico', 'thehill.com': 'The Hill',
  'axios.com': 'Axios', 'npr.org': 'NPR',
  'independent.co.uk': 'The Independent', 'telegraph.co.uk': 'The Telegraph',
  'sky.com': 'Sky News', 'skynews.com.au': 'Sky News Australia',
  'globalnews.ca': 'Global News', 'cbc.ca': 'CBC',
  'abc.es': 'ABC Spain', 'corriere.it': 'Corriere della Sera',
  'tagesschau.de': 'Tagesschau', 'rte.ie': 'RTE',
  'almayadeen.net': 'Al Mayadeen', 'middleeasteye.net': 'Middle East Eye',
  'arabnews.com': 'Arab News', 'alarabiya.net': 'Al Arabiya',
  'vox.com': 'Vox',
  'businessinsider.com': 'Business Insider', 'bloomberg.com': 'Bloomberg',
  'cnbc.com': 'CNBC', 'ft.com': 'Financial Times',
  'economist.com': 'The Economist', 'foreignpolicy.com': 'Foreign Policy',
  'euronews.com': 'Euronews', 'theintercept.com': 'The Intercept',
  'sputniknews.com': 'Sputnik', 'tass.com': 'TASS',
  'news.cn': 'Xinhua', 'english.news.cn': 'Xinhua',
  'cgtn.com': 'CGTN', 'news.cgtn.com': 'CGTN',
  'chinadaily.com.cn': 'China Daily', 'globaltimes.cn': 'Global Times',
  'i24news.tv': 'i24 News', 'gulfnews.com': 'Gulf News',
  'gmanetwork.com': 'GMA Network', 'airwaysmag.com': 'Airways Magazine',
  'kfgo.com': 'KFGO', 'palwatch.org': 'Palestinian Media Watch',
  'majalla.com': 'The Majalla', 'en.majalla.com': 'The Majalla',
  'merip.org': 'MERIP', 'wionews.com': 'WION',
  'timesnownews.com': 'Times Now', 'news18.com': 'CNN-News18',
  'livemint.com': 'Mint', 'deccanherald.com': 'Deccan Herald',
  'straitstimes.com': 'Straits Times', 'channelnewsasia.com': 'CNA',
  '9news.com.au': '9 News Australia', 'smh.com.au': 'Sydney Morning Herald',
  'irishexaminer.com': 'Irish Examiner', 'irishtimes.com': 'Irish Times',
  'asahi.com': 'Asahi Shimbun', 'mainichi.jp': 'Mainichi',
  'yomiuri.co.jp': 'Yomiuri Shimbun',
  'presstv.ir': 'Press TV', 'irna.ir': 'IRNA',
  'english.alarabiya.net': 'Al Arabiya English',
};

const GENERIC_PLATFORMS = new Set([
  'youtube.com', 'wikipedia.org', 'en.wikipedia.org',
  'facebook.com', 'twitter.com', 'x.com', 'instagram.com',
  'tiktok.com', 'reddit.com', 'linkedin.com', 'medium.com',
  'archive.org', 'web.archive.org', 'docs.google.com',
]);

function isGenericPlatform(host) {
  const h = host.replace(/^www\./, '');
  return GENERIC_PLATFORMS.has(h) || GENERIC_PLATFORMS.has(h.split('.').slice(-2).join('.'));
}

const COMPOUND_SUFFIXES = /^(.+?)(news|times|post|media|online|wire|today|daily|world|press|mag|monitor|gazette|herald|tribune|journal|report|watch|insider|standard|observer|review|digest|channel|network)$/i;

/**
 * Convert a hostname to a human-friendly source name.
 * Uses a known-sources map for major outlets, falls back to cleaned hostname.
 */
function hostToSourceName(host) {
  const h = host.replace(/^www\./, '');
  if (KNOWN_SOURCE_NAMES[h]) return KNOWN_SOURCE_NAMES[h];
  const withoutSub = h.split('.').slice(-2).join('.');
  if (KNOWN_SOURCE_NAMES[withoutSub]) return KNOWN_SOURCE_NAMES[withoutSub];
  const threeLevel = h.split('.').slice(-3).join('.');
  if (KNOWN_SOURCE_NAMES[threeLevel]) return KNOWN_SOURCE_NAMES[threeLevel];
  const stripped = h
    .replace(/\.(com|org|net|co|gov|edu|ac)\.[a-z]{2}$/i, '')
    .replace(/\.[a-z]{2,6}$/i, '');
  const name = stripped.split('.').pop();
  const m = name.match(COMPOUND_SUFFIXES);
  if (m) {
    const prefix = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
    const suffix = m[2].charAt(0).toUpperCase() + m[2].slice(1).toLowerCase();
    return `${prefix} ${suffix}`;
  }
  if (name.length <= 4) return name.toUpperCase();
  return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
}

function stripCitationMarkers(text) {
  if (!text) return text;
  return text.replace(/\[(\d+)\]/g, '').replace(/\s{2,}/g, ' ').trim();
}

function cleanResearchData(researchResult) {
  if (!researchResult || !researchResult.findings) return researchResult;
  researchResult.findings = researchResult.findings.map(f => {
    const cleaned = { ...f };
    if (cleaned.summary) cleaned.summary = stripCitationMarkers(cleaned.summary);
    if (cleaned.details) cleaned.details = stripCitationMarkers(cleaned.details);
    if (cleaned.topic) cleaned.topic = stripCitationMarkers(cleaned.topic);
    if (cleaned.imageUrl && !isValidUrl(cleaned.imageUrl)) {
      delete cleaned.imageUrl;
    }
    if (cleaned.sourceUrls && Array.isArray(cleaned.sourceUrls)) {
      cleaned.sourceUrls = cleaned.sourceUrls.filter(u => isValidUrl(u));
    }
    if (cleaned.factCheck) {
      cleaned.factCheck = { ...cleaned.factCheck };
      if (cleaned.factCheck.explanation) cleaned.factCheck.explanation = stripCitationMarkers(cleaned.factCheck.explanation);
      if (cleaned.factCheck.claim) cleaned.factCheck.claim = stripCitationMarkers(cleaned.factCheck.claim);
    }
    return cleaned;
  });
  if (researchResult.overallContext) {
    researchResult.overallContext = stripCitationMarkers(researchResult.overallContext);
  }
  if (researchResult.followUpQuestions) {
    researchResult.followUpQuestions = researchResult.followUpQuestions.map(q => ({
      ...q,
      answer: q.answer ? stripCitationMarkers(q.answer) : q.answer,
    }));
  }
  return researchResult;
}

function sentenceWords(sentence) {
  return new Set(sentence.toLowerCase().replace(/[^\w\s]/g, '').replace(/s\b/g, '').split(/\s+/).filter(w => w.length > 3));
}

function extractAttribution(sentence) {
  const m = sentence.match(/^(confirmed|according|reported|verified|cited|corroborated)\s+(by|to)\s+(\S+)/i);
  return m ? m[3].replace(/[''`]s?$/i, '').replace(/[^\w]/g, '').toLowerCase() : null;
}

function deduplicateSentences(text) {
  if (!text) return text;
  const sentences = text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 10);
  if (sentences.length <= 1) return text;
  const kept = [];
  const seenAttributions = new Set();
  for (const sentence of sentences) {
    const words = sentenceWords(sentence);
    if (words.size < 2) { kept.push(sentence); continue; }

    const attr = extractAttribution(sentence);
    if (attr && seenAttributions.has(attr)) continue;

    const isDuplicate = kept.some(prev => {
      const prevWords = sentenceWords(prev);
      if (prevWords.size === 0) return false;
      const overlap = [...words].filter(w => prevWords.has(w)).length;
      const smaller = Math.min(words.size, prevWords.size);
      return smaller > 0 && overlap / smaller > 0.6;
    });
    if (!isDuplicate) {
      kept.push(sentence);
      if (attr) seenAttributions.add(attr);
    }
  }
  return kept.join(' ');
}

function truncateAtWord(text, maxLen) {
  if (!text || text.length <= maxLen) return text;
  const truncated = text.slice(0, maxLen);
  const lastSpace = truncated.lastIndexOf(' ');
  return (lastSpace > maxLen * 0.6 ? truncated.slice(0, lastSpace) : truncated) + '...';
}

/**
 * Compute verification_card overall status from individual source statuses.
 * Ensures the displayed badge always matches the source checkmarks the user sees.
 */
function normalizeSourceStatus(status) {
  if (status === 'verified' || status === 'confirmed') return 'confirmed';
  if (status === 'denied' || status === 'false' || status === 'disproven') return 'denied';
  if (status === 'checking' || status === 'searching' || status === 'pending') return 'checking';
  if (status === 'inconclusive' || status === 'unverified' || status === 'needs_context' || status === 'mixed') return 'inconclusive';
  return status;
}

function computeVerificationStatus(sources) {
  if (!sources || sources.length === 0) return 'unconfirmed';
  const statuses = sources.map(s => normalizeSourceStatus(s.status));
  const hasConfirmed = statuses.some(s => s === 'confirmed');
  const hasDenied = statuses.some(s => s === 'denied');
  const allConfirmed = statuses.every(s => s === 'confirmed');
  const allDenied = statuses.every(s => s === 'denied');
  const hasInconclusive = statuses.some(s => s === 'inconclusive');

  if (allConfirmed) return 'verified';
  if (allDenied) return 'denied';
  if (hasConfirmed && hasDenied) return 'conflicting';
  if (hasConfirmed) return 'partially_verified';
  if (hasInconclusive) return 'inconclusive';
  return 'unconfirmed';
}

/**
 * Find the best matching research finding for a verification source name.
 * Uses progressively looser matching: exact substring → cleaned name → keyword overlap.
 */
function findMatchingFinding(sourceName, findings) {
  if (!sourceName || !findings || findings.length === 0) return null;
  const name = sourceName.toLowerCase();

  const getFindingText = (f) =>
    `${f.topic || ''} ${f.summary || ''} ${f.details || ''}`.toLowerCase();

  // 1. Exact substring match (current behavior)
  let match = findings.find(f => getFindingText(f).includes(name));
  if (match) return match;

  // 2. Strip parenthetical qualifiers: "Al Jazeera Mubasher (English)" → "al jazeera mubasher"
  const cleaned = name.replace(/\s*\([^)]*\)\s*/g, '').replace(/\s+/g, ' ').trim();
  if (cleaned && cleaned !== name) {
    match = findings.find(f => getFindingText(f).includes(cleaned));
    if (match) return match;
  }

  // 3. Keyword overlap: require ≥50% of significant words (3+ chars) to match
  const words = (cleaned || name).split(/\s+/).filter(w => w.length >= 3);
  if (words.length >= 1) {
    const threshold = Math.max(1, Math.ceil(words.length / 2));
    match = findings.find(f => {
      const text = getFindingText(f);
      return words.filter(w => text.includes(w)).length >= threshold;
    });
    if (match) return match;
  }

  return null;
}

/**
 * Enrich timeline cards with events derived from research findings.
 * The enhance phase only sees the screenshot, which rarely has detailed
 * chronology — just "4 hours ago". Research findings contain richer context
 * (dates, related events, broader conflict timeline) that makes the
 * timeline card actually useful.
 */
function enrichTimelineFromResearch({ currentCards, researchFindings, onCardUpdate }) {
  if (!researchFindings || researchFindings.length === 0) return 0;
  let enrichCount = 0;

  for (const [cardId, card] of currentCards) {
    if (card.cardType !== 'timeline_card') continue;
    const cardData = card.populatedData || card.data || {};
    const events = cardData.events || [];
    if (events.length === 0) continue;

    const MAX_TIMELINE_EVENTS = 6;
    const existingEventText = events.map(e => (e.event || '').toLowerCase()).join(' ');
    let addedAny = false;

    for (const finding of researchFindings) {
      if (events.length >= MAX_TIMELINE_EVENTS) break;

      const topic = (finding.topic || '').trim();
      const summary = (finding.summary || '').trim();
      if (!topic && !summary) continue;

      const fText = `${topic} ${summary}`.toLowerCase();
      const cardSearchText = `${cardData.title || ''} ${existingEventText}`.toLowerCase();

      const fWords = fText.split(/\s+/).filter(w => w.length > 3);
      const isRelevant = fWords.some(w => cardSearchText.includes(w));
      if (!isRelevant) continue;

      const significantWords = new Set(fText.split(/\s+/).filter(w => w.length > 4));
      if (significantWords.size > 0) {
        const covered = [...significantWords].filter(w => existingEventText.includes(w)).length;
        if (covered / significantWords.size > 0.5) continue;
      }

      if (/^(screenshot source|source attribution|status from other)/i.test(topic)) continue;

      const datePatterns = [
        /\b((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})\b/i,
        /\b(\d{4}-\d{2}-\d{2})\b/,
        /\b(week\s+\d+)\b/i,
      ];
      let dateStr = null;
      for (const pattern of datePatterns) {
        const m = summary.match(pattern) || topic.match(pattern);
        if (m) { dateStr = m[1]; break; }
      }

      const eventDesc = truncateAtWord(topic.length > 5 ? topic : summary, 80);
      const newEvent = {
        date: dateStr || 'Context',
        event: eventDesc,
        highlight: false,
      };
      if (finding.sourceUrls && finding.sourceUrls[0] && isValidUrl(finding.sourceUrls[0])) {
        newEvent.url = finding.sourceUrls[0];
      }

      events.push(newEvent);
      addedAny = true;
    }

    if (addedAny) {
      const updatedData = { ...cardData, events };
      card.populatedData = updatedData;
      card.data = updatedData;
      currentCards.set(cardId, card);
      enrichCount++;

      if (onCardUpdate) {
        onCardUpdate({
          cardId,
          cardType: 'timeline_card',
          data: updatedData,
          reason: 'Research findings added as timeline events',
          source: 'research-enrich',
        });
      }
    }
  }

  return enrichCount;
}

/**
 * Programmatically apply research findings to populated cards.
 * Matches findings to cards by keyword overlap and adds sourceUrls,
 * context, and other enrichment data — without an LLM call.
 * Returns the number of cards enriched.
 */
function applyResearchToCards({ currentCards, researchFindings, onCardUpdate }) {
  if (!researchFindings || researchFindings.length === 0) return 0;
  let enrichCount = 0;

  for (const [cardId, card] of currentCards) {
    if (card.cardType === 'verification_card') continue;
    const cardData = card.populatedData || card.data || {};
    if (!cardData || Object.keys(cardData).length === 0) continue;

    const cardText = `${cardData.title || ''} ${cardData.name || ''} ${cardData.headline || ''} ${cardData.claim || ''} ${cardData.label || ''} ${cardData.fact || ''}`.toLowerCase();
    if (!cardText.trim()) continue;

    const hasWordOverlap = (f) => {
      const fText = `${f.topic || ''} ${f.summary || ''}`.toLowerCase();
      return fText.split(/\s+/).some(w => w.length > 3 && cardText.includes(w));
    };
    const matchedFinding =
      researchFindings.find(f => f.relatedCardTypes?.includes(card.cardType) && hasWordOverlap(f)) ||
      researchFindings.find(f => {
        if (card.cardType !== 'verification_card' && f.relatedCardTypes?.length && f.relatedCardTypes.every(t => t === 'verification_card')) return false;
        return hasWordOverlap(f);
      });

    if (!matchedFinding) continue;

    const updates = {};
    let changed = false;

    if (matchedFinding.sourceUrls && matchedFinding.sourceUrls.length > 0) {
      if (!cardData.url && !cardData.sourceUrl) {
        if (card.cardType === 'fact_check' || card.cardType === 'quote_card' || card.cardType === 'did_you_know_card') {
          updates.sourceUrl = matchedFinding.sourceUrls[0];
        } else {
          updates.url = matchedFinding.sourceUrls[0];
        }
        changed = true;
      }
    }

    if (matchedFinding.factCheck && card.cardType === 'fact_check') {
      if (matchedFinding.factCheck.verdict && cardData.verdict !== matchedFinding.factCheck.verdict) {
        updates.verdict = matchedFinding.factCheck.verdict;
        changed = true;
      }
      if (matchedFinding.factCheck.explanation && !cardData.explanation) {
        updates.explanation = matchedFinding.factCheck.explanation.slice(0, 300);
        changed = true;
      }
    }

    if (matchedFinding.summary && !cardData.relatedContext && card.cardType === 'news_card') {
      updates.relatedContext = matchedFinding.summary.slice(0, 300);
      changed = true;
    }

    if (matchedFinding.imageUrl && !cardData.imageUrl && isValidUrl(matchedFinding.imageUrl)) {
      const imageCardTypes = new Set(['person_card', 'location_card', 'news_card', 'hero_summary', 'product_card']);
      if (imageCardTypes.has(card.cardType)) {
        updates.imageUrl = matchedFinding.imageUrl;
        changed = true;
      }
    }

    if (matchedFinding.summary && !cardData.context && card.cardType === 'did_you_know_card') {
      updates.context = matchedFinding.summary.slice(0, 500);
      changed = true;
    }

    if (matchedFinding.summary && !cardData.notableInfo && card.cardType === 'person_card') {
      updates.notableInfo = matchedFinding.summary.slice(0, 500);
      changed = true;
    }

    if (matchedFinding.summary && !cardData.details && card.cardType === 'location_card') {
      const detailText = (matchedFinding.details || matchedFinding.summary || '').slice(0, 500);
      updates.details = [detailText];
      changed = true;
    }

    if (changed) {
      const mergedData = { ...cardData, ...updates };
      card.populatedData = mergedData;
      card.data = mergedData;
      currentCards.set(cardId, card);
      enrichCount++;

      if (onCardUpdate) {
        onCardUpdate({
          cardId,
          cardType: card.cardType,
          data: updates,
          reason: 'Research URL/context enrichment',
          source: 'research-enrich',
        });
      }
    }
  }

  return enrichCount;
}

/**
 * Run the progressive enhancement pipeline with SSE callbacks.
 *
 * Callback contract (all optional):
 *   onBlueprint(blueprint)       — Instant skeleton for immediate display
 *   onLayoutUpdate(blueprint)    — Layout with hero title (from Haiku classification)
 *   onLayoutPreview(blueprint)   — Kept for backward compat (same as onLayoutUpdate)
 *   onCardPopulated(cardUpdate)  — A card has been populated with real data
 *   onCardUpdate(cardUpdate)     — Enhancer updated an existing card
 *   onCardAdd(cardAdd)           — Sonnet added a new card
 *   onPhase(phase)               — Phase transition notification
 *   onComplete(result)           — Pipeline finished
 *   onError(error)               — Pipeline error
 *   onProgress(progress)         — Progress updates
 */
async function runPipeline({
  imageData,
  mediaType,
  question,
  onBlueprint,
  onLayoutUpdate,
  onLayoutPreview,
  onCardPopulated,
  onCardUpdate,
  onCardAdd,
  onPhase,
  onComplete,
  onError,
  onProgress,
  adapterConfig = {},
}) {
  const startTime = Date.now();
  const traceCollector = new TraceCollector(
    adapterConfig.requestId || 'unknown'
  );

  const currentCards = new Map();
  let enhanceHeartbeat;

  try {
    // =====================================================
    // Phase 0: Instant skeleton (no LLM, <1ms)
    // =====================================================
    const skeleton = createSkeletonBlueprint();
    if (onBlueprint) {
      onBlueprint(skeleton);
    }

    if (onProgress) {
      onProgress({
        phase: 'classifying',
        progress: 5,
        message: 'Analyzing screenshot...',
      });
    }

    // =====================================================
    // Gemini Pipeline: Single-call analysis + web search
    // When PIPELINE_MODE=gemini, skip the multi-phase flow entirely.
    // One Gemini call with Google Search grounding does:
    // classify + enhance + research + verify in ~16-24s.
    // =====================================================
    const useGeminiPipeline = (process.env.PIPELINE_MODE || '').toLowerCase() === 'gemini'
      && isGeminiAvailable();

    if (useGeminiPipeline) {
      return await runGeminiPipeline({
        imageData, mediaType, question,
        skeleton, startTime, traceCollector,
        onBlueprint, onLayoutUpdate, onCardPopulated, onCardUpdate,
        onCardAdd, onPhase, onComplete, onError, onProgress,
        adapterConfig,
      });
    }

    // =====================================================
    // Phase 1: Haiku Classification (~1-2s)
    // Returns title + layout choice. No card population.
    // =====================================================
    if (onPhase) {
      onPhase({ phase: 'haiku', message: 'Quick classification...' });
    }

    logger.info('Orchestrator', 'Phase 1: Haiku Classification', {
      model: 'claude-haiku-4-5-20251001',
    });

    const haikuBlueprint = await fastClassify({
      imageData,
      mediaType,
      question,
      adapterConfig: { ...adapterConfig, traceCollector },
    });

    const haikuDuration = Date.now() - startTime;

    if (!haikuBlueprint) {
      logger.warn('Orchestrator', 'Haiku failed, using fallback skeleton');
      for (const card of skeleton.cards) {
        currentCards.set(card.id, card);
      }
      if (onProgress) {
        onProgress({ phase: 'enhancing', progress: 15, message: 'Enhancing analysis...' });
      }
    } else {
      logger.info('Orchestrator', 'Haiku classification ready', {
        dur: haikuDuration,
        contentType: haikuBlueprint.contentAnalysis?.contentType,
        layoutType: haikuBlueprint.layout?.type,
        cardCount: haikuBlueprint.cards?.length,
      });

      if (onLayoutUpdate) {
        onLayoutUpdate(haikuBlueprint);
      }

      // Register all cards (hero is populated, rest are skeletons)
      for (const card of haikuBlueprint.cards) {
        if (card.populatedData) card.populatedData = stripFabricatedImageUrls(card.populatedData);
        if (card.data) card.data = stripFabricatedImageUrls(card.data);
        currentCards.set(card.id, card);
        const data = card.populatedData || card.placeholderData;
        if (data && Object.keys(data).length > 0 && card.status === 'populated' && onCardPopulated) {
          onCardPopulated({
            cardId: card.id,
            cardType: card.cardType,
            data,
            completedCount: 1,
            totalCount: haikuBlueprint.cards.length,
          });
        }
      }

      if (onProgress) {
        onProgress({
          phase: 'enhancing',
          progress: 20,
          message: `${haikuBlueprint.contentAnalysis?.contentType} detected — populating cards...`,
        });
      }
    }

    const blueprint = haikuBlueprint || skeleton;

    // =====================================================
    // Phase 2: Parallel Enhancement + Deep Research
    // Haiku populates cards, Sonar researches in parallel
    // =====================================================
    if (onPhase) {
      onPhase({ phase: 'enhancing', message: 'Populating cards + deep research...' });
    }

    logger.info('Orchestrator', 'Phase 2: Parallel Enhancement (Haiku) + Deep Research (Sonar)');

    const contentType = blueprint.contentAnalysis?.contentType || 'general';
    const skipResearch = !RESEARCH_WORTHY_TYPES.has(contentType);

    const enhanceMessages = [
      'Searching source websites...',
      'Validating claims...',
      'Populating cards with web data...',
      'Cross-referencing sources...',
    ];
    const researchMessages = [
      'Deep research in progress...',
      'Checking multiple sources...',
      'Verifying facts and claims...',
      'Adding citations and context...',
      'Compiling research...',
    ];
    let heartbeatIdx = 0;
    let enhanceDone = false;
    let researchMsgIdx = 0;
    enhanceHeartbeat = setInterval(() => {
      if (onProgress) {
        if (!enhanceDone) {
          heartbeatIdx = Math.min(heartbeatIdx + 1, enhanceMessages.length - 1);
          onProgress({
            phase: 'enhancing',
            progress: 25 + heartbeatIdx * 10,
            message: enhanceMessages[heartbeatIdx],
          });
        } else {
          researchMsgIdx = Math.min(researchMsgIdx + 1, researchMessages.length - 1);
          onProgress({
            phase: 'researching',
            progress: 70 + researchMsgIdx * 5,
            message: researchMessages[researchMsgIdx],
          });
        }
      }
    }, 3000);

    const enhancePromise = enhance({
      imageData,
      mediaType,
      currentCards: blueprint.cards,
      contentAnalysis: blueprint.contentAnalysis,
      layout: blueprint.layout,
      onCardUpdate: (action) => {
        logger.info('Orchestrator', 'Enhancer updated card', {
          cardId: action.cardId,
          reason: action.reason,
        });

        const safeData = stripFabricatedImageUrls(action.data);
        const existing = currentCards.get(action.cardId);
        if (existing) {
          const mergedData = {
            ...(existing.populatedData || existing.data || existing.placeholderData || {}),
            ...safeData,
          };
          if (existing.cardType === 'verification_card') {
            mergedData.lastChecked = new Date().toISOString();
          }
          existing.populatedData = mergedData;
          existing.data = mergedData;
          currentCards.set(action.cardId, existing);
        }

        if (onCardUpdate) {
          onCardUpdate({
            cardId: action.cardId,
            cardType: action.cardType,
            data: safeData,
            reason: action.reason,
            source: 'enhance',
          });
        }
      },
      onCardAdd: (action) => {
        logger.info('Orchestrator', 'Enhancer added card', {
          cardId: action.cardId,
          cardType: action.cardType,
          reason: action.reason,
        });

        const safeData = stripFabricatedImageUrls(action.data);
        const newCard = {
          id: action.cardId,
          cardType: action.cardType,
          gridPosition: action.gridPosition,
          populatedData: safeData,
          data: safeData,
          status: 'populated',
        };
        currentCards.set(action.cardId, newCard);

        if (onCardAdd) {
          onCardAdd({
            cardId: action.cardId,
            cardType: action.cardType,
            data: safeData,
            gridPosition: action.gridPosition,
            reason: action.reason,
            source: 'enhance',
          });
        }
      },
      onLayoutUpdate: (action) => {
        logger.info('Orchestrator', 'Enhancer changed layout', {
          type: action.layoutType,
          reason: action.reason,
        });
        if (onProgress) {
          onProgress({
            phase: 'enhancing',
            progress: 50,
            message: `Layout changed to ${action.layoutType}`,
          });
        }
      },
      adapterConfig: {
        ...adapterConfig,
        model: adapterConfig.enhanceModel || 'claude-haiku-4-5-20251001',
        traceCollector,
        maxIterations: 2,
      },
    }).then(result => {
      enhanceDone = true;
      if (onProgress && !skipResearch) {
        onProgress({
          phase: 'researching',
          progress: 70,
          message: researchMessages[0],
        });
      }
      return result;
    }).catch(err => {
      enhanceDone = true;
      logger.warn('Orchestrator', 'Enhancement failed (non-fatal)', { err: err.message });
      return { actions: [], duration: Date.now() - startTime };
    });

    const deepResearchPromise = skipResearch
      ? Promise.resolve({ findings: [], duration: 0, skipped: true })
      : deepResearch({
          contentAnalysis: blueprint.contentAnalysis,
          cards: blueprint.cards,
          imageData,
          mediaType,
          adapterConfig: { ...adapterConfig, traceCollector },
        }).catch(err => {
          logger.warn('Orchestrator', 'Deep research failed (non-fatal)', { err: err.message });
          return { findings: [], duration: Date.now() - startTime };
        });

    if (skipResearch) {
      logger.info('Orchestrator', 'Skipping deep research — not research-worthy content', { contentType });
    }

    // Wait for enhance to complete first (cards populate during this via SSE)
    const enhanceResult = await enhancePromise;

    // Race deep research against a pipeline duration cap.
    // Sonar typically takes 20-25s which can push total pipeline past 25s.
    // Cards are already populated from enhance — research adds enrichment
    // (verification sources, context, URLs) which is valuable but not critical.
    const PIPELINE_MAX_MS = parseInt(process.env.PIPELINE_MAX_DURATION || '20000', 10);
    const MIN_RESEARCH_GRACE_MS = 2000;
    const POST_ENHANCE_GRACE_MS = parseInt(process.env.POST_ENHANCE_GRACE_MS || '5000', 10);
    const elapsedAfterEnhance = Date.now() - startTime;
    const researchGrace = Math.min(
      POST_ENHANCE_GRACE_MS,
      Math.max(MIN_RESEARCH_GRACE_MS, PIPELINE_MAX_MS - elapsedAfterEnhance)
    );

    let researchDeadlineTimer;
    const researchResult = await Promise.race([
      deepResearchPromise,
      new Promise(resolve => {
        researchDeadlineTimer = setTimeout(() => resolve({
          findings: [],
          timedOut: true,
          duration: Date.now() - startTime,
        }), researchGrace);
      }),
    ]);
    clearTimeout(researchDeadlineTimer);

    if (researchResult.timedOut) {
      logger.info('Orchestrator', 'Research deadline reached — proceeding without findings', {
        pipelineCap: PIPELINE_MAX_MS,
        elapsed: Date.now() - startTime,
        graceMs: researchGrace,
      });
    }

    cleanResearchData(researchResult);

    clearInterval(enhanceHeartbeat);

    const phase2Duration = Date.now() - startTime;
    logger.info('Orchestrator', 'Phase 2 complete', {
      dur: phase2Duration,
      enhanceActions: enhanceResult.actions?.length || 0,
      researchFindings: researchResult.findings?.length || 0,
    });

    // =====================================================
    // Phase 2.5: Wire research findings to verification cards
    // If any card is a verification_card, map research findings
    // to its sources. This ensures sources don't stay "checking".
    // =====================================================
    const verificationCards = Array.from(currentCards.values())
      .filter(c => c.cardType === 'verification_card');
    
    if (verificationCards.length > 0 && researchResult.findings && researchResult.findings.length > 0) {
      for (const vCard of verificationCards) {
        const cardData = vCard.populatedData || vCard.data || vCard.placeholderData || {};
        const sources = cardData.sources || [];
        let updated = false;

        // Normalize string sources to objects (LLM may return ["Al Jazeera"] instead of [{name: "Al Jazeera"}])
        normalizeSourceArray(sources);

        // Normalize source field names — LLM may use "source" instead of "name"
        for (const source of sources) {
          if (!source.name && source.source) source.name = source.source;
        }

        // Haiku's verification statuses are unreliable assumptions —
        // always re-evaluate ALL sources against research findings
        const matchedFindingSet = new Set();
        for (const source of sources) {
          const sourceName = (source.name || '').toLowerCase();
          const finding = sourceName && findMatchingFinding(sourceName, researchResult.findings);

          if (finding) {
            matchedFindingSet.add(finding);
            const fc = finding.factCheck;
            if (fc && (fc.verdict === 'verified' || fc.verdict === 'partially_true')) {
              source.status = 'confirmed';
            } else if (fc && (fc.verdict === 'false' || fc.verdict === 'misleading')) {
              source.status = 'denied';
            } else {
              source.status = 'inconclusive';
            }
            source.snippet = finding.summary || '';
            if (finding.sourceUrls && finding.sourceUrls.length > 0) {
              source.url = finding.sourceUrls[0];
            }
            updated = true;
          } else {
            source.status = 'not_yet_reported';
            updated = true;
          }
        }

        // Add sources from research URLs not already in the card.
        // Sonar often finds relevant sources (Kurdistan24, India Today, etc.)
        // that the enhance LLM didn't include. Surfacing them gives users
        // a richer multi-source verification grid.
        const MAX_VERIFICATION_SOURCES = 5;
        const existingHosts = new Set(sources.map(s => {
          if (s.url) {
            try { return new URL(s.url).hostname.replace(/^www\./, ''); } catch (_) { /* ignore */ }
          }
          return null;
        }).filter(Boolean));

        for (const finding of researchResult.findings) {
          if (sources.length >= MAX_VERIFICATION_SOURCES) break;
          if (!finding.sourceUrls?.length || !finding.factCheck) continue;

          for (const url of finding.sourceUrls) {
            if (sources.length >= MAX_VERIFICATION_SOURCES) break;
            let host;
            try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (_) { continue; }
            if (existingHosts.has(host)) continue;
            if (isGenericPlatform(host)) continue;

            const fc = finding.factCheck;
            let status;
            if (fc.verdict === 'verified' || fc.verdict === 'partially_true') status = 'confirmed';
            else if (fc.verdict === 'false' || fc.verdict === 'misleading') status = 'denied';
            else status = 'inconclusive';

            sources.push({
              name: hostToSourceName(host),
              status,
              snippet: truncateAtWord(finding.summary || fc.explanation || '', 200),
              url,
            });
            existingHosts.add(host);
            updated = true;
          }
        }

        if (updated) {
          const overallStatus = computeVerificationStatus(sources);
          const updatedData = { ...cardData, sources, status: overallStatus, lastChecked: new Date().toISOString() };
          
          // Build research summary — deduplicate at sentence level to avoid
          // near-duplicate Sonar explanations repeating the same conclusion
          const summaryParts = researchResult.findings
            .filter(f => f.factCheck)
            .map(f => (f.factCheck.explanation || f.summary || '').replace(/\.+\s*$/, '').trim())
            .filter(Boolean);
          const uniqueParts = [...new Set(summaryParts)];
          const rawSummary = uniqueParts.join('. ');
          if (rawSummary) {
            const deduped = deduplicateSentences(rawSummary + '.');
            updatedData.summary = truncateAtWord(deduped, 500);
          }

          vCard.populatedData = updatedData;
          vCard.data = updatedData;
          currentCards.set(vCard.id, vCard);

          if (onCardUpdate) {
            onCardUpdate({
              cardId: vCard.id,
              cardType: 'verification_card',
              data: updatedData,
              reason: 'Research findings applied to verification sources',
              source: 'research',
            });
          }
        }
      }
    }

    // Also apply a timeout for verification cards still in "checking" state
    for (const vCard of verificationCards) {
      const cardData = vCard.populatedData || vCard.data || {};
      const sources = cardData.sources || [];
      normalizeSourceArray(sources);
      let anyStillChecking = false;
      for (const source of sources) {
        if (!source.name && source.source) source.name = source.source;
        const norm = normalizeSourceStatus(source.status);
        if (norm === 'checking') {
          source.status = 'not_yet_reported';
          anyStillChecking = true;
        }
      }
      if (anyStillChecking) {
        const updatedData = { ...cardData, sources, status: cardData.status === 'searching' ? 'unconfirmed' : cardData.status, lastChecked: new Date().toISOString() };
        vCard.populatedData = updatedData;
        vCard.data = updatedData;
        currentCards.set(vCard.id, vCard);
        if (onCardUpdate) {
          onCardUpdate({
            cardId: vCard.id,
            cardType: 'verification_card',
            data: updatedData,
            reason: 'Verification timeout — sources set to not_yet_reported',
            source: 'timeout',
          });
        }
      }
    }

    // =====================================================
    // Post-processing: promote screenshot's original source in verification cards.
    // When the preAnalysis identifies the screenshot's publisher (e.g. Reuters),
    // any verification source matching that name should be "confirmed" — the
    // screenshot itself is direct evidence that this source reported the story.
    // Without this, users see "Reuters: Not Yet Reported" on a Reuters screenshot.
    // =====================================================
    const sourceAttribution = blueprint.contentAnalysis?.preAnalysis?.sourceAttribution;
    if (sourceAttribution?.name && sourceAttribution.confidence !== 'low') {
      const attrName = sourceAttribution.name.toLowerCase().trim();
      for (const vCard of verificationCards) {
        const cardData = vCard.populatedData || vCard.data || {};
        const sources = cardData.sources || [];
        let promoted = false;

        for (const source of sources) {
          const srcName = (source.name || '').toLowerCase().trim();
          if (!srcName) continue;
          const isMatch = srcName === attrName
            || attrName.includes(srcName)
            || srcName.includes(attrName);
          if (!isMatch) continue;
          if (source.status === 'confirmed') continue;

          source.status = 'confirmed';
          source.snippet = `Original source — this screenshot is from ${sourceAttribution.name}.`;
          promoted = true;
        }

        if (promoted) {
          const newStatus = computeVerificationStatus(sources);
          const updatedData = { ...cardData, sources, status: newStatus, lastChecked: new Date().toISOString() };
          vCard.populatedData = updatedData;
          vCard.data = updatedData;
          currentCards.set(vCard.id, vCard);

          logger.info('Orchestrator', 'Promoted original source in verification card', {
            sourceName: sourceAttribution.name,
            newStatus,
          });

          if (onCardUpdate) {
            onCardUpdate({
              cardId: vCard.id,
              cardType: 'verification_card',
              data: updatedData,
              reason: `Source "${sourceAttribution.name}" confirmed as original publisher`,
              source: 'reconcile',
            });
          }
        }
      }
    }

    // =====================================================
    // Phase 3: Review — LLM only if cards need population,
    // otherwise apply research data programmatically
    // =====================================================
    const hasResearchFindings = researchResult.findings && researchResult.findings.length > 0;
    const unpopulatedCards = Array.from(currentCards.values()).filter(c => {
      const data = c.populatedData || c.data || {};
      return !data || Object.keys(data).length === 0;
    });
    const hasUnpopulatedCards = unpopulatedCards.length > 0;

    if (hasUnpopulatedCards) {
      logger.warn('Orchestrator', 'Cards still unpopulated after enhance', {
        unpopulated: unpopulatedCards.map(c => ({ id: c.id, type: c.cardType })),
      });
    }

    if (hasUnpopulatedCards) {
      // Full LLM review — unpopulated cards need the model to generate content
      if (onPhase) {
        onPhase({ phase: 'reviewing', message: 'Populating remaining cards...' });
      }

      if (onProgress) {
        onProgress({
          phase: 'reviewing',
          progress: 70,
          message: 'Populating remaining cards...',
        });
      }

      logger.info('Orchestrator', 'Phase 3: LLM Review (unpopulated cards)', {
        findings: researchResult.findings?.length || 0,
        unpopulated: unpopulatedCards.length,
      });

      const reviewResearchData = hasResearchFindings
        ? researchResult
        : { findings: [], overallContext: '' };

      const reviewResult = await enhance({
        imageData,
        mediaType,
        currentCards: Array.from(currentCards.values()),
        contentAnalysis: blueprint.contentAnalysis,
        layout: blueprint.layout,
        researchData: reviewResearchData,
        onCardUpdate: (action) => {
          logger.info('Orchestrator', 'Review updated card', {
            cardId: action.cardId,
            reason: action.reason,
          });

          const safeData = stripFabricatedImageUrls(action.data);
          const existing = currentCards.get(action.cardId);
          if (existing) {
            const mergedData = {
              ...(existing.populatedData || existing.data || existing.placeholderData || {}),
              ...safeData,
            };
            if (existing.cardType === 'verification_card') {
              mergedData.lastChecked = new Date().toISOString();
            }
            existing.populatedData = mergedData;
            existing.data = mergedData;
            currentCards.set(action.cardId, existing);
          }

          if (onCardUpdate) {
            onCardUpdate({
              cardId: action.cardId,
              cardType: action.cardType,
              data: safeData,
              reason: action.reason,
              source: 'review',
            });
          }
        },
        onCardAdd: (action) => {
          logger.info('Orchestrator', 'Review added card', {
            cardId: action.cardId,
            cardType: action.cardType,
          });

          const safeData = stripFabricatedImageUrls(action.data);
          const newCard = {
            id: action.cardId,
            cardType: action.cardType,
            gridPosition: action.gridPosition,
            populatedData: safeData,
            data: safeData,
            status: 'populated',
          };
          currentCards.set(action.cardId, newCard);

          if (onCardAdd) {
            onCardAdd({
              cardId: action.cardId,
              cardType: action.cardType,
              data: safeData,
              gridPosition: action.gridPosition,
              reason: action.reason,
              source: 'review',
            });
          }
        },
        onLayoutUpdate: (action) => {
          logger.info('Orchestrator', 'Review changed layout', {
            type: action.layoutType,
          });
        },
        adapterConfig: {
          ...adapterConfig,
          model: adapterConfig.reviewModel || 'claude-haiku-4-5-20251001',
          traceCollector,
          maxIterations: 1,
        },
      }).catch(err => {
        logger.warn('Orchestrator', 'Review failed (non-fatal)', { err: err.message });
        return { actions: [], duration: 0 };
      });

      if (hasResearchFindings) {
        enrichTimelineFromResearch({
          currentCards,
          researchFindings: researchResult.findings,
          onCardUpdate,
        });
      }

      logger.info('Orchestrator', 'Phase 3 complete (LLM)', {
        reviewActions: reviewResult.actions?.length || 0,
      });
    } else if (hasResearchFindings) {
      // All cards populated — apply research URLs/context programmatically (no LLM)
      const enrichCount = applyResearchToCards({
        currentCards,
        researchFindings: researchResult.findings,
        onCardUpdate,
      });
      const timelineEnrichCount = enrichTimelineFromResearch({
        currentCards,
        researchFindings: researchResult.findings,
        onCardUpdate,
      });
      logger.info('Orchestrator', 'Phase 3: Programmatic research enrichment (skipped LLM)', {
        findings: researchResult.findings.length,
        cardsEnriched: enrichCount,
        timelinesEnriched: timelineEnrichCount,
      });
    } else {
      logger.info('Orchestrator', 'Skipping Phase 3 (no research findings, all cards populated)');
    }

    // =====================================================
    // Post-processing: enforce person_card must be a named human
    // Haiku ignores the prompt instruction ~60% of the time, producing
    // person_cards for news outlets ("CNN International"), organizations
    // ("Iranian Revolutionary Guard"), or generic titles ("Japanese
    // Prime Minister"). Convert these to source_card when detected.
    // =====================================================
    for (const [cardId, card] of currentCards) {
      if (card.cardType !== 'person_card') continue;
      const cardData = card.populatedData || card.data || {};
      const name = (cardData.name || '').trim();
      const role = (cardData.role || '').toLowerCase();

      if (!name || isLikelyNotAPerson(name, role)) {
        logger.info('Orchestrator', 'Converting non-person person_card to source_card', {
          cardId, name, role,
        });

        card.cardType = 'source_card';
        const sourceData = {
          name: name || 'Unknown Source',
          type: guessSourceType(role),
          credibility: 'unknown',
          context: cardData.context || '',
        };
        if (cardData.handle) sourceData.profileUrl = cardData.profileUrl;
        if (cardData.details && Array.isArray(cardData.details)) {
          sourceData.context = (sourceData.context + ' ' + cardData.details.join('. ')).trim().slice(0, 200);
        }

        card.populatedData = sourceData;
        card.data = sourceData;
        currentCards.set(cardId, card);

        if (onCardUpdate) {
          onCardUpdate({
            cardId,
            cardType: 'source_card',
            data: sourceData,
            reason: `Converted non-person "${name}" from person_card to source_card`,
            source: 'reconcile',
          });
        }
      }
    }

    // =====================================================
    // Post-processing: validate did_you_know_card quality
    // Haiku frequently generates DYK facts that restate the hero card
    // or paraphrase what's already visible in the screenshot.
    // Detect high overlap with hero content and replace from research.
    // =====================================================
    for (const [cardId, card] of currentCards) {
      if (card.cardType !== 'did_you_know_card') continue;
      const dykData = card.populatedData || card.data || {};
      const fact = (dykData.fact || '').toLowerCase();
      if (!fact || fact.length < 10) continue;

      const heroEntry = Array.from(currentCards.values()).find(c => c.cardType === 'hero_summary');
      if (!heroEntry) continue;
      const heroData = heroEntry.populatedData || heroEntry.data || {};
      const heroText = `${heroData.title || ''} ${heroData.subtitle || ''} ${heroData.takeaway || ''}`.toLowerCase();

      const factWords = new Set(fact.split(/\s+/).filter(w => w.length > 3));
      const heroWords = new Set(heroText.split(/\s+/).filter(w => w.length > 3));
      if (factWords.size === 0) continue;
      const overlap = [...factWords].filter(w => heroWords.has(w)).length;
      const overlapRatio = overlap / factWords.size;

      if (overlapRatio > 0.5 && researchResult.findings && researchResult.findings.length > 0) {
        for (const finding of researchResult.findings) {
          const summary = (finding.summary || '').trim();
          if (!summary || summary.length < 30 || summary.length > 300) continue;

          const findingWords = new Set(summary.toLowerCase().split(/\s+/).filter(w => w.length > 3));
          if (findingWords.size === 0) continue;
          const findingHeroOverlap = [...findingWords].filter(w => heroWords.has(w)).length;
          if (findingHeroOverlap / findingWords.size > 0.4) continue;

          if (/^(screenshot source|source attribution)/i.test(finding.topic)) continue;

          logger.info('Orchestrator', 'Replaced redundant DYK fact from research', {
            cardId,
            overlapRatio: overlapRatio.toFixed(2),
            oldFact: truncateAtWord(dykData.fact, 60),
            newFact: truncateAtWord(summary, 60),
          });

          dykData.fact = truncateAtWord(summary, 200);
          if (finding.sourceUrls && finding.sourceUrls[0] && isValidUrl(finding.sourceUrls[0])) {
            dykData.sourceUrl = finding.sourceUrls[0];
          }
          card.populatedData = dykData;
          card.data = dykData;
          currentCards.set(cardId, card);

          if (onCardUpdate) {
            onCardUpdate({
              cardId,
              cardType: 'did_you_know_card',
              data: dykData,
              reason: 'Replaced redundant DYK fact with research context',
              source: 'reconcile',
            });
          }
          break;
        }
      }
    }

    // =====================================================
    // Post-processing: enforce fact_check verdict/confidence coherence
    // LLMs often return "verified" + "low" confidence (contradictory).
    // The prompt instructs coherence but the LLM ignores it, so we
    // enforce it in code — same principle as verification_card reconciliation.
    // =====================================================
    for (const [cardId, card] of currentCards) {
      if (card.cardType !== 'fact_check') continue;
      const cardData = card.populatedData || card.data || {};
      if (!cardData.verdict) continue;

      const v = cardData.verdict;
      const c = cardData.confidence;
      let newVerdict = v;
      let newConfidence = c;

      if ((v === 'verified') && (c === 'low' || !c)) {
        newVerdict = 'needs_context';
        newConfidence = c || 'low';
      } else if ((v === 'false' || v === 'misleading') && (c === 'low' || !c)) {
        newVerdict = 'unverified';
        newConfidence = c || 'low';
      } else if ((v === 'unverified' || v === 'needs_context') && c === 'high') {
        newConfidence = 'medium';
      } else if (v === 'verified' && !c) {
        newConfidence = 'medium';
      }

      if (newVerdict !== v || newConfidence !== c) {
        logger.info('Orchestrator', 'Reconciled fact_check coherence', {
          cardId, wasVerdict: v, wasConfidence: c,
          nowVerdict: newVerdict, nowConfidence: newConfidence,
        });
        cardData.verdict = newVerdict;
        cardData.confidence = newConfidence;
        card.populatedData = cardData;
        card.data = cardData;
        currentCards.set(cardId, card);

        if (onCardUpdate) {
          onCardUpdate({
            cardId,
            cardType: 'fact_check',
            data: { verdict: newVerdict, confidence: newConfidence },
            reason: `Verdict/confidence reconciled: ${newVerdict} (${newConfidence})`,
            source: 'reconcile',
          });
        }
      }
    }

    // =====================================================
    // Post-processing: reconcile verification card statuses
    // The review phase may overwrite Phase 2.5's computed status,
    // causing the overall badge to contradict individual source icons.
    // Re-compute from actual source statuses to ensure consistency.
    // =====================================================
    for (const [cardId, card] of currentCards) {
      if (card.cardType !== 'verification_card') continue;
      const cardData = card.populatedData || card.data || {};
      const sources = cardData.sources || [];
      if (sources.length === 0) continue;

      // Normalize string sources and field names for consistent storage
      normalizeSourceArray(sources);
      for (const src of sources) {
        if (!src.name && src.source) src.name = src.source;
        src.status = normalizeSourceStatus(src.status);
      }

      const correctStatus = computeVerificationStatus(sources);
      if (cardData.status !== correctStatus) {
        logger.info('Orchestrator', 'Reconciled verification status', {
          cardId,
          was: cardData.status,
          now: correctStatus,
          sources: sources.map(s => s.status),
        });
        cardData.status = correctStatus;
        card.populatedData = cardData;
        card.data = cardData;
        currentCards.set(cardId, card);

        if (onCardUpdate) {
          onCardUpdate({
            cardId,
            cardType: 'verification_card',
            data: cardData,
            reason: `Status reconciled: ${correctStatus} (based on ${sources.length} sources)`,
            source: 'reconcile',
          });
        }
      }
    }

    // =====================================================
    // Post-processing: generate fallback verification summary
    // When research times out or returns no findings, the verification card
    // ends up with sources set to "not_yet_reported" and an empty summary.
    // Users see an "Unconfirmed" badge with zero context — useless for
    // the most important card in breaking news. Generate a contextual
    // fallback so users always know what was checked and what to do.
    // =====================================================
    for (const [cardId, card] of currentCards) {
      if (card.cardType !== 'verification_card') continue;
      const cardData = card.populatedData || card.data || {};
      if (cardData.summary) continue;

      const sources = cardData.sources || [];
      const status = cardData.status || 'unconfirmed';
      const notYetCount = sources.filter(s =>
        s.status === 'not_yet_reported' || s.status === 'checking'
      ).length;
      const inconclusiveCount = sources.filter(s => s.status === 'inconclusive').length;

      let fallback;
      if (notYetCount === sources.length && sources.length > 0) {
        fallback = 'This claim could not be independently verified at this time. None of the sources checked have reported on this story. Check major news outlets directly for the latest updates.';
      } else if (status === 'inconclusive' || inconclusiveCount > 0) {
        fallback = 'Initial source checks were inconclusive. Breaking stories often take time to be independently verified by multiple outlets.';
      } else if (status === 'unconfirmed') {
        fallback = 'This claim has not been confirmed by the sources checked. Verify with established news outlets for the most current information.';
      }

      if (fallback) {
        cardData.summary = fallback;
        card.populatedData = cardData;
        card.data = cardData;
        currentCards.set(cardId, card);

        if (onCardUpdate) {
          onCardUpdate({
            cardId,
            cardType: 'verification_card',
            data: { summary: fallback },
            reason: 'Fallback summary — research data unavailable',
            source: 'reconcile',
          });
        }
      }
    }

    // =====================================================
    // Surface research follow-up questions to the frontend.
    // The classifier always returns empty arrays; enrich with
    // the deeper Q&A that came back from Sonar / web search.
    // =====================================================
    if (researchResult.followUpQuestions?.length || researchResult.additionalQuestions?.length) {
      const ca = blueprint.contentAnalysis;
      if (researchResult.followUpQuestions?.length) {
        ca.followUpQuestions = [
          ...(ca.followUpQuestions || []),
          ...researchResult.followUpQuestions,
        ].slice(0, 5);
      }
      if (researchResult.additionalQuestions?.length) {
        ca.additionalQuestions = researchResult.additionalQuestions.slice(0, 5);
      }
      if (researchResult.overallContext) {
        ca.overallContext = researchResult.overallContext;
      }
    }

    // =====================================================
    // Milestone 3: Resolve hero investigation status
    // Derive from verification card status + research findings
    // =====================================================
    const heroCard = Array.from(currentCards.values()).find(c => c.cardType === 'hero_summary');
    if (heroCard) {
      const heroData = heroCard.populatedData || heroCard.data || {};
      const vCard = Array.from(currentCards.values()).find(c => c.cardType === 'verification_card');
      const vData = vCard ? (vCard.populatedData || vCard.data || {}) : null;

      let investigationStatus = null;
      if (skipResearch) {
        delete heroData.investigationStatus;
      } else if (vData && vData.status) {
        const vs = vData.status;
        if (vs === 'verified' || vs === 'confirmed') investigationStatus = 'confirmed';
        else if (vs === 'denied' || vs === 'false') investigationStatus = 'unconfirmed';
        else if (vs === 'partially_verified' || vs === 'conflicting') investigationStatus = 'mixed';
        else investigationStatus = 'unconfirmed';
      } else if (researchResult.findings && researchResult.findings.length > 0) {
        const verdicts = researchResult.findings
          .filter(f => f.factCheck?.verdict)
          .map(f => f.factCheck.verdict);
        if (verdicts.includes('verified') || verdicts.includes('partially_true')) investigationStatus = 'confirmed';
        else if (verdicts.includes('false') || verdicts.includes('misleading')) investigationStatus = 'unconfirmed';
        else if (verdicts.length > 0) investigationStatus = 'mixed';
        else investigationStatus = 'unconfirmed';
      } else {
        investigationStatus = 'unconfirmed';
      }

      if (investigationStatus) {
        heroData.investigationStatus = investigationStatus;
      }
      heroCard.populatedData = heroData;
      heroCard.data = heroData;
      currentCards.set(heroCard.id, heroCard);

      logger.info('Orchestrator', 'Investigation status resolved', {
        status: investigationStatus,
        vCardStatus: vData?.status,
      });

      if (onCardUpdate && investigationStatus) {
        onCardUpdate({
          cardId: heroCard.id,
          cardType: 'hero_summary',
          data: { investigationStatus },
          reason: `Investigation ${investigationStatus}`,
          source: 'status',
        });
      }

      // =====================================================
      // Post-processing: qualify person/news cards when claim is unverified
      // When investigation is "unconfirmed", person_card roles and news_card
      // summaries may present the unverified claim as established fact,
      // contradicting the verification card. Qualify them with uncertainty.
      // =====================================================
      if (investigationStatus === 'unconfirmed' && vData) {
        const claim = (vData.claim || '').toLowerCase();
        const vSummary = vData.summary || '';

        if (claim) {
          for (const [cardId, card] of currentCards) {
            if (card.cardType === 'person_card') {
              const cardData = card.populatedData || card.data || {};
              const personName = (cardData.name || '').toLowerCase().trim();
              if (!personName || !cardData.role) continue;

              const nameWords = personName.split(/\s+/).filter(w => w.length > 2);
              const nameInClaim = nameWords.length > 0 && nameWords.every(w => claim.includes(w));
              if (!nameInClaim) continue;

              logger.info('Orchestrator', 'Qualifying unverified person_card role', {
                cardId, name: cardData.name, role: cardData.role,
              });

              cardData.role = cardData.role + ' — unverified';

              if (vSummary) {
                const lastName = personName.split(/\s+/).pop();
                const sentences = vSummary.split(/(?<=[.!?])\s+/);
                const roleVerbs = /\b(serves?|remains?|holds?|is currently|occupies?|acts? as)\b/i;
                const verifiedRole = sentences.find(s =>
                  s.toLowerCase().includes(lastName) && roleVerbs.test(s)
                );
                if (verifiedRole && verifiedRole.length < 250) {
                  cardData.notableInfo = '📋 ' + verifiedRole.trim();
                }
              }

              card.populatedData = cardData;
              card.data = cardData;
              currentCards.set(cardId, card);

              if (onCardUpdate) {
                onCardUpdate({
                  cardId,
                  cardType: 'person_card',
                  data: cardData,
                  reason: 'Qualified role — claim is unverified by major sources',
                  source: 'reconcile',
                });
              }
            }

            if (card.cardType === 'news_card') {
              const cardData = card.populatedData || card.data || {};
              const summary = (cardData.summary || '').toLowerCase();
              if (!summary) continue;

              const claimWords = claim.split(/\s+/).filter(w => w.length > 3);
              const summaryWords = summary.split(/\s+/).filter(w => w.length > 3);
              if (summaryWords.length === 0) continue;
              const overlap = summaryWords.filter(w => claimWords.includes(w)).length;
              const echoesRatio = overlap / summaryWords.length;

              if (echoesRatio > 0.25 && cardData.summary && !cardData.summary.toLowerCase().startsWith('per unverified')) {
                cardData.summary = 'Per unverified reports: ' + cardData.summary;
                card.populatedData = cardData;
                card.data = cardData;
                currentCards.set(cardId, card);

                if (onCardUpdate) {
                  onCardUpdate({
                    cardId,
                    cardType: 'news_card',
                    data: cardData,
                    reason: 'Qualified summary — claim is unverified',
                    source: 'reconcile',
                  });
                }
              }
            }
          }
        }
      }
    }

    // =====================================================
    // Final: Assemble result
    // =====================================================
    const totalDuration = Date.now() - startTime;
    logger.info('Orchestrator', 'Pipeline complete', { dur: totalDuration });

    const finalCards = Array.from(currentCards.values()).map(card => ({
      ...card,
      status: 'populated',
      data: card.populatedData || card.data || card.placeholderData,
    }));

    // Guard: if zero cards have meaningful data beyond placeholders,
    // the pipeline effectively failed (e.g. API overloaded on both classify + enhance)
    const populatedCount = finalCards.filter(card => {
      const data = card.populatedData || card.data || {};
      if (!data || Object.keys(data).length === 0) return false;
      if (data.title === 'Analyzing screenshot...' && Object.keys(data).length <= 3) return false;
      return true;
    }).length;

    if (populatedCount === 0) {
      const degradedError = new Error(
        'Analysis could not be completed — our AI service is temporarily overloaded. Please try again in a moment.'
      );
      degradedError.code = 'ZERO_CARDS_POPULATED';
      logger.error('Orchestrator', 'Pipeline degraded — zero cards populated', {
        dur: totalDuration,
        skeletonCards: finalCards.length,
        classifyErrors: traceCollector.getSummary()?.byPhase?.classify?.errors || 0,
        enhanceErrors: traceCollector.getSummary()?.byPhase?.enhance?.errors || 0,
      });
      clearInterval(enhanceHeartbeat);
      if (onError) {
        onError(degradedError);
      } else {
        throw degradedError;
      }
      return null;
    }

    const populatedLayout = {
      ...blueprint,
      cards: finalCards,
      _meta: {
        totalDuration,
        haikuDuration,
        designDuration: haikuDuration,
        enhanceDuration: enhanceResult.duration || 0,
        researchDuration: researchResult.duration || 0,
        enhanceActions: enhanceResult.actions?.length || 0,
        researchFindings: researchResult.findings?.length || 0,
        cardsResearched: finalCards.length,
      },
      _llmTraces: traceCollector.getTraces(),
      _llmTraceSummary: traceCollector.getSummary(),
    };

    if (onProgress) {
      onProgress({ phase: 'complete', progress: 100, message: 'All cards populated' });
    }

    if (onComplete) {
      onComplete(populatedLayout);
    }

    return populatedLayout;
  } catch (error) {
    clearInterval(enhanceHeartbeat);
    logger.error('Orchestrator', 'Pipeline error', {
      err: error.message,
      stack: error.stack?.split('\n').slice(0, 3).join(' | '),
    });
    if (onError) {
      onError(error);
    } else {
      throw error;
    }
  }
}

/**
 * Gemini-only pipeline — single API call replaces classify + enhance + research.
 * Gemini 2.5 Flash with Google Search grounding sees the screenshot and
 * searches the web simultaneously, returning fully populated card data.
 */
async function runGeminiPipeline({
  imageData, mediaType, question,
  skeleton, startTime, traceCollector,
  onBlueprint, onLayoutUpdate, onCardPopulated, onCardUpdate,
  onCardAdd, onPhase, onComplete, onError, onProgress,
  adapterConfig,
}) {
  logger.info('Orchestrator', 'Gemini pipeline: single-call analysis + web search');

  if (onPhase) {
    onPhase({ phase: 'analyzing', message: 'Analyzing with web search...' });
  }

  const progressMessages = [
    'Reading screenshot...',
    'Searching news sources...',
    'Verifying claims...',
    'Cross-referencing sources...',
    'Building timeline...',
    'Analyzing context...',
    'Checking multiple outlets...',
    'Compiling verified findings...',
    'Almost there...',
  ];
  let msgIdx = 0;
  const heartbeat = setInterval(() => {
    if (onProgress) {
      msgIdx = Math.min(msgIdx + 1, progressMessages.length - 1);
      const progress = Math.min(10 + msgIdx * 10, 90);
      onProgress({
        phase: 'analyzing',
        progress,
        message: progressMessages[msgIdx],
      });
    }
  }, 3000);

  try {
    const result = await geminiAnalyze({
      imageData,
      mediaType,
      question,
      adapterConfig: { ...adapterConfig, traceCollector },
    });

    clearInterval(heartbeat);

    if (!result || !result.analysis) {
      logger.warn('Orchestrator', 'Gemini analysis returned null — falling back to classic pipeline');
      clearInterval(heartbeat);
      // Fall back: re-enter the classic pipeline by calling runPipeline with
      // PIPELINE_MODE overridden. We can't easily do this without recursion,
      // so instead we throw a specific error that the caller can catch.
      const fallbackError = new Error('Gemini analysis failed — please retry');
      fallbackError.code = 'GEMINI_FALLBACK';
      throw fallbackError;
    }

    const blueprint = toBlueprintAndCards(result.analysis);
    const geminiDuration = Date.now() - startTime;

    logger.info('Orchestrator', 'Gemini analysis complete', {
      dur: geminiDuration,
      contentType: blueprint.contentAnalysis?.contentType,
      layoutType: blueprint.layout?.type,
      cardCount: blueprint.cards?.length,
      groundingSources: result.groundingSources,
      model: result.model,
    });

    if (onLayoutUpdate) {
      onLayoutUpdate(blueprint);
    }

    if (onProgress) {
      onProgress({
        phase: 'populating',
        progress: 85,
        message: 'Rendering cards...',
      });
    }

    // Send each card as a populated event with a small stagger
    // for the card-by-card animation effect
    const finalCards = new Map();
    for (let i = 0; i < blueprint.cards.length; i++) {
      const card = blueprint.cards[i];
      finalCards.set(card.id, card);

      if (onCardPopulated) {
        onCardPopulated({
          cardId: card.id,
          cardType: card.cardType,
          data: card.populatedData || card.data,
          completedCount: i + 1,
          totalCount: blueprint.cards.length,
        });
      }
    }

    // Post-processing: validate verification card status consistency
    for (const [cardId, card] of finalCards) {
      if (card.cardType !== 'verification_card') continue;
      const cardData = card.populatedData || card.data || {};
      const sources = cardData.sources || [];
      if (sources.length === 0) continue;

      normalizeSourceArray(sources);
      for (const src of sources) {
        if (!src.name && src.source) src.name = src.source;
        src.status = normalizeSourceStatus(src.status);
      }
      const correctStatus = computeVerificationStatus(sources);
      if (cardData.status !== correctStatus) {
        cardData.status = correctStatus;
        card.populatedData = cardData;
        card.data = cardData;
        finalCards.set(cardId, card);
      }
    }

    // Post-processing: person_card org/generic check
    for (const [cardId, card] of finalCards) {
      if (card.cardType !== 'person_card') continue;
      const cardData = card.populatedData || card.data || {};
      const name = (cardData.name || '').trim();
      const role = (cardData.role || '').toLowerCase();

      if (!name || isLikelyNotAPerson(name, role)) {
        card.cardType = 'source_card';
        card.populatedData = {
          name: name || 'Unknown Source',
          type: guessSourceType(role),
          credibility: 'unknown',
          context: cardData.context || '',
        };
        card.data = card.populatedData;
        finalCards.set(cardId, card);

        if (onCardUpdate) {
          onCardUpdate({
            cardId, cardType: 'source_card',
            data: card.populatedData,
            reason: `Converted "${name}" from person_card to source_card`,
            source: 'reconcile',
          });
        }
      }
    }

    // Sync hero investigationStatus with verification card
    const heroCard = Array.from(finalCards.values()).find(c => c.cardType === 'hero_summary');
    const vCard = Array.from(finalCards.values()).find(c => c.cardType === 'verification_card');
    if (heroCard && vCard) {
      const vData = vCard.populatedData || vCard.data || {};
      const heroData = heroCard.populatedData || heroCard.data || {};
      const vs = vData.status;
      let investigationStatus;
      if (vs === 'verified' || vs === 'confirmed') investigationStatus = 'confirmed';
      else if (vs === 'denied' || vs === 'false') investigationStatus = 'unconfirmed';
      else if (vs === 'partially_verified' || vs === 'conflicting') investigationStatus = 'mixed';
      else investigationStatus = 'unconfirmed';

      if (heroData.investigationStatus !== investigationStatus) {
        heroData.investigationStatus = investigationStatus;
        heroCard.populatedData = heroData;
        heroCard.data = heroData;
        finalCards.set(heroCard.id, heroCard);

        if (onCardUpdate) {
          onCardUpdate({
            cardId: heroCard.id, cardType: 'hero_summary',
            data: { investigationStatus },
            reason: `Investigation ${investigationStatus}`,
            source: 'status',
          });
        }
      }
    }

    const totalDuration = Date.now() - startTime;

    const populatedLayout = {
      ...blueprint,
      cards: Array.from(finalCards.values()),
      _meta: {
        totalDuration,
        pipeline: 'gemini',
        model: result.model,
        groundingSources: result.groundingSources,
        citations: result.citations?.length || 0,
        geminiDuration: result.duration,
      },
      _llmTraces: traceCollector.getTraces(),
      _llmTraceSummary: traceCollector.getSummary(),
    };

    if (onProgress) {
      onProgress({ phase: 'complete', progress: 100, message: 'All cards populated' });
    }

    if (onComplete) {
      onComplete(populatedLayout);
    }

    return populatedLayout;
  } catch (error) {
    clearInterval(heartbeat);
    logger.error('Orchestrator', 'Gemini pipeline error', {
      err: error.message,
      dur: Date.now() - startTime,
    });
    if (onError) {
      onError(error);
    } else {
      throw error;
    }
  }
}

module.exports = { runPipeline };
