/**
 * Style Manager
 * 
 * Creates and manages the Global Style Manifest for GIUE canvases.
 * Extracts theme information from screenshot analysis and generates
 * consistent CSS variables for all components.
 */

/**
 * Default style configuration
 */
const DEFAULT_STYLES = {
  // Base colors
  bgPrimary: '#0a0a0a',
  bgSecondary: '#151515',
  bgTertiary: '#1a1a1a',
  
  // Text colors
  textPrimary: '#e5e5e5',
  textSecondary: '#999999',
  textMuted: '#666666',
  
  // Accent colors
  accentPrimary: '#00ffaa',
  accentSecondary: '#00cc88',
  accentMuted: 'rgba(0, 255, 170, 0.15)',
  
  // UI colors
  borderColor: '#2a2a2a',
  borderColorHover: '#3a3a3a',
  shadowColor: 'rgba(0, 0, 0, 0.5)',
  
  // Typography
  fontFamily: "'JetBrains Mono', 'IBM Plex Mono', monospace",
  fontSizeBase: '14px',
  fontSizeSmall: '12px',
  fontSizeLarge: '16px',
  lineHeight: '1.6',
  
  // Spacing
  spacingXs: '4px',
  spacingSm: '8px',
  spacingMd: '16px',
  spacingLg: '24px',
  spacingXl: '32px',
  
  // Borders
  borderRadius: '4px',
  borderRadiusLg: '8px',
  borderWidth: '1px',
  
  // Transitions
  transitionFast: '0.15s ease',
  transitionNormal: '0.25s ease',
  transitionSlow: '0.4s ease',
  
  // Layout
  gridColumns: 12,
  gap: '16px',
};

/**
 * Map of layout types to grid configurations
 */
const LAYOUT_GRID_MAP = {
  single_column: { columns: 1, gap: '24px' },
  two_column: { columns: 2, gap: '20px' },
  grid: { columns: 3, gap: '16px' },
  feed: { columns: 1, gap: '16px' },
  dashboard: { columns: 4, gap: '12px' },
  article: { columns: 1, gap: '20px' },
  product_page: { columns: 2, gap: '24px' },
  social_feed: { columns: 1, gap: '12px' },
  other: { columns: 1, gap: '16px' },
};

/**
 * Extract dominant color properties
 * @param {string} hexColor - Hex color string
 * @returns {Object} Color properties
 */
function analyzeColor(hexColor) {
  // Convert hex to RGB
  const hex = hexColor.replace('#', '');
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);
  
  // Calculate luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  
  // Calculate saturation (simplified HSL)
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const saturation = max === 0 ? 0 : (max - min) / max;
  
  return {
    hex: hexColor,
    r, g, b,
    luminance,
    saturation,
    isDark: luminance < 0.5,
    isVibrant: saturation > 0.5,
  };
}

/**
 * Generate a lighter/darker variant of a color
 * @param {string} hexColor - Base color
 * @param {number} factor - Lighten (positive) or darken (negative) factor
 * @returns {string} New hex color
 */
