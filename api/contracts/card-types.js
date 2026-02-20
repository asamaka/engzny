/**
 * Card Type Contracts
 *
 * Defines the predefined contract between the orchestration LLM (layout designer)
 * and the individual research LLMs. Both sides agree on the card types, their
 * data shapes, and how they render.
 *
 * The layout designer chooses which card types to use and creates placeholders.
 * Research LLMs populate the cards by returning data matching the contract.
 */

// All available card types with their schemas and rendering hints
const CARD_TYPES = {
  // === Content Cards ===
  hero_summary: {
    description: 'Large summary card at the top - headline, subtitle, and key takeaway',
    schema: {
      title: { type: 'string', required: true, description: 'Main headline (3-8 words)' },
      subtitle: { type: 'string', required: true, description: 'One-line context' },
      badge: { type: 'string', description: 'Category badge (e.g. "Breaking News", "Product", "Social")' },
      badgeColor: { type: 'string', description: 'Badge accent color hex' },
      icon: { type: 'string', description: 'Unicode emoji or symbol' },
      takeaway: { type: 'string', description: 'Key takeaway in 1-2 sentences' },
    },
    sizing: { minWidth: 2, minHeight: 1, defaultSpan: 'full' },
  },

  key_metric: {
    description: 'Single prominent number/stat with label and context',
    schema: {
      label: { type: 'string', required: true, description: 'What this metric measures' },
      value: { type: 'string', required: true, description: 'The metric value (number, price, rating, etc.)' },
      unit: { type: 'string', description: 'Unit if applicable ($, %, stars, etc.)' },
      trend: { type: 'string', enum: ['up', 'down', 'stable', 'none'], description: 'Direction indicator' },
      context: { type: 'string', description: 'Brief context (e.g. "vs $299 last month")' },
      color: { type: 'string', description: 'Accent color for the value' },
    },
    sizing: { minWidth: 1, minHeight: 1, defaultSpan: '1' },
  },

  info_list: {
    description: 'List of key-value pairs for structured information',
    schema: {
      title: { type: 'string', required: true, description: 'List heading' },
      items: {
        type: 'array',
        required: true,
        items: {
          label: { type: 'string', required: true },
          value: { type: 'string', required: true },
          icon: { type: 'string' },
          highlight: { type: 'boolean', description: 'Emphasize this item' },
        },
      },
    },
    sizing: { minWidth: 1, minHeight: 1, defaultSpan: '1' },
  },

  fact_check: {
    description: 'Claim verification card with verdict',
    schema: {
      claim: { type: 'string', required: true, description: 'The claim being checked' },
      verdict: { type: 'string', required: true, enum: ['verified', 'misleading', 'unverified', 'false', 'partially_true', 'needs_context'], description: 'Assessment' },
      explanation: { type: 'string', required: true, description: 'Why this verdict was reached' },
      source: { type: 'string', description: 'Source or basis for the check' },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Confidence in the verdict' },
    },
    sizing: { minWidth: 1, minHeight: 1, defaultSpan: '1' },
  },

  person_card: {
    description: 'Card about a person mentioned or shown',
    schema: {
      name: { type: 'string', required: true, description: 'Person name' },
      role: { type: 'string', description: 'Title, role, or brief descriptor' },
      handle: { type: 'string', description: 'Social media handle if visible' },
      context: { type: 'string', required: true, description: 'Why this person is relevant here' },
      details: { type: 'array', items: { type: 'string' }, description: 'Additional details' },
    },
    sizing: { minWidth: 1, minHeight: 1, defaultSpan: '1' },
  },

  product_card: {
    description: 'Product information with price and key features',
    schema: {
      name: { type: 'string', required: true, description: 'Product name' },
      price: { type: 'string', description: 'Price if visible' },
      rating: { type: 'string', description: 'Rating if visible (e.g. "4.5/5")' },
      features: { type: 'array', items: { type: 'string' }, description: 'Key features or specs' },
      verdict: { type: 'string', description: 'Quick assessment' },
      warnings: { type: 'array', items: { type: 'string' }, description: 'Things to watch out for' },
    },
    sizing: { minWidth: 1, minHeight: 2, defaultSpan: '1' },
  },

  timeline_card: {
    description: 'Sequence of events or dates',
    schema: {
      title: { type: 'string', required: true, description: 'Timeline heading' },
      events: {
        type: 'array',
        required: true,
        items: {
          date: { type: 'string', required: true },
          event: { type: 'string', required: true },
          highlight: { type: 'boolean' },
        },
      },
    },
    sizing: { minWidth: 1, minHeight: 2, defaultSpan: '1' },
  },

  quote_card: {
    description: 'Notable quote or statement extracted from the content',
    schema: {
      quote: { type: 'string', required: true, description: 'The quoted text' },
      attribution: { type: 'string', description: 'Who said it' },
      context: { type: 'string', description: 'Context for the quote' },
    },
    sizing: { minWidth: 1, minHeight: 1, defaultSpan: '1' },
  },

  comparison_card: {
    description: 'Side-by-side comparison of two or more items',
    schema: {
      title: { type: 'string', required: true },
      columns: {
        type: 'array',
        required: true,
        items: {
          header: { type: 'string', required: true },
          values: { type: 'array', items: { type: 'string' }, required: true },
        },
      },
      rows: { type: 'array', items: { type: 'string' }, description: 'Row labels' },
    },
    sizing: { minWidth: 2, minHeight: 2, defaultSpan: 'full' },
  },

  warning_card: {
    description: 'Alert for misleading content, scams, or things to be cautious about',
    schema: {
      level: { type: 'string', required: true, enum: ['critical', 'warning', 'info'], description: 'Severity' },
      title: { type: 'string', required: true, description: 'Warning headline' },
      details: { type: 'string', required: true, description: 'What to watch out for' },
      advice: { type: 'string', description: 'What to do about it' },
    },
    sizing: { minWidth: 1, minHeight: 1, defaultSpan: 'full' },
  },

  action_card: {
    description: 'Actionable next steps or recommendations',
    schema: {
      title: { type: 'string', required: true },
      actions: {
        type: 'array',
        required: true,
        items: {
          label: { type: 'string', required: true },
          description: { type: 'string' },
          priority: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
      },
    },
    sizing: { minWidth: 1, minHeight: 1, defaultSpan: '1' },
  },

  text_extract: {
    description: 'Important text extracted verbatim from the screenshot',
    schema: {
      title: { type: 'string', required: true, description: 'What this text is' },
      text: { type: 'string', required: true, description: 'The extracted text' },
      source: { type: 'string', description: 'Where in the image this came from' },
    },
    sizing: { minWidth: 1, minHeight: 1, defaultSpan: '1' },
  },

  location_card: {
    description: 'Location or place information',
    schema: {
      name: { type: 'string', required: true, description: 'Place name' },
      address: { type: 'string', description: 'Address if known' },
      context: { type: 'string', required: true, description: 'Why this location is relevant' },
      details: { type: 'array', items: { type: 'string' }, description: 'Additional info' },
    },
    sizing: { minWidth: 1, minHeight: 1, defaultSpan: '1' },
  },
};

// Layout types the designer can choose from
const LAYOUT_TYPES = {
  editorial: {
    description: 'News/article layout - hero at top, 2-column body with facts and context',
    columns: 2,
    areas: ['hero', 'main', 'sidebar'],
    bestFor: ['news', 'articles', 'blog posts', 'reports'],
  },
  dashboard: {
    description: 'Metrics-focused grid - KPIs at top, detail cards below',
    columns: 3,
    areas: ['metrics', 'details'],
    bestFor: ['analytics', 'dashboards', 'financial data', 'statistics'],
  },
  product_showcase: {
    description: 'Product-focused - large product card, specs, pricing, warnings',
    columns: 2,
    areas: ['product', 'details', 'warnings'],
    bestFor: ['shopping', 'product pages', 'reviews', 'marketplace listings'],
  },
  social_feed: {
    description: 'Social media layout - person card, quote, fact-check, context',
    columns: 1,
    areas: ['person', 'content', 'context'],
    bestFor: ['tweets', 'social media posts', 'comments', 'chat messages'],
  },
  investigation: {
    description: 'Fact-checking layout - claims, verdicts, timeline, sources',
    columns: 2,
    areas: ['claims', 'evidence', 'timeline'],
    bestFor: ['claims', 'misinformation', 'controversial content'],
  },
  simple: {
    description: 'Clean single-column - hero summary followed by key cards',
    columns: 1,
    areas: ['hero', 'cards'],
    bestFor: ['simple screenshots', 'menus', 'settings', 'messages', 'general'],
  },
};

/**
 * Build a compact schema description for the LLM prompt
 * Only includes card type names and their descriptions
 */
function getCardTypeSummaryForPrompt() {
  return Object.entries(CARD_TYPES).map(([name, def]) => {
    const requiredFields = Object.entries(def.schema)
      .filter(([, v]) => v.required)
      .map(([k]) => k);
    return `- ${name}: ${def.description} (required: ${requiredFields.join(', ')})`;
  }).join('\n');
}

/**
 * Build layout types summary for the LLM prompt
 */
function getLayoutTypesSummaryForPrompt() {
  return Object.entries(LAYOUT_TYPES).map(([name, def]) => {
    return `- ${name}: ${def.description} | best for: ${def.bestFor.join(', ')}`;
  }).join('\n');
}

/**
 * Get the full schema for a specific card type (used by research LLMs)
 */
function getCardSchema(cardType) {
  return CARD_TYPES[cardType] || null;
}

/**
 * Validate card data against its type schema
 */
function validateCardData(cardType, data) {
  const cardDef = CARD_TYPES[cardType];
  if (!cardDef) return { valid: false, errors: [`Unknown card type: ${cardType}`] };

  const errors = [];
  for (const [field, fieldDef] of Object.entries(cardDef.schema)) {
    if (fieldDef.required && (data[field] === undefined || data[field] === null || data[field] === '')) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

module.exports = {
  CARD_TYPES,
  LAYOUT_TYPES,
  getCardTypeSummaryForPrompt,
  getLayoutTypesSummaryForPrompt,
  getCardSchema,
  validateCardData,
};
