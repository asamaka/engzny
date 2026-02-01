require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const Anthropic = require('@anthropic-ai/sdk').default;
const sharp = require('sharp');
const { GeminiAdapter } = require('./llm/gemini');

const app = express();

// In-memory job storage (fallback when Redis is not configured)
// For production, configure UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN
const jobStore = new Map();

// Job status constants with clear progression
const JOB_STATUS = {
  QUEUED: 'queued',           // Image uploaded, waiting to start
  PROCESSING: 'processing',   // Job started, preparing request
  WAITING_LLM: 'waiting_llm', // Waiting for LLM to start responding
  STREAMING: 'streaming',     // LLM is streaming tokens
  COMPLETED: 'completed',     // Analysis complete
  FAILED: 'failed',           // Error occurred
};

// Progress messages for each status
const PROGRESS_MESSAGES = {
  [JOB_STATUS.QUEUED]: 'Image uploaded, waiting to process...',
  [JOB_STATUS.PROCESSING]: 'Starting AI analysis...',
  [JOB_STATUS.WAITING_LLM]: 'Waiting for Claude AI response...',
  [JOB_STATUS.STREAMING]: 'Claude is analyzing your image...',
  [JOB_STATUS.COMPLETED]: 'Analysis complete!',
  [JOB_STATUS.FAILED]: 'Analysis failed',
};

// Redis client (lazy loaded)
let redis = null;
const getRedis = async () => {
  if (redis) return redis;
  
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    const { Redis } = require('@upstash/redis');
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
    return redis;
  }
  
  return null;
};

// Storage abstraction
const storage = {
  async setJob(jobId, data, ttl = 3600) {
    const redis = await getRedis();
    if (redis) {
      await redis.setex(`job:${jobId}`, ttl, JSON.stringify(data));
    } else {
      jobStore.set(jobId, data);
    }
  },
  
  async getJob(jobId) {
    const redis = await getRedis();
    if (redis) {
      const data = await redis.get(`job:${jobId}`);
      return data ? (typeof data === 'string' ? JSON.parse(data) : data) : null;
    } else {
      return jobStore.get(jobId) || null;
    }
  },
  
  async updateJob(jobId, updates) {
    const job = await this.getJob(jobId);
    if (job) {
      const updated = { ...job, ...updates };
      await this.setJob(jobId, updated);
      return updated;
    }
    return null;
  },
};

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  },
});

// Initialize Anthropic client
const getAnthropicClient = () => {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY environment variable is not set');
  }
  return new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });
};

// Middleware
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '..', 'public')));
// Deprecated v1 snapshot
app.use('/v1', express.static(path.join(__dirname, '..', 'v1', 'public')));

// Paste page (for clipboard integration with Shortcuts)
app.get('/paste', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'paste.html'));
});

// Scan page (for URL image testing - hash fragment method)
app.get('/scan', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'scan.html'));
});

// ============================================
// Scan API - POST image, get code, view with scanning animation
// ============================================

// Generate short code (6 chars)
function generateShortCode() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// POST /api/scan - Upload image, get code
app.post('/api/scan', async (req, res) => {
  try {
    const { image, mediaType } = req.body || {};
    
    if (!image) {
      return res.status(400).json({ error: 'No image provided' });
    }
    
    // Parse data URL if provided
    let base64Data = image;
    let mimeType = mediaType || 'image/jpeg';
    
    if (image.startsWith('data:')) {
      const matches = image.match(/^data:([^;]+);base64,(.+)$/);
      if (matches) {
        mimeType = matches[1];
        base64Data = matches[2];
      }
    }
    
    // Generate short code
    const code = generateShortCode();
    
    // Store image with 10 minute TTL
    await storage.setJob(`scan:${code}`, {
      imageData: base64Data,
      mediaType: mimeType,
      createdAt: new Date().toISOString(),
    }, 600); // 10 minutes
    
    res.json({
      success: true,
      code,
      url: `https://thinx.fun/s/${code}`,
    });
  } catch (error) {
    console.error('Scan upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/scan/:code - Get image data
app.get('/api/scan/:code', async (req, res) => {
  const { code } = req.params;
  const data = await storage.getJob(`scan:${code}`);
  
  if (!data) {
    return res.status(404).json({ error: 'Image not found or expired' });
  }
  
  res.json({
    imageData: data.imageData,
    mediaType: data.mediaType,
    dataUrl: `data:${data.mediaType};base64,${data.imageData}`,
  });
});

// GET /s/:code - View scan page with code
app.get('/s/:code', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'scan-view.html'));
});

// Main route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Deprecated v1 route
app.get('/v1', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'v1', 'public', 'index.html'));
});


// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================
// Screenshot Intelligence Hub (v2) Routes
// ============================================
const buildHubPrompt = (question) => {
  return `You are a helpful AI assistant that analyzes images to help users understand what they're looking at. 

Your first action must always be to call render_hero to define the context and stop the scanner.

Analyze this image thoroughly and provide your findings by calling the appropriate tools from the library:

1. **What You See**: A clear description of the main content in the image.
2. **Key Information**: Extract and highlight any important information visible (Text, Product names, News claims, Data, People/Places).
3. **Fact Check & Context**: Assess credibility for news, share details for products, explain statistics, and identify ad fine print.
4. **Helpful Insights**: Provide background info, things to be aware of, or related useful information.
${question ? `5. **User's Question**: The user specifically asked: "${question}". Address this question directly.\n` : ''}

Operational Rule: Be factual, helpful, and highlight anything the user should be cautious about (misleading claims, too-good-to-be-true offers, etc.). Translate these insights into tool calls to populate the user's dashboard.

Tool Library (return tool calls only):
- render_hero: { title, subtitle, badge, icon, hero_image }
- render_metric: { title, label, value, color, subtext }
- render_list: { title, items: [{ label, value, icon, active }] }
- render_grid: { cells: [{ label, value, icon, dark_mode }] }
- render_footer: { primary_btn: { label, icon }, secondary_btn: { icon } }

Return ONLY raw JSON (no markdown fences, no commentary) with this shape and no extra keys:
{
  "toolCalls": [
    { "tool": "render_hero", "args": { "title": "...", "subtitle": "...", "badge": "...", "icon": "...", "hero_image": "..." } },
    { "tool": "render_metric", "args": { "title": "...", "label": "...", "value": "...", "color": "...", "subtext": "..." } }
  ]
}

The first toolCalls entry must be render_hero.`;
};

const extractJsonPayload = (text) => {
  if (!text) return null;
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = match ? match[1] : text;
  let trimmed = candidate.trim();

  trimmed = trimmed.replace(/^\uFEFF/, '');
  trimmed = trimmed.replace(/```/g, '');
  trimmed = trimmed.replace(/^json\s*/i, '').trim();

  const tryParse = (value) => {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  };

  let parsed = tryParse(trimmed);
  if (parsed) return parsed;

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  const sliced = trimmed.slice(firstBrace, lastBrace + 1);
  const stripComments = (value) =>
    value.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

  parsed = tryParse(stripComments(sliced));
  if (parsed) return parsed;

  const withoutTrailingCommas = stripComments(sliced).replace(/,\s*([}\]])/g, '$1');
  parsed = tryParse(withoutTrailingCommas);
  if (parsed) return parsed;

  const withoutControlChars = withoutTrailingCommas.replace(/[\u0000-\u001F]+/g, ' ');
  return tryParse(withoutControlChars);
};

const normalizeImagePayload = ({ image, mediaType }) => {
  if (!image || typeof image !== 'string') {
    throw new Error('No image provided');
  }

  let base64Data = image.trim();
  let mimeType = mediaType || 'image/png';

  if (base64Data.startsWith('data:')) {
    const matches = base64Data.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) {
      throw new Error('Invalid data URL format');
    }
    mimeType = matches[1];
    base64Data = matches[2];
  }

  base64Data = base64Data.replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/]+=*$/.test(base64Data)) {
    throw new Error('Invalid base64 image data');
  }

  const buffer = Buffer.from(base64Data, 'base64');
  if (buffer.length > 20 * 1024 * 1024) {
    throw new Error('Image too large (max 20MB)');
  }

  const detectedType = detectMediaType(buffer);
  if (detectedType) {
    mimeType = detectedType;
  }

  return { imageData: base64Data, mediaType: mimeType };
};

app.post('/api/hub/analyze', async (req, res) => {
  try {
    const { image, question, mediaType } = req.body || {};
    const normalized = normalizeImagePayload({ image, mediaType });
    const adapter = new GeminiAdapter();
    const prompt = buildHubPrompt(question);
    const responseFormat = {
      type: 'object',
      properties: {
        toolCalls: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              tool: { type: 'string' },
              args: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  subtitle: { type: 'string' },
                  badge: { type: 'string' },
                  icon: { type: 'string' },
                  hero_image: { type: 'string' },
                  label: { type: 'string' },
                  value: { type: 'string' },
                  color: { type: 'string' },
                  subtext: { type: 'string' },
                  items: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        label: { type: 'string' },
                        value: { type: 'string' },
                        icon: { type: 'string' },
                        active: { type: 'boolean' },
                      },
                    },
                  },
                  cells: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        label: { type: 'string' },
                        value: { type: 'string' },
                        icon: { type: 'string' },
                        dark_mode: { type: 'boolean' },
                      },
                    },
                  },
                  primary_btn: {
                    type: 'object',
                    properties: {
                      label: { type: 'string' },
                      icon: { type: 'string' },
                    },
                  },
                  secondary_btn: {
                    type: 'object',
                    properties: {
                      icon: { type: 'string' },
                    },
                  },
                },
              },
            },
            required: ['tool', 'args'],
          },
        },
      },
      required: ['toolCalls'],
    };

    const result = await adapter.analyzeImage({
      imageData: normalized.imageData,
      mediaType: normalized.mediaType,
      prompt,
      responseFormat,
    });

    const parsed = extractJsonPayload(result.text);
    const toolCalls = Array.isArray(parsed?.toolCalls)
      ? parsed.toolCalls
      : [
          {
            tool: 'render_hero',
            args: {
              title: 'Analysis incomplete',
              subtitle: 'Gemini response could not be parsed',
              badge: 'Fallback',
              icon: '⚠️',
              hero_image: null,
            },
          },
          {
            tool: 'render_list',
            args: {
              title: 'Raw response',
              items: [
                {
                  label: 'Output',
                  value: (result.text || 'No output').slice(0, 140) + '...',
                  icon: '📝',
                  active: false,
                },
              ],
            },
          },
        ];

    res.json({
      success: true,
      toolCalls,
      model: result.model,
      usage: result.usage,
    });
  } catch (error) {
    console.error('Hub analyze error:', error);
    res.status(500).json({
      error: 'Analysis failed',
      message: error.message || 'An unexpected error occurred',
    });
  }
});