function adjustColor(hexColor, factor) {
  const hex = hexColor.replace('#', '');
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);
  
  const adjust = (c) => {
    if (factor > 0) {
      return Math.round(c + (255 - c) * factor);
    }
    return Math.round(c * (1 + factor));
  };
  
  const nr = Math.min(255, Math.max(0, adjust(r)));
  const ng = Math.min(255, Math.max(0, adjust(g)));
  const nb = Math.min(255, Math.max(0, adjust(b)));
  
  return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`;
}

/**
 * Create an RGBA color from hex with alpha
 * @param {string} hexColor - Hex color
 * @param {number} alpha - Alpha value (0-1)
 * @returns {string} RGBA color string
 */
function hexToRgba(hexColor, alpha) {
  const hex = hexColor.replace('#', '');
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Create a style manifest from analysis data
 * @param {Object} analysis - Vision analysis result
 * @returns {Object} Style manifest
 */
function createStyleManifest(analysis) {
  const colors = (analysis.dominantColors || []).map(analyzeColor);
  const layoutType = analysis.layoutType || 'other';
  const gridConfig = LAYOUT_GRID_MAP[layoutType] || LAYOUT_GRID_MAP.other;
  
  // Find accent color (most vibrant)
  const accentColor = colors.find(c => c.isVibrant) || colors[0];
  
  // Find background color (darkest)
  const bgColor = colors.reduce((darkest, c) => 
    (!darkest || c.luminance < darkest.luminance) ? c : darkest, null);
  
  // Find text color (lightest)
  const textColor = colors.reduce((lightest, c) => 
    (!lightest || c.luminance > lightest.luminance) ? c : lightest, null);
  
  // Build CSS variables object
  const cssVariables = {
    // Colors from analysis or defaults
    '--giue-bg-primary': bgColor?.hex || DEFAULT_STYLES.bgPrimary,
    '--giue-bg-secondary': bgColor ? adjustColor(bgColor.hex, 0.1) : DEFAULT_STYLES.bgSecondary,
    '--giue-bg-tertiary': bgColor ? adjustColor(bgColor.hex, 0.15) : DEFAULT_STYLES.bgTertiary,
    
    '--giue-text-primary': textColor?.hex || DEFAULT_STYLES.textPrimary,
    '--giue-text-secondary': textColor ? adjustColor(textColor.hex, -0.3) : DEFAULT_STYLES.textSecondary,
    '--giue-text-muted': textColor ? adjustColor(textColor.hex, -0.5) : DEFAULT_STYLES.textMuted,
    
    '--giue-accent': accentColor?.hex || DEFAULT_STYLES.accentPrimary,
    '--giue-accent-secondary': accentColor ? adjustColor(accentColor.hex, -0.2) : DEFAULT_STYLES.accentSecondary,
    '--giue-accent-muted': accentColor ? hexToRgba(accentColor.hex, 0.15) : DEFAULT_STYLES.accentMuted,
    
    '--giue-border': DEFAULT_STYLES.borderColor,
    '--giue-border-hover': DEFAULT_STYLES.borderColorHover,
    '--giue-shadow': DEFAULT_STYLES.shadowColor,
    
    // Typography
    '--giue-font': DEFAULT_STYLES.fontFamily,
    '--giue-font-size': DEFAULT_STYLES.fontSizeBase,
    '--giue-font-size-sm': DEFAULT_STYLES.fontSizeSmall,
    '--giue-font-size-lg': DEFAULT_STYLES.fontSizeLarge,
    '--giue-line-height': DEFAULT_STYLES.lineHeight,
    
    // Spacing
    '--giue-space-xs': DEFAULT_STYLES.spacingXs,
    '--giue-space-sm': DEFAULT_STYLES.spacingSm,
    '--giue-space-md': DEFAULT_STYLES.spacingMd,
    '--giue-space-lg': DEFAULT_STYLES.spacingLg,
    '--giue-space-xl': DEFAULT_STYLES.spacingXl,
    
    // Borders
    '--giue-radius': DEFAULT_STYLES.borderRadius,
    '--giue-radius-lg': DEFAULT_STYLES.borderRadiusLg,
    
    // Transitions
    '--giue-transition-fast': DEFAULT_STYLES.transitionFast,
    '--giue-transition': DEFAULT_STYLES.transitionNormal,
    '--giue-transition-slow': DEFAULT_STYLES.transitionSlow,
    
    // Layout
    '--giue-grid-columns': gridConfig.columns,
    '--giue-gap': gridConfig.gap,
  };
  
  return {
    cssVariables,
    dominantColors: colors.map(c => c.hex),
    gridColumns: gridConfig.columns,
    gap: gridConfig.gap,
    layoutType,
    theme: bgColor?.isDark ? 'dark' : 'light',
    accentHex: accentColor?.hex || DEFAULT_STYLES.accentPrimary,
  };
}

/**
 * Generate CSS string from variables object
 * @param {Object} variables - CSS variables object
 * @returns {string} CSS string
 */
function generateCSSString(variables) {
  const varEntries = Object.entries(variables)
    .map(([key, value]) => `  ${key}: ${value};`)
    .join('\n');
  
  return `:root {\n${varEntries}\n}`;
}

/**
 * Generate full base CSS for GIUE canvases
 * @param {Object} manifest - Style manifest
 * @returns {string} Complete CSS string
 */
function generateBaseCSS(manifest) {
  const vars = generateCSSString(manifest.cssVariables);
  
  return `${vars}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body {
  height: 100%;
  overflow: hidden;
}

