/**
 * Orchestrator v2
 *
 * Pipeline with instant feedback + fast classification:
 *
 * 1. Immediate: Send generic skeleton (user sees cards in <1ms)
 * 2. Fast Classifier (Haiku, 2-4s): Contextual skeleton with correct layout + card types
 * 3. Layout Designer LLM (Sonnet, 10-20s): Full blueprint with research briefs
 * 4. Parallel Card Researchers → each card populates as it completes
 * 5. All complete → final event
 */

const { designLayout } = require('./layout-designer');
const { fastClassify } = require('./fast-classifier');
const { researchCardsInParallel } = require('./card-researcher');
const { logger } = require('../lib/logger');
const { TraceCollector } = require('../lib/llm-trace');

/**
 * Create a generic skeleton blueprint for instant display.
 * Shows hero + 2 shimmer cards while the fast classifier runs.
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
 * Run the full v2 pipeline with SSE callbacks
 */
async function runPipeline({
  imageData,
  mediaType,
  question,
  onBlueprint,
  onLayoutUpdate,
  onLayoutPreview,
  onCardPopulated,
  onComplete,
  onError,
  onProgress,
  adapterConfig = {},
}) {
  const startTime = Date.now();
  const traceCollector = new TraceCollector(
    adapterConfig.requestId || 'unknown'
  );

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
        message: 'Detecting content type...',
      });
    }

    // =====================================================
    // Phase 0.5: Fast Classification (Haiku, 2-4s)
    // Runs in parallel with the start of Phase 1
    // =====================================================
    const fastClassifyPromise = fastClassify({
      imageData,
      mediaType,
      question,
      adapterConfig: { ...adapterConfig, traceCollector },
    }).catch((err) => {
      logger.warn('Orchestrator', 'Fast classify failed', { err: err.message });
      return null;
    });

    // =====================================================
    // Phase 1: Layout Design (Sonnet vision, 10-20s)
    // Start immediately - don't wait for fast classifier
    // =====================================================
    const designAdapterConfig = {
      ...adapterConfig,
      model: adapterConfig.designModel || 'claude-sonnet-4-20250514',
    };

    logger.info('Orchestrator', 'Phase 1: Layout Design + Fast Classify (parallel)', {
      designModel: designAdapterConfig.model,
      classifyModel: 'claude-haiku-4-5-20251001',
    });

    const designMessages = [
      'Detecting content type...',
      'Reading text and visual elements...',
      'Identifying key information...',
      'Analyzing visual layout...',
      'Mapping content structure...',
      'Selecting best card types...',
      'Designing card layout...',
      'Preparing research briefs...',
    ];
    let designProgress = 5;
    let designMsgIdx = 0;
    const designHeartbeat = setInterval(() => {
      designProgress = Math.min(designProgress + 2.5, 28);
      designMsgIdx = Math.min(designMsgIdx + 1, designMessages.length - 1);
      if (onProgress) {
        onProgress({
          phase: 'designing',
          progress: designProgress,
          message: designMessages[designMsgIdx],
        });
      }
    }, 2500);

    // Wait for fast classifier first (should be much faster than layout designer)
    const quickBlueprint = await fastClassifyPromise;
    const classifyDuration = Date.now() - startTime;

    if (quickBlueprint && onLayoutPreview) {
      logger.info('Orchestrator', 'Fast classification ready', {
        dur: classifyDuration,
        contentType: quickBlueprint.contentAnalysis?.contentType,
        layoutType: quickBlueprint.layout?.type,
        cardCount: quickBlueprint.cards?.length,
      });
      onLayoutPreview(quickBlueprint);

      if (onProgress) {
        onProgress({
          phase: 'designing',
          progress: 15,
          message: `${quickBlueprint.contentAnalysis?.contentType || 'Content'} detected — designing detailed layout...`,
        });
      }
    }

    // Now wait for the full layout designer
    let blueprint;
    const designPromise = designLayout({
      imageData,
      mediaType,
      question,
      adapterConfig: { ...designAdapterConfig, traceCollector },
    });

    try {
      blueprint = await designPromise;
    } finally {
      clearInterval(designHeartbeat);
    }

    const designDuration = Date.now() - startTime;
    logger.info('Orchestrator', 'Blueprint ready', {
      dur: designDuration,
      layoutType: blueprint.layout.type,
      cardCount: blueprint.cards.length,
    });

    if (onLayoutUpdate) {
      onLayoutUpdate(blueprint);
    }

    if (onProgress) {
      onProgress({
        phase: 'researching',
        progress: 30,
        message: `Researching ${blueprint.cards.length} cards...`,
      });
    }

    // =====================================================
    // Phase 2: Parallel Card Research (Sonnet, 5-10s)
    // =====================================================
    const cardsToResearch = blueprint.cards.filter((c, i) => {
      if (i === 0 && c.cardType === 'hero_summary' && c.placeholderData?.title && c.placeholderData?.subtitle) {
        if (onCardPopulated) {
          onCardPopulated({
            cardId: c.id,
            cardType: c.cardType,
            data: c.placeholderData,
            completedCount: 1,
            totalCount: blueprint.cards.length,
          });
        }
        return false;
      }
      return true;
    });

    logger.info('Orchestrator', 'Phase 2: Parallel Card Research', { cardCount: cardsToResearch.length });
    const researchAdapterConfig = {
      ...adapterConfig,
      model: adapterConfig.researchModel || 'claude-sonnet-4-20250514',
      traceCollector,
    };

    let completedCount = blueprint.cards.length - cardsToResearch.length;

    const researchResults = await researchCardsInParallel({
      cards: cardsToResearch,
      contentAnalysis: blueprint.contentAnalysis,
      imageData,
      mediaType,
      adapterConfig: researchAdapterConfig,
      onCardComplete: (result) => {
        completedCount++;

        if (onCardPopulated) {
          onCardPopulated({
            ...result,
            completedCount,
            totalCount: blueprint.cards.length,
          });
        }

        if (onProgress) {
          const pct = 30 + Math.round((completedCount / blueprint.cards.length) * 65);
          onProgress({
            phase: 'researching',
            progress: pct,
            message: `Card ${completedCount}/${blueprint.cards.length} complete`,
          });
        }
      },
    });

    // =====================================================
    // Phase 3: Assemble final layout
    // =====================================================
    const totalDuration = Date.now() - startTime;
    logger.info('Orchestrator', 'Pipeline complete', { dur: totalDuration });

    const populatedLayout = {
      ...blueprint,
      cards: blueprint.cards.map((card) => ({
        ...card,
        status: 'populated',
        data: researchResults.get(card.id) || card.placeholderData,
      })),
      _meta: {
        totalDuration,
        designDuration,
        classifyDuration,
        cardsResearched: cardsToResearch.length,
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
    logger.error('Orchestrator', 'Pipeline error', { err: error.message, stack: error.stack?.split('\n').slice(0, 3).join(' | ') });
    if (onError) {
      onError(error);
    } else {
      throw error;
    }
  }
}

module.exports = { runPipeline };
