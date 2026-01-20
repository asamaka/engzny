const express = require('express');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const Anthropic = require('@anthropic-ai/sdk').default;
const sharp = require('sharp');

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

// Main route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Shortcut download page
app.get('/shortcut', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'shortcut.html'));
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
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

    // Compress image if it exceeds Claude API's size limit (5MB)
    // This handles large iPhone screenshots and other high-resolution images
    let finalImageData = imageData;
    let finalMediaType = mediaType;
    let compressionInfo = null;

    try {
      const imageBuffer = Buffer.from(imageData, 'base64');
      const compressionResult = await compressImageForAPI(imageBuffer, mediaType);
      
      if (compressionResult.wasCompressed) {
        finalImageData = compressionResult.buffer.toString('base64');
        finalMediaType = compressionResult.mediaType;
        compressionInfo = {
          originalSize: compressionResult.originalSize,
          finalSize: compressionResult.finalSize,
          finalDimensions: compressionResult.finalDimensions,
        };
        console.log(`Image compressed for job: ${(compressionResult.originalSize / 1024 / 1024).toFixed(2)}MB -> ${(compressionResult.finalSize / 1024 / 1024).toFixed(2)}MB`);
      }
    } catch (compressionError) {
      console.error('Image compression error:', compressionError);
      // If compression fails, try to proceed with original image
      // It might still work if it's under 5MB
      const originalSize = Buffer.from(imageData, 'base64').length;
      if (originalSize > 5 * 1024 * 1024) {
        return res.status(400).json({
          error: 'Image too large',
          message: `Image is ${(originalSize / 1024 / 1024).toFixed(1)}MB. Maximum supported size is 5MB after compression. Please try a smaller image.`
        });
      }
    }

    // Generate unique job ID
    const jobId = crypto.randomUUID();

    // Create job record with image data
    const job = {
      id: jobId,
      status: JOB_STATUS.QUEUED,
      progress: 0,
      progressMessage: PROGRESS_MESSAGES[JOB_STATUS.QUEUED],
      createdAt: new Date().toISOString(),
      imageData: finalImageData,
      mediaType: finalMediaType,
      question: question,
      result: null,
      streamedText: '',
      error: null,
      compressionInfo: compressionInfo,
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
  
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  // Helper to send SSE events
  const sendEvent = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Store original image data before processing clears it
  let originalImageData = null;
  let originalMediaType = null;

  try {
    // Get job from storage
    let job = await storage.getJob(jobId);
    
    if (!job) {
      sendEvent('error', { message: 'Job not found' });
      res.end();
      return;
    }

    // Store image data before any processing
    originalImageData = job.imageData;
    originalMediaType = job.mediaType;

    // If job is already completed, send the result with image
    if (job.status === JOB_STATUS.COMPLETED) {
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
      message: PROGRESS_MESSAGES[JOB_STATUS.WAITING_LLM],
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
        sendEvent('status', {
          status: JOB_STATUS.STREAMING,
          progress: 50,
          message: PROGRESS_MESSAGES[JOB_STATUS.STREAMING],
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
    
    // Update job as failed but keep image data
    await storage.updateJob(jobId, {
      status: JOB_STATUS.FAILED,
      progress: 0,
      progressMessage: PROGRESS_MESSAGES[JOB_STATUS.FAILED],
      error: error.message,
    });

    sendEvent('error', {
      message: error.message || 'An error occurred during analysis',
    });
  } finally {
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

app.get(UUID_REGEX, (req, res) => {
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
