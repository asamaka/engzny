const URL_FIELDS = new Set([
  'url', 'sourceUrl', 'profileUrl', 'mapUrl', 'imageUrl', 'photoUrl', 'mapImageUrl',
]);

const ORGANIZATION_MARKERS = [
  'al jazeera', 'editorial', 'bureau', 'government', 'ministry', 'guard',
  'revolutionary guard', 'times of israel', 'reuters', 'ap', 'bbc', 'cnn',
  'news', 'media', 'channel', 'office', 'department', 'administration',
];

const GENERIC_ROLE_MARKERS = [
  'prime minister', 'president', 'spokesperson', 'editorial', 'government',
  'military', 'army', 'police', 'minister', 'official', 'bureau chief',
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sanitizeUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const match = url.match(/https?:\/\/[^\s)"'>]+/i);
  if (!match) return null;

  const candidate = match[0].replace(/[),.;]+$/g, '');
  try {
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function sanitizeUrlsDeep(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeUrlsDeep(item));
  }
  if (!value || typeof value !== 'object') return value;

  const next = { ...value };
  for (const [key, item] of Object.entries(next)) {
    if (URL_FIELDS.has(key)) {
      const sanitized = sanitizeUrl(item);
      if (sanitized) next[key] = sanitized;
      else delete next[key];
    } else if (Array.isArray(item) || (item && typeof item === 'object')) {
      next[key] = sanitizeUrlsDeep(item);
    }
  }
  return next;
}

function normalizeSourceStatus(status) {
  if (status === 'verified' || status === 'confirmed') return 'confirmed';
  if (status === 'denied' || status === 'false' || status === 'disproven') return 'denied';
  if (status === 'checking' || status === 'searching' || status === 'pending') return 'checking';
  if (status === 'inconclusive' || status === 'unverified' || status === 'needs_context' || status === 'mixed') return 'inconclusive';
  if (status === 'no_info') return 'no_info';
  if (status === 'not_yet_reported') return 'not_yet_reported';
  return status || 'not_yet_reported';
}

function computeVerificationStatus(sources) {
  if (!Array.isArray(sources) || sources.length === 0) return 'unconfirmed';
  const statuses = sources.map((source) => normalizeSourceStatus(source.status));
  const hasConfirmed = statuses.some((status) => status === 'confirmed');
  const hasDenied = statuses.some((status) => status === 'denied');
  const hasChecking = statuses.some((status) => status === 'checking');
  const hasInconclusive = statuses.some((status) => status === 'inconclusive');

  if (hasChecking) return 'searching';
  if (hasConfirmed && hasDenied) return 'conflicting';
  if (hasConfirmed && !hasDenied) {
    return statuses.every((status) => status === 'confirmed') ? 'verified' : 'partially_verified';
  }
  if (hasDenied && !hasConfirmed) return 'denied';
  if (hasInconclusive) return 'unconfirmed';
  return 'unconfirmed';
}

function isLikelyOrganizationName(name = '') {
  const lower = name.toLowerCase();
  return ORGANIZATION_MARKERS.some((marker) => lower.includes(marker));
}

function isLikelyGenericRole(name = '') {
  const lower = name.toLowerCase();
  return GENERIC_ROLE_MARKERS.some((marker) => lower.includes(marker));
}

function reconcileFactCheckData(data = {}) {
  if (!data.verdict) return { changed: false, data };

  let verdict = data.verdict;
  let confidence = data.confidence;

  if (verdict === 'verified' && (!confidence || confidence === 'low')) {
    verdict = 'needs_context';
    confidence = confidence || 'low';
  } else if ((verdict === 'false' || verdict === 'misleading') && (!confidence || confidence === 'low')) {
    verdict = 'unverified';
    confidence = confidence || 'low';
  } else if ((verdict === 'unverified' || verdict === 'needs_context') && confidence === 'high') {
    confidence = 'medium';
  }

  const changed = verdict !== data.verdict || confidence !== data.confidence;
  return {
    changed,
    data: changed ? { ...data, verdict, confidence } : data,
  };
}

function reconcileVerificationData(data = {}) {
  const rawSources = Array.isArray(data.sources) ? data.sources : [];
  const sources = rawSources
    .map((source) => {
      if (!source) return null;
      if (typeof source === 'string') return { name: source, status: 'not_yet_reported' };
      const name = source.name || source.source || null;
      if (!name) return null;
      const next = sanitizeUrlsDeep({ ...source, name });
      next.status = normalizeSourceStatus(next.status);
      return next;
    })
    .filter(Boolean);

  const status = computeVerificationStatus(sources);
  const changed = status !== data.status || JSON.stringify(sources) !== JSON.stringify(rawSources);
  return {
    changed,
    data: changed
      ? {
          ...sanitizeUrlsDeep(data),
          sources,
          status,
        }
      : sanitizeUrlsDeep(data),
  };
}

