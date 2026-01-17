const express = require('express');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const Anthropic = require('@anthropic-ai/sdk').default;

const app = express();

// In-memory job storage (for serverless, consider using Vercel KV for production)
// Jobs will persist during the Lambda container lifetime
const jobStore = new Map();

// Job status constants
const JOB_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
};

// Configure multer for memory storage (for serverless)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept only images
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

// Image analysis endpoint
app.post('/api/analyze', upload.single('image'), async (req, res) => {
  try {
    // Check if image was uploaded
    if (!req.file) {
      return res.status(400).json({ error: 'No image uploaded' });
    }

    // Get the anthropic client
    const anthropic = getAnthropicClient();

    // Convert image buffer to base64
    const base64Image = req.file.buffer.toString('base64');
    
    // Determine media type
    const mediaType = req.file.mimetype;

    // Get optional user question/context
    const userQuestion = req.body.question || '';

    // Build the prompt
    const analysisPrompt = `You are a helpful AI assistant that analyzes images to help users understand what they're looking at. 

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

${userQuestion ? `\n5. **User's Question**: The user specifically asked: "${userQuestion}"\nPlease address this question in your analysis.` : ''}

Be factual, helpful, and highlight anything the user should be cautious about (misleading claims, too-good-to-be-true offers, etc.).`;

    // Call Claude Opus 4.5 with vision
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

    // Extract the text response
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
        message: 'The Claude API key is not configured. Please contact the administrator.',
      });
    }

    res.status(500).json({
      error: 'Analysis failed',
      message: error.message || 'An unexpected error occurred',
    });
  }
});

// API Upload endpoint - Returns a job ID for tracking progress
// In serverless environments, we process synchronously to ensure completion
app.post('/api/upload', upload.single('image'), async (req, res) => {
  try {
    // Check if image was uploaded
    if (!req.file) {
      return res.status(400).json({ error: 'No image uploaded' });
    }

    // Generate unique job ID
    const jobId = crypto.randomUUID();

    // Get optional user question/context
    const userQuestion = req.body.question || '';

    // Store job with initial status
    const job = {
      id: jobId,
      status: JOB_STATUS.PENDING,
      progress: 0,
      progressMessage: 'Job created, preparing to analyze...',
      createdAt: new Date().toISOString(),
      imageData: req.file.buffer.toString('base64'),
      mediaType: req.file.mimetype,
      question: userQuestion,
      result: null,
      error: null,
    };

    jobStore.set(jobId, job);

    // Process the job synchronously (required for serverless)
    // This ensures the job completes before the function terminates
    await processJob(jobId);

    // Get updated job status
    const completedJob = jobStore.get(jobId);

    // Return job ID and final status
    res.json({
      success: completedJob.status === JOB_STATUS.COMPLETED,
      jobId: jobId,
      status: completedJob.status,
      statusUrl: `/api/job/${jobId}/status`,
      viewUrl: `/${jobId}`,
      message: completedJob.status === JOB_STATUS.COMPLETED 
        ? 'Analysis complete! Visit viewUrl to see results.' 
        : 'Analysis failed. Visit viewUrl for details.',
      result: completedJob.result,
      error: completedJob.error,
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({
      error: 'Upload failed',
      message: error.message || 'An unexpected error occurred',
    });
  }
});

// Async job processor
async function processJob(jobId) {
  const job = jobStore.get(jobId);
  if (!job) return;

  try {
    // Update status to processing
    job.status = JOB_STATUS.PROCESSING;
    job.progress = 10;
    job.progressMessage = 'Initializing AI analysis...';
    jobStore.set(jobId, job);

    // Get the Anthropic client
    const anthropic = getAnthropicClient();

    // Update progress
    job.progress = 30;
    job.progressMessage = 'Sending image to Claude AI...';
    jobStore.set(jobId, job);

    // Build the prompt
    const analysisPrompt = `You are a helpful AI assistant that analyzes images to help users understand what they're looking at. 

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

${job.question ? `\n5. **User's Question**: The user specifically asked: "${job.question}"\nPlease address this question in your analysis.` : ''}

Be factual, helpful, and highlight anything the user should be cautious about (misleading claims, too-good-to-be-true offers, etc.).`;

    // Update progress
    job.progress = 50;
    job.progressMessage = 'Claude is analyzing the image...';
    jobStore.set(jobId, job);

    // Call Claude with vision
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

    // Update progress
    job.progress = 90;
    job.progressMessage = 'Processing results...';
    jobStore.set(jobId, job);

    // Extract the text response
    const analysisText = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');

    // Complete the job
    job.status = JOB_STATUS.COMPLETED;
    job.progress = 100;
    job.progressMessage = 'Analysis complete!';
    job.result = {
      analysis: analysisText,
      model: response.model,
      usage: response.usage,
    };
    job.completedAt = new Date().toISOString();
    // Clear image data to save memory
    job.imageData = null;
    jobStore.set(jobId, job);
  } catch (error) {
    console.error(`Job ${jobId} failed:`, error);
    job.status = JOB_STATUS.FAILED;
    job.progress = 0;
    job.progressMessage = 'Analysis failed';
    job.error = error.message || 'An unexpected error occurred';
    job.imageData = null;
    jobStore.set(jobId, job);
  }
}

// Get job status endpoint
app.get('/api/job/:jobId/status', (req, res) => {
  const { jobId } = req.params;
  const job = jobStore.get(jobId);

  if (!job) {
    return res.status(404).json({
      error: 'Job not found',
      message: 'The requested job does not exist or has expired.',
    });
  }

  // Return job status (without sensitive data)
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
  });
});

// List all jobs (for debugging - can be removed in production)
app.get('/api/jobs', (req, res) => {
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
// UUID v4 format: 8-4-4-4-12 hexadecimal characters
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