const getHubSampleFiles = () => {
  const sampleDir = path.join(__dirname, '..', 'screens');
  try {
    return fs.readdirSync(sampleDir)
      .filter((file) => /\.(png|jpe?g|webp|gif)$/i.test(file))
      .slice(0, 5);
  } catch {
    return [];
  }
};

app.get('/api/hub/samples', (req, res) => {
  const samples = getHubSampleFiles();
  res.json({ samples });
});

app.get('/api/hub/sample', (req, res) => {
  const samples = getHubSampleFiles();
  const requested = req.query.name;
  const file = requested && samples.includes(requested) ? requested : samples[0];

  if (!file) {
    return res.status(404).json({
      error: 'No samples available',
      message: 'No screenshot samples found in /screens.',
    });
  }

  const sampleDir = path.join(__dirname, '..', 'screens');
  const filePath = path.join(sampleDir, file);
  const buffer = fs.readFileSync(filePath);
  const mediaType = detectMediaType(buffer) || 'image/jpeg';

  res.json({
    name: file,
    dataUrl: `data:${mediaType};base64,${buffer.toString('base64')}`,
  });
});

// ============================================
// GIUE (Generative Intent-UI Engine) Routes
// ============================================
const { streamCanvasGeneration } = require('./generators/canvas-generator');

// GIUE job status constants
const GIUE_STATUS = {
  QUEUED: 'queued',
  ANALYZING: 'analyzing',
  GENERATING: 'generating',
  COMPLETED: 'completed',
  FAILED: 'failed',
};

// Canvas page route
app.get('/canvas', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'canvas.html'));
});

// Generate canvas from screenshot
app.post('/api/generate', upload.single('image'), async (req, res) => {
  console.log('[GIUE] /api/generate called');
  try {
    let imageData = null;
    let mediaType = null;

    // Check if this is a JSON request with base64 image
    if (req.is('application/json') || (req.body && req.body.image && typeof req.body.image === 'string')) {
      const body = req.body;
      
      if (!body.image) {
        return res.status(400).json({ error: 'No image provided', message: 'Please provide an image in base64 format' });
      }

      let base64Data = body.image;
      
      if (base64Data.startsWith('data:')) {
        const matches = base64Data.match(/^data:([^;]+);base64,(.+)$/);
        if (matches) {
          mediaType = matches[1];
          base64Data = matches[2];
        } else {
          return res.status(400).json({ error: 'Invalid image format', message: 'Could not parse data URL' });
        }
      } else {
        mediaType = body.mediaType || body.media_type || 'image/png';
      }

      imageData = base64Data;

    } else if (req.file) {
      imageData = req.file.buffer.toString('base64');
      mediaType = req.file.mimetype;
    } else {
      return res.status(400).json({ 
        error: 'No image uploaded',
        message: 'Please provide an image either as multipart form-data or JSON with base64 encoded image'
      });
    }

    // Validate media type
    const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!validTypes.includes(mediaType)) {
      return res.status(400).json({ 
        error: 'Invalid image type',
        message: `Supported formats: JPEG, PNG, GIF, WebP. Got: ${mediaType}`
      });
    }

    // Generate unique job ID
    const jobId = crypto.randomUUID();

    // Create GIUE job record
    const job = {
      id: jobId,
      type: 'giue',
      status: GIUE_STATUS.QUEUED,
      progress: 0,
      progressMessage: 'Image uploaded, waiting to process...',
      createdAt: new Date().toISOString(),
      imageData: imageData,
      mediaType: mediaType,
      result: null,
      error: null,
    };

    // Store job
    await storage.setJob(jobId, job, 3600);

    // Return immediately with job info
    console.log('[GIUE] Job created:', jobId);
    res.json({
      success: true,
      jobId: jobId,
      status: GIUE_STATUS.QUEUED,
      canvasUrl: `/canvas?job=${jobId}`,
      streamUrl: `/api/job/${jobId}/canvas`,
      message: 'Image queued for canvas generation.',
    });
    
  } catch (error) {
    console.error('GIUE upload error:', error);
    res.status(500).json({
      error: 'Upload failed',
      message: error.message || 'An unexpected error occurred',
    });
  }
});

