/**
 * Renders live pipeline reports as self-contained HTML pages.
 *
 * Faithfully reproduces the card UI the user saw in hub-v2.html,
 * adds pipeline telemetry, and includes an AI-generated reflection.
 */

function esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function fmtMs(ms) { return ms < 1000 ? ms + 'ms' : (ms / 1000).toFixed(1) + 's'; }

function renderReflection(report) {
  const cards = report.cards || [];
  const ca = report.contentAnalysis || {};
  const meta = report.meta || {};
  const duration = meta.totalDuration || report.duration;
  const haikuDur = meta.haikuDuration || null;
  const designDur = meta.designDuration || report.designDuration || haikuDur;
  const enhanceDur = meta.enhanceDuration || null;
  const researchDur = meta.researchDuration || (duration && designDur ? duration - designDur : null);
  const cardTypes = cards.map(c => c.cardType).filter(Boolean);

  const lines = [];

  // Error case — most important, show first
  if (report.outcome === 'error') {
    lines.push(`<span style="color:var(--r)">This pipeline failed with error: <strong>${esc(report.error)}</strong>. The user saw an error state instead of cards.</span>`);
    return lines;
  }

  // Expected vs Actual framing
  if (ca.contentType || ca.platform) {
    let expected = `<strong>Input:</strong> A screenshot of <strong>${esc(ca.contentType || 'content')}</strong>`;
    if (ca.platform) expected += ` from <strong>${esc(ca.platform)}</strong>`;
    expected += '.';
    if (ca.intent) expected += ` The user likely wanted: <em>${esc(ca.intent)}</em>.`;
    lines.push(expected);
  }

  if (cardTypes.length > 0) {
    let output = `<strong>Output:</strong> <strong>${cards.length} cards</strong> (${cardTypes.map(t => t.replace(/_/g, ' ')).join(', ')})`;
    if (report.layout?.type) output += ` in a <strong>${esc(report.layout.type)}</strong> layout`;
    output += '.';
    lines.push(output);
  }

  // Quality gap analysis
  const issues = [];
  const emptyCards = cards.filter(c => {
    const d = c.data || {};
    return Object.keys(d).length === 0 || (!d.title && !d.name && !d.claim && !d.quote && !d.label);
  });
  if (emptyCards.length > 0) {
    issues.push(`${emptyCards.length} card(s) have minimal or missing data`);
  }

  const verificationCard = cards.find(c => c.cardType === 'verification_card');
  if (verificationCard?.data) {
    const sources = verificationCard.data.sources || [];
    const checking = sources.filter(s => (typeof s === 'object' ? s.status : '') === 'checking').length;
    if (checking > 0 && checking === sources.length) {
      issues.push('all verification sources still show "checking"');
    }
  }

  if (issues.length > 0) {
    lines.push(`<strong>Gap:</strong> <span style="color:var(--y)">${issues.join('; ')}.</span>`);
  } else if (cardTypes.length > 0) {
    lines.push('<strong>Gap:</strong> <span style="color:var(--g)">Output appears complete and relevant to the input.</span>');
  }

  // Performance
  if (duration) {
    let perf = `<strong>Performance:</strong> ${fmtMs(duration)} total`;
    if (haikuDur) perf += ` (first cards in ${fmtMs(haikuDur)}`;
    if (enhanceDur) perf += `, enhance ${fmtMs(enhanceDur)}`;
    if (researchDur) perf += `, research ${fmtMs(researchDur)}`;
    if (haikuDur) perf += ')';
    perf += '.';
    if (duration > 30000) perf += ' <span style="color:var(--y)">Slow — investigate pipeline bottleneck.</span>';
    lines.push(perf);
  }

  // Top questions
  if (ca.topQuestions?.length > 0) {
    lines.push(`<strong>Key questions identified:</strong><br>` +
      ca.topQuestions.map((q, i) => `&nbsp;&nbsp;${i + 1}. ${esc(q)}`).join('<br>'));
  }

  return lines;
}