const IRRELEVANT_PERSON_SIGNALS = [
  /\bunclear\b/i,
  /\bunrelated\b/i,
  /\brequires?\s+verification\b/i,
  /\bnot\s+(?:directly\s+)?relat(?:ed|able)\b/i,
  /\bconnection\b[^.]{0,30}\bunclear\b/i,
  /\birrelevant\b/i,
  /\bnot\s+(?:directly\s+)?connected\b/i,
];

function hasIrrelevanceSignals(data) {
  const textFields = [
    data.context || '',
    data.notableInfo || '',
    ...(Array.isArray(data.details) ? data.details : []),
  ].join(' ');
  if (!textFields.trim()) return false;
  return IRRELEVANT_PERSON_SIGNALS.some((pattern) => pattern.test(textFields));
}

function reconcilePersonCard(card, context = {}) {
  const data = sanitizeUrlsDeep(card.populatedData || card.data || {});
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  if (!name) {
    return {
      changed: true,
      card: {
        ...card,
        cardType: 'source_card',
        populatedData: {
          name: context.preAnalysis?.sourceAttribution?.name || 'Visible source',
          type: context.preAnalysis?.sourceAttribution?.type || 'unknown',
          credibility: 'unknown',
          context: data.context || data.role || 'Referenced in the screenshot',
        },
        data: {
          name: context.preAnalysis?.sourceAttribution?.name || 'Visible source',
          type: context.preAnalysis?.sourceAttribution?.type || 'unknown',
          credibility: 'unknown',
          context: data.context || data.role || 'Referenced in the screenshot',
        },
      },
      reason: 'Converted invalid person_card to source_card',
    };
  }

  if (isLikelyOrganizationName(name) || isLikelyGenericRole(name)) {
    return {
      changed: true,
      card: {
        ...card,
        cardType: 'source_card',
        populatedData: {
          name,
          type: context.preAnalysis?.sourceAttribution?.type || 'organization',
          credibility: 'unknown',
          context: data.context || data.role || 'Visible source/account in the screenshot',
          profileUrl: data.profileUrl || data.url,
          imageUrl: data.photoUrl || data.imageUrl,
        },
        data: {
          name,
          type: context.preAnalysis?.sourceAttribution?.type || 'organization',
          credibility: 'unknown',
          context: data.context || data.role || 'Visible source/account in the screenshot',
          profileUrl: data.profileUrl || data.url,
          imageUrl: data.photoUrl || data.imageUrl,
        },
      },
      reason: 'Converted organization-like person_card to source_card',
    };
  }

  if (hasIrrelevanceSignals(data)) {
    const sourceName = context.preAnalysis?.sourceAttribution?.name || name;
    return {
      changed: true,
      card: {
        ...card,
        cardType: 'source_card',
        populatedData: {
          name: sourceName,
          type: context.preAnalysis?.sourceAttribution?.type || 'unknown',
          credibility: 'unknown',
          context: `${name} mentioned in secondary content. ${data.context || ''}`.trim().slice(0, 200),
        },
        data: {
          name: sourceName,
          type: context.preAnalysis?.sourceAttribution?.type || 'unknown',
          credibility: 'unknown',
          context: `${name} mentioned in secondary content. ${data.context || ''}`.trim().slice(0, 200),
        },
      },
      reason: `Converted irrelevant person_card "${name}" to source_card — LLM flagged unclear relevance`,
    };
  }

  return {
    changed: JSON.stringify(data) !== JSON.stringify(card.populatedData || card.data || {}),
    card: {
      ...card,
      populatedData: data,
      data,
    },
    reason: 'Sanitized person_card URLs',
  };
}

function normalizeYearStrings(text, currentYear) {
  if (!text || typeof text !== 'string') return text;
  return text.replace(/\b20(2[0-5])\b/g, (match) => {
    const year = Number(match);
    if (year >= currentYear) return match;
    if (currentYear - year > 2) return match;
    return String(currentYear);
  });
}

