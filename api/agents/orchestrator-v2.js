/**
 * Orchestrator v2 — Progressive Enhancement Pipeline
 *
 * Three-phase architecture optimized for speed-to-first-card:
 *
 * Phase 1 — Haiku Classification (~1-2s):
 *   Haiku glances at screenshot, returns title + layout choice.
 *   User sees hero card with title + layout skeleton within 2-3 seconds.
 *
 * Phase 2 — Parallel Enhancement + Research:
 *   2a. Sonnet Enhancement: Sees screenshot + Haiku's classification,
 *       populates each card one-by-one via tool_use (each fires SSE event).
 *   2b. Sonar Deep Research: Web-grounded research running in parallel.
 *
 * Phase 3 — Sonnet Review (after Sonar responds):
 *   Sonnet reviews all displayed info + Sonar research findings,
 *   makes final corrections and additions.
 */

const { fastClassify } = require('./fast-classifier');
const { enhance } = require('./sonnet-enhancer');
const { deepResearch } = require('./deep-researcher');
const { logger } = require('../lib/logger');
const { TraceCollector } = require('../lib/llm-trace');

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
 * Compute verification_card overall status from individual source statuses.
 * Ensures the displayed badge always matches the source checkmarks the user sees.
 */
function normalizeSourceStatus(status) {
  if (status === 'verified' || status === 'confirmed') return 'confirmed';
  if (status === 'denied' || status === 'false' || status === 'disproven') return 'denied';
  if (status === 'checking' || status === 'searching' || status === 'pending') return 'checking';
  return status;
}