function renderCardHtml(card) {
  const type = card.cardType;
  const d = card.data || card.placeholderData || {};
  const cardClass = {
    hero_summary: 'card-hero', key_metric: 'card-metric', info_list: 'card-list',
    fact_check: 'card-fact-check', person_card: 'card-person', product_card: 'card-product',
    timeline_card: 'card-timeline', quote_card: 'card-quote', comparison_card: 'card-comparison',
    warning_card: 'card-warning', action_card: 'card-action', text_extract: 'card-extract',
    location_card: 'card-location', link_card: 'card-link',
    chat_card: 'card-chat', map_card: 'card-map', order_card: 'card-order',
    stats_grid_card: 'card-stats-grid', gallery_card: 'card-gallery', source_card: 'card-source',
  }[type] || '';

  const ICONS = {
    hero_summary: 'article', key_metric: 'monitoring', info_list: 'list_alt',
    fact_check: 'fact_check', person_card: 'person', product_card: 'shopping_bag',
    timeline_card: 'timeline', quote_card: 'format_quote', comparison_card: 'compare',
    warning_card: 'warning', action_card: 'bolt', text_extract: 'description',
    location_card: 'location_on', link_card: 'link',
    chat_card: 'chat', map_card: 'map', order_card: 'receipt_long',
    stats_grid_card: 'monitoring', gallery_card: 'photo_library', source_card: 'source',
  };

  const icon = ICONS[type] || 'info';
  const typeLabel = type !== 'hero_summary' ? `<div class="card-type-label"><div class="card-type-icon"><span class="mi">${icon}</span></div>${type.replace(/_/g, ' ')}</div>` : '';

  let inner = '';
  switch (type) {
    case 'hero_summary':
      inner = `${d.badge ? `<span class="hero-badge">${esc(d.badge)}</span>` : ''}
        ${d.icon ? `<span style="font-size:1.4rem;margin-bottom:6px;display:inline-block">${esc(d.icon)}</span>` : ''}
        <div class="hero-title">${esc(d.title || 'Analysis')}</div>
        <div class="hero-subtitle">${esc(d.subtitle || '')}</div>
        ${d.takeaway ? `<div class="hero-takeaway">${esc(d.takeaway)}</div>` : ''}`;
      break;

    case 'key_metric':
      inner = `${typeLabel}
        <div class="metric-value">${esc(d.unit && d.unit.length === 1 ? d.unit : '')}${esc(d.value || '—')}</div>
        <div class="metric-label">${esc(d.label || '')}</div>
        ${d.trend && d.trend !== 'none' ? `<span class="metric-trend ${esc(d.trend)}">${esc(d.trend)}</span>` : ''}
        ${d.context ? `<div class="metric-context">${esc(d.context)}</div>` : ''}`;
      break;

    case 'info_list':
      inner = `${typeLabel}
        <div class="list-title">${esc(d.title || 'Details')}</div>
        ${(d.items || []).map(item => {
          if (typeof item === 'object' && item !== null) {
            return `<div class="list-item${item.highlight ? ' highlight' : ''}">
              <span class="list-item-label">${item.icon ? `<span class="li-icon">${esc(item.icon)}</span>` : ''}${esc(item.label || item.name || item.key || '')}</span>
              <span class="list-item-value">${esc(item.value || item.description || item.text || '')}</span>
            </div>`;
          }
          return `<div class="list-item"><span class="list-item-value" style="text-align:left">${esc(item)}</span></div>`;
        }).join('')}`;
      break;

    case 'fact_check':
      inner = `${typeLabel}
        <div class="fact-claim">${esc(d.claim || '')}</div>
        <div class="fact-verdict ${esc(d.verdict || 'unverified')}"><span class="mi" style="font-size:13px">${
          d.verdict === 'verified' ? 'check_circle' : d.verdict === 'false' ? 'cancel' : d.verdict === 'misleading' ? 'warning' : 'help'
        }</span> ${esc(d.verdict || 'unverified')}</div>
        <div class="fact-explanation">${esc(d.explanation || '')}</div>
        ${d.source ? `<div class="fact-source">Source: ${esc(d.source)}</div>` : ''}
        ${d.confidence ? `<div class="fact-source">Confidence: ${esc(d.confidence)}</div>` : ''}`;
      break;

    case 'person_card':
      inner = `${typeLabel}
        <div class="person-header">
          <div class="person-avatar">${esc(d.name ? d.name[0].toUpperCase() : '?')}</div>
          <div>
            <div class="person-name">${esc(d.name || 'Unknown')}</div>
            ${d.role ? `<div class="person-role">${esc(d.role)}</div>` : ''}
            ${d.handle ? `<div class="person-handle">${esc(d.handle)}</div>` : ''}
          </div>
        </div>
        <div class="person-context">${esc(d.context || '')}</div>
        ${(d.details || []).length ? `<div class="person-details">${d.details.map(det =>
          `<div class="person-detail-item">${esc(typeof det === 'string' ? det : det.label || JSON.stringify(det))}</div>`
        ).join('')}</div>` : ''}`;
      break;

    case 'product_card':
      inner = `${typeLabel}
        <div class="product-header"><div>
          <div class="product-name">${esc(d.name || 'Product')}</div>
          ${d.price ? `<div class="product-price">${esc(d.price)}</div>` : ''}
          ${d.rating ? `<div class="product-rating">${esc(d.rating)}</div>` : ''}
        </div></div>
        ${(d.features || []).length ? `<ul class="product-features">${d.features.map(f => `<li>${esc(typeof f === 'string' ? f : f.label || JSON.stringify(f))}</li>`).join('')}</ul>` : ''}
        ${d.verdict ? `<div class="product-verdict">${esc(d.verdict)}</div>` : ''}
        ${(d.warnings || []).length ? `<ul class="product-warnings">${d.warnings.map(w => `<li>${esc(typeof w === 'string' ? w : w.label || JSON.stringify(w))}</li>`).join('')}</ul>` : ''}`;
      break;

    case 'timeline_card':
      inner = `${typeLabel}
        <div class="timeline-title">${esc(d.title || 'Timeline')}</div>
        ${(d.events || []).map(ev => {
          const evObj = typeof ev === 'object' ? ev : { event: String(ev) };
          return `<div class="timeline-event${evObj.highlight ? ' highlight' : ''}">
            <div class="timeline-date">${esc(evObj.date || '')}</div>
            <div class="timeline-dot"></div>
            <div class="timeline-text">${esc(evObj.event || evObj.text || evObj.description || '')}</div>
          </div>`;
        }).join('')}`;
      break;

    case 'quote_card':
      inner = `${typeLabel}
        <div class="quote-mark">"</div>
        <div class="quote-text">${esc(d.quote || '')}</div>
        ${d.attribution ? `<div class="quote-attribution">— ${esc(d.attribution)}</div>` : ''}
        ${d.context ? `<div class="quote-context">${esc(d.context)}</div>` : ''}`;
      break;

    case 'warning_card': {
      const level = d.level || 'warning';
      inner = `<div class="warning-header">
          <div class="warning-icon-wrap"><span class="mi">${level === 'critical' ? 'error' : level === 'info' ? 'info' : 'warning'}</span></div>
          <span class="warning-title">${esc(d.title || 'Warning')}</span>
        </div>
        <div class="warning-details">${esc(d.details || '')}</div>
        ${d.advice ? `<div class="warning-advice">${esc(d.advice)}</div>` : ''}`;
      break;
    }

    case 'action_card':
      inner = `${typeLabel}
        <div class="action-title">${esc(d.title || 'Next Steps')}</div>
        ${(d.actions || []).map((a, i) => {
          const aObj = typeof a === 'object' ? a : { label: String(a) };
          return `<div class="action-item">
            <span class="action-bullet">${i + 1}</span>
            <div>
              <div class="action-label">${esc(aObj.label || aObj.name || '')}</div>
              ${aObj.description ? `<div class="action-desc">${esc(aObj.description)}</div>` : ''}
              ${aObj.priority ? `<span class="action-priority ${esc(aObj.priority)}">${esc(aObj.priority)}</span>` : ''}
            </div>
          </div>`;
        }).join('')}`;
      break;

    case 'text_extract':
      inner = `${typeLabel}
        <div class="extract-title">${esc(d.title || 'Extracted Text')}</div>
        <div class="extract-text">${esc(d.text || '')}</div>
        ${d.source ? `<div class="extract-source">${esc(d.source)}</div>` : ''}`;
      break;

    case 'location_card':
      inner = `${typeLabel}
        <div class="location-name">${esc(d.name || 'Location')}</div>
        ${d.address ? `<div class="location-address"><span class="mi" style="font-size:14px">place</span> ${esc(d.address)}</div>` : ''}
        <div class="location-context">${esc(d.context || '')}</div>
        ${(d.details || []).length ? `<div class="location-details">${d.details.map(det =>
          `<div class="location-detail-item">${esc(typeof det === 'string' ? det : det.label || JSON.stringify(det))}</div>`
        ).join('')}</div>` : ''}`;
      break;

    case 'link_card':
      inner = `${typeLabel}
        <div class="links-title">${esc(d.title || 'Links')}</div>
        ${(d.links || []).map(l => {
          const lObj = typeof l === 'object' ? l : { label: String(l) };
          return `<div class="link-item"><div class="link-icon"><span class="mi">link</span></div><div>
            <div class="link-label">${lObj.url ? `<a href="${esc(lObj.url)}" target="_blank">${esc(lObj.label || lObj.url)}</a>` : esc(lObj.label || '')}</div>
            ${lObj.description ? `<div class="link-desc">${esc(lObj.description)}</div>` : ''}
          </div></div>`;
        }).join('')}`;
      break;

    case 'chat_card':
      inner = `${typeLabel}
        <div class="list-title">${esc(d.title || 'Conversation')}</div>
        ${(d.messages || []).map(msg => {
          const mObj = typeof msg === 'object' ? msg : { text: String(msg), sender: 'Unknown' };
          return `<div style="margin-bottom:8px;${mObj.isUser ? 'text-align:right' : ''}">
            <div style="font-size:.7rem;color:var(--t3);margin-bottom:2px">${esc(mObj.sender || '')} ${mObj.time ? esc(mObj.time) : ''}</div>
            <div style="display:inline-block;max-width:85%;padding:8px 12px;border-radius:12px;font-size:.82rem;line-height:1.5;${mObj.isUser ? 'background:var(--a-bgs);color:var(--a)' : 'background:var(--s3);color:var(--t)'}">${esc(mObj.text || '')}</div>
          </div>`;
        }).join('')}`;
      break;

    case 'map_card':
      inner = `${typeLabel}
        ${d.mapImageUrl ? `<img src="${esc(d.mapImageUrl)}" alt="${esc(d.name)}" style="width:100%;height:150px;object-fit:cover;border-radius:8px;margin-bottom:10px" onerror="this.style.display='none'">` : ''}
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span class="mi" style="font-size:20px;color:var(--a)">map</span>
          <span style="font-size:.95rem;font-weight:700;color:#fff">${esc(d.name || 'Location')}</span>
        </div>
        ${d.context ? `<div style="font-size:.8rem;color:var(--t2);line-height:1.6">${esc(d.context)}</div>` : ''}
        ${d.mapUrl ? `<a href="${esc(d.mapUrl)}" target="_blank" style="display:inline-flex;align-items:center;gap:4px;margin-top:8px;font-size:.78rem;color:var(--a);text-decoration:none"><span class="mi" style="font-size:14px">open_in_new</span> Open in Maps</a>` : ''}`;
      break;

    case 'order_card':
      inner = `${typeLabel}
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
          ${d.emoji ? `<span style="font-size:1.2rem">${esc(d.emoji)}</span>` : ''}
          <span class="list-title" style="margin:0">${esc(d.title || 'Order')}</span>
          ${d.status ? `<span class="badge badge-g" style="font-size:.6rem">${esc(d.status)}</span>` : ''}
        </div>
        ${(d.items || []).map(item => {
          const iObj = typeof item === 'object' ? item : { name: String(item) };
          return `<div class="list-item"><span class="list-item-label">${iObj.quantity ? iObj.quantity + '× ' : ''}${esc(iObj.name || '')}</span><span class="list-item-value">${esc(iObj.price || '')}</span></div>`;
        }).join('')}
        ${d.total ? `<div style="display:flex;justify-content:space-between;padding-top:10px;margin-top:6px;border-top:2px solid var(--b);font-weight:700"><span>Total</span><span style="color:var(--a);font-size:1.1rem">${esc(d.total)}</span></div>` : ''}
        ${d.deliveryTime ? `<div style="font-size:.7rem;color:var(--t3);margin-top:8px">🕐 ${esc(d.deliveryTime)}</div>` : ''}`;
      break;

    case 'stats_grid_card':
      inner = `${typeLabel}
        ${d.title ? `<div class="list-title">${esc(d.title)}</div>` : ''}
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px">
        ${(d.stats || []).map(s => {
          const sObj = typeof s === 'object' ? s : { label: String(s), value: '' };
          return `<div style="background:var(--s3);border-radius:8px;padding:10px">
            ${sObj.emoji ? `<div style="font-size:1rem;margin-bottom:2px">${esc(sObj.emoji)}</div>` : ''}
            <div style="font-size:.65rem;color:var(--t3)">${esc(sObj.label || '')}</div>
            <div style="font-size:1.2rem;font-weight:700;color:var(--a)">${esc(sObj.value || '—')}</div>
            ${sObj.trend ? `<span class="metric-trend ${esc(sObj.trend)}" style="font-size:.6rem">${esc(sObj.trend)}</span>` : ''}
          </div>`;
        }).join('')}
        </div>`;
      break;

    case 'gallery_card':
      inner = `${typeLabel}
        <div class="list-title">${esc(d.title || 'Gallery')}</div>
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px">
        ${(d.images || []).slice(0, 6).map(img => {
          const iObj = typeof img === 'object' ? img : { url: String(img) };
          return `<img src="${esc(iObj.url || '')}" alt="${esc(iObj.caption || '')}" style="width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:8px" onerror="this.style.display='none'">`;
        }).join('')}
        </div>`;
      break;

    case 'source_card': {
      const credColors = { high: 'var(--g)', medium: 'var(--y)', low: 'var(--r)', unknown: 'var(--t3)' };
      inner = `${typeLabel}
        <div style="display:flex;align-items:center;gap:10px">
          ${d.imageUrl ? `<img src="${esc(d.imageUrl)}" alt="" style="width:40px;height:40px;border-radius:50%;object-fit:cover">` : `<div style="width:40px;height:40px;border-radius:50%;background:var(--s3);display:flex;align-items:center;justify-content:center"><span class="mi" style="font-size:20px;color:var(--t3)">source</span></div>`}
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;font-size:.88rem">${d.profileUrl ? `<a href="${esc(d.profileUrl)}" target="_blank" style="color:var(--a);text-decoration:none">${esc(d.name || 'Source')}</a>` : esc(d.name || 'Source')}</div>
            ${d.type ? `<div style="font-size:.72rem;color:var(--t3)">${esc(d.type)}</div>` : ''}
          </div>
          ${d.credibility ? `<span style="font-size:.65rem;font-weight:700;color:${credColors[d.credibility] || 'var(--t3)'};text-transform:uppercase">${esc(d.credibility)}</span>` : ''}
        </div>
        ${d.context ? `<div style="font-size:.8rem;color:var(--t);margin-top:8px;line-height:1.6">${esc(d.context)}</div>` : ''}
        ${d.followers ? `<div style="font-size:.7rem;color:var(--t3);margin-top:4px">${esc(d.followers)} followers</div>` : ''}`;
      break;
    }

    default:
      inner = `${typeLabel}<div style="font-size:.82rem;color:var(--t2)">${JSON.stringify(d, null, 2).slice(0, 500)}</div>`;
  }

  return `<div class="card ${cardClass}"><div class="card-inner">${inner}</div></div>`;
}

