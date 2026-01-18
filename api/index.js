const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const multer = require('multer');
const Anthropic = require('@anthropic-ai/sdk').default;

const app = express();

// In-memory job storage (fallback when Redis is not configured)
// For production, configure UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN
const jobStore = new Map();
const jobStoreTimers = new Map();
const jobUpdateLocks = new Map();

// Job status constants
const JOB_STATUS = {
  QUEUED: 'queued',
  PROCESSING: 'processing',
  STREAMING: 'streaming',
  COMPLETED: 'completed',
  FAILED: 'failed',
};

const JOB_TTL_SECONDS = Number.parseInt(process.env.JOB_TTL_SECONDS || '3600', 10);
const JOB_QUEUE_CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.JOB_QUEUE_CONCURRENCY || '2', 10),
);
const JOB_QUEUE_MAX = Math.max(1, Number.parseInt(process.env.JOB_QUEUE_MAX || '50', 10));
const JOB_PROCESS_ON_UPLOAD = (process.env.JOB_PROCESS_ON_UPLOAD || 'false') === 'true';
const JOB_PROCESS_ON_STREAM = process.env.JOB_PROCESS_ON_STREAM !== 'false';
const JOB_PROCESS_ON_STATUS = (process.env.JOB_PROCESS_ON_STATUS || 'false') === 'true';
const JOB_LOCK_SECONDS = Math.max(
  60,
  Number.parseInt(process.env.JOB_LOCK_SECONDS || '900', 10),
);
const JOB_LOCK_RENEW_MS = Math.max(
  15000,
  Number.parseInt(process.env.JOB_LOCK_RENEW_MS || '30000', 10),
);
const STREAM_POLL_INTERVAL_MS = Math.max(
  500,
  Number.parseInt(process.env.JOB_STREAM_POLL_INTERVAL_MS || '1000', 10),
);
const MAX_IMAGE_BYTES = Number.parseInt(
  process.env.MAX_IMAGE_BYTES || String(5 * 1024 * 1024),
  10,
);
const MAX_UPLOAD_BYTES = MAX_IMAGE_BYTES;
const BASE64_IMAGE_FIELDS = ['imageBase64', 'imageData', 'dataUrl', 'image'];
const DATA_URL_REGEX = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/;

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

const acquireJobLock = async (jobId) => {
  const redisClient = await getRedis();
  const lockId = crypto.randomUUID();
  if (redisClient) {
    const result = await redisClient.set(`joblock:${jobId}`, lockId, {
      nx: true,
      ex: JOB_LOCK_SECONDS,
    });
    if (!result) {
      return null;
    }
    return {
      lockId,
      renew: async () =>
        redisClient.set(`joblock:${jobId}`, lockId, {
          xx: true,
          ex: JOB_LOCK_SECONDS,
        }),
    };
  }
  return { lockId, renew: null };
};

const releaseJobLock = async (jobId, lock) => {
  if (!lock) return;
  const redisClient = await getRedis();
  if (redisClient) {
    try {
      const current = await redisClient.get(`joblock:${jobId}`);
      if (current && current === lock.lockId) {
        await redisClient.del(`joblock:${jobId}`);
      }
    } catch (error) {
      console.error('Failed to release job lock:', error);
    }
  }
};

const queueJobUpdate = (jobId, task) => {
  const previous = jobUpdateLocks.get(jobId) || Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  jobUpdateLocks.set(
    jobId,
    next.finally(() => {
      if (jobUpdateLocks.get(jobId) === next) {
        jobUpdateLocks.delete(jobId);
      }
    }),
  );
  return next;
};

