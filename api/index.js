const express = require('express');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const Anthropic = require('@anthropic-ai/sdk').default;

const app = express();

// In-memory job storage (fallback when Redis is not configured)
// For production, configure UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN
const jobStore = new Map();

// Job status constants
const JOB_STATUS = {
  QUEUED: 'queued',
  PROCESSING: 'processing',
  STREAMING: 'streaming',
  COMPLETED: 'completed',
  FAILED: 'failed',
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
// NEW: Queue-based upload endpoint
// Returns immediately with jobId
// ============================================
app.post('/api/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image uploaded' });
    }

    // Generate unique job ID
    const jobId = crypto.randomUUID();
    
    // Get optional user question
    const question = req.body.question || '';

    // Create job record with image data
    const job = {
      id: jobId,
      status: JOB_STATUS.QUEUED,
      progress: 0,
      progressMessage: 'Image uploaded, waiting to process...',
      createdAt: new Date().toISOString(),
      imageData: req.file.buffer.toString('base64'),
      mediaType: req.file.mimetype,
      question: question,
      result: null,
      streamedText: '',
      error: null,
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

// ============================================
// NEW: Server-Sent Events streaming endpoint
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

  try {
    // Get job from storage
    let job = await storage.getJob(jobId);
    
    if (!job) {
      sendEvent('error', { message: 'Job not found' });
      res.end();
      return;
    }

    // If job is already completed, send the result
    if (job.status === JOB_STATUS.COMPLETED) {
      sendEvent('complete', {
        analysis: job.result?.analysis || job.streamedText,
        model: job.result?.model,
      });
      res.end();
      return;
    }

    // If job failed, send error
    if (job.status === JOB_STATUS.FAILED) {
      sendEvent('error', { message: job.error || 'Analysis failed' });
      res.end();
      return;
    }

    // Send initial status with image
    sendEvent('init', {
      jobId: job.id,
      status: job.status,
      imageData: job.imageData,
      mediaType: job.mediaType,
      question: job.question,
    });

    // Update job status to processing
    job = await storage.updateJob(jobId, {
      status: JOB_STATUS.PROCESSING,
      progress: 10,
      progressMessage: 'Starting AI analysis...',
    });

    sendEvent('status', {
      status: JOB_STATUS.PROCESSING,
      progress: 10,
      message: 'Starting AI analysis...',
    });

    // Get Anthropic client
    const anthropic = getAnthropicClient();

    // Update progress
    sendEvent('status', {
      status: JOB_STATUS.PROCESSING,
      progress: 30,
      message: 'Connecting to Claude AI...',
    });

    // Build prompt
    const analysisPrompt = buildAnalysisPrompt(job.question);

    // Start streaming from Claude
    sendEvent('status', {
      status: JOB_STATUS.STREAMING,
      progress: 50,
      message: 'Analyzing image...',
    });

    await storage.updateJob(jobId, {
      status: JOB_STATUS.STREAMING,
      progress: 50,
      progressMessage: 'Analyzing image...',
    });

    let fullText = '';

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
                media_type: job.mediaType,
                data: job.imageData,
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
    stream.on('text', (text) => {
      fullText += text;
      sendEvent('token', { text });
    });

    // Wait for stream to complete
    const finalMessage = await stream.finalMessage();

    // Update job as completed
    await storage.updateJob(jobId, {
      status: JOB_STATUS.COMPLETED,
      progress: 100,
      progressMessage: 'Analysis complete!',
      streamedText: fullText,
      result: {
        analysis: fullText,
        model: finalMessage.model,
        usage: finalMessage.usage,
      },
      imageData: null, // Clear image data to save space
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
    
    // Update job as failed
    await storage.updateJob(jobId, {
      status: JOB_STATUS.FAILED,
      progress: 0,
      progressMessage: 'Analysis failed',
      error: error.message,
      imageData: null,
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

  // Return job status (without image data)
  res.json({
    id: job.id,
    status: job.status,
    progress: job.progress,
    progressMessage: job.progressMessage,
    createdAt: job.createdAt,
    completedAt: job.completedAt || null,
    question: job.question || null,
    result: job.result,
    error: job.error,
    hasImage: !!job.imageData,
  });
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
    const base64Image = req.file.buffer.toString('base64');
    const mediaType = req.file.mimetype;
    const userQuestion = req.body.question || '';
    const analysisPrompt = buildAnalysisPrompt(userQuestion);

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
