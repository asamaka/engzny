/**
 * Orchestrator v2
 *
 * Pipeline with instant feedback:
 *
 * 1. Immediate: Send skeleton blueprint (user sees cards in <1s)
 * 2. Layout Designer LLM (vision) → sends layout_update with real cards
 * 3. Parallel Card Researchers → each card populates as it completes
 * 4. All complete → final event
 */

const { designLayout } = require('./layout-designer');
const { researchCardsInParallel } = require('./card-researcher');
const { logger } = require('../lib/logger');

/**
 * Create a generic skeleton blueprint for instant display.
 * Shows hero + 3 shimmer cards while the real layout designer runs.
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
 *
 * @param {Object} options
 * @param {string} options.imageData - Base64 encoded image
 * @param {string} options.mediaType - MIME type
 * @param {string} options.question - Optional user question
 * @param {Function} options.onBlueprint - Called with skeleton blueprint (instant)
 * @param {Function} options.onLayoutUpdate - Called with real blueprint from layout designer
 * @param {Function} options.onCardPopulated - Called when each card research completes
 * @param {Function} options.onComplete - Called when all research is done
 * @param {Function} options.onError - Called on error
 * @param {Function} options.onProgress - Called with progress updates
 * @param {Object} options.adapterConfig - Optional LLM adapter config
 * @returns {Promise<Object>} Final populated layout
 */
async function runPipeline({
  imageData,
  mediaType,
  question,
  onBlueprint,
  onLayoutUpdate,
  onCardPopulated,
  onComplete,
  onError,
  onProgress,
  adapterConfig = {},
}) {
  const startTime = Date.now();

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
        phase: 'designing',
        progress: 10,
        message: 'Analyzing screenshot...',
      });
    }

    // =====================================================
    // Phase 1: Layout Design (Sonnet vision, 5-10s)
    // =====================================================
    const designAdapterConfig = {
      ...adapterConfig,
      model: adapterConfig.designModel || 'claude-sonnet-4-20250514',
    };

    logger.info('Orchestrator', 'Phase 1: Layout Design', { model: designAdapterConfig.model });
    const blueprint = await designLayout({
      imageData,
      mediaType,
      question,
      adapterConfig: designAdapterConfig,
    });

    const designDuration = Date.now() - startTime;
    logger.info('Orchestrator', 'Blueprint ready', {
      dur: designDuration,
      layoutType: blueprint.layout.type,
      cardCount: blueprint.cards.length,
    });

    // Send real layout to replace skeleton
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
    // Hero card can use placeholder data since designer already has good context
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
        cardsResearched: cardsToResearch.length,
      },
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