// Storage abstraction
const storage = {
  async setJob(jobId, data, ttl = JOB_TTL_SECONDS) {
    const redis = await getRedis();
    const ttlSeconds = data.ttlSeconds || ttl;
    const expiresAt =
      data.expiresAt || new Date(Date.now() + ttlSeconds * 1000).toISOString();
    const payload = { ...data, ttlSeconds, expiresAt };
    if (redis) {
      await redis.setex(`job:${jobId}`, ttlSeconds, JSON.stringify(payload));
    } else {
      jobStore.set(jobId, payload);
      if (jobStoreTimers.has(jobId)) {
        clearTimeout(jobStoreTimers.get(jobId));
      }
      const timeout = setTimeout(() => {
        jobStore.delete(jobId);
        jobStoreTimers.delete(jobId);
      }, ttlSeconds * 1000);
      jobStoreTimers.set(jobId, timeout);
    }
  },

  async getJob(jobId) {
    const redis = await getRedis();
    if (redis) {
      const data = await redis.get(`job:${jobId}`);
      return data ? (typeof data === 'string' ? JSON.parse(data) : data) : null;
    } else {
      const job = jobStore.get(jobId) || null;
      if (!job) return null;
      if (job.expiresAt && new Date(job.expiresAt).getTime() < Date.now()) {
        jobStore.delete(jobId);
        if (jobStoreTimers.has(jobId)) {
          clearTimeout(jobStoreTimers.get(jobId));
          jobStoreTimers.delete(jobId);
        }
        return null;
      }
      return job;
    }
  },

  async updateJob(jobId, updates) {
    return queueJobUpdate(jobId, async () => {
      const job = await this.getJob(jobId);
      if (job) {
        const updated = { ...job, ...updates };
        await this.setJob(jobId, updated, job.ttlSeconds || JOB_TTL_SECONDS);
        return updated;
      }
      return null;
    });
  },
};

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
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

const createHttpError = (status, error, message, details) => {
  const err = new Error(message);
  err.status = status;
  err.error = error;
  err.details = details;
  return err;
};

const formatBytes = (bytes) => {
  const mb = bytes / (1024 * 1024);
  return `${Math.round(mb * 10) / 10}MB`;
};

const normalizeMediaType = (mediaType) => {
  if (!mediaType) return mediaType;
  if (mediaType === 'image/jpg') return 'image/jpeg';
  return mediaType;
};

const parseBase64Image = (input, mediaTypeInput) => {
  if (!input || typeof input !== 'string') return null;
  let base64Data = input.trim();
  let mediaType = mediaTypeInput;
  const match = base64Data.match(DATA_URL_REGEX);
  if (match) {
    mediaType = match[1];
    base64Data = match[2];
  }
  if (!mediaType) {
    throw createHttpError(
      400,
      'Missing media type',
      'mediaType is required when sending base64 image data.',
    );
  }
  const normalizedMediaType = normalizeMediaType(mediaType);
  if (!normalizedMediaType.startsWith('image/')) {
    throw createHttpError(
      400,
      'Invalid media type',
      'Only image media types are allowed.',
    );
  }
  base64Data = base64Data.replace(/\s/g, '');
  if (!base64Data) {
    throw createHttpError(400, 'Invalid image data', 'Image data is empty.');
  }
  if (!/^[A-Za-z0-9+/=]+$/.test(base64Data)) {
    throw createHttpError(400, 'Invalid image data', 'Image data is not valid base64.');
  }
  const buffer = Buffer.from(base64Data, 'base64');
  if (!buffer.length) {
    throw createHttpError(400, 'Invalid image data', 'Image data could not be decoded.');
  }
  return { buffer, base64Data, mediaType: normalizedMediaType };
};

const extractImagePayload = (req) => {
  if (req.file) {
    return {
      buffer: req.file.buffer,
      mediaType: normalizeMediaType(req.file.mimetype),
      source: 'multipart',
    };
  }
  const body = req.body || {};
  const base64Input = BASE64_IMAGE_FIELDS.map((field) => body[field]).find(
    (value) => typeof value === 'string' && value.trim().length > 0,
  );
  if (!base64Input) return null;
  const mediaType =
    typeof body.mediaType === 'string'
      ? body.mediaType
      : typeof body.mimeType === 'string'
        ? body.mimeType
        : undefined;
  return { ...parseBase64Image(base64Input, mediaType), source: 'base64' };
};

const normalizeImagePayload = (payload) => {
  if (!payload || !payload.buffer) {
    throw createHttpError(400, 'Invalid image data', 'Image payload is missing.');
  }
  if (!payload.mediaType) {
    throw createHttpError(
      400,
      'Missing media type',
      'mediaType is required for the image payload.',
    );
  }
  const imageBytes = payload.buffer.length;
  if (imageBytes > MAX_IMAGE_BYTES) {
    throw createHttpError(
      413,
      'Image too large',
      `Image exceeds ${formatBytes(MAX_IMAGE_BYTES)} limit for analysis.`,
      { maxImageBytes: MAX_IMAGE_BYTES },
    );
  }
  return {
    imageData: payload.base64Data || payload.buffer.toString('base64'),
    mediaType: payload.mediaType,
    imageBytes,
    source: payload.source,
  };
};

