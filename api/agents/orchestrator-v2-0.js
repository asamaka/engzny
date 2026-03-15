const { fastClassify, adaptBlueprintForPreAnalysis } = require('./fast-classifier');
const { enhance } = require('./sonnet-enhancer');
const { deepResearch } = require('./deep-researcher');
const { preAnalyze } = require('./pre-analyzer');
const { verifyTranslation } = require('./translation-verifier');
const { logger } = require('../lib/logger');
const { TraceCollector } = require('../lib/llm-trace');
const { runPipelineQualityGate } = require('../lib/pipeline-quality-gate');

const RESEARCH_WORTHY_TYPES = new Set([
  'breaking_news', 'news', 'emergency', 'sports', 'science',
  'health', 'finance', 'tech', 'social_media',
  'report_significant_event', 'significant_event',
]);

function createSkeletonBlueprint() {
  return {
    contentAnalysis: {
      contentType: 'analyzing',
      platform: null,
      intent: 'Analyzing screenshot...',
      topQuestions: [],
      followUpQuestions: [],
    },
    layout: { type: 'simple', columns: 1, reason: 'Skeleton layout while analyzing' },
    cards: [
      {
        id: 'skeleton-hero',
        cardType: 'hero_summary',
        gridPosition: { row: 1, column: 1, columnSpan: 1, rowSpan: 1 },
        researchBrief: '',
        placeholderData: { title: 'Analyzing screenshot...', subtitle: 'Building Pipeline 2.0 view' },
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

function stripFabricatedImageUrls(data) {
  if (!data || typeof data !== 'object') return data;
  const cleaned = { ...data };
  delete cleaned.imageUrl;
  delete cleaned.photoUrl;
  return cleaned;
}

function normalizeSourceArray(sources) {
  return (Array.isArray(sources) ? sources : []).map((source) => {
    if (typeof source === 'string') {
      return { name: source, status: 'not_yet_reported' };
    }
    if (!source || typeof source !== 'object') return null;
    return {
      ...source,
      name: source.name || source.source || null,
      status: source.status || 'not_yet_reported',
    };
  }).filter((source) => source && source.name);
}

function normalizeSourceStatus(status) {
  if (status === 'verified' || status === 'confirmed') return 'confirmed';
  if (status === 'denied' || status === 'false' || status === 'disproven') return 'denied';
  if (status === 'checking' || status === 'searching' || status === 'pending') return 'checking';
  if (status === 'inconclusive' || status === 'unverified' || status === 'needs_context' || status === 'mixed') return 'inconclusive';
  return status || 'not_yet_reported';
}

function computeVerificationStatus(sources) {
  const statuses = sources.map((source) => normalizeSourceStatus(source.status));
  if (statuses.length === 0) return 'unconfirmed';
  if (statuses.some((status) => status === 'checking')) return 'searching';
  const hasConfirmed = statuses.some((status) => status === 'confirmed');
  const hasDenied = statuses.some((status) => status === 'denied');
  if (hasConfirmed && hasDenied) return 'conflicting';
  if (hasConfirmed) return statuses.every((status) => status === 'confirmed') ? 'verified' : 'partially_verified';
  if (hasDenied) return 'denied';
  return 'unconfirmed';
}

function verdictToSourceStatus(verdict) {
  if (verdict === 'verified' || verdict === 'partially_true') return 'confirmed';
  if (verdict === 'false' || verdict === 'misleading') return 'denied';
  return 'inconclusive';
}

function findingText(finding) {
  return `${finding.topic || ''} ${finding.summary || ''} ${finding.details || ''}`.toLowerCase();
}

function findMatchingFinding(sourceName, findings) {
  const normalized = String(sourceName || '').toLowerCase().trim();
  if (!normalized) return null;

  return findings.find((finding) => {
    const haystack = findingText(finding);
    if (haystack.includes(normalized)) return true;
    const words = normalized.split(/\s+/).filter((word) => word.length >= 4);
    if (words.length === 0) return false;
    const overlap = words.filter((word) => haystack.includes(word)).length;
    return overlap >= Math.max(1, Math.ceil(words.length / 2));
  }) || null;
}

function applyCardData(currentCards, action, handler) {
  const safeData = stripFabricatedImageUrls(action.data);
  const existing = currentCards.get(action.cardId);
  if (!existing) return;

  const mergedData = {
    ...(existing.populatedData || existing.data || existing.placeholderData || {}),
    ...safeData,
  };
  const nextCard = {
    ...existing,
    cardType: action.cardType || existing.cardType,
    populatedData: mergedData,
    data: mergedData,
    status: 'populated',
  };
  currentCards.set(action.cardId, nextCard);

  if (handler) {
    handler({
      ...action,
      cardType: nextCard.cardType,
      data: mergedData,
    });
  }
}

function emitQualityGateUpdates(currentCards, gateResult, onCardUpdate) {
  for (const nextCard of gateResult.cards) {
    const previous = currentCards.get(nextCard.id);
    if (!previous) {
      currentCards.set(nextCard.id, nextCard);
      continue;
    }

    const prevJson = JSON.stringify({
      cardType: previous.cardType,
      data: previous.populatedData || previous.data || {},
    });
    const nextJson = JSON.stringify({
      cardType: nextCard.cardType,
      data: nextCard.populatedData || nextCard.data || {},
    });
    currentCards.set(nextCard.id, nextCard);

    if (prevJson !== nextJson && onCardUpdate) {
      onCardUpdate({
        cardId: nextCard.id,
        cardType: nextCard.cardType,
        data: nextCard.populatedData || nextCard.data || {},
        reason: 'Pipeline 2.0 quality gate adjustment',
        source: 'quality_gate',
      });
    }
  }
}

function applyTranslationCorrection(currentCards, translationVerification, preAnalysis, onCardUpdate) {
  if (!translationVerification || translationVerification.skipped || !translationVerification.normalizedTranslation) {
    return 0;
  }

  let changes = 0;
  const heroCard = Array.from(currentCards.values()).find((card) => card.cardType === 'hero_summary');
  if (heroCard) {
    const heroData = heroCard.populatedData || heroCard.data || {};
    const shouldOverride = translationVerification.shouldOverrideClaim || (
      preAnalysis?.visibleClaim &&
      heroData.subtitle &&
      heroData.subtitle.includes(preAnalysis.visibleClaim)
    );

    if (shouldOverride || !heroData.subtitle) {
      const nextData = {
        ...heroData,
        subtitle: translationVerification.normalizedTranslation,
      };
      heroCard.populatedData = nextData;
      heroCard.data = nextData;
      currentCards.set(heroCard.id, heroCard);
      changes++;

      if (onCardUpdate) {
        onCardUpdate({
          cardId: heroCard.id,
          cardType: heroCard.cardType,
          data: nextData,
          reason: 'Translation verification refined the main claim',
          source: 'translation_verify',
        });
      }
    }
  }

  const verificationCard = Array.from(currentCards.values()).find((card) => card.cardType === 'verification_card');
  if (verificationCard) {
    const verificationData = verificationCard.populatedData || verificationCard.data || {};
    if (translationVerification.shouldOverrideClaim || !verificationData.claim) {
      const nextData = {
        ...verificationData,
        claim: translationVerification.normalizedTranslation,
      };
      verificationCard.populatedData = nextData;
      verificationCard.data = nextData;
      currentCards.set(verificationCard.id, verificationCard);
      changes++;

      if (onCardUpdate) {
        onCardUpdate({
          cardId: verificationCard.id,
          cardType: verificationCard.cardType,
          data: nextData,
          reason: 'Translation verification refined the claim text',
          source: 'translation_verify',
        });
      }
    }
  }

  return changes;
}

function applyResearchFindings(currentCards, researchResult, onCardUpdate) {
  const findings = Array.isArray(researchResult?.findings) ? researchResult.findings : [];
  let changes = 0;

  const verificationCards = Array.from(currentCards.values()).filter((card) => card.cardType === 'verification_card');
  for (const card of verificationCards) {
    const data = card.populatedData || card.data || {};
    const sources = normalizeSourceArray(data.sources);
    let updated = false;

    for (const source of sources) {
      const finding = findMatchingFinding(source.name, findings);
      if (finding) {
        source.status = verdictToSourceStatus(finding.factCheck?.verdict);
        source.snippet = finding.summary || source.snippet || '';
        if (finding.sourceUrls?.length) source.url = finding.sourceUrls[0];
        updated = true;
      } else if (normalizeSourceStatus(source.status) === 'checking') {
        source.status = 'not_yet_reported';
        updated = true;
      }
    }

    if (updated) {
      const nextData = {
        ...data,
        sources,
        status: computeVerificationStatus(sources),
        summary: findings
          .filter((finding) => finding.factCheck)
          .map((finding) => finding.factCheck.explanation || finding.summary || '')
          .filter(Boolean)
          .slice(0, 3)
          .join(' '),
        lastChecked: new Date().toISOString(),
      };
      card.populatedData = nextData;
      card.data = nextData;
      currentCards.set(card.id, card);
      changes++;

      if (onCardUpdate) {
        onCardUpdate({
          cardId: card.id,
          cardType: card.cardType,
          data: nextData,
          reason: 'Deep research updated verification sources',
          source: 'research',
        });
      }
    }
  }

  const heroCard = Array.from(currentCards.values()).find((card) => card.cardType === 'hero_summary');
  if (heroCard) {
    const heroData = heroCard.populatedData || heroCard.data || {};
    const verificationCard = verificationCards[0];
    const verificationStatus = verificationCard ? (verificationCard.populatedData || verificationCard.data || {}).status : null;

    let investigationStatus = heroData.investigationStatus || 'investigating';
    if (verificationStatus === 'verified' || verificationStatus === 'partially_verified') investigationStatus = 'confirmed';
    else if (verificationStatus === 'denied') investigationStatus = 'unconfirmed';
    else if (verificationStatus === 'conflicting') investigationStatus = 'mixed';
    else if (findings.length > 0) investigationStatus = 'unconfirmed';

    if (investigationStatus !== heroData.investigationStatus) {
      const nextData = { ...heroData, investigationStatus };
      heroCard.populatedData = nextData;
      heroCard.data = nextData;
      currentCards.set(heroCard.id, heroCard);
      changes++;

      if (onCardUpdate) {
        onCardUpdate({
          cardId: heroCard.id,
          cardType: heroCard.cardType,
          data: { investigationStatus },
          reason: 'Deep research resolved investigation status',
          source: 'research',
        });
      }
    }
  }

  return changes;
}

async function runPipelineV20({
  imageData,
  mediaType,
  question,
  onBlueprint,
  onLayoutUpdate,
  onCardPopulated,
  onCardUpdate,
  onCardAdd,
  onPhase,
  onComplete,
  onSettled,
  onError,
  onProgress,
  adapterConfig = {},
}) {
  const startTime = Date.now();
  const traceCollector = new TraceCollector(adapterConfig.requestId || 'unknown');
  const currentCards = new Map();
  const durations = {};

  try {
    const skeleton = createSkeletonBlueprint();
    if (onBlueprint) onBlueprint(skeleton);
    if (onProgress) onProgress({ phase: 'pre_analysis', progress: 5, message: 'Scanning screenshot structure...' });

    if (onPhase) onPhase({ phase: 'pre_analysis', message: 'Pre-analysis and language detection...' });

    const preAnalysisStartedAt = Date.now();
    const preAnalysis = await preAnalyze({
      imageData,
      mediaType,
      question,
      adapterConfig: { ...adapterConfig, traceCollector },
    });
    durations.preAnalysisDuration = Date.now() - preAnalysisStartedAt;

    if (onProgress) {
      onProgress({
        phase: 'classifying',
        progress: 15,
        message: preAnalysis.requiresTranslationVerification
          ? 'Verifying translated claim and classifying layout...'
          : 'Classifying layout...',
      });
    }

    if (onPhase) onPhase({ phase: 'classifying', message: 'Verified classification...' });

    const classifyStartedAt = Date.now();
    const rawBlueprint = await fastClassify({
      imageData,
      mediaType,
      question,
      adapterConfig: { ...adapterConfig, traceCollector },
    });
    durations.classifyDuration = Date.now() - classifyStartedAt;

    const adaptedBlueprint = adaptBlueprintForPreAnalysis(rawBlueprint || createSkeletonBlueprint(), preAnalysis);
    const blueprint = {
      ...adaptedBlueprint,
      contentAnalysis: {
        ...(adaptedBlueprint.contentAnalysis || {}),
        preAnalysis,
      },
    };

    if (onLayoutUpdate) onLayoutUpdate(blueprint);

    for (const card of blueprint.cards || []) {
      const safeCard = { ...card };
      if (safeCard.populatedData) safeCard.populatedData = stripFabricatedImageUrls(safeCard.populatedData);
      if (safeCard.data) safeCard.data = stripFabricatedImageUrls(safeCard.data);
      currentCards.set(safeCard.id, safeCard);
      if (safeCard.status === 'populated' && onCardPopulated && safeCard.populatedData) {
        onCardPopulated({
          cardId: safeCard.id,
          cardType: safeCard.cardType,
          data: safeCard.populatedData,
          completedCount: 1,
          totalCount: blueprint.cards.length,
        });
      }
    }

    if (onPhase) onPhase({ phase: 'enhancing', message: 'Populating cards...' });

    const translationPromise = verifyTranslation({
      imageData,
      mediaType,
      preAnalysis,
      adapterConfig: { ...adapterConfig, traceCollector },
    });

    const enhanceStartedAt = Date.now();
    const enhancePromise = enhance({
      imageData,
      mediaType,
      currentCards: blueprint.cards,
      contentAnalysis: blueprint.contentAnalysis,
      layout: blueprint.layout,
      preAnalysis,
      onCardUpdate: (action) => {
        applyCardData(currentCards, action, onCardUpdate);
      },
      onCardAdd: (action) => {
        const safeData = stripFabricatedImageUrls(action.data);
        const nextCard = {
          id: action.cardId,
          cardType: action.cardType,
          gridPosition: action.gridPosition,
          populatedData: safeData,
          data: safeData,
          status: 'populated',
        };
        currentCards.set(action.cardId, nextCard);
        if (onCardAdd) onCardAdd({ ...action, data: safeData });
      },
      onLayoutUpdate: (action) => {
        if (onCardUpdate) {
          logger.info('PipelineV20', 'Enhancer suggested layout update', { requestId: adapterConfig.requestId, layoutType: action.layoutType });
        }
      },
      adapterConfig: {
        ...adapterConfig,
        model: adapterConfig.enhanceModel || 'claude-haiku-4-5-20251001',
        traceCollector,
        maxIterations: 2,
      },
    });

    const contentType = blueprint.contentAnalysis?.contentType || 'general';
    const skipResearch = !RESEARCH_WORTHY_TYPES.has(contentType);
    const researchPromise = (async () => {
      const translationVerification = await translationPromise;
      if (skipResearch) {
        return { findings: [], duration: 0, skipped: true };
      }
      return deepResearch({
        contentAnalysis: blueprint.contentAnalysis,
        cards: Array.from(currentCards.values()),
        imageData,
        mediaType,
        preAnalysis,
        translationVerification,
        adapterConfig: { ...adapterConfig, traceCollector },
      }).catch((error) => {
        logger.warn('PipelineV20', 'Deep research failed (non-fatal)', { err: error.message });
        return { findings: [], duration: 0, error: error.message };
      });
    })();

    const enhanceResult = await enhancePromise;
    durations.enhanceDuration = Date.now() - enhanceStartedAt;

    const initialGate = runPipelineQualityGate(Array.from(currentCards.values()), {
      contentAnalysis: blueprint.contentAnalysis,
      preAnalysis,
    });
    emitQualityGateUpdates(currentCards, initialGate, onCardUpdate);

    const pendingResearch = !skipResearch || preAnalysis.requiresTranslationVerification;
    const uiReadyDuration = Date.now() - startTime;

    if (onComplete) {
      onComplete({
        layout: blueprint.layout,
        contentAnalysis: blueprint.contentAnalysis,
        meta: {
          pipeline: 'llm2',
          pendingResearch,
          uiReadyDuration,
          preAnalysisDuration: durations.preAnalysisDuration,
          classifyDuration: durations.classifyDuration,
          enhanceDuration: durations.enhanceDuration,
          enhanceActions: enhanceResult.actions?.length || 0,
        },
      });
    }

    if (pendingResearch && onProgress) {
      onProgress({
        phase: 'researching',
        progress: 92,
        message: 'UI is ready — checking sources and refining details...',
      });
    }

    const [translationVerification, researchResult] = await Promise.all([
      translationPromise,
      researchPromise,
    ]);

    durations.translationVerificationDuration = translationVerification.skipped ? 0 : (translationVerification.duration || 0);
    durations.researchDuration = researchResult?.duration || 0;

    applyTranslationCorrection(currentCards, translationVerification, preAnalysis, onCardUpdate);
    applyResearchFindings(currentCards, researchResult, onCardUpdate);

    const finalGate = runPipelineQualityGate(Array.from(currentCards.values()), {
      contentAnalysis: blueprint.contentAnalysis,
      preAnalysis,
    });
    emitQualityGateUpdates(currentCards, finalGate, onCardUpdate);

    const finalCards = Array.from(currentCards.values()).map((card) => ({
      ...card,
      status: 'populated',
      data: card.populatedData || card.data || card.placeholderData || {},
    }));

    const totalDuration = Date.now() - startTime;
    const settledLayout = {
      ...blueprint,
      cards: finalCards,
      _meta: {
        pipeline: 'llm2',
        totalDuration,
        uiReadyDuration,
        pendingResearch: false,
        preAnalysisDuration: durations.preAnalysisDuration,
        classifyDuration: durations.classifyDuration,
        enhanceDuration: durations.enhanceDuration,
        translationVerificationDuration: durations.translationVerificationDuration,
        researchDuration: durations.researchDuration,
        researchFindings: researchResult?.findings?.length || 0,
      },
      _llmTraces: traceCollector.getTraces(),
      _llmTraceSummary: traceCollector.getSummary(),
    };

    logger.info('PipelineV20', 'Pipeline settled', {
      requestId: adapterConfig.requestId,
      totalDuration,
      cardCount: finalCards.length,
      findings: researchResult?.findings?.length || 0,
    });

    if (onProgress) {
      onProgress({ phase: 'complete', progress: 100, message: 'Pipeline 2.0 settled' });
    }

    if (onSettled) onSettled(settledLayout);
    return settledLayout;
  } catch (error) {
    logger.error('PipelineV20', 'Pipeline failed', {
      requestId: adapterConfig.requestId,
      err: error.message,
    });
    if (onError) onError(error);
    else throw error;
    return null;
  }
}

module.exports = { runPipelineV20 };
