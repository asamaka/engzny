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

  chat_card: {
    description: 'Chat/messaging conversation extract with message bubbles — use for WhatsApp, Telegram, SMS, iMessage screenshots',
    schema: {
      title: { type: 'string', required: true, description: 'Conversation topic or participants' },
      messages: {
        type: 'array',
        required: true,
        items: {
          sender: { type: 'string', required: true, description: 'Who sent this message' },
          text: { type: 'string', required: true, description: 'Message content' },
          time: { type: 'string', description: 'Timestamp' },
          isUser: { type: 'boolean', description: 'True if this is the screenshot owner' },
        },
      },
    },
    sizing: { minWidth: 1, minHeight: 2, defaultSpan: 'full' },
  },

  map_card: {
    description: 'Map or location visualization — static map image or link to interactive map',
    schema: {
      name: { type: 'string', required: true, description: 'Location name' },
      latitude: { type: 'number', description: 'Latitude coordinate' },
      longitude: { type: 'number', description: 'Longitude coordinate' },
      mapImageUrl: { type: 'string', description: 'Static map image URL' },
      mapUrl: { type: 'string', description: 'Link to interactive map (Google Maps, etc.)' },
      zoom: { type: 'number', description: 'Map zoom level 1-18' },
      context: { type: 'string', description: 'Why this location matters (1 sentence)' },
    },
    sizing: { minWidth: 2, minHeight: 1, defaultSpan: 'full' },
  },

  order_card: {
    description: 'Order/receipt card — for food delivery, shopping orders, invoices. Shows itemized list with totals.',
    schema: {
      title: { type: 'string', required: true, description: 'Order title or restaurant/store name' },
      items: {
        type: 'array',
        required: true,
        items: {
          name: { type: 'string', required: true, description: 'Item name' },
          quantity: { type: 'number', description: 'Quantity ordered' },
          price: { type: 'string', description: 'Item price' },
        },
      },
      total: { type: 'string', description: 'Order total amount' },
      status: { type: 'string', description: 'Order status (placed, preparing, delivered, etc.)' },
      emoji: { type: 'string', description: 'Category emoji' },
      deliveryTime: { type: 'string', description: 'Estimated or actual delivery time' },
    },
    sizing: { minWidth: 1, minHeight: 2, defaultSpan: '1' },
  },

  stats_grid_card: {
    description: 'Grid of 2-6 mini stat/metric items in one compact card — use instead of multiple key_metric cards',
    schema: {
      title: { type: 'string', description: 'Section title' },
      stats: {
        type: 'array',
        required: true,
        items: {
          label: { type: 'string', required: true, description: 'Stat label (2-4 words)' },
          value: { type: 'string', required: true, description: 'Stat value' },
          emoji: { type: 'string', description: 'Decorative emoji' },
          trend: { type: 'string', enum: ['up', 'down', 'stable'], description: 'Trend direction' },
        },
      },
    },
    sizing: { minWidth: 2, minHeight: 1, defaultSpan: 'full' },
  },

  gallery_card: {
    description: 'Image gallery showing multiple related images in a grid',
    schema: {
      title: { type: 'string', required: true, description: 'Gallery title' },
      images: {
        type: 'array',
        required: true,
        items: {
          url: { type: 'string', required: true, description: 'Image URL' },
          caption: { type: 'string', description: 'Image caption' },
        },
      },
    },
    sizing: { minWidth: 2, minHeight: 2, defaultSpan: 'full' },
  },

  source_card: {
    description: 'News source or social media account credibility information',
    schema: {
      name: { type: 'string', required: true, description: 'Source/account name' },
      type: { type: 'string', description: 'Source type: official, news_agency, social_media, blog, etc.' },
      credibility: { type: 'string', enum: ['high', 'medium', 'low', 'unknown'], description: 'Credibility rating' },
      followers: { type: 'string', description: 'Follower/subscriber count' },
      context: { type: 'string', description: 'Why this source matters (1 sentence)' },
      profileUrl: { type: 'string', description: 'Profile URL' },
      imageUrl: { type: 'string', description: 'Source avatar/logo URL' },
    },
    sizing: { minWidth: 1, minHeight: 1, defaultSpan: '1' },
  },
};