// Stream canvas generation via SSE - Simple approach: let Claude generate the HTML
app.get('/api/job/:jobId/canvas', async (req, res) => {
  const { jobId } = req.params;
  console.log('[GIUE] /api/job/:jobId/canvas called for:', jobId);
  
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.flushHeaders();

  let streamEnded = false;
  const endStream = () => {
    if (streamEnded) return;
    streamEnded = true;
    if (!res.writableEnded && !res.destroyed) {
      res.end();
    }
  };

  const sendEvent = (event, data) => {
    if (streamEnded || res.closed || res.destroyed || res.writableEnded) {
      console.log(`[GIUE] Skipping ${event} event - stream already closed`);
      return;
    }
    try {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      if (res.flush) res.flush();
    } catch (err) {
      console.error(`[GIUE] Error sending ${event} event:`, err.message);
      endStream();
    }
  };

  res.on('close', () => {
    streamEnded = true;
  });

  try {
    let job = await storage.getJob(jobId);
    
    if (!job) {
      sendEvent('error', { message: 'Job not found' });
      endStream();
      return;
    }

    // If job is already completed, send the cached result
    if (job.status === GIUE_STATUS.COMPLETED && job.result?.html) {
      sendEvent('html', { chunk: job.result.html, final: true });
      sendEvent('complete', {});
      endStream();
      return;
    }

    // If job failed, send error
    if (job.status === GIUE_STATUS.FAILED) {
      sendEvent('error', { message: job.error || 'Canvas generation failed' });
      endStream();
      return;
    }

    // Send initial status
    sendEvent('status', { status: 'generating', progress: 10, message: 'Generating visual interface...' });
    console.log('[GIUE] Sent initial status event');

    let fullHtml = '';
    let tokenCount = 0;
    const startTime = Date.now();

    // Stream HTML generation directly from Claude
    console.log('[GIUE] Starting streamCanvasGeneration...');
    await streamCanvasGeneration({
      imageData: job.imageData,
      mediaType: job.mediaType,
      onToken: (token) => {
        if (!streamEnded) {
          tokenCount++;
          fullHtml += token;
          if (tokenCount === 1) {
            console.log('[GIUE] First token received!');
          }
          if (tokenCount % 100 === 0) {
            console.log(`[GIUE] Received ${tokenCount} tokens, ${fullHtml.length} chars`);
          }
          sendEvent('html', { chunk: token, final: false });
        }
      },
      onComplete: (text) => {
        const duration = Date.now() - startTime;
        console.log(`[GIUE] Stream complete! Total tokens: ${tokenCount}, Duration: ${duration}ms`);
        console.log(`[GIUE] Final HTML length: ${fullHtml.length} chars`);

        if (streamEnded) return;

        // Cache the result, then send complete + end the stream
        Promise.resolve(
          storage.updateJob(jobId, {
            status: GIUE_STATUS.COMPLETED,
            progress: 100,
            result: { html: fullHtml },
            completedAt: new Date().toISOString(),
            imageData: null, // Clear to save memory
          })
        )
          .then(() => {
            if (streamEnded) return;
            console.log('[GIUE] Job updated, sending complete event');
            sendEvent('complete', {});
            endStream();
          })
          .catch((error) => {
            console.error('[GIUE] Error updating job:', error.message);
            if (!streamEnded) {
              sendEvent('error', { message: error.message });
              endStream();
            }
          });
      },
      onError: async (error) => {
        console.error('[GIUE] Stream error:', error.message);
        console.error('[GIUE] Error stack:', error.stack);
        
        if (!streamEnded) {
          await storage.updateJob(jobId, {
            status: GIUE_STATUS.FAILED,
            error: error.message,
          });
          sendEvent('error', { message: error.message });
          endStream();
        }
      },
    });

  } catch (error) {
    console.error('GIUE stream error:', error);
    if (!streamEnded) {
      sendEvent('error', { message: error.message || 'An error occurred' });
      endStream();
    }
  }
});

// Investigate hotspot (placeholder for future research integration)
app.post('/api/investigate/:hotspotId', async (req, res) => {
  const { hotspotId } = req.params;
  const { jobId, question } = req.body;

  // For MVP, return a placeholder response
  // In the future, this will trigger Perplexity or similar research API
  res.json({
    success: true,
    hotspotId,
    status: 'pending',
    message: 'Research integration coming soon. This endpoint will trigger deep-dive analysis using Perplexity or similar APIs.',
    placeholder: true,
  });
});