const jobQueue = [];
const jobEmitters = new Map();
const activeJobs = new Set();
let activeWorkers = 0;
let queueScheduled = false;

const getQueuePosition = (jobId) => {
  const index = jobQueue.indexOf(jobId);
  return index === -1 ? null : index + 1;
};

const getQueueSnapshot = (jobId) => ({
  position: getQueuePosition(jobId),
  length: jobQueue.length,
  active: activeWorkers,
  concurrency: JOB_QUEUE_CONCURRENCY,
  processingMode: JOB_PROCESS_ON_UPLOAD ? 'background' : 'stream',
});

const getJobEmitter = (jobId) => {
  if (!jobEmitters.has(jobId)) {
    jobEmitters.set(jobId, new EventEmitter());
  }
  return jobEmitters.get(jobId);
};

const emitJobEvent = (jobId, event, payload) => {
  const emitter = jobEmitters.get(jobId);
  if (emitter) {
    emitter.emit(event, payload);
  }
};

const cleanupJobEmitter = (jobId) => {
  const emitter = jobEmitters.get(jobId);
  if (!emitter) return;
  if (
    emitter.listenerCount('status') === 0 &&
    emitter.listenerCount('token') === 0 &&
    emitter.listenerCount('complete') === 0 &&
    emitter.listenerCount('error') === 0
  ) {
    jobEmitters.delete(jobId);
  }
};

const startJobProcessing = async (jobId) => {
  if (activeJobs.has(jobId)) return { started: false, reason: 'active' };
  if (activeWorkers >= JOB_QUEUE_CONCURRENCY) {
    return { started: false, reason: 'concurrency' };
  }
  const job = await storage.getJob(jobId);
  if (!job || job.status !== JOB_STATUS.QUEUED) {
    return { started: false, reason: 'state' };
  }
  const lock = await acquireJobLock(jobId);
  if (!lock) return { started: false, reason: 'locked' };

  activeJobs.add(jobId);
  activeWorkers += 1;

  let lockRenewTimer = null;
  if (lock.renew) {
    lockRenewTimer = setInterval(() => {
      lock.renew().catch((error) => {
        console.error('Failed to renew job lock:', error);
      });
    }, JOB_LOCK_RENEW_MS);
  }

  processJob(jobId, lock)
    .catch((error) => {
      console.error('Job processing error:', error);
    })
    .finally(async () => {
      if (lockRenewTimer) clearInterval(lockRenewTimer);
      activeWorkers -= 1;
      activeJobs.delete(jobId);
      await releaseJobLock(jobId, lock);
      scheduleQueueProcessing();
    });

  return { started: true, reason: 'started' };
};

const scheduleQueueProcessing = () => {
  if (queueScheduled) return;
  queueScheduled = true;
  setImmediate(async () => {
    queueScheduled = false;
    while (activeWorkers < JOB_QUEUE_CONCURRENCY && jobQueue.length > 0) {
      const jobId = jobQueue.shift();
      const result = await startJobProcessing(jobId);
      if (!result.started) {
        if (result.reason === 'concurrency') {
          jobQueue.unshift(jobId);
          break;
        }
      }
    }
  });
};

const enqueueJob = (jobId, options = {}) => {
  if (activeJobs.has(jobId)) return;
  const alreadyQueued = jobQueue.includes(jobId);
  if (!alreadyQueued) {
    if (jobQueue.length >= JOB_QUEUE_MAX) {
      throw createHttpError(
        429,
        'Queue full',
        'Too many jobs are queued. Please try again in a moment.',
      );
    }
    jobQueue.push(jobId);
  }
  if (options.start) {
    scheduleQueueProcessing();
  }
};

