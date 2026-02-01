/**
 * HTML Generator
 * 
 * Transforms hotspot analysis data into spatial, interactive HTML/CSS.
 * Generates a minimalist canvas that maintains the original screenshot's
 * layout while replacing content with actionable components.
 */

const { generateBaseCSS } = require('./style-manager');

/**
 * Escape HTML entities
 * @param {string} text - Raw text
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Generate HTML for a single hotspot
 * @param {Object} hotspot - Hotspot data
 * @param {number} index - Index for staggered animation
 * @returns {string} HTML string
 */
function generateHotspotHTML(hotspot, index) {
  const { id, bounds, type, contentSummary, extractedText, predictedQuestion, priority, investigatable } = hotspot;
  
  const priorityClass = priority === 'high' ? 'giue-hotspot--high' : '';
  const animDelay = index * 0.1;
  
  // Position hotspot at center of its detected region
  const centerX = bounds.x + (bounds.width / 2);
  const centerY = bounds.y + (bounds.height / 2);
  
  const style = [
    `left: ${Math.min(centerX, 70)}%`,
    `top: ${bounds.y}%`,
    `z-index: ${50 - index}`,
    `animation-delay: ${animDelay}s`,
  ].join('; ');
  
  const ctaButton = investigatable 
    ? `<button class="giue-hotspot__cta" data-hotspot-id="${escapeHtml(id)}" data-action="investigate">
        <span>investigate</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"></circle>
          <path d="M21 21l-4.35-4.35"></path>
        </svg>
      </button>`
    : '';
  
  // Truncate long text
  const shortSummary = contentSummary && contentSummary.length > 100 
    ? contentSummary.slice(0, 100) + '...' 
    : contentSummary;
  const shortText = extractedText && extractedText.length > 80 
    ? extractedText.slice(0, 80) + '...' 
    : extractedText;
  
  return `
  <div 
    class="giue-hotspot ${priorityClass} giue-hotspot--${type}" 
    id="${escapeHtml(id)}"
    data-hotspot-type="${escapeHtml(type)}"
    data-priority="${escapeHtml(priority)}"
    data-investigatable="${investigatable}"
    style="${style}"
  >
    <span class="giue-type-badge">${escapeHtml(type.replace(/_/g, ' '))}</span>
    ${shortSummary ? `<div class="giue-hotspot__content">${escapeHtml(shortSummary)}</div>` : ''}
    ${shortText ? `<div class="giue-hotspot__text">${escapeHtml(shortText)}</div>` : ''}
    ${predictedQuestion ? `<div class="giue-hotspot__question">"${escapeHtml(predictedQuestion)}"</div>` : ''}
    ${ctaButton}
  </div>`;
}

/**
 * Generate HTML for a noise region placeholder
 * @param {Object} region - Noise region data
 * @returns {string} HTML string
 */
function generateNoiseRegionHTML(region) {
  const { id, bounds, type } = region;
  
  const style = [
    `left: ${bounds.x}%`,
    `top: ${bounds.y}%`,
    `width: ${bounds.width}%`,
    `height: ${bounds.height}%`,
  ].join('; ');
  
  return `
  <div 
    class="giue-noise giue-noise--${type}" 
    id="${escapeHtml(id)}"
    data-noise-type="${escapeHtml(type)}"
    style="${style}"
    title="${escapeHtml(type)} (filtered)"
  ></div>`;
}

/**
 * Generate the context bar HTML
 * @param {Object} manifest - Style manifest
 * @param {number} hotspotCount - Number of hotspots
 * @returns {string} HTML string
 */
function generateContextBar(manifest, hotspotCount) {
  const context = manifest.contentContext || 'Screenshot analysis';
  
  return `
  <div class="giue-context-bar">
    <a href="/" class="giue-back-link">← thinx.fun</a>
    <span class="giue-context-bar__title">${escapeHtml(context)}</span>
    <span>${hotspotCount} hotspot${hotspotCount !== 1 ? 's' : ''}</span>
  </div>`;
}

/**
 * Generate the client-side JavaScript
 * @returns {string} JavaScript code
 */