body {
  font-family: var(--giue-font);
  font-size: var(--giue-font-size);
  line-height: var(--giue-line-height);
  background: var(--giue-bg-primary);
  color: var(--giue-text-primary);
}

.giue-canvas {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: auto;
}

.giue-hotspot {
  position: absolute;
  background: var(--giue-bg-secondary);
  border: 1px solid var(--giue-border);
  border-radius: var(--giue-radius);
  padding: var(--giue-space-md);
  transition: all var(--giue-transition);
  cursor: pointer;
  overflow: hidden;
}

.giue-hotspot:hover {
  border-color: var(--giue-accent);
  box-shadow: 0 0 20px var(--giue-accent-muted);
  transform: translateY(-2px);
}

.giue-hotspot--high {
  border-color: var(--giue-accent-secondary);
}

.giue-hotspot__content {
  font-size: var(--giue-font-size-sm);
  color: var(--giue-text-secondary);
  margin-bottom: var(--giue-space-sm);
}

.giue-hotspot__text {
  font-size: var(--giue-font-size);
  color: var(--giue-text-primary);
  margin-bottom: var(--giue-space-md);
}

.giue-hotspot__question {
  font-size: var(--giue-font-size-sm);
  color: var(--giue-text-muted);
  font-style: italic;
  margin-bottom: var(--giue-space-sm);
}

.giue-hotspot__cta {
  display: inline-flex;
  align-items: center;
  gap: var(--giue-space-xs);
  padding: var(--giue-space-xs) var(--giue-space-sm);
  background: var(--giue-accent-muted);
  color: var(--giue-accent);
  border: 1px solid var(--giue-accent);
  border-radius: var(--giue-radius);
  font-size: var(--giue-font-size-sm);
  cursor: pointer;
  transition: all var(--giue-transition-fast);
  font-family: inherit;
}

.giue-hotspot__cta:hover {
  background: var(--giue-accent);
  color: var(--giue-bg-primary);
}

.giue-noise {
  position: absolute;
  background: var(--giue-bg-tertiary);
  border: 1px dashed var(--giue-border);
  border-radius: var(--giue-radius);
  opacity: 0.3;
  pointer-events: none;
}

.giue-type-badge {
  display: inline-block;
  padding: 2px 6px;
  background: var(--giue-bg-tertiary);
  border-radius: 2px;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--giue-text-muted);
  margin-bottom: var(--giue-space-xs);
}

.giue-loading {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--giue-bg-primary);
  z-index: 1000;
}

.giue-loading__spinner {
  width: 40px;
  height: 40px;
  border: 2px solid var(--giue-border);
  border-top-color: var(--giue-accent);
  border-radius: 50%;
  animation: giue-spin 0.8s linear infinite;
}

@keyframes giue-spin {
  to { transform: rotate(360deg); }
}

.giue-context-bar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  padding: var(--giue-space-sm) var(--giue-space-md);
  background: var(--giue-bg-secondary);
  border-bottom: 1px solid var(--giue-border);
  font-size: var(--giue-font-size-sm);
  color: var(--giue-text-muted);
  z-index: 100;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.giue-context-bar__title {
  color: var(--giue-text-primary);
}

.giue-back-link {
  color: var(--giue-text-muted);
  text-decoration: none;
  transition: color var(--giue-transition-fast);
}

.giue-back-link:hover {
  color: var(--giue-accent);
}`;
}

module.exports = {
  createStyleManifest,
  generateCSSString,
  generateBaseCSS,
  DEFAULT_STYLES,
  analyzeColor,
  adjustColor,
  hexToRgba,
};