const updateJobStatus = async (jobId, updates) => {
  const updated = await storage.updateJob(jobId, {
    ...updates,
    updatedAt: new Date().toISOString(),
  });
  if (updated) {
    emitJobEvent(jobId, 'status', {
      status: updated.status,
      progress: updated.progress,
      message: updated.progressMessage,
      queue: getQueueSnapshot(jobId),
      processing: {
        mode: JOB_PROCESS_ON_UPLOAD ? 'background' : 'stream',
        startOnStream: !JOB_PROCESS_ON_UPLOAD,
        startOnStatus: JOB_PROCESS_ON_STATUS,
      },
    });
  }
  return updated;
};

const processJob = async (jobId) => {
  let job = await storage.getJob(jobId);
  if (!job) return;
  if ([JOB_STATUS.COMPLETED, JOB_STATUS.FAILED].includes(job.status)) return;
  if (!job.imageData || !job.mediaType) {
    await updateJobStatus(jobId, {
      status: JOB_STATUS.FAILED,
      progress: 0,
      progressMessage: 'Missing image data',
      error: 'Image data is no longer available.',
    });
    emitJobEvent(jobId, 'error', { message: 'Image data is no longer available.' });
    return;
  }

  await updateJobStatus(jobId, {
    status: JOB_STATUS.PROCESSING,
    progress: 10,
    progressMessage: 'Starting AI analysis...',
    startedAt: new Date().toISOString(),
  });

  try {
    const anthropic = getAnthropicClient();
    const analysisPrompt = buildAnalysisPrompt(job.question);

    await updateJobStatus(jobId, {
      status: JOB_STATUS.STREAMING,
      progress: 40,
      progressMessage: 'Analyzing image...',
    });

    let fullText = job.streamedText || '';
    let lastPersistedAt = Date.now();
    let persistInFlight = false;

    const persistStreamedText = async (force = false) => {
      if (persistInFlight) return;
      if (!force && Date.now() - lastPersistedAt < 1000) return;
      persistInFlight = true;
      const snapshot = fullText;
      try {
        await storage.updateJob(jobId, { streamedText: snapshot });
        lastPersistedAt = Date.now();
      } finally {
        persistInFlight = false;
      }
    };

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

    stream.on('text', (text) => {
      fullText += text;
      emitJobEvent(jobId, 'token', { text });
      void persistStreamedText();
    });

    const finalMessage = await stream.finalMessage();
    await persistStreamedText(true);

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
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    emitJobEvent(jobId, 'complete', {
      analysis: fullText,
      model: finalMessage.model,
      usage: finalMessage.usage,
    });
  } catch (error) {
    console.error('Stream error:', error);
    await storage.updateJob(jobId, {
      status: JOB_STATUS.FAILED,
      progress: 0,
      progressMessage: 'Analysis failed',
      error: error.message,
      updatedAt: new Date().toISOString(),
    });
    emitJobEvent(jobId, 'error', {
      message: error.message || 'An error occurred during analysis',
    });
  }
};