function generateClientScript() {
  return `
  <script>
    // GIUE Canvas Client
    (function() {
      // Handle investigate button clicks
      document.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action="investigate"]');
        if (btn) {
          const hotspotId = btn.dataset.hotspotId;
          const hotspot = document.getElementById(hotspotId);
          
          // Visual feedback
          btn.textContent = 'researching...';
          btn.disabled = true;
          
          // Dispatch custom event for future research integration
          window.dispatchEvent(new CustomEvent('giue:investigate', {
            detail: {
              hotspotId,
              type: hotspot?.dataset.hotspotType,
              element: hotspot,
            }
          }));
          
          // For MVP, show a placeholder message
          setTimeout(() => {
            btn.innerHTML = '<span>investigate</span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><path d="M21 21l-4.35-4.35"></path></svg>';
            btn.disabled = false;
            
            // Create research panel (MVP placeholder)
            showResearchPlaceholder(hotspot, hotspotId);
          }, 1500);
        }
      });
      
      // Hotspot hover effects
      document.querySelectorAll('.giue-hotspot').forEach(hotspot => {
        hotspot.addEventListener('mouseenter', () => {
          hotspot.style.zIndex = '50';
        });
        hotspot.addEventListener('mouseleave', () => {
          hotspot.style.zIndex = '';
        });
      });
      
      // Show research placeholder panel
      function showResearchPlaceholder(hotspot, id) {
        // Remove existing panel
        const existing = document.querySelector('.giue-research-panel');
        if (existing) existing.remove();
        
        const panel = document.createElement('div');
        panel.className = 'giue-research-panel';
        panel.innerHTML = \`
          <div class="giue-research-panel__header">
            <span>Research: \${id}</span>
            <button class="giue-research-panel__close">×</button>
          </div>
          <div class="giue-research-panel__content">
            <p>Deep-dive research will appear here in a future update.</p>
            <p style="color: var(--giue-accent); margin-top: 1em;">
              This feature will integrate with Perplexity or similar research APIs 
              to fact-check claims and provide additional context.
            </p>
          </div>
        \`;
        
        // Position near hotspot
        const rect = hotspot.getBoundingClientRect();
        panel.style.position = 'fixed';
        panel.style.top = Math.min(rect.bottom + 10, window.innerHeight - 200) + 'px';
        panel.style.left = Math.max(10, Math.min(rect.left, window.innerWidth - 320)) + 'px';
        
        document.body.appendChild(panel);
        
        // Close button
        panel.querySelector('.giue-research-panel__close').onclick = () => panel.remove();
        
        // Auto-close after 10s
        setTimeout(() => panel.remove(), 10000);
      }
      
      // Keyboard navigation
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          const panel = document.querySelector('.giue-research-panel');
          if (panel) panel.remove();
        }
      });
      
      // Signal canvas ready
      window.dispatchEvent(new CustomEvent('giue:ready'));
      console.log('GIUE Canvas initialized');
    })();
  </script>`;
}

/**
 * Generate additional CSS for research panel
 * @returns {string} CSS string
 */
function generateResearchPanelCSS() {
  return `
  <style>
    .giue-research-panel {
      width: 300px;
      background: var(--giue-bg-secondary);
      border: 1px solid var(--giue-accent);
      border-radius: var(--giue-radius-lg);
      box-shadow: 0 10px 40px var(--giue-shadow);
      z-index: 1000;
      animation: giue-panel-in 0.2s ease;
    }
    
    @keyframes giue-panel-in {
      from {
        opacity: 0;
        transform: translateY(-10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
    
    .giue-research-panel__header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: var(--giue-space-sm) var(--giue-space-md);
      border-bottom: 1px solid var(--giue-border);
      font-size: var(--giue-font-size-sm);
      color: var(--giue-accent);
    }
    
    .giue-research-panel__close {
      background: none;
      border: none;
      color: var(--giue-text-muted);
      font-size: 18px;
      cursor: pointer;
      padding: 0 4px;
    }
    
    .giue-research-panel__close:hover {
      color: var(--giue-text-primary);
    }
    
    .giue-research-panel__content {
      padding: var(--giue-space-md);
      font-size: var(--giue-font-size-sm);
      color: var(--giue-text-secondary);
    }
    
    /* Hotspot entrance animation */
    .giue-hotspot {
      animation: giue-hotspot-in 0.4s ease backwards;
    }
    
    @keyframes giue-hotspot-in {
      from {
        opacity: 0;
        transform: scale(0.95);
      }
      to {
        opacity: 1;
        transform: scale(1);
      }
    }
  </style>`;
}

/**
 * Generate complete HTML document for the canvas
 * @param {Object} options
 * @param {Object} options.manifest - Global context manifest
 * @param {Array} options.hotspots - Hotspot data array
 * @param {Array} options.noiseRegions - Noise region data array
 * @param {Object} options.originalImage - Original image data (optional)
 * @returns {string} Complete HTML document
 */
