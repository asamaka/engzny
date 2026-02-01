/**
 * Orchestrator Agent
 * 
 * Central coordinator for the GIUE (Generative Intent-UI Engine).
 * Manages the pipeline from screenshot analysis to HTML generation.
 * 
 * Responsibilities:
 * - Establish Global Context Manifest (CSS variables, layout constraints)
 * - Coordinate Vision Analysis for hotspot detection
 * - Manage HTML/CSS generation
 * - Future: Coordinate parallel Segment Agents
 */

const { analyzeScreenshot } = require('../generators/vision-analyzer');
const { generateHTML, generateHTMLStream } = require('../generators/html-generator');
const { createStyleManifest } = require('../generators/style-manager');

/**
 * Global Context Manifest
 * Contains all shared styling and layout information for component generation
 */
class GlobalContextManifest {
  constructor(analysis) {
    this.viewport = analysis.viewport;
    this.layoutType = analysis.layoutType;
    this.contentContext = analysis.contentContext;
    this.dominantColors = analysis.dominantColors;
    this.styles = createStyleManifest(analysis);
    this.timestamp = new Date().toISOString();
  }
  
  /**
   * Get CSS variables for the manifest
   */
  getCSSVariables() {
    return this.styles.cssVariables;
  }
  
  /**
   * Get layout constraints
   */
  getLayoutConstraints() {
    return {
      type: this.layoutType,
      viewport: this.viewport,
      gridColumns: this.styles.gridColumns,
      gap: this.styles.gap,
    };
  }
  
  /**
   * Serialize for client transmission
   */
  toJSON() {
    return {
      viewport: this.viewport,
      layoutType: this.layoutType,
      contentContext: this.contentContext,
      styles: this.styles,
      timestamp: this.timestamp,
    };
  }
}

/**
 * Orchestrator Agent
 * Coordinates the entire GIUE pipeline
 */
class Orchestrator {
  constructor(config = {}) {
    this.config = {
      maxHotspots: config.maxHotspots || 10,
      includeNoiseRegions: config.includeNoiseRegions || false,
      streamHTML: config.streamHTML !== false,
      ...config,
    };
    
    this.manifest = null;
    this.analysis = null;
    this.status = 'idle';
  }
  
  /**
   * Process a screenshot through the full pipeline
   * @param {Object} options
   * @param {string} options.imageData - Base64 encoded image
   * @param {string} options.mediaType - MIME type
   * @param {Function} options.onProgress - Progress callback
   * @returns {Promise<Object>} Generated canvas data
   */
  async process({ imageData, mediaType, onProgress }) {
    this.status = 'analyzing';
    
    try {
      // Step 1: Vision Analysis
      if (onProgress) onProgress({ stage: 'analyzing', progress: 10, message: 'Analyzing screenshot...' });
      
      this.analysis = await analyzeScreenshot({
        imageData,
        mediaType,
        adapterConfig: this.config.adapterConfig,
      });
      
      if (onProgress) onProgress({ stage: 'analyzing', progress: 40, message: 'Detected hotspots' });
      
      // Step 2: Create Global Context Manifest
      this.manifest = new GlobalContextManifest(this.analysis);
      
      if (onProgress) onProgress({ stage: 'generating', progress: 50, message: 'Creating style manifest...' });
      
      // Step 3: Generate HTML
      this.status = 'generating';
      
      const hotspots = this.analysis.hotspots.slice(0, this.config.maxHotspots);
      const noiseRegions = this.config.includeNoiseRegions ? this.analysis.noiseRegions : [];
      
      const html = await generateHTML({
        manifest: this.manifest,
        hotspots,
        noiseRegions,
        originalImage: { data: imageData, mediaType },
      });
      
      if (onProgress) onProgress({ stage: 'complete', progress: 100, message: 'Canvas ready' });
      
      this.status = 'complete';
      
      return {
        html,
        manifest: this.manifest.toJSON(),
        analysis: {
          hotspotsCount: this.analysis.hotspots.length,
          layoutType: this.analysis.layoutType,
          contentContext: this.analysis.contentContext,
        },
      };
      
    } catch (error) {
      this.status = 'error';
      throw error;
    }
  }
  
  /**
   * Process with streaming HTML output
   * @param {Object} options
   * @param {string} options.imageData - Base64 encoded image
   * @param {string} options.mediaType - MIME type
   * @param {Function} options.onChunk - Callback for each HTML chunk
   * @param {Function} options.onProgress - Progress callback
   * @param {Function} options.onComplete - Completion callback
   * @param {Function} options.onError - Error callback
   */
  async processStream({ imageData, mediaType, onChunk, onProgress, onComplete, onError }) {
    this.status = 'analyzing';
    console.log('[Orchestrator] Starting processStream');
    
    try {
      // Step 1: Vision Analysis
      if (onProgress) onProgress({ stage: 'analyzing', progress: 10, message: 'Analyzing screenshot...' });
      
      console.log('[Orchestrator] Starting vision analysis...');
      this.analysis = await analyzeScreenshot({
        imageData,
        mediaType,
        adapterConfig: this.config.adapterConfig,
      });
      console.log('[Orchestrator] Vision analysis complete, hotspots:', this.analysis.hotspots?.length);
      
      if (onProgress) onProgress({ stage: 'analyzing', progress: 40, message: `Found ${this.analysis.hotspots.length} intent hotspots` });
      
      // Step 2: Create Global Context Manifest
      this.manifest = new GlobalContextManifest(this.analysis);
      
      if (onProgress) onProgress({ stage: 'generating', progress: 50, message: 'Generating canvas...' });
      
      // Send manifest first
      if (onChunk) {
        onChunk({
          type: 'manifest',
          data: this.manifest.toJSON(),
        });
      }
      
      // Step 3: Stream HTML generation
      this.status = 'generating';
      
      const hotspots = this.analysis.hotspots.slice(0, this.config.maxHotspots);
      const noiseRegions = this.config.includeNoiseRegions ? this.analysis.noiseRegions : [];
      
      await generateHTMLStream({
        manifest: this.manifest,
        hotspots,
        noiseRegions,
        originalImage: { data: imageData, mediaType },
        onChunk: (chunk) => {
          if (onChunk) onChunk({ type: 'html', data: chunk });
        },
        onProgress: (p) => {
          if (onProgress) onProgress({ 
            stage: 'generating', 
            progress: 50 + (p * 0.5), 
            message: 'Building canvas...' 
          });
        },
      });
      
      this.status = 'complete';
      
      if (onComplete) {
        await onComplete({
          manifest: this.manifest.toJSON(),
          analysis: {
            hotspotsCount: this.analysis.hotspots.length,
            layoutType: this.analysis.layoutType,
            contentContext: this.analysis.contentContext,
          },
        });
      }
      
    } catch (error) {
      this.status = 'error';
      if (onError) {
        await onError(error);
      } else {
        throw error;
      }
    }
  }
  
  /**
   * Get current status
   */
  getStatus() {
    return {
      status: this.status,
      hasManifest: !!this.manifest,
      hasAnalysis: !!this.analysis,
      hotspotsCount: this.analysis?.hotspots?.length || 0,
    };
  }
  
  /**
   * Get the analysis result
   */
  getAnalysis() {
    return this.analysis;
  }
  
  /**
   * Get the manifest
   */
  getManifest() {
    return this.manifest;
  }
}

/**
 * Create a new Orchestrator instance
 * @param {Object} config - Configuration options
 * @returns {Orchestrator}
 */
function createOrchestrator(config = {}) {
  return new Orchestrator(config);
}

module.exports = {
  Orchestrator,
  GlobalContextManifest,
  createOrchestrator,
};
