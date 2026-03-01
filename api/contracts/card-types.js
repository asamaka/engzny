/**
 * Card Type Contracts v3 — Visual-First, Image-Rich Design
 *
 * Each card type defines:
 *   - required fields: minimum for a meaningful quick render (Haiku fills these)
 *   - optional fields: enrichment data (Sonnet/research fills these progressively)
 *   - visual hints: emoji, colors, sizing, imageUrl for the frontend
 *
 * Design principles:
 *   1. Images first — every card that can show a photo should
 *   2. Less text, more visual — concise labels, not paragraphs
 *   3. Show what the user didn't know — focus on new/surprising info
 *   4. Person/location/news cards should always try to fetch real photos
 */

const CARD_TYPES = {
  hero_summary: {
    description: 'Large headline card — image banner, icon, title, one-line subtitle, key takeaway',
    schema: {
      title: { type: 'string', required: true, description: 'Headline (3-8 words)' },
      subtitle: { type: 'string', required: true, description: 'One-line context sentence' },
      emoji: { type: 'string', required: true, description: 'Single emoji representing content (e.g. "📰", "🛒", "⚠️")' },
      badge: { type: 'string', description: 'Category label (e.g. "Breaking News", "Product")' },
      badgeColor: { type: 'string', description: 'Badge accent color hex' },
      takeaway: { type: 'string', description: 'Key insight the user likely did NOT know — 1 sentence max' },
      imageUrl: { type: 'string', description: 'Banner image URL — news article image, product shot, etc.' },
      url: { type: 'string', description: 'Primary source URL if visible' },
    },
    sizing: { minWidth: 2, minHeight: 1, defaultSpan: 'full' },
  },

  key_metric: {
    description: 'Single big number/stat — visual focus on the value, optional mini sparkline',
    schema: {
      value: { type: 'string', required: true, description: 'The number or stat (e.g. "$299", "4.8★", "92%")' },
      label: { type: 'string', required: true, description: 'What this measures (2-4 words)' },
      emoji: { type: 'string', description: 'Decorative emoji' },
      unit: { type: 'string', description: 'Unit symbol ($, %, etc.)' },
      trend: { type: 'string', enum: ['up', 'down', 'stable', 'none'], description: 'Direction' },
      context: { type: 'string', description: 'Brief context (under 10 words)' },
      color: { type: 'string', description: 'Accent color for value' },
      sparkline: { type: 'array', items: { type: 'number' }, description: 'Array of 5-10 numbers for a mini sparkline chart' },
    },
    sizing: { minWidth: 1, minHeight: 1, defaultSpan: '1' },
  },

  info_list: {
    description: 'Compact key-value list — icons, labels, values. Keep items to 4-5 max.',
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
    description: 'Claim + visual verdict gauge. For breaking news: prefer "unverified" with low confidence over "misleading"/"false"',
    schema: {
      claim: { type: 'string', required: true, description: 'The claim (one sentence, neutral wording)' },
      verdict: { type: 'string', required: true, enum: ['verified', 'misleading', 'unverified', 'false', 'partially_true', 'needs_context'], description: 'For breaking news strongly prefer "unverified" or "needs_context"' },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: 'For breaking news, almost always "low"' },
      explanation: { type: 'string', description: 'Why this verdict (1-2 sentences max)' },
      source: { type: 'string', description: 'Source name' },
      sourceUrl: { type: 'string', description: 'Source URL' },
    },
    sizing: { minWidth: 1, minHeight: 1, defaultSpan: '1' },
  },

  person_card: {
    description: 'Person mentioned or shown — MUST include photoUrl from web search when possible. Shows real photo, name, role.',
    schema: {
      name: { type: 'string', required: true, description: 'Full name' },
      role: { type: 'string', description: 'Title or descriptor (under 6 words)' },
      emoji: { type: 'string', description: 'Representing emoji (flag, role symbol, etc.)' },
      photoUrl: { type: 'string', description: 'IMPORTANT: Real photo URL of this person — use web search to find Wikipedia/official photo. Makes cards much richer.' },
      handle: { type: 'string', description: 'Social handle' },
      profileUrl: { type: 'string', description: 'Profile URL' },
      context: { type: 'string', description: 'Why they are relevant (1 sentence)' },
      notableInfo: { type: 'string', description: 'Surprising/interesting fact the user likely did not know about this person' },
      details: { type: 'array', items: { type: 'string' }, description: 'Key facts (max 3, short phrases only)' },
    },
    sizing: { minWidth: 1, minHeight: 1, defaultSpan: '1' },
  },

  product_card: {
    description: 'Product with image, price, rating, features',
    schema: {
      name: { type: 'string', required: true, description: 'Product name' },
      price: { type: 'string', description: 'Price if visible' },
      rating: { type: 'string', description: 'Rating (e.g. "4.5/5")' },
      emoji: { type: 'string', description: 'Product category emoji' },
      imageUrl: { type: 'string', description: 'Product image URL' },
      features: { type: 'array', items: { type: 'string' }, description: 'Key features as plain strings (max 4)' },
      verdict: { type: 'string', description: 'One-line assessment' },
      warnings: { type: 'array', items: { type: 'string' }, description: 'Concerns as plain strings (max 2)' },
      url: { type: 'string', description: 'Product URL' },
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
    description: 'Notable quote — large stylish text with optional person photo',
    schema: {
      quote: { type: 'string', required: true, description: 'The quoted text (keep under 30 words)' },
      attribution: { type: 'string', description: 'Who said it' },
      photoUrl: { type: 'string', description: 'Photo of the person being quoted' },
      context: { type: 'string', description: 'Brief context (1 sentence max)' },
      sourceUrl: { type: 'string', description: 'Source URL' },
    },
    sizing: { minWidth: 1, minHeight: 1, defaultSpan: '1' },
  },

  comparison_card: {
    description: 'Side-by-side comparison table — visual and scannable',
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
      details: { type: 'string', description: 'Brief explanation (1 sentence max)' },
      advice: { type: 'string', description: 'What to do (1 sentence max)' },
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
    description: 'Verbatim text extracted from screenshot — only when actual text extraction is useful',
    schema: {
      title: { type: 'string', required: true, description: 'What this text is' },
      text: { type: 'string', required: true, description: 'The extracted text' },
      source: { type: 'string', description: 'Where in the image' },
    },
    sizing: { minWidth: 1, minHeight: 1, defaultSpan: '1' },
  },

  location_card: {
    description: 'Place or location — MUST include imageUrl from web search. Shows photo, name, key facts.',
    schema: {
      name: { type: 'string', required: true, description: 'Place name' },
      emoji: { type: 'string', description: 'Country flag or location emoji' },
      imageUrl: { type: 'string', description: 'IMPORTANT: Photo of this location — use web search to find a real photo. Makes cards much richer.' },
      address: { type: 'string', description: 'Address' },
      context: { type: 'string', description: 'Why relevant (1 sentence)' },
      details: { type: 'array', items: { type: 'string' }, description: 'Key facts (max 3, short phrases)' },
      mapUrl: { type: 'string', description: 'Map link' },
    },
    sizing: { minWidth: 1, minHeight: 1, defaultSpan: '1' },
  },

  link_card: {
    description: 'Collection of relevant links — only use when there are actual URLs to show',
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

  news_card: {
    description: 'News article with image, headline, source, date — use for news/article screenshots. MUST include imageUrl.',
    schema: {
      headline: { type: 'string', required: true, description: 'News headline (under 12 words)' },
      source: { type: 'string', required: true, description: 'News source name' },
      imageUrl: { type: 'string', description: 'IMPORTANT: Article image or news photo URL. Makes the card visual and engaging.' },
      date: { type: 'string', description: 'Publication date' },
      summary: { type: 'string', description: 'What happened in 1-2 sentences — focus on what is NEW or surprising' },
      category: { type: 'string', description: 'News category (politics, tech, sports, etc.)' },
      url: { type: 'string', description: 'Article URL' },
      relatedContext: { type: 'string', description: 'Background the user likely did not know — 1 sentence' },
    },
    sizing: { minWidth: 1, minHeight: 2, defaultSpan: '1' },
  },

  chart_card: {
    description: 'Visual chart — bar chart, pie chart, or number comparison. Use when data can be visualized.',
    schema: {
      title: { type: 'string', required: true, description: 'Chart title (2-5 words)' },
      chartType: { type: 'string', required: true, enum: ['bar', 'pie', 'progress', 'comparison'], description: 'Type of visualization' },
      data: {
        type: 'array',
        required: true,
        items: {
          label: { type: 'string', required: true },
          value: { type: 'number', required: true },
          color: { type: 'string', description: 'Color hex (optional, auto-assigned if missing)' },
        },
      },
      unit: { type: 'string', description: 'Unit label (%, $, etc.)' },
      insight: { type: 'string', description: 'One-line insight about the data' },
    },
    sizing: { minWidth: 1, minHeight: 2, defaultSpan: '1' },
  },

  did_you_know_card: {
    description: 'Surprising fact the user likely did NOT know — the core value of this app. Makes the hub informative.',
    schema: {
      fact: { type: 'string', required: true, description: 'The surprising fact (1-2 sentences)' },
      emoji: { type: 'string', required: true, description: 'Eye-catching emoji for this fact' },
      category: { type: 'string', description: 'Category: history, science, context, background, etc.' },
      sourceUrl: { type: 'string', description: 'Source URL for verification' },
      imageUrl: { type: 'string', description: 'Related image URL to make it visual' },
    },
    sizing: { minWidth: 1, minHeight: 1, defaultSpan: '1' },
  },

  verification_card: {
    description: 'REQUIRED for breaking news. Live verification tracker — shows which sources have been checked and what they say. Starts in "searching" state, progressively updated as web search finds sources. ALWAYS use this instead of fact_check for breaking/unverified news.',
    schema: {
      claim: { type: 'string', required: true, description: 'The claim being verified (1 neutral sentence)' },
      status: { type: 'string', required: true, enum: ['searching', 'partially_verified', 'verified', 'denied', 'unconfirmed', 'conflicting'], description: 'Start with "searching", updated as sources are found' },
      sources: {
        type: 'array',
        required: true,
        items: {
          name: { type: 'string', required: true, description: 'Source name (e.g. "Reuters", "BBC", "AP News")' },
          status: { type: 'string', required: true, description: 'checking|confirmed|denied|no_info|not_yet_reported' },
          snippet: { type: 'string', description: 'What this source says (1 sentence)' },
          url: { type: 'string', description: 'Source URL' },
        },
      },
      lastChecked: { type: 'string', description: 'Timestamp of last check' },
      summary: { type: 'string', description: 'Brief verification summary based on sources found so far' },
    },
    sizing: { minWidth: 2, minHeight: 2, defaultSpan: 'full' },
  },
};

const LAYOUT_TYPES = {
  editorial: {
    description: 'News/article — hero image at top, news cards, fact checks, timeline',
    columns: 2,
    areas: ['hero', 'main', 'sidebar'],
    bestFor: ['news', 'articles', 'blog posts', 'reports'],
  },
  dashboard: {
    description: 'Metrics grid — chart cards, KPIs at top, detail cards below',
    columns: 3,
    areas: ['metrics', 'details'],
    bestFor: ['analytics', 'dashboards', 'financial data', 'statistics'],
  },
  product_showcase: {
    description: 'Product-focused — large product image, specs, pricing, comparison',
    columns: 2,
    areas: ['product', 'details', 'warnings'],
    bestFor: ['shopping', 'product pages', 'reviews', 'marketplace'],
  },
  social_feed: {
    description: 'Social media — person photo card, quote, fact-check',
    columns: 1,
    areas: ['person', 'content', 'context'],
    bestFor: ['tweets', 'social posts', 'comments', 'chat messages'],
  },
  investigation: {
    description: 'Fact-checking — claims, verdicts, timeline, did-you-know',
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