function generateHTML({ manifest, hotspots, noiseRegions = [], originalImage = null }) {
  const baseCSS = generateBaseCSS(manifest.styles || manifest);
  const contextBar = generateContextBar(manifest, hotspots.length);
  const hotspotElements = hotspots.map((hs, i) => generateHotspotHTML(hs, i)).join('\n');
  const noiseElements = noiseRegions.map(nr => generateNoiseRegionHTML(nr)).join('\n');
  const researchCSS = generateResearchPanelCSS();
  const clientScript = generateClientScript();
  
  const imageDataUrl = originalImage 
    ? `data:${originalImage.mediaType};base64,${originalImage.data}`
    : '';
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Canvas - thinx.fun</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>${baseCSS}</style>
  ${researchCSS}
  <style>
    .giue-canvas-wrapper {
      position: relative;
      width: 100%;
      max-width: 1200px;
      margin: 70px auto 20px;
      padding: 0 20px;
    }
    
    .giue-screenshot-container {
      position: relative;
      width: 100%;
    }
    
    .giue-screenshot {
      width: 100%;
      height: auto;
      display: block;
      border-radius: 8px;
      opacity: 0.4;
      filter: brightness(0.7);
    }
    
    .giue-hotspots-layer {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
    }
    
    .giue-hotspot {
      pointer-events: auto;
      position: absolute;
      background: rgba(21, 21, 21, 0.95);
      backdrop-filter: blur(10px);
      border: 1px solid var(--giue-border);
      border-radius: var(--giue-radius-lg);
      padding: 12px 16px;
      max-width: 300px;
      min-width: 200px;
      transition: all 0.25s ease;
      cursor: pointer;
      box-shadow: 0 4px 20px rgba(0,0,0,0.5);
    }
    
    .giue-hotspot:hover {
      border-color: var(--giue-accent);
      box-shadow: 0 0 30px rgba(0, 255, 170, 0.3);
      transform: scale(1.02);
      z-index: 100 !important;
    }
    
    .giue-hotspot--high {
      border-color: var(--giue-accent-secondary);
    }
  </style>
</head>
<body>
  ${contextBar}
  
  <div class="giue-canvas-wrapper">
    <div class="giue-screenshot-container">
      ${originalImage ? `<img src="${imageDataUrl}" class="giue-screenshot" alt="Original screenshot">` : ''}
      <div class="giue-hotspots-layer">
        ${noiseElements}
        ${hotspotElements}
      </div>
    </div>
  </div>
  
  ${clientScript}
</body>
</html>`;
}

/**
 * Generate HTML in streaming chunks
 * @param {Object} options
 * @param {Object} options.manifest - Global context manifest
 * @param {Array} options.hotspots - Hotspot data array
 * @param {Array} options.noiseRegions - Noise region data array
 * @param {Object} options.originalImage - Original image data (optional)
 * @param {Function} options.onChunk - Callback for each chunk
 * @param {Function} options.onProgress - Progress callback
 * @returns {Promise<void>}
 */
async function generateHTMLStream({ manifest, hotspots, noiseRegions = [], originalImage = null, onChunk, onProgress }) {
  const baseCSS = generateBaseCSS(manifest.styles || manifest);
  const contextBar = generateContextBar(manifest, hotspots.length);
  const researchCSS = generateResearchPanelCSS();
  
  const imageDataUrl = originalImage 
    ? `data:${originalImage.mediaType};base64,${originalImage.data}`
    : '';
  
  // Stream the document head
  onChunk(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Canvas - thinx.fun</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>${baseCSS}</style>
  ${researchCSS}
  <style>
    .giue-canvas-wrapper {
      position: relative;
      width: 100%;
      max-width: 1200px;
      margin: 70px auto 20px;
      padding: 0 20px;
    }
    
    .giue-screenshot-container {
      position: relative;
      width: 100%;
    }
    
    .giue-screenshot {
      width: 100%;
      height: auto;
      display: block;
      border-radius: 8px;
      opacity: 0.4;
      filter: brightness(0.7);
    }
    
    .giue-hotspots-layer {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
    }
    
    .giue-hotspot {
      pointer-events: auto;
      position: absolute;
      background: rgba(21, 21, 21, 0.95);
      backdrop-filter: blur(10px);
      border: 1px solid var(--giue-border);
      border-radius: var(--giue-radius-lg);
      padding: 12px 16px;
      max-width: 300px;
      min-width: 200px;
      transition: all 0.25s ease;
      cursor: pointer;
      box-shadow: 0 4px 20px rgba(0,0,0,0.5);
    }
    
    .giue-hotspot:hover {
      border-color: var(--giue-accent);
      box-shadow: 0 0 30px rgba(0, 255, 170, 0.3);
      transform: scale(1.02);
      z-index: 100 !important;
    }
    
    .giue-hotspot--high {
      border-color: var(--giue-accent-secondary);
    }
  </style>
</head>
<body>
  ${contextBar}
  <div class="giue-canvas-wrapper">
    <div class="giue-screenshot-container">
      ${originalImage ? `<img src="${imageDataUrl}" class="giue-screenshot" alt="Original screenshot">` : ''}
      <div class="giue-hotspots-layer">`);
  
  if (onProgress) onProgress(0.2);
  
  // Stream noise regions
  for (const nr of noiseRegions) {
    onChunk(generateNoiseRegionHTML(nr));
    await delay(10);
  }
  
  if (onProgress) onProgress(0.4);
  
  // Stream hotspots one by one
  const total = hotspots.length;
  for (let i = 0; i < total; i++) {
    onChunk(generateHotspotHTML(hotspots[i], i));
    if (onProgress) onProgress(0.4 + (0.5 * (i + 1) / total));
    await delay(50);
  }
  
  // Stream closing tags and script
  const clientScript = generateClientScript();
  onChunk(`
      </div>
    </div>
  </div>
  ${clientScript}
</body>
</html>`);
  
  if (onProgress) onProgress(1);
}

/**
 * Simple delay helper
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  generateHTML,
  generateHTMLStream,
  generateHotspotHTML,
  generateNoiseRegionHTML,
  generateContextBar,
  generateClientScript,
  escapeHtml,
};
