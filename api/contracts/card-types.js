/**
 * Card Type Contracts v2 — Visual-First Design
 *
 * Each card type defines:
 *   - required fields: minimum for a meaningful quick render (Haiku fills these)
 *   - optional fields: enrichment data (Sonnet/research fills these progressively)
 *   - visual hints: emoji, colors, sizing for the frontend
 *
 * Design principle: required fields should be fillable from screenshot text alone
 * in under 3 seconds. Optional fields require deeper analysis or web research.
 */

const CARD_TYPES = {
  hero_summary: {
    description: 'Large headline card — icon, title, one-line subtitle, optional takeaway',
    schema: {
      title: { type: 'string', required: true, description: 'Headline (3-8 words)' },
      subtitle: { type: 'string', required: true, description: 'One-line context sentence' },
      emoji: { type: 'string', required: true, description: 'Single emoji representing content (e.g. "📰", "🛒", "⚠️")' },
      badge: { type: 'string', description: 'Category label (e.g. "Breaking News", "Product")' },
      badgeColor: { type: 'string', description: 'Badge accent color hex' },
      takeaway: { type: 'string', description: 'Key takeaway 1-2 sentences max' },
      imageUrl: { type: 'string', description: 'Image URL if visible in screenshot' },
      url: { type: 'string', description: 'Primary source URL if visible' },
    },
    sizing: { minWidth: 2, minHeight: 1, defaultSpan: 'full' },
  },

  key_metric: {
    description: 'Single big number/stat — visual focus on the value',
    schema: {
      value: { type: 'string', required: true, description: 'The number or stat (e.g. "$299", "4.8★", "92%")' },
      label: { type: 'string', required: true, description: 'What this measures (2-4 words)' },
      emoji: { type: 'string', description: 'Decorative emoji' },
      unit: { type: 'string', description: 'Unit symbol ($, %, etc.)' },
      trend: { type: 'string', enum: ['up', 'down', 'stable', 'none'], description: 'Direction' },
      context: { type: 'string', description: 'Brief context (under 15 words)' },
      color: { type: 'string', description: 'Accent color for value' },
    },
    sizing: { minWidth: 1, minHeight: 1, defaultSpan: '1' },
  },

  info_list: {
    description: 'Compact key-value list — icons, labels, values',
    schema: {
      title: { type: 'string', required: true, description: 'Section heading (2-4 words)' },
      items: {
        type: 'array',
        required: true,
        items: {
          emoji: { type: 'string', description: 'Item emoji' },
          label: { type: 'string', required: true },
          value: { type: 'string', required: true },
          highlight: { type: 'boolean' },
          url: { type: 'string' },
        },
      },
    },
    sizing: { minWidth: 1, minHeight: 1, defaultSpan: '1' },
  },

  fact_check: {
    description: 'Claim + visual verdict. For breaking news: prefer "unverified" with low confidence over "misleading"/"false"',
    schema: {
      claim: { type: 'string', required: true, description: 'The claim (one sentence, neutral wording)' },
      verdict: { type: 'string', required: true, enum: ['verified', 'misleading', 'unverified', 'false', 'partially_true', 'needs_context'], description: 'For breaking news strongly prefer "unverified" or "needs_context"' },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: 'For breaking news, almost always "low"' },
      explanation: { type: 'string', description: 'Why this verdict (2-3 sentences max)' },
      source: { type: 'string', description: 'Source name' },
      sourceUrl: { type: 'string', description: 'Source URL' },
    },
    sizing: { minWidth: 1, minHeight: 1, defaultSpan: '1' },
  },

  person_card: {
    description: 'Person mentioned or shown — avatar, name, role',
    schema: {
      name: { type: 'string', required: true, description: 'Full name' },
      role: { type: 'string', description: 'Title or descriptor (under 6 words)' },
      emoji: { type: 'string', description: 'Representing emoji (flag, role symbol, etc.)' },
      handle: { type: 'string', description: 'Social handle' },
      profileUrl: { type: 'string', description: 'Profile URL' },
      context: { type: 'string', description: 'Relevance (1-2 sentences)' },
      details: { type: 'array', items: { type: 'string' }, description: 'Extra facts (max 3)' },
    },
    sizing: { minWidth: 1, minHeight: 1, defaultSpan: '1' },
  },

  product_card: {
    description: 'Product with price, rating, features',
    schema: {
      name: { type: 'string', required: true, description: 'Product name' },
      price: { type: 'string', description: 'Price if visible' },
      rating: { type: 'string', description: 'Rating (e.g. "4.5/5")' },
      emoji: { type: 'string', description: 'Product category emoji' },
      features: { type: 'array', items: { type: 'string' }, description: 'Key features as plain strings (max 5)' },
      verdict: { type: 'string', description: 'One-line assessment' },
      warnings: { type: 'array', items: { type: 'string' }, description: 'Concerns as plain strings (max 3)' },
      url: { type: 'string', description: 'Product URL' },
      imageUrl: { type: 'string', description: 'Product image URL' },
    },
    sizing: { minWidth: 1, minHeight: 2, defaultSpan: '1' },
  },

  timeline_card: {
    description: 'Sequence of events — dates and one-line descriptions',
    schema: {
      title: { type: 'string', required: true, description: 'Timeline heading' },
      events: {
        type: 'array',
        required: true,
        items: {
          date: { type: 'string', required: true },
          event: { type: 'string', required: true },
          highlight: { type: 'boolean' },
          url: { type: 'string' },
        },
      },
    },
    sizing: { minWidth: 1, minHeight: 2, defaultSpan: '1' },
  },

  quote_card: {
    description: 'Notable quote — large stylish text',
    schema: {
      quote: { type: 'string', required: true, description: 'The quoted text' },
      attribution: { type: 'string', description: 'Who said it' },
      context: { type: 'string', description: 'Brief context' },
      sourceUrl: { type: 'string', description: 'Source URL' },
    },
    sizing: { minWidth: 1, minHeight: 1, defaultSpan: '1' },
  },

  comparison_card: {
    description: 'Side-by-side comparison table',
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
    description: 'Visual alert — prominent icon and colored severity',
    schema: {
      level: { type: 'string', required: true, enum: ['critical', 'warning', 'info'], description: 'Severity' },
      title: { type: 'string', required: true, description: 'Warning headline (under 8 words)' },
      details: { type: 'string', description: 'Brief explanation (2 sentences max)' },
      advice: { type: 'string', description: 'What to do' },
    },
    sizing: { minWidth: 1, minHeight: 1, defaultSpan: 'full' },
  },

  action_card: {
    description: 'Actionable next steps — numbered items',
    schema: {
      title: { type: 'string', required: true },
      actions: {
        type: 'array',
        required: true,
        items: {
          label: { type: 'string', required: true },
          description: { type: 'string' },
          url: { type: 'string' },
          priority: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
      },
    },
    sizing: { minWidth: 1, minHeight: 1, defaultSpan: '1' },
  },

  text_extract: {
    description: 'Verbatim text extracted from screenshot',
    schema: {
      title: { type: 'string', required: true, description: 'What this text is' },
      text: { type: 'string', required: true, description: 'The extracted text' },
      source: { type: 'string', description: 'Where in the image' },
    },
    sizing: { minWidth: 1, minHeight: 1, defaultSpan: '1' },
  },

  location_card: {
    description: 'Place or location with pin visual',
    schema: {
      name: { type: 'string', required: true, description: 'Place name' },
      emoji: { type: 'string', description: 'Country flag or location emoji' },
      address: { type: 'string', description: 'Address' },
      context: { type: 'string', description: 'Why relevant (1-2 sentences)' },
      details: { type: 'array', items: { type: 'string' }, description: 'Extra info (max 3)' },
      mapUrl: { type: 'string', description: 'Map link' },
    },
    sizing: { minWidth: 1, minHeight: 1, defaultSpan: '1' },
  },

  link_card: {
    description: 'Collection of relevant links',
    schema: {
      title: { type: 'string', required: true, description: 'Section heading' },
      links: {
        type: 'array',
        required: true,
        items: {
          label: { type: 'string', required: true },
          url: { type: 'string', required: true },
          description: { type: 'string' },
        },
      },
    },
    sizing: { minWidth: 1, minHeight: 1, defaultSpan: '1' },
  },
};