const LAYOUT_TYPES = {
  breaking_news: {
    description: 'Breaking/developing news — verification first, source tracking, key people and locations',
    columns: 2,
    suggestedCards: ['hero_summary', 'verification_card', 'person_card', 'location_card', 'timeline_card', 'news_card'],
    bestFor: ['breaking news', 'developing stories', 'unverified claims', 'crisis', 'military events'],
  },
  editorial: {
    description: 'News article analysis — hero with image, key details, fact-check, context',
    columns: 2,
    suggestedCards: ['hero_summary', 'news_card', 'fact_check', 'person_card', 'info_list', 'did_you_know_card'],
    bestFor: ['news articles', 'blog posts', 'press releases', 'reports', 'verified news'],
  },
  social_feed: {
    description: 'Social media post — person profile, quote/post content, fact-check, context',
    columns: 1,
    suggestedCards: ['hero_summary', 'person_card', 'quote_card', 'fact_check', 'did_you_know_card'],
    bestFor: ['tweets', 'facebook posts', 'instagram', 'social media', 'memes', 'viral content'],
  },
  simple: {
    description: 'Clean single-column for straightforward content',
    columns: 1,
    suggestedCards: ['hero_summary', 'info_list', 'action_card'],
    bestFor: ['settings', 'menus', 'simple screenshots', 'general', 'unknown content'],
  },
  food_order: {
    description: 'Food delivery / restaurant order — order details, location, timing, total',
    columns: 2,
    suggestedCards: ['hero_summary', 'order_card', 'location_card', 'key_metric', 'warning_card', 'action_card'],
    bestFor: ['food delivery', 'uber eats', 'doordash', 'restaurant order', 'grocery delivery', 'shopping cart'],
  },
  messaging: {
    description: 'Chat/messaging conversation — message bubbles, context, action items',
    columns: 1,
    suggestedCards: ['hero_summary', 'chat_card', 'info_list', 'action_card'],
    bestFor: ['whatsapp', 'telegram', 'sms', 'imessage', 'messenger', 'chat', 'text messages', 'email'],
  },
  location_explorer: {
    description: 'Place/location focus — photos, map, details, reviews, context',
    columns: 2,
    suggestedCards: ['hero_summary', 'location_card', 'map_card', 'gallery_card', 'info_list', 'did_you_know_card'],
    bestFor: ['restaurants', 'hotels', 'tourist spots', 'places', 'travel destinations', 'maps', 'addresses'],
  },
  media_analysis: {
    description: 'Photo/media analysis — image details, artistic analysis, context',
    columns: 1,
    suggestedCards: ['hero_summary', 'gallery_card', 'info_list', 'quote_card', 'did_you_know_card'],
    bestFor: ['photos', 'art', 'memes', 'infographics', 'screenshots of images', 'photography'],
  },
  product_showcase: {
    description: 'Product-focused — product image, specs, pricing, reviews, comparison',
    columns: 2,
    suggestedCards: ['hero_summary', 'product_card', 'stats_grid_card', 'comparison_card', 'warning_card', 'action_card'],
    bestFor: ['shopping', 'product pages', 'reviews', 'marketplace', 'amazon', 'price comparison'],
  },
  dashboard: {
    description: 'Data/metrics grid — KPIs, charts, trends, detail tables',
    columns: 2,
    suggestedCards: ['hero_summary', 'stats_grid_card', 'chart_card', 'key_metric', 'info_list'],
    bestFor: ['analytics', 'dashboards', 'financial data', 'statistics', 'reports', 'stocks', 'crypto'],
  },
  encyclopedia: {
    description: 'Deep dive / Wikipedia-like — background, timeline, facts, context',
    columns: 2,
    suggestedCards: ['hero_summary', 'person_card', 'timeline_card', 'info_list', 'did_you_know_card', 'gallery_card'],
    bestFor: ['famous people', 'historical events', 'topics', 'educational', 'wikipedia', 'research'],
  },
  travel_planner: {
    description: 'Travel / itinerary — timeline of events, locations, costs, tips',
    columns: 2,
    suggestedCards: ['hero_summary', 'timeline_card', 'location_card', 'map_card', 'stats_grid_card', 'action_card'],
    bestFor: ['travel itinerary', 'trip planning', 'flight booking', 'hotel booking', 'vacation'],
  },
};

// Backward compatibility aliases
LAYOUT_TYPES.investigation = LAYOUT_TYPES.breaking_news;

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
  return Object.entries(LAYOUT_TYPES)
    .filter(([name]) => name !== 'investigation') // skip alias
    .map(([name, def]) => {
      return `- ${name}: ${def.description} | best for: ${def.bestFor.join(', ')} | suggested cards: ${def.suggestedCards.join(', ')}`;
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