function computeVerificationStatus(sources) {
  if (!sources || sources.length === 0) return 'unconfirmed';
  const statuses = sources.map(s => normalizeSourceStatus(s.status));
  const hasConfirmed = statuses.some(s => s === 'confirmed');
  const hasDenied = statuses.some(s => s === 'denied');
  const allConfirmed = statuses.every(s => s === 'confirmed');
  const allDenied = statuses.every(s => s === 'denied');

  if (allConfirmed) return 'verified';
  if (allDenied) return 'denied';
  if (hasConfirmed && hasDenied) return 'conflicting';
  if (hasConfirmed) return 'partially_verified';
  return 'unconfirmed';
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

    const matchedFinding = researchFindings.find(f => {
      const fText = `${f.topic || ''} ${f.summary || ''}`.toLowerCase();
      return fText.split(/\s+/).some(w => w.length > 3 && cardText.includes(w));
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
        updates.explanation = matchedFinding.factCheck.explanation.slice(0, 150);
        changed = true;
      }
    }

    if (matchedFinding.summary && !cardData.relatedContext && card.cardType === 'news_card') {
      updates.relatedContext = matchedFinding.summary.slice(0, 150);
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
 *   onCardUpdate(cardUpdate)     — Sonnet updated an existing card
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
    // Sonnet populates cards, Sonar researches in parallel
    // =====================================================
    if (onPhase) {
      onPhase({ phase: 'enhancing', message: 'Populating cards + deep research...' });
    }

    logger.info('Orchestrator', 'Phase 2: Parallel Enhancement (Haiku) + Research');

    const enhanceProgressMessages = [
      'Analyzing screenshot...',
      'Populating card content...',
      'Adding details and context...',
      'Searching for images...',
      'Verifying information...',
    ];
    let enhanceMsgIdx = 0;
    enhanceHeartbeat = setInterval(() => {
      enhanceMsgIdx = Math.min(enhanceMsgIdx + 1, enhanceProgressMessages.length - 1);
      if (onProgress) {
        onProgress({
          phase: 'enhancing',
          progress: 25 + enhanceMsgIdx * 10,
          message: enhanceProgressMessages[enhanceMsgIdx],
        });
      }
    }, 3000);

    const sonnetEnhancePromise = enhance({
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

        const existing = currentCards.get(action.cardId);
        if (existing) {
          const mergedData = {
            ...(existing.populatedData || existing.data || existing.placeholderData || {}),
            ...action.data,
          };
          existing.populatedData = mergedData;
          existing.data = mergedData;
          currentCards.set(action.cardId, existing);
        }

        if (onCardUpdate) {
          onCardUpdate({
            cardId: action.cardId,
            cardType: action.cardType,
            data: action.data,
            reason: action.reason,
            source: 'sonnet',
          });
        }
      },
      onCardAdd: (action) => {
        logger.info('Orchestrator', 'Enhancer added card', {
          cardId: action.cardId,
          cardType: action.cardType,
          reason: action.reason,
        });

        const newCard = {
          id: action.cardId,
          cardType: action.cardType,
          gridPosition: action.gridPosition,
          populatedData: action.data,
          data: action.data,
          status: 'populated',
        };
        currentCards.set(action.cardId, newCard);

        if (onCardAdd) {
          onCardAdd({
            cardId: action.cardId,
            cardType: action.cardType,
            data: action.data,
            gridPosition: action.gridPosition,
            reason: action.reason,
            source: 'sonnet',
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
    }).catch(err => {
      logger.warn('Orchestrator', 'Enhancement failed (non-fatal)', { err: err.message });
      return { actions: [], duration: Date.now() - startTime };
    });

    const deepResearchPromise = deepResearch({
      contentAnalysis: blueprint.contentAnalysis,
      cards: blueprint.cards,
      imageData,
      mediaType,
      adapterConfig: { ...adapterConfig, traceCollector },
    }).catch(err => {
      logger.warn('Orchestrator', 'Deep research failed (non-fatal)', { err: err.message });
      return { findings: [], duration: Date.now() - startTime };
    });

    const [enhanceResult, researchResult] = await Promise.all([
      sonnetEnhancePromise,
      deepResearchPromise,
    ]);

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

        // Normalize source field names — LLM may use "source" instead of "name"
        for (const source of sources) {
          if (!source.name && source.source) source.name = source.source;
        }

        // Haiku's verification statuses are unreliable assumptions —
        // always re-evaluate ALL sources against research findings
        for (const source of sources) {
          const sourceName = (source.name || '').toLowerCase();
          const finding = sourceName && researchResult.findings.find(f => {
            const text = `${f.topic || ''} ${f.summary || ''} ${f.details || ''}`.toLowerCase();
            return text.includes(sourceName);
          });

          if (finding) {
            const fc = finding.factCheck;
            if (fc && (fc.verdict === 'verified' || fc.verdict === 'partially_true')) {
              source.status = 'confirmed';
            } else if (fc && (fc.verdict === 'false' || fc.verdict === 'misleading')) {
              source.status = 'denied';
            } else {
              source.status = 'not_yet_reported';
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

        if (updated) {
          const overallStatus = computeVerificationStatus(sources);
          const updatedData = { ...cardData, sources, status: overallStatus, lastChecked: new Date().toISOString() };
          
          // Add research summary
          const researchSummary = researchResult.findings
            .filter(f => f.factCheck)
            .map(f => f.factCheck.explanation || f.summary)
            .filter(Boolean)
            .join('. ');
          if (researchSummary) {
            updatedData.summary = researchSummary.slice(0, 200);
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
      let anyStillChecking = false;
      for (const source of sources) {
        if (!source.name && source.source) source.name = source.source;
        const norm = normalizeSourceStatus(source.status);
        if (norm === 'checking' || norm === 'not_yet_reported') {
          source.status = 'not_yet_reported';
          if (!source.snippet) source.snippet = 'Unable to verify — check source directly';
          anyStillChecking = true;
        }
      }
      if (anyStillChecking) {
        const updatedData = { ...cardData, sources, status: cardData.status === 'searching' ? 'unconfirmed' : cardData.status };
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

          const existing = currentCards.get(action.cardId);
          if (existing) {
            const mergedData = {
              ...(existing.populatedData || existing.data || existing.placeholderData || {}),
              ...action.data,
            };
            existing.populatedData = mergedData;
            existing.data = mergedData;
            currentCards.set(action.cardId, existing);
          }

          if (onCardUpdate) {
            onCardUpdate({
              cardId: action.cardId,
              cardType: action.cardType,
              data: action.data,
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

          const newCard = {
            id: action.cardId,
            cardType: action.cardType,
            gridPosition: action.gridPosition,
            populatedData: action.data,
            data: action.data,
            status: 'populated',
          };
          currentCards.set(action.cardId, newCard);

          if (onCardAdd) {
            onCardAdd({
              cardId: action.cardId,
              cardType: action.cardType,
              data: action.data,
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
      logger.info('Orchestrator', 'Phase 3: Programmatic research enrichment (skipped LLM)', {
        findings: researchResult.findings.length,
        cardsEnriched: enrichCount,
      });
    } else {
      logger.info('Orchestrator', 'Skipping Phase 3 (no research findings, all cards populated)');
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

      // Normalize source field names and statuses for consistent storage
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
    // Final: Assemble result
    // =====================================================
    const totalDuration = Date.now() - startTime;
    logger.info('Orchestrator', 'Pipeline complete', { dur: totalDuration });

    const finalCards = Array.from(currentCards.values()).map(card => ({
      ...card,
      status: 'populated',
      data: card.populatedData || card.data || card.placeholderData,
    }));

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

module.exports = { runPipeline };