const LAYOUT_TYPES = {
  editorial: {
    description: 'News/article — hero at top, 2-column body',
    columns: 2,
    areas: ['hero', 'main', 'sidebar'],
    bestFor: ['news', 'articles', 'blog posts', 'reports'],
  },
  dashboard: {
    description: 'Metrics grid — KPIs at top, detail cards below',
    columns: 3,
    areas: ['metrics', 'details'],
    bestFor: ['analytics', 'dashboards', 'financial data', 'statistics'],
  },
  product_showcase: {
    description: 'Product-focused — large product card, specs, pricing',
    columns: 2,
    areas: ['product', 'details', 'warnings'],
    bestFor: ['shopping', 'product pages', 'reviews', 'marketplace'],
  },
  social_feed: {
    description: 'Social media — person card, quote, fact-check',
    columns: 1,
    areas: ['person', 'content', 'context'],
    bestFor: ['tweets', 'social posts', 'comments', 'chat messages'],
  },
  investigation: {
    description: 'Fact-checking — claims, verdicts, timeline',
    columns: 2,
    areas: ['claims', 'evidence', 'timeline'],
    bestFor: ['claims', 'misinformation', 'controversial content'],
  },
  simple: {
    description: 'Clean single-column — hero + key cards',
    columns: 1,
    areas: ['hero', 'cards'],
    bestFor: ['simple screenshots', 'menus', 'settings', 'messages', 'general'],
  },
};