function renderLlmTracesHtml(report) {
  const traces = report.llmTraces || [];
  const summary = report.llmTraceSummary || {};
  if (!traces.length) return '';

  const phaseColors = {
    classify: { bg: 'rgba(255,209,92,.1)', border: 'var(--y)', text: 'var(--y)', label: 'CLASSIFY' },
    design: { bg: 'rgba(108,159,255,.1)', border: 'var(--a)', text: 'var(--a)', label: 'DESIGN' },
    research: { bg: 'rgba(91,219,138,.1)', border: 'var(--g)', text: 'var(--g)', label: 'RESEARCH' },
  };

  const modelBadge = (model) => {
    const short = (model || 'unknown')
      .replace('claude-', '')
      .replace('-20250514', '')
      .replace('-latest', '');
    const isHaiku = model && model.includes('haiku');
    const isOpus = model && model.includes('opus');
    const isSonnet = model && model.includes('sonnet');
    const cls = isHaiku ? 'model-haiku' : isOpus ? 'model-opus' : isSonnet ? 'model-sonnet' : 'model-other';
    return `<span class="model-badge ${cls}">${esc(short)}</span>`;
  };

  let summaryHtml = '<div class="trace-summary">';
  summaryHtml += `<div class="trace-stat"><div class="trace-stat-val">${traces.length}</div><div class="trace-stat-label">LLM Calls</div></div>`;
  summaryHtml += `<div class="trace-stat"><div class="trace-stat-val">${(summary.models || []).length}</div><div class="trace-stat-label">Models Used</div></div>`;
  if (summary.totalInputTokens) {
    summaryHtml += `<div class="trace-stat"><div class="trace-stat-val">${(summary.totalInputTokens / 1000).toFixed(1)}k</div><div class="trace-stat-label">Input Tokens</div></div>`;
  }
  if (summary.totalOutputTokens) {
    summaryHtml += `<div class="trace-stat"><div class="trace-stat-val">${(summary.totalOutputTokens / 1000).toFixed(1)}k</div><div class="trace-stat-label">Output Tokens</div></div>`;
  }
  if (summary.totalLlmDuration) {
    summaryHtml += `<div class="trace-stat"><div class="trace-stat-val">${fmtMs(summary.totalLlmDuration)}</div><div class="trace-stat-label">Total LLM Time</div></div>`;
  }
  summaryHtml += '</div>';

  if (summary.models && summary.models.length) {
    summaryHtml += '<div class="trace-models">';
    for (const m of summary.models) {
      summaryHtml += modelBadge(m);
    }
    summaryHtml += '</div>';
  }

  let tracesHtml = '';
  traces.forEach((t, i) => {
    const pc = phaseColors[t.phase] || phaseColors.research;
    const usage = t.response?.usage;
    const hasError = !!t.error;

    tracesHtml += `<div class="trace-entry${hasError ? ' trace-error' : ''}" id="trace-${i}">`;

    // Header row
    tracesHtml += `<div class="trace-header" onclick="toggleTrace(${i})">`;
    tracesHtml += `<div class="trace-header-left">`;
    tracesHtml += `<span class="trace-phase" style="background:${pc.bg};color:${pc.text};border-color:${pc.border}">${pc.label}</span>`;
    tracesHtml += modelBadge(t.model);
    tracesHtml += `<span class="trace-agent">${esc(t.agent)}</span>`;
    if (t.cardId) tracesHtml += `<span class="trace-card-id">${esc(t.cardId)}</span>`;
    tracesHtml += `</div>`;
    tracesHtml += `<div class="trace-header-right">`;
    tracesHtml += `<span class="trace-dur">${fmtMs(t.duration)}</span>`;
    if (usage) tracesHtml += `<span class="trace-tokens">${(usage.input_tokens || 0) + (usage.output_tokens || 0)} tok</span>`;
    tracesHtml += `<span class="trace-chevron mi" id="chev-${i}">expand_more</span>`;
    tracesHtml += `</div></div>`;

    // Collapsible detail body
    tracesHtml += `<div class="trace-body" id="tbody-${i}" style="display:none">`;

    // Metadata
    tracesHtml += '<div class="trace-meta-grid">';
    tracesHtml += `<div class="trace-meta-item"><span class="trace-meta-k">Time</span><span class="trace-meta-v">${esc(t.timestamp)}</span></div>`;
    tracesHtml += `<div class="trace-meta-item"><span class="trace-meta-k">Pipeline Offset</span><span class="trace-meta-v">+${fmtMs(t.pipelineOffset)}</span></div>`;
    tracesHtml += `<div class="trace-meta-item"><span class="trace-meta-k">Duration</span><span class="trace-meta-v">${fmtMs(t.duration)}</span></div>`;
    tracesHtml += `<div class="trace-meta-item"><span class="trace-meta-k">Model</span><span class="trace-meta-v">${esc(t.model)}</span></div>`;
    if (usage) {
      tracesHtml += `<div class="trace-meta-item"><span class="trace-meta-k">Input Tokens</span><span class="trace-meta-v">${usage.input_tokens || 0}</span></div>`;
      tracesHtml += `<div class="trace-meta-item"><span class="trace-meta-k">Output Tokens</span><span class="trace-meta-v">${usage.output_tokens || 0}</span></div>`;
    }
    if (t.response?.stopReason) {
      tracesHtml += `<div class="trace-meta-item"><span class="trace-meta-k">Stop Reason</span><span class="trace-meta-v">${esc(t.response.stopReason)}</span></div>`;
    }
    if (t.cardType) {
      tracesHtml += `<div class="trace-meta-item"><span class="trace-meta-k">Card Type</span><span class="trace-meta-v">${esc(t.cardType)}</span></div>`;
    }
    tracesHtml += '</div>';

    // Error
    if (hasError) {
      tracesHtml += `<div class="trace-section trace-error-box"><div class="trace-section-title">Error</div><pre class="trace-pre trace-pre-error">${esc(t.error)}</pre></div>`;
    }

    // Request: prompt
    if (t.request?.userPrompt) {
      tracesHtml += '<div class="trace-section">';
      tracesHtml += `<div class="trace-section-title"><span class="mi" style="font-size:14px">arrow_upward</span> Prompt${t.request.hasImage ? ' <span class="trace-img-badge">+ IMAGE</span>' : ''}</div>`;
      tracesHtml += `<pre class="trace-pre trace-pre-prompt">${esc(t.request.userPrompt)}</pre>`;
      tracesHtml += '</div>';
    }

    if (t.request?.systemPrompt) {
      tracesHtml += '<div class="trace-section">';
      tracesHtml += '<div class="trace-section-title"><span class="mi" style="font-size:14px">settings</span> System Prompt</div>';
      tracesHtml += `<pre class="trace-pre trace-pre-system">${esc(t.request.systemPrompt)}</pre>`;
      tracesHtml += '</div>';
    }

    // Response: output
    if (t.response?.text) {
      tracesHtml += '<div class="trace-section">';
      tracesHtml += '<div class="trace-section-title"><span class="mi" style="font-size:14px">arrow_downward</span> Output</div>';
      tracesHtml += `<pre class="trace-pre trace-pre-output">${esc(t.response.text)}</pre>`;
      tracesHtml += '</div>';
    }

    // Tool calls (if any)
    if (t.toolCalls && t.toolCalls.length > 0) {
      tracesHtml += '<div class="trace-section">';
      tracesHtml += `<div class="trace-section-title"><span class="mi" style="font-size:14px">build</span> Tool Calls (${t.toolCalls.length})</div>`;
      t.toolCalls.forEach((tc, j) => {
        tracesHtml += `<div class="trace-tool-call">`;
        tracesHtml += `<div class="trace-tool-name">${esc(tc.name || 'tool_' + j)}</div>`;
        if (tc.input) tracesHtml += `<pre class="trace-pre trace-pre-tool">${esc(typeof tc.input === 'string' ? tc.input : JSON.stringify(tc.input, null, 2))}</pre>`;
        if (tc.output) tracesHtml += `<pre class="trace-pre trace-pre-output">${esc(typeof tc.output === 'string' ? tc.output : JSON.stringify(tc.output, null, 2))}</pre>`;
        tracesHtml += '</div>';
      });
      tracesHtml += '</div>';
    }

    tracesHtml += '</div></div>';
  });

  return summaryHtml + '<div class="trace-timeline">' + tracesHtml + '</div>';
}

module.exports = { renderCardHtml, renderReflection, renderLlmTracesHtml, esc, fmtMs };
