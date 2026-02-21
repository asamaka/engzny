/**
 * Orchestrator v2
 *
 * Enhanced pipeline coordinator implementing the new architecture:
 *
 * 1. Screenshot → Layout Designer LLM (vision)
 *    - Describes content, identifies intent, suggests top questions
 *    - Picks the best layout type
 *    - Creates placeholder cards with research assignments
 *
 * 2. Blueprint → SSE to client (cards render as placeholders immediately)
 *
 * 3. Blueprint → Parallel Card Researchers (multiple LLM calls)
 *    - Each card gets its own researcher LLM
 *    - Researchers populate cards based on the agreed contract
 *    - As each completes, SSE sends populated card data to client
 *
 * 4. All complete → Final event with full populated layout
 */

const { designLayout } = require('./layout-designer');
const { researchCardsInParallel } = require('./card-researcher');
const { logger } = require('../lib/logger');

/**
 * Run the full v2 pipeline with SSE callbacks
 *
 * @param {Object} options
 * @param {string} options.imageData - Base64 encoded image
 * @param {string} options.mediaType - MIME type
 * @param {string} options.question - Optional user question
 * @param {Function} options.onBlueprint - Called with layout blueprint (cards as placeholders)
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
  onCardPopulated,
  onComplete,
  onError,
  onProgress,
  adapterConfig = {},
}) {
  const startTime = Date.now();

  try {
    // =====================================================
    // Phase 1: Layout Design (single LLM vision call)
    // =====================================================
    if (onProgress) {
      onProgress({
        phase: 'designing',
        progress: 5,
        message: 'Analyzing screenshot and designing layout...',
      });
    }

    logger.info('Orchestrator', 'Phase 1: Layout Design');
    const blueprint = await designLayout({
      imageData,
      mediaType,
      question,
      adapterConfig,
    });

    const designDuration = Date.now() - startTime;
    logger.info('Orchestrator', 'Blueprint ready', {
      dur: designDuration,
      layoutType: blueprint.layout.type,
      cardCount: blueprint.cards.length,
    });

    // Send blueprint to client (cards render as placeholders immediately)
    if (onBlueprint) {
      onBlueprint(blueprint);
    }

    if (onProgress) {
      onProgress({
        phase: 'researching',
        progress: 30,
        message: `Layout designed. Researching ${blueprint.cards.length} cards in parallel...`,
      });
    }

    // =====================================================
    // Phase 2: Parallel Card Research (multiple LLM calls)
    // Use Sonnet for card research - faster and cheaper than Opus
    // Layout Designer already did the heavy vision analysis
    // =====================================================
    logger.info('Orchestrator', 'Phase 2: Parallel Card Research', { cardCount: cardsToResearch.length });
    const researchAdapterConfig = {
      ...adapterConfig,
      model: adapterConfig.researchModel || 'claude-sonnet-4-20250514',
    };

    // The hero card can use placeholder data directly since the designer already has good context
    // Research the remaining cards in parallel
    const cardsToResearch = blueprint.cards.filter((c, i) => {
      // Skip hero if it already has solid placeholder data
      if (i === 0 && c.cardType === 'hero_summary' && c.placeholderData?.title && c.placeholderData?.subtitle) {
        // Immediately "populate" the hero with its placeholder data
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

    // Build final populated layout
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