function getCardTypeSummaryForPrompt() {
  return Object.entries(CARD_TYPES).map(([name, def]) => {
    const requiredFields = Object.entries(def.schema)
      .filter(([, v]) => v.required)
      .map(([k]) => k);
    return `- ${name}: ${def.description} (required: ${requiredFields.join(', ')})`;
  }).join('\n');
}

function getCardTypeDetailedSchemaForPrompt() {
  return Object.entries(CARD_TYPES).map(([name, def]) => {
    const required = [];
    const optional = [];
    for (const [field, fieldDef] of Object.entries(def.schema)) {
      const desc = fieldDef.description || '';
      const enumStr = fieldDef.enum ? ` [${fieldDef.enum.join('|')}]` : '';
      if (fieldDef.type === 'array' && fieldDef.items && typeof fieldDef.items === 'object' && !fieldDef.items.type) {
        const subFields = Object.entries(fieldDef.items)
          .map(([sf, sd]) => `${sf}${sd.required ? '*' : ''}`)
          .join(', ');
        const line = `${field}*: array of {${subFields}} — ${desc}`;
        if (fieldDef.required) required.push(line);
        else optional.push(line);
      } else {
        const line = `${field}: ${fieldDef.type}${enumStr} — ${desc}`;
        if (fieldDef.required) required.push(line);
        else optional.push(line);
      }
    }
    const size = def.sizing?.defaultSpan === 'full' ? 'FULL WIDTH' : def.sizing?.minWidth >= 2 ? 'WIDE' : 'COMPACT';
    return `## ${name} (${size})
${def.description}
Required: ${required.join('; ')}
Optional: ${optional.join('; ')}`;
  }).join('\n\n');
}

function getLayoutTypesSummaryForPrompt() {
  return Object.entries(LAYOUT_TYPES).map(([name, def]) => {
    return `- ${name}: ${def.description} | best for: ${def.bestFor.join(', ')}`;
  }).join('\n');
}

function getCardSchema(cardType) {
  return CARD_TYPES[cardType] || null;
}

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
  getCardTypeDetailedSchemaForPrompt,
  getLayoutTypesSummaryForPrompt,
  getCardSchema,
  validateCardData,
};