// Build analysis prompt
const buildAnalysisPrompt = (question) => {
  return `You are a helpful AI assistant that analyzes images to help users understand what they're looking at. 

Analyze this image thoroughly and provide:

1. **What You See**: A clear description of the main content in the image.

2. **Key Information**: Extract and highlight any important information visible, such as:
   - Text, headlines, or titles
   - Product names, brands, or prices
   - News claims or statements
   - Data, statistics, or numbers
   - People, places, or events shown

3. **Fact Check & Context**: If the image contains:
   - News claims: Assess the credibility and provide context
   - Product information: Share relevant details or considerations
   - Statistics or data: Explain what they mean and any caveats
   - Advertisements: Identify what's being promoted and any fine print

4. **Helpful Insights**: Provide any additional context that would help the user understand:
   - Background information on topics shown
   - Things to be aware of or consider
   - Related information that might be useful

${question ? `\n5. **User's Question**: The user specifically asked: "${question}"\nPlease address this question in your analysis.` : ''}

Be factual, helpful, and highlight anything the user should be cautious about (misleading claims, too-good-to-be-true offers, etc.).`;
};

// ============================================
// Upload endpoint - supports both:
// 1. Multipart form-data (traditional file upload)
// 2. JSON with base64 encoded image (for Apple Shortcuts)
// Returns immediately with jobId before processing starts
// ============================================
app.post('/api/upload', upload.single('image'), async (req, res) => {
  try {
    let imageData = null;
    let mediaType = null;
    let question = '';

    // Check if this is a JSON request with base64 image
    if (req.is('application/json') || (req.body && req.body.image && typeof req.body.image === 'string')) {
      // JSON body with base64 image
      const body = req.body;
      
      if (!body.image) {
        return res.status(400).json({ error: 'No image provided', message: 'Please provide an image in base64 format' });
      }

      // Handle base64 data - might include data URL prefix
      let base64Data = body.image;
      
      // Extract media type and data from data URL if present
      if (base64Data.startsWith('data:')) {
        const matches = base64Data.match(/^data:([^;]+);base64,(.+)$/);
        if (matches) {
          mediaType = matches[1];
          base64Data = matches[2];
        } else {
          return res.status(400).json({ error: 'Invalid image format', message: 'Could not parse data URL' });
        }
      } else {
        // Raw base64, assume PNG or detect from magic bytes
        mediaType = body.mediaType || body.media_type || 'image/png';
      }

      // Validate base64 format
      if (!/^[A-Za-z0-9+/]+=*$/.test(base64Data)) {
        return res.status(400).json({ error: 'Invalid base64', message: 'Image data is not valid base64 encoding' });
      }

      // Decode and validate
      try {
        const buffer = Buffer.from(base64Data, 'base64');
        if (buffer.length < 8) {
          return res.status(400).json({ error: 'Invalid image', message: 'Image data is too small to be a valid image' });
        }
        
        // Detect media type from magic bytes
        const detectedType = detectMediaType(buffer);
        if (detectedType) {
          mediaType = detectedType;
        } else if (!body.mediaType && !body.media_type) {
          // No valid image magic bytes and no media type specified
          return res.status(400).json({ error: 'Invalid image', message: 'Could not detect image format. Please provide mediaType.' });
        }
        
        imageData = base64Data;
      } catch (e) {
        return res.status(400).json({ error: 'Invalid base64', message: 'Could not decode base64 image data' });
      }

      question = body.question || body.prompt || '';

    } else if (req.file) {
      // Traditional multipart file upload
      imageData = req.file.buffer.toString('base64');
      mediaType = req.file.mimetype;
      question = req.body.question || '';

    } else {
      return res.status(400).json({ 
        error: 'No image uploaded',
        message: 'Please provide an image either as multipart form-data or JSON with base64 encoded image'
      });
    }

    // Validate media type
    const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!validTypes.includes(mediaType)) {
      return res.status(400).json({ 
        error: 'Invalid image type',
        message: `Supported formats: JPEG, PNG, GIF, WebP. Got: ${mediaType}`
      });
    }

    // DON'T compress during upload - this blocks the response and causes timeouts on Vercel
    // Compression will happen lazily when the stream endpoint is called
    // Just validate the image size here
    const originalSize = Buffer.from(imageData, 'base64').length;
    console.log(`Upload received: ${(originalSize / 1024 / 1024).toFixed(2)}MB image`);

    // Generate unique job ID
    const jobId = crypto.randomUUID();

    // Create job record with RAW image data (compression happens later)
    const job = {
      id: jobId,
      status: JOB_STATUS.QUEUED,
      progress: 0,
      progressMessage: PROGRESS_MESSAGES[JOB_STATUS.QUEUED],
      createdAt: new Date().toISOString(),
      imageData: imageData,  // Store raw, compress later
      mediaType: mediaType,
      question: question,
      result: null,
      streamedText: '',
      error: null,
      needsCompression: originalSize > 4.5 * 1024 * 1024, // Flag for lazy compression
      originalSize: originalSize,
    };

    // Store job (in Redis or memory)
    await storage.setJob(jobId, job, 3600); // 1 hour TTL

    // Return immediately with job info
    res.json({
      success: true,
      jobId: jobId,
      status: JOB_STATUS.QUEUED,
      statusUrl: `/api/job/${jobId}/status`,
      streamUrl: `/api/job/${jobId}/stream`,
      viewUrl: `/${jobId}`,
      message: 'Image queued for analysis. Open viewUrl to see results.',
    });
    
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({
      error: 'Upload failed',
      message: error.message || 'An unexpected error occurred',
    });
  }
});

// Helper to detect image type from buffer magic bytes
function detectMediaType(buffer) {
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return 'image/jpeg';
  }
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    return 'image/png';
  }
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return 'image/gif';
  }
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
    return 'image/webp';
  }
  return null;
}

// ============================================
// Image compression for Claude API
// Claude has a 5MB limit, so we compress images that exceed 4.5MB
// ============================================
const MAX_IMAGE_SIZE = 4.5 * 1024 * 1024; // 4.5MB to stay safely under 5MB limit
const MAX_DIMENSION = 4096; // Max width or height for initial resize

/**
 * Compress an image to fit within Claude API's size limit
 * @param {Buffer} imageBuffer - Original image buffer
 * @param {string} mediaType - Original media type (image/jpeg, image/png, etc.)
 * @returns {Promise<{buffer: Buffer, mediaType: string, wasCompressed: boolean}>}
 */
async function compressImageForAPI(imageBuffer, mediaType) {
  const originalSize = imageBuffer.length;
  
  // If already under limit, return as-is
  if (originalSize <= MAX_IMAGE_SIZE) {
    return {
      buffer: imageBuffer,
      mediaType: mediaType,
      wasCompressed: false,
      originalSize,
      finalSize: originalSize,
    };
  }

  console.log(`Image size ${(originalSize / 1024 / 1024).toFixed(2)}MB exceeds limit, compressing...`);

  let sharpInstance = sharp(imageBuffer);
  const metadata = await sharpInstance.metadata();
  
  // Start with the original dimensions
  let targetWidth = metadata.width;
  let targetHeight = metadata.height;
  
  // If image is very large, start by resizing down
  if (targetWidth > MAX_DIMENSION || targetHeight > MAX_DIMENSION) {
    const scale = Math.min(MAX_DIMENSION / targetWidth, MAX_DIMENSION / targetHeight);
    targetWidth = Math.round(targetWidth * scale);
    targetHeight = Math.round(targetHeight * scale);
  }

  // Progressive compression strategy:
  // 1. Try high quality JPEG first (works well for photos/screenshots)
  // 2. Reduce quality progressively
  // 3. Reduce dimensions if quality reduction isn't enough

  const qualityLevels = [85, 75, 65, 55, 45];
  const scaleLevels = [1.0, 0.85, 0.7, 0.55, 0.4];

  for (const scale of scaleLevels) {
    const width = Math.round(targetWidth * scale);
    const height = Math.round(targetHeight * scale);
    
    for (const quality of qualityLevels) {
      sharpInstance = sharp(imageBuffer)
        .resize(width, height, {
          fit: 'inside',
          withoutEnlargement: true,
        });

      // Convert to JPEG for best compression (unless it's a GIF with animation)
      // JPEG works well for screenshots and photos
      let outputBuffer;
      let outputMediaType;

      if (mediaType === 'image/gif') {
        // For GIFs, try WebP first (supports animation), fallback to JPEG
        try {
          outputBuffer = await sharpInstance
            .webp({ quality: quality })
            .toBuffer();
          outputMediaType = 'image/webp';
        } catch {
          // If WebP fails (e.g., animated GIF issues), convert to JPEG
          outputBuffer = await sharpInstance
            .jpeg({ quality: quality, mozjpeg: true })
            .toBuffer();
          outputMediaType = 'image/jpeg';
        }
      } else if (mediaType === 'image/png') {
        // For PNGs, check if it has transparency
        // If it does, use WebP. Otherwise, JPEG compresses better.
        if (metadata.hasAlpha) {
          outputBuffer = await sharpInstance
            .webp({ quality: quality })
            .toBuffer();
          outputMediaType = 'image/webp';
        } else {
          outputBuffer = await sharpInstance
            .jpeg({ quality: quality, mozjpeg: true })
            .toBuffer();
          outputMediaType = 'image/jpeg';
        }
      } else {
        // For JPEG and WebP, output as JPEG for consistent compression
        outputBuffer = await sharpInstance
          .jpeg({ quality: quality, mozjpeg: true })
          .toBuffer();
        outputMediaType = 'image/jpeg';
      }

      if (outputBuffer.length <= MAX_IMAGE_SIZE) {
        console.log(`Compressed: ${(originalSize / 1024 / 1024).toFixed(2)}MB -> ${(outputBuffer.length / 1024 / 1024).toFixed(2)}MB (${width}x${height}, quality ${quality})`);
        return {
          buffer: outputBuffer,
          mediaType: outputMediaType,
          wasCompressed: true,
          originalSize,
          finalSize: outputBuffer.length,
          finalDimensions: { width, height },
          quality,
        };
      }
    }
  }

  // Last resort: aggressive compression
  console.log('Using aggressive compression as last resort');
  const finalBuffer = await sharp(imageBuffer)
    .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 35, mozjpeg: true })
    .toBuffer();

  console.log(`Aggressively compressed: ${(originalSize / 1024 / 1024).toFixed(2)}MB -> ${(finalBuffer.length / 1024 / 1024).toFixed(2)}MB`);
  
  return {
    buffer: finalBuffer,
    mediaType: 'image/jpeg',
    wasCompressed: true,
    originalSize,
    finalSize: finalBuffer.length,
  };
}

// ============================================
// Server-Sent Events streaming endpoint
// Connects to Claude API and streams tokens
// ============================================
app.get('/api/job/:jobId/stream', async (req, res) => {
  const { jobId } = req.params;
  
  // Set SSE headers - including headers to prevent Vercel/nginx buffering
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx/Vercel buffering
  res.setHeader('Transfer-Encoding', 'chunked');
  res.flushHeaders();

  // Helper to send SSE events with immediate flush
  const sendEvent = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    // Force flush for Vercel
    if (res.flush) res.flush();
  };

  // Keep-alive interval to prevent connection timeout
  let keepAliveInterval = null;
  const startKeepAlive = () => {
    // Send a comment every 15 seconds to keep connection alive
    keepAliveInterval = setInterval(() => {
      res.write(': keep-alive\n\n');
      if (res.flush) res.flush();
    }, 15000);
  };
  
  const stopKeepAlive = () => {
    if (keepAliveInterval) {
      clearInterval(keepAliveInterval);
      keepAliveInterval = null;
    }
  };

  // Store original image data before processing clears it
  let originalImageData = null;
  let originalMediaType = null;

  try {
    // IMMEDIATELY send a connected event so client knows we're alive
    sendEvent('connected', { 
      message: 'Connected to server',
      timestamp: new Date().toISOString() 
    });
    
    // Start keep-alive pings
    startKeepAlive();

    // Get job from storage
    let job = await storage.getJob(jobId);
    
    if (!job) {
      stopKeepAlive();
      sendEvent('error', { message: 'Job not found' });
      res.end();
      return;
    }

    // LAZY COMPRESSION: If the image needs compression, do it now (not during upload)
    // But FIRST send a status update so the user knows what's happening
    if (job.needsCompression && job.imageData) {
      const sizeMB = (job.originalSize / 1024 / 1024).toFixed(1);
      console.log(`Lazy compression starting for job ${jobId}: ${sizeMB}MB`);
      
      // Tell the client we're compressing - this is why it takes time!
      sendEvent('status', {
        status: 'compressing',
        progress: 5,
        message: `Optimizing image (${sizeMB}MB) for analysis...`,
      });
      
      try {
        const imageBuffer = Buffer.from(job.imageData, 'base64');
        const compressionResult = await compressImageForAPI(imageBuffer, job.mediaType);
        
        if (compressionResult.wasCompressed) {
          job.imageData = compressionResult.buffer.toString('base64');
          job.mediaType = compressionResult.mediaType;
          const finalSizeMB = (compressionResult.finalSize / 1024 / 1024).toFixed(1);
          console.log(`Lazy compression complete: ${sizeMB}MB -> ${finalSizeMB}MB`);
          
          // Update job in storage with compressed data
          await storage.updateJob(jobId, {
            imageData: job.imageData,
            mediaType: job.mediaType,
            needsCompression: false,
          });
          
          // Notify client compression is done
          sendEvent('status', {
            status: 'compressed',
            progress: 15,
            message: `Image optimized (${sizeMB}MB → ${finalSizeMB}MB)`,
          });
        }
      } catch (compressionError) {
        console.error('Lazy compression error:', compressionError);
        stopKeepAlive();
        sendEvent('error', { message: 'Failed to process image. It may be too large or corrupted.' });
        await storage.updateJob(jobId, {
          status: JOB_STATUS.FAILED,
          error: 'Image compression failed: ' + compressionError.message,
        });
        res.end();
        return;
      }
    }

    // Store image data before any processing
    originalImageData = job.imageData;
    originalMediaType = job.mediaType;

    // If job is already completed, send the result with image
    if (job.status === JOB_STATUS.COMPLETED) {
      stopKeepAlive();
      // Send init with image first (might be null if cleared, client should handle)
      sendEvent('init', {
        jobId: job.id,
        status: job.status,
        imageData: originalImageData,
        mediaType: originalMediaType,
        question: job.question,
      });
      sendEvent('complete', {
        analysis: job.result?.analysis || job.streamedText,
        model: job.result?.model,
      });
      res.end();
      return;
    }

    // If job failed, send error with image
    if (job.status === JOB_STATUS.FAILED) {
      stopKeepAlive();
      sendEvent('init', {
        jobId: job.id,
        status: job.status,
        imageData: originalImageData,
        mediaType: originalMediaType,
        question: job.question,
      });
      sendEvent('error', { message: job.error || 'Analysis failed' });
      res.end();
      return;
    }

    // Send initial status with image - always include image data
    sendEvent('init', {
      jobId: job.id,
      status: job.status,
      progress: job.progress || 0,
      progressMessage: job.progressMessage || PROGRESS_MESSAGES[job.status],
      imageData: originalImageData,
      mediaType: originalMediaType,
      question: job.question,
    });

    // Update job status to processing
    job = await storage.updateJob(jobId, {
      status: JOB_STATUS.PROCESSING,
      progress: 10,
      progressMessage: PROGRESS_MESSAGES[JOB_STATUS.PROCESSING],
    });

    sendEvent('status', {
      status: JOB_STATUS.PROCESSING,
      progress: 10,
      message: PROGRESS_MESSAGES[JOB_STATUS.PROCESSING],
    });

    // Get Anthropic client
    const anthropic = getAnthropicClient();

    // Update to waiting for LLM
    sendEvent('status', {
      status: JOB_STATUS.WAITING_LLM,
      progress: 30,
      message: 'Connecting to Claude AI...',
    });

    await storage.updateJob(jobId, {
      status: JOB_STATUS.WAITING_LLM,
      progress: 30,
      progressMessage: PROGRESS_MESSAGES[JOB_STATUS.WAITING_LLM],
    });

    // Build prompt
    const analysisPrompt = buildAnalysisPrompt(job.question);

    let fullText = '';
    let firstTokenReceived = false;
    
    // Send periodic progress updates while waiting for Claude
    // This helps the user know the connection is alive
    let waitingProgress = 30;
    const waitingInterval = setInterval(() => {
      if (!firstTokenReceived && waitingProgress < 45) {
        waitingProgress += 3;
        sendEvent('status', {
          status: JOB_STATUS.WAITING_LLM,
          progress: waitingProgress,
          message: 'Waiting for Claude AI to respond...',
        });
      }
    }, 2000);

    // Use Claude streaming API
    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: originalMediaType,
                data: originalImageData,
              },
            },
            {
              type: 'text',
              text: analysisPrompt,
            },
          ],
        },
      ],
    });

    // Stream tokens to client
    stream.on('text', async (text) => {
      // On first token, update status to streaming
      if (!firstTokenReceived) {
        firstTokenReceived = true;
        // Clear the waiting progress interval
        clearInterval(waitingInterval);
        
        sendEvent('status', {
          status: JOB_STATUS.STREAMING,
          progress: 50,
          message: 'Claude is analyzing your image...',
        });
        await storage.updateJob(jobId, {
          status: JOB_STATUS.STREAMING,
          progress: 50,
          progressMessage: PROGRESS_MESSAGES[JOB_STATUS.STREAMING],
        });
      }
      
      fullText += text;
      sendEvent('token', { text });
    });

    // Wait for stream to complete
    const finalMessage = await stream.finalMessage();
    
    // Clean up intervals
    clearInterval(waitingInterval);
    stopKeepAlive();

    // Update job as completed - keep image data for a while longer
    await storage.updateJob(jobId, {
      status: JOB_STATUS.COMPLETED,
      progress: 100,
      progressMessage: PROGRESS_MESSAGES[JOB_STATUS.COMPLETED],
      streamedText: fullText,
      result: {
        analysis: fullText,
        model: finalMessage.model,
        usage: finalMessage.usage,
      },
      // Keep image data for completed jobs so UI can display it
      // It will be cleared by TTL eventually
      completedAt: new Date().toISOString(),
    });

    // Send completion event
    sendEvent('complete', {
      analysis: fullText,
      model: finalMessage.model,
      usage: finalMessage.usage,
    });

  } catch (error) {
    console.error('Stream error:', error);
    
    // Clean up all intervals
    stopKeepAlive();
    // waitingInterval may not be defined if error occurred before it was created
    // but clearInterval(undefined) is a safe no-op in JavaScript
    if (typeof waitingInterval !== 'undefined') {
      clearInterval(waitingInterval);
    }
    
    // Update job as failed but keep image data
    try {
      await storage.updateJob(jobId, {
        status: JOB_STATUS.FAILED,
        progress: 0,
        progressMessage: PROGRESS_MESSAGES[JOB_STATUS.FAILED],
        error: error.message,
      });
    } catch (updateError) {
      console.error('Failed to update job status:', updateError);
    }

    sendEvent('error', {
      message: error.message || 'An error occurred during analysis',
    });
  } finally {
    stopKeepAlive(); // Ensure keep-alive is always stopped
    res.end();
  }
});

// ============================================
// Status endpoint (for polling fallback)
// ============================================
app.get('/api/job/:jobId/status', async (req, res) => {
  const { jobId } = req.params;
  const job = await storage.getJob(jobId);

  if (!job) {
    return res.status(404).json({
      error: 'Job not found',
      message: 'The requested job does not exist or has expired.',
    });
  }

  // Return job status (without image data by default for bandwidth)
  const includeImage = req.query.includeImage === 'true';
  
  const response = {
    id: job.id,
    status: job.status,
    progress: job.progress || 0,
    progressMessage: job.progressMessage || PROGRESS_MESSAGES[job.status] || 'Processing...',
    createdAt: job.createdAt,
    completedAt: job.completedAt || null,
    question: job.question || null,
    result: job.result,
    error: job.error,
    hasImage: !!job.imageData,
    mediaType: job.mediaType,
  };

  // Include image data if requested
  if (includeImage && job.imageData) {
    response.imageData = job.imageData;
  }

  res.json(response);
});

// Get job image (for displaying in UI)
app.get('/api/job/:jobId/image', async (req, res) => {
  const { jobId } = req.params;
  const job = await storage.getJob(jobId);

  if (!job || !job.imageData) {
    return res.status(404).json({
      error: 'Image not found',
      message: 'The image for this job is not available.',
    });
  }

  // Return image as base64 data URL
  res.json({
    imageData: job.imageData,
    mediaType: job.mediaType,
    dataUrl: `data:${job.mediaType};base64,${job.imageData}`,
  });
});

// Legacy analyze endpoint (synchronous, for backward compatibility)
app.post('/api/analyze', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image uploaded' });
    }

    const anthropic = getAnthropicClient();
    const userQuestion = req.body.question || '';
    const analysisPrompt = buildAnalysisPrompt(userQuestion);

    // Compress image if needed
    let imageBuffer = req.file.buffer;
    let mediaType = req.file.mimetype;

    try {
      const compressionResult = await compressImageForAPI(imageBuffer, mediaType);
      if (compressionResult.wasCompressed) {
        imageBuffer = compressionResult.buffer;
        mediaType = compressionResult.mediaType;
        console.log(`Legacy analyze: Image compressed ${(compressionResult.originalSize / 1024 / 1024).toFixed(2)}MB -> ${(compressionResult.finalSize / 1024 / 1024).toFixed(2)}MB`);
      }
    } catch (compressionError) {
      console.error('Compression error in legacy analyze:', compressionError);
      // Continue with original if compression fails and size is acceptable
      if (imageBuffer.length > 5 * 1024 * 1024) {
        return res.status(400).json({
          error: 'Image too large',
          message: `Image is ${(imageBuffer.length / 1024 / 1024).toFixed(1)}MB. Maximum supported size is 5MB.`
        });
      }
    }

    const base64Image = imageBuffer.toString('base64');

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: base64Image,
              },
            },
            {
              type: 'text',
              text: analysisPrompt,
            },
          ],
        },
      ],
    });

    const analysisText = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');

    res.json({
      success: true,
      analysis: analysisText,
      model: response.model,
      usage: response.usage,
    });
  } catch (error) {
    console.error('Analysis error:', error);
    
    if (error.message.includes('ANTHROPIC_API_KEY')) {
      return res.status(500).json({
        error: 'API configuration error',
        message: 'The Claude API key is not configured.',
      });
    }

    res.status(500).json({
      error: 'Analysis failed',
      message: error.message || 'An unexpected error occurred',
    });
  }
});

// List all jobs (for debugging)
app.get('/api/jobs', async (req, res) => {
  // Only works with in-memory storage
  const jobs = Array.from(jobStore.values()).map((job) => ({
    id: job.id,
    status: job.status,
    progress: job.progress,
    createdAt: job.createdAt,
    completedAt: job.completedAt || null,
  }));
  res.json({ jobs, count: jobs.length });
});

// Error handling middleware for multer
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        error: 'File too large',
        message: 'Maximum file size is 20MB',
      });
    }
  }
  if (error.message === 'Only image files are allowed') {
    return res.status(400).json({
      error: 'Invalid file type',
      message: 'Please upload an image file (JPEG, PNG, GIF, WebP)',
    });
  }
  next(error);
});

// Serve job progress page for UUID-formatted paths
const UUID_REGEX = /^\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

app.get(UUID_REGEX, async (req, res) => {
  const jobId = req.params[0];
  
  // Check if this is a GIUE job
  try {
    const job = await storage.getJob(jobId);
    if (job && job.type === 'giue') {
      // Redirect to canvas view for GIUE jobs
      return res.redirect(`/canvas?job=${jobId}`);
    }
  } catch (e) {
    // Ignore errors, fall through to job.html
  }
  
  res.sendFile(path.join(__dirname, '..', 'public', 'job.html'));
});

// Catch-all route for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// For local development
const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

// Export for Vercel
module.exports = app;