function normalizeObviousDidYouKnow(data = {}, context = {}) {
  const fact = typeof data.fact === 'string' ? data.fact.trim() : '';
  const heroTitle = context.heroTitle || '';
  const heroSubtitle = context.heroSubtitle || '';
  const comparisonBase = `${heroTitle} ${heroSubtitle}`.toLowerCase();
  const candidate = fact.toLowerCase();

  if (!fact || !comparisonBase) {
    return { changed: false, data: sanitizeUrlsDeep(data) };
  }

  const titleWords = new Set(comparisonBase.split(/\W+/).filter((item) => item.length > 3));
  const factWords = candidate.split(/\W+/).filter((item) => item.length > 3);
  const overlap = factWords.filter((item) => titleWords.has(item)).length;
  const overlapRatio = factWords.length > 0 ? overlap / factWords.length : 0;

  if (overlapRatio < 0.6) {
    return { changed: false, data: sanitizeUrlsDeep(data) };
  }

  return {
    changed: true,
    data: sanitizeUrlsDeep({
      ...data,
      fact: 'External source verification is still adding deeper context beyond the visible headline.',
      category: data.category || 'context',
    }),
  };
}

function applyGenericSanitizers(card, context = {}) {
  const baseData = sanitizeUrlsDeep(card.populatedData || card.data || {});
  const data = clone(baseData);
  const currentYear = context.currentYear || new Date().getUTCFullYear();

  if (typeof data.date === 'string') data.date = normalizeYearStrings(data.date, currentYear);
  if (typeof data.summary === 'string') data.summary = normalizeYearStrings(data.summary, currentYear);
  if (typeof data.subtitle === 'string') data.subtitle = normalizeYearStrings(data.subtitle, currentYear);
  if (typeof data.context === 'string') data.context = normalizeYearStrings(data.context, currentYear);
  if (Array.isArray(data.events)) {
    data.events = data.events.map((event) => {
      if (!event || typeof event !== 'object') return event;
      return {
        ...event,
        date: typeof event.date === 'string' ? normalizeYearStrings(event.date, currentYear) : event.date,
      };
    });
  }

  if (card.cardType === 'fact_check') {
    const factCheck = reconcileFactCheckData(data);
    return {
      changed: factCheck.changed || JSON.stringify(data) !== JSON.stringify(baseData),
      card: {
        ...card,
        populatedData: factCheck.data,
        data: factCheck.data,
      },
      reason: factCheck.changed ? 'Reconciled fact_check coherence' : 'Sanitized fact_check data',
    };
  }

  if (card.cardType === 'verification_card') {
    const verification = reconcileVerificationData(data);
    return {
      changed: verification.changed || JSON.stringify(verification.data) !== JSON.stringify(baseData),
      card: {
        ...card,
        populatedData: verification.data,
        data: verification.data,
      },
      reason: verification.changed ? 'Reconciled verification status' : 'Sanitized verification data',
    };
  }

  if (card.cardType === 'did_you_know_card') {
    const didYouKnow = normalizeObviousDidYouKnow(data, context);
    return {
      changed: didYouKnow.changed || JSON.stringify(didYouKnow.data) !== JSON.stringify(baseData),
      card: {
        ...card,
        populatedData: didYouKnow.data,
        data: didYouKnow.data,
      },
      reason: didYouKnow.changed ? 'Adjusted repetitive did_you_know fact' : 'Sanitized did_you_know data',
    };
  }

  return {
    changed: JSON.stringify(data) !== JSON.stringify(baseData),
    card: {
      ...card,
      populatedData: data,
      data,
    },
    reason: 'Sanitized card URLs/dates',
  };
}

function runPipelineQualityGate(cards, context = {}) {
  const heroCard = cards.find((card) => card.cardType === 'hero_summary');
  const heroData = heroCard ? (heroCard.populatedData || heroCard.data || {}) : {};

  const nextContext = {
    ...context,
    heroTitle: heroData.title || context.heroTitle || '',
    heroSubtitle: heroData.subtitle || context.heroSubtitle || '',
    currentYear: context.currentYear || new Date().getUTCFullYear(),
  };

  const nextCards = [];
  const changes = [];

  for (const card of cards) {
    let result;

    if (card.cardType === 'person_card') {
      result = reconcilePersonCard(card, nextContext);
    } else {
      result = applyGenericSanitizers(card, nextContext);
    }

    nextCards.push(result.card);
    if (result.changed) {
      changes.push({
        cardId: card.id,
        cardTypeBefore: card.cardType,
        cardTypeAfter: result.card.cardType,
        reason: result.reason,
      });
    }
  }

  return {
    cards: nextCards,
    changes,
  };
}

module.exports = {
  sanitizeUrl,
  sanitizeUrlsDeep,
  normalizeSourceStatus,
  computeVerificationStatus,
  isLikelyOrganizationName,
  isLikelyGenericRole,
  reconcileFactCheckData,
  reconcileVerificationData,
  runPipelineQualityGate,
};
