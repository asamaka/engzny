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
      onPhase({ phase: 'enhancing', message: 'Sonnet populating cards + deep research...' });
    }

    logger.info('Orchestrator', 'Phase 2: Parallel Enhancement + Research');

    const enhanceProgressMessages = [
      'Sonnet analyzing screenshot...',
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
        logger.info('Orchestrator', 'Sonnet updated card', {
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
        logger.info('Orchestrator', 'Sonnet added card', {
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
        logger.info('Orchestrator', 'Sonnet changed layout', {
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
        model: adapterConfig.enhanceModel || 'claude-sonnet-4-20250514',
        traceCollector,
      },
    }).catch(err => {
      logger.warn('Orchestrator', 'Sonnet enhancement failed (non-fatal)', { err: err.message });
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

        // Try to match research findings to verification sources
        for (const source of sources) {
          if (source.status === 'checking') {
            // Find a research finding that mentions this source
            const finding = researchResult.findings.find(f => {
              const text = `${f.topic || ''} ${f.summary || ''} ${f.details || ''}`.toLowerCase();
              return text.includes(source.name.toLowerCase());
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
              // No finding for this source — mark as not yet reported
              source.status = 'not_yet_reported';
              updated = true;
            }
          }
        }

        if (updated) {
          // Determine overall status
          const statuses = sources.map(s => s.status);
          let overallStatus = 'unconfirmed';
          if (statuses.every(s => s === 'confirmed')) overallStatus = 'verified';
          else if (statuses.some(s => s === 'confirmed') && statuses.some(s => s !== 'confirmed')) overallStatus = 'partially_verified';
          else if (statuses.every(s => s === 'denied')) overallStatus = 'denied';
          else if (statuses.some(s => s === 'confirmed') && statuses.some(s => s === 'denied')) overallStatus = 'conflicting';

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
        if (source.status === 'checking') {
          source.status = 'not_yet_reported';
          source.snippet = 'Unable to verify — check source directly';
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
    // Phase 3: Sonnet Review (with research data)
    // Only runs if we got meaningful research findings
    // =====================================================
    const hasResearchFindings = researchResult.findings && researchResult.findings.length > 0;

    if (hasResearchFindings) {
      if (onPhase) {
        onPhase({ phase: 'reviewing', message: 'Reviewing with research findings...' });
      }

      if (onProgress) {
        onProgress({
          phase: 'reviewing',
          progress: 70,
          message: 'Incorporating research findings...',
        });
      }

      logger.info('Orchestrator', 'Phase 3: Sonnet Review with research', {
        findings: researchResult.findings.length,
      });

      const reviewResult = await enhance({
        imageData,
        mediaType,
        currentCards: Array.from(currentCards.values()),
        contentAnalysis: blueprint.contentAnalysis,
        layout: blueprint.layout,
        researchData: researchResult,
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
          model: adapterConfig.reviewModel || 'claude-sonnet-4-20250514',
          traceCollector,
        },
      }).catch(err => {
        logger.warn('Orchestrator', 'Sonnet review failed (non-fatal)', { err: err.message });
        return { actions: [], duration: 0 };
      });

      logger.info('Orchestrator', 'Phase 3 complete', {
        reviewActions: reviewResult.actions?.length || 0,
      });
    } else {
      logger.info('Orchestrator', 'Skipping Phase 3 (no research findings)');
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