// ============================================
// NEW: Queue-based upload endpoint
// Returns immediately with jobId
// ============================================
app.post('/api/upload', upload.single('image'), async (req, res) => {
  try {
    const payload = extractImagePayload(req);
    if (!payload) {
      return res.status(400).json({
        error: 'No image provided',
        message: 'Upload an image file or send base64 image data.',
      });
    }
    const normalized = normalizeImagePayload(payload);

    // Generate unique job ID
    const jobId = crypto.randomUUID();
    
    // Get optional user question
    const question = typeof req.body.question === 'string' ? req.body.question : '';

    // Create job record with image data
    const job = {
      id: jobId,
      status: JOB_STATUS.QUEUED,
      progress: 0,
      progressMessage: JOB_PROCESS_ON_UPLOAD
        ? 'Queued for analysis...'
        : 'Waiting for analysis stream to start...',
      createdAt: new Date().toISOString(),
      queuedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      imageData: normalized.imageData,
      mediaType: normalized.mediaType,
      imageBytes: normalized.imageBytes,
      imageSource: normalized.source,
      question: question,
      result: null,
      streamedText: '',
      error: null,
      ttlSeconds: JOB_TTL_SECONDS,
    };

    // Store job (in Redis or memory)
    await storage.setJob(jobId, job, JOB_TTL_SECONDS);

    // Enqueue job for processing
    try {
      enqueueJob(jobId, { start: JOB_PROCESS_ON_UPLOAD });
    } catch (queueError) {
      await updateJobStatus(jobId, {
        status: JOB_STATUS.FAILED,
        progress: 0,
        progressMessage: 'Queue is full',
        error: queueError.message,
      });
      throw queueError;
    }
    const queue = getQueueSnapshot(jobId);
    const processing = {
      mode: JOB_PROCESS_ON_UPLOAD ? 'background' : 'stream',
      startOnStream: !JOB_PROCESS_ON_UPLOAD,
      startOnStatus: JOB_PROCESS_ON_STATUS,
    };
    const next = !JOB_PROCESS_ON_UPLOAD
      ? {
          action: 'open_stream',
          url: `/api/job/${jobId}/stream`,
          message: 'Open the stream URL to begin processing.',
        }
      : null;

    // Return immediately with job info
    res.json({
      success: true,
      jobId: jobId,
      status: JOB_STATUS.QUEUED,
      statusUrl: `/api/job/${jobId}/status`,
      streamUrl: `/api/job/${jobId}/stream`,
      viewUrl: `/${jobId}`,
      queue,
      processing,
      next,
      message: 'Image queued for analysis. Open viewUrl to see results.',
    });
    
  } catch (error) {
    console.error('Upload error:', error);
    const status = error.status || 500;
    res.status(status).json({
      error: error.error || 'Upload failed',
      message: error.message || 'An unexpected error occurred',
      details: error.details,
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
    let job = await storage.getJob(jobId);
    if (!job) {
      sendEvent('error', { message: 'Job not found' });
      res.end();
      return;
    }

    let closed = false;
    let pollTimer = null;
    let emitter = null;
    let lastSentLength = job.streamedText ? job.streamedText.length : 0;
    let lastStatus = job.status;
    let lastProgress = job.progress;
    let lastMessage = job.progressMessage;

    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (pollTimer) clearInterval(pollTimer);
      if (emitter) {
        emitter.removeListener('status', onStatus);
        emitter.removeListener('token', onToken);
        emitter.removeListener('complete', onComplete);
        emitter.removeListener('error', onError);
        cleanupJobEmitter(jobId);
      }
      res.end();
    };

    const onStatus = (data) => {
      sendEvent('status', data);
    };

    const onToken = (data) => {
      lastSentLength += data.text.length;
      sendEvent('token', data);
    };

    const onComplete = (data) => {
      sendEvent('complete', data);
      cleanup();
    };

    const onError = (data) => {
      sendEvent('error', data);
      cleanup();
    };

    res.on('close', cleanup);

    sendEvent('init', {
      jobId: job.id,
      status: job.status,
      imageData: job.imageData,
      mediaType: job.mediaType,
      question: job.question,
      queue: getQueueSnapshot(jobId),
      processing: {
        mode: JOB_PROCESS_ON_UPLOAD ? 'background' : 'stream',
        startOnStream: !JOB_PROCESS_ON_UPLOAD,
        startOnStatus: JOB_PROCESS_ON_STATUS,
      },
    });

    sendEvent('status', {
      status: job.status,
      progress: job.progress,
      message: job.progressMessage,
      queue: getQueueSnapshot(jobId),
      processing: {
        mode: JOB_PROCESS_ON_UPLOAD ? 'background' : 'stream',
        startOnStream: !JOB_PROCESS_ON_UPLOAD,
        startOnStatus: JOB_PROCESS_ON_STATUS,
      },
    });

    if (job.streamedText) {
      sendEvent('token', { text: job.streamedText });
    }

    if (job.status === JOB_STATUS.QUEUED) {
      try {
        enqueueJob(jobId, { start: JOB_PROCESS_ON_STREAM });
      } catch (error) {
        sendEvent('error', { message: error.message || 'Queue is full.' });
        cleanup();
        return;
      }
    }

    if (job.status === JOB_STATUS.COMPLETED) {
      sendEvent('complete', {
        analysis: job.result?.analysis || job.streamedText,
        model: job.result?.model,
        usage: job.result?.usage,
      });
      cleanup();
      return;
    }

    if (job.status === JOB_STATUS.FAILED) {
      sendEvent('error', { message: job.error || 'Analysis failed' });
      cleanup();
      return;
    }

    emitter = getJobEmitter(jobId);
    emitter.on('status', onStatus);
    emitter.on('token', onToken);
    emitter.on('complete', onComplete);
    emitter.on('error', onError);

    pollTimer = setInterval(async () => {
      if (closed) return;
      try {
        const current = await storage.getJob(jobId);
        if (!current) {
          sendEvent('error', { message: 'Job not found' });
          cleanup();
          return;
        }

        if (current.streamedText && current.streamedText.length > lastSentLength) {
          const delta = current.streamedText.slice(lastSentLength);
          lastSentLength = current.streamedText.length;
          if (delta) {
            sendEvent('token', { text: delta });
          }
        }

        if (
          current.status !== lastStatus ||
          current.progress !== lastProgress ||
          current.progressMessage !== lastMessage
        ) {
          lastStatus = current.status;
          lastProgress = current.progress;
          lastMessage = current.progressMessage;
          sendEvent('status', {
            status: current.status,
            progress: current.progress,
            message: current.progressMessage,
            queue: getQueueSnapshot(jobId),
            processing: {
              mode: JOB_PROCESS_ON_UPLOAD ? 'background' : 'stream',
              startOnStream: !JOB_PROCESS_ON_UPLOAD,
              startOnStatus: JOB_PROCESS_ON_STATUS,
            },
          });
        }

        if (current.status === JOB_STATUS.COMPLETED) {
          sendEvent('complete', {
            analysis: current.result?.analysis || current.streamedText,
            model: current.result?.model,
            usage: current.result?.usage,
          });
          cleanup();
          return;
        }

        if (current.status === JOB_STATUS.FAILED) {
          sendEvent('error', { message: current.error || 'Analysis failed' });
          cleanup();
        }
      } catch (error) {
        sendEvent('error', { message: 'Stream polling failed.' });
        cleanup();
      }
    }, STREAM_POLL_INTERVAL_MS);
  } catch (error) {
    console.error('Stream error:', error);
    sendEvent('error', {
      message: error.message || 'An error occurred while streaming updates',
    });
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

  if (job.status === JOB_STATUS.QUEUED) {
    const shouldStart = JOB_PROCESS_ON_STATUS || req.query.start === '1';
    try {
      enqueueJob(jobId, { start: shouldStart });
    } catch (error) {
      // Queue full; keep status response but include queue state
    }
  }
  const queue = getQueueSnapshot(jobId);
  const processing = {
    mode: JOB_PROCESS_ON_UPLOAD ? 'background' : 'stream',
    startOnStream: !JOB_PROCESS_ON_UPLOAD,
    startOnStatus: JOB_PROCESS_ON_STATUS,
  };
  const next =
    job.status === JOB_STATUS.QUEUED && !JOB_PROCESS_ON_UPLOAD
      ? {
          action: 'open_stream',
          url: `/api/job/${jobId}/stream`,
          message: 'Open the stream URL to begin processing.',
        }
      : null;

  // Return job status (without image data)
  res.json({
    id: job.id,
    status: job.status,
    progress: job.progress,
    progressMessage: job.progressMessage,
    createdAt: job.createdAt,
    queuedAt: job.queuedAt || null,
    startedAt: job.startedAt || null,
    completedAt: job.completedAt || null,
    question: job.question || null,
    result: job.result,
    error: job.error,
    hasImage: !!job.imageData,
    queue,
    processing,
    next,
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
    const payload = extractImagePayload(req);
    if (!payload) {
      return res.status(400).json({
        error: 'No image provided',
        message: 'Upload an image file or send base64 image data.',
      });
    }
    const normalized = normalizeImagePayload(payload);

    const anthropic = getAnthropicClient();
    const base64Image = normalized.imageData;
    const mediaType = normalized.mediaType;
    const userQuestion = typeof req.body.question === 'string' ? req.body.question : '';
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
    const status = error.status || 500;
    res.status(status).json({
      error: error.error || 'Analysis failed',
      message: error.message || 'An unexpected error occurred',
      details: error.details,
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
    queuePosition: getQueuePosition(job.id),
  }));
  res.json({
    jobs,
    count: jobs.length,
    queue: {
      length: jobQueue.length,
      active: activeWorkers,
      concurrency: JOB_QUEUE_CONCURRENCY,
    },
  });
});

// Error handling middleware for multer
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        error: 'File too large',
        message: `Maximum file size is ${formatBytes(MAX_UPLOAD_BYTES)}`,
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
