require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const Anthropic = require('@anthropic-ai/sdk').default;
const sharp = require('sharp');
const { ClaudeAdapter } = require('./llm/claude');
const { logger } = require('./lib/logger');

const app = express();

logger.info('Server', 'Initializing', { nodeVersion: process.version, env: process.env.NODE_ENV || 'development' });

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
app.use(express.raw({ type: 'image/*', limit: '20mb' }));

// Request logging middleware - logs every HTTP request
app.use((req, res, next) => {
  const start = Date.now();
  const originalEnd = res.end;
  res.end = function (...args) {
    const duration = Date.now() - start;
    // Skip noisy static/health requests
    if (!req.path.startsWith('/api/debug') && req.path !== '/api/health' && !req.path.match(/\.(js|css|png|ico|svg|woff)$/)) {
      logger.logRequest({
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration,
        userAgent: req.headers['user-agent']?.slice(0, 120),
        ip: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip,
      });
    }
    originalEnd.apply(this, args);
  };
  next();
});

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '..', 'public')));

// Legacy /paste route - redirect to main page
app.get('/paste', (req, res) => {
  res.redirect('/');
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
// Simple test endpoint for debugging
app.post('/api/test', (req, res) => {
  console.log('[TEST] Headers:', req.headers);
  console.log('[TEST] Body type:', typeof req.body);
  console.log('[TEST] Body keys:', Object.keys(req.body || {}));
  res.json({ 
    received: true, 
    bodyType: typeof req.body,
    hasImage: !!req.body?.image,
    imageLength: req.body?.image?.length || 0,
    headers: req.headers['content-type']
  });
});

app.post('/api/scan', upload.single('image'), async (req, res) => {
  console.log('[SCAN] Request received');
  console.log('[SCAN] Content-Type:', req.headers['content-type']);
  
  try {
    let base64Data = null;
    let mimeType = 'image/jpeg';
    
    // Method 1: File upload (multipart/form-data) - for iOS Shortcuts
    if (req.file) {
      console.log('[SCAN] File upload, size:', req.file.size);
      base64Data = req.file.buffer.toString('base64');
      mimeType = req.file.mimetype;
    }
    // Method 2: JSON body with image field
    else if (req.body?.image) {
      const image = req.body.image;
      console.log('[SCAN] JSON body, image length:', image.length);
      
      if (image.startsWith('data:')) {
        const matches = image.match(/^data:([^;]+);base64,(.+)$/);
        if (matches) {
          mimeType = matches[1];
          base64Data = matches[2];
        } else {
          base64Data = image;
        }
      } else {
        // Raw base64 without data URL prefix
        base64Data = image;
        mimeType = req.body.mediaType || 'image/jpeg';
      }
    }
    // Method 3: Raw image body
    else if (Buffer.isBuffer(req.body)) {
      console.log('[SCAN] Raw buffer, size:', req.body.length);
      base64Data = req.body.toString('base64');
      mimeType = req.headers['content-type']?.split(';')[0] || 'image/jpeg';
    }
    
    if (!base64Data) {
      return res.status(400).json({ error: 'No image provided' });
    }
    
    const code = generateShortCode();
    console.log('[SCAN] Generated code:', code);
    
    await storage.setJob(`scan:${code}`, {
      imageData: base64Data,
      mediaType: mimeType,
      createdAt: new Date().toISOString(),
    }, 600);
    
    res.json({
      success: true,
      code,
      url: `https://thinx.fun/s/${code}`,
    });
  } catch (error) {
    console.error('[SCAN] Error:', error);
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

// GET /api/scan?img=base64 - Simple GET endpoint for iOS Shortcuts
app.get('/api/scan', async (req, res) => {
  console.log('[SCAN-GET] Request received');
  
  try {
    const img = req.query.img || req.query.image;
    
    if (!img) {
      return res.status(400).json({ error: 'No image. Use ?img=base64data' });
    }
    
    // Decode if URL encoded
    let base64Data = decodeURIComponent(img);
    let mimeType = 'image/jpeg';
    
    // Handle data URL format
    if (base64Data.startsWith('data:')) {
      const matches = base64Data.match(/^data:([^;]+);base64,(.+)$/);
      if (matches) {
        mimeType = matches[1];
        base64Data = matches[2];
      }
    }
    
    const code = generateShortCode();
    console.log('[SCAN-GET] Code:', code, 'size:', base64Data.length);
    
    await storage.setJob(`scan:${code}`, {
      imageData: base64Data,
      mediaType: mimeType,
      createdAt: new Date().toISOString(),
    }, 600);
    
    // Return redirect URL or JSON based on Accept header
    if (req.headers.accept?.includes('text/html')) {
      return res.redirect(`/s/${code}`);
    }
    
    res.json({
      success: true,
      code,
      url: `https://thinx.fun/s/${code}`,
    });
  } catch (error) {
    console.error('[SCAN-GET] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Main route - v2 dynamic layout hub
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'hub-v2.html'));
});

// Legacy /hub route
app.get('/hub', (req, res) => {
  res.redirect('/');
});


// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================
// Debug & Monitoring Endpoints
// ============================================

// All read endpoints require auth. Write endpoints (client reports) are open.
const DEBUG_TOKEN = process.env.DEBUG_TOKEN || 'thinx-debug-2026';

function requireDebugAuth(req, res, next) {
  if (req.query.token === DEBUG_TOKEN || req.headers['x-debug-token'] === DEBUG_TOKEN) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// GET /api/debug/dashboard - Quick at-a-glance production status
app.get('/api/debug/dashboard', requireDebugAuth, (req, res) => {
  res.json(logger.getDashboard());
});

// GET /api/debug/logs - Query raw logs
app.get('/api/debug/logs', requireDebugAuth, (req, res) => {
  const { level, category, limit, since, summary } = req.query;
  if (summary === 'true' || summary === '1') {
    return res.json(logger.getSummary());
  }
  const logs = logger.query({
    level,
    category,
    limit: limit ? parseInt(limit, 10) : 50,
    since,
  });
  res.json({ count: logs.length, logs });
});

// GET /api/debug/pipelines - Pipeline traces
app.get('/api/debug/pipelines', requireDebugAuth, (req, res) => {
  const summary = logger.getSummary();
  res.json({ stats: summary.pipelineStats, pipelines: summary.recentPipelines });
});

// POST /api/debug/client-error - Client error reports (open, no auth)
app.post('/api/debug/client-error', (req, res) => {
  const errorData = req.body || {};
  logger.clientError(errorData);
  res.json({ received: true });
});

// POST /api/debug/client-report - Full client session telemetry (open, no auth)
// Sent by the frontend on EVERY pipeline run (success or failure)
app.post('/api/debug/client-report', (req, res) => {
  const report = req.body || {};
  logger.clientReport(report);
  res.json({ received: true });
});

// ============================================
// Test Report Storage & Admin Dashboard
// Auth: httpOnly session cookie — token never stored client-side
// ============================================
const reportStore = require('./lib/report-store');
reportStore.init(getRedis);

const screenshotCapture = require('./lib/screenshot-capture');
screenshotCapture.init(getRedis);

const liveReports = require('./lib/live-reports');
liveReports.init(getRedis);
const reportRenderer = require('./lib/report-renderer');

const SESSION_COOKIE = 'thinx_sid';
const SESSION_MAX_AGE = 7 * 24 * 3600 * 1000;

function signSession(id) {
  return id + '.' + crypto.createHmac('sha256', DEBUG_TOKEN).update(id).digest('hex').slice(0, 16);
}
function verifySession(cookie) {
  if (!cookie || !cookie.includes('.')) return false;
  const [id, sig] = cookie.split('.');
  return sig === crypto.createHmac('sha256', DEBUG_TOKEN).update(id).digest('hex').slice(0, 16);
}
function setSessionCookie(res) {
  const signed = signSession(crypto.randomBytes(16).toString('hex'));
  res.cookie(SESSION_COOKIE, signed, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: SESSION_MAX_AGE,
    path: '/',
  });
}

// Minimal cookie parser
app.use((req, res, next) => {
  req.cookies = {};
  const raw = req.headers.cookie;
  if (raw) raw.split(';').forEach(p => { const [k, ...v] = p.trim().split('='); if (k) req.cookies[k.trim()] = decodeURIComponent(v.join('=')); });
  next();
});

function requireReportAuth(req, res, next) {
  if (req.cookies[SESSION_COOKIE] && verifySession(req.cookies[SESSION_COOKIE])) return next();
  if (req.headers['x-debug-token'] === DEBUG_TOKEN) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// POST /api/reports/session — Login: validate token in POST body, set httpOnly cookie
app.post('/api/reports/session', (req, res) => {
  if (req.body?.token !== DEBUG_TOKEN) return res.status(401).json({ error: 'Invalid token' });
  setSessionCookie(res);
  res.json({ ok: true });
});

// DELETE /api/reports/session — Logout: clear cookie
app.delete('/api/reports/session', (req, res) => {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ ok: true });
});

// POST /api/reports — Upload report (header auth for CLI tools)
app.post('/api/reports', requireReportAuth, async (req, res) => {
  try {
    const { title, html, meta } = req.body || {};
    if (!html) return res.status(400).json({ error: 'html field is required' });
    const entry = await reportStore.saveReport({ title, html, meta });
    res.json({ ok: true, report: entry });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/reports — List reports
app.get('/api/reports', requireReportAuth, async (req, res) => {
  const reports = await reportStore.listReports();
  const storage = await reportStore.getStorageType();
  res.json({ reports, storage });
});

// GET /api/reports/:id — View report HTML (cookie auth — no token in URL)
app.get('/api/reports/:id', requireReportAuth, async (req, res) => {
  const report = await reportStore.getReport(req.params.id);
  if (!report) return res.status(404).json({ error: 'Report not found' });
  if (req.query.format === 'json') return res.json({ report: report.entry });
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(report.html);
});

// DELETE /api/reports/:id
app.delete('/api/reports/:id', requireReportAuth, async (req, res) => {
  await reportStore.deleteReport(req.params.id);
  res.json({ ok: true });
});

// ============================================
// Screenshot Capture Admin API
// ============================================

// GET /api/captures — List captured screenshots
app.get('/api/captures', requireReportAuth, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = parseInt(req.query.offset) || 0;
  const result = await screenshotCapture.listCaptures({ limit, offset });
  const storage = await screenshotCapture.getStorageType();
  res.json({ ...result, storage });
});

// GET /api/captures/:id/thumb — Serve thumbnail as JPEG
app.get('/api/captures/:id/thumb', requireReportAuth, async (req, res) => {
  const thumb = await screenshotCapture.getCaptureThumbnail(req.params.id);
  if (!thumb) return res.status(404).json({ error: 'Not found' });
  res.set('Content-Type', 'image/jpeg');
  res.send(Buffer.from(thumb, 'base64'));
});

// GET /api/captures/:id/full — Serve full image
app.get('/api/captures/:id/full', requireReportAuth, async (req, res) => {
  const data = await screenshotCapture.getCaptureFullImage(req.params.id);
  if (!data) return res.status(404).json({ error: 'Not found' });
  const mime = data.entry?.mediaType || 'image/png';
  if (req.query.format === 'base64') {
    return res.json({ id: req.params.id, mediaType: mime, base64: data.base64 });
  }
  res.set('Content-Type', mime);
  res.send(Buffer.from(data.base64, 'base64'));
});

// DELETE /api/captures/:id
app.delete('/api/captures/:id', requireReportAuth, async (req, res) => {
  await screenshotCapture.deleteCapture(req.params.id);
  res.json({ ok: true });
});

// GET /reports — Admin dashboard (public page, auth happens via JS + cookie)
app.get('/reports', (req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(getReportsDashboardHtml());
});

function getReportsDashboardHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>thinx.fun — Test Reports</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  :root { --bg: #0a0d12; --surface: #151a22; --surface-2: #1b222c; --border: #1e2736; --text: #e8ecf2; --text-2: #8d99ae; --text-3: #5c6878; --accent: #6c9fff; --green: #5bdb8a; --red: #ff6b6b; --radius: 12px; }
  body { font-family: 'Inter', sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; }
  .container { max-width: 900px; margin: 0 auto; padding: 24px 16px; }
  h1 { font-size: 1.4rem; margin-bottom: 8px; }
  .subtitle { color: var(--text-2); font-size: 0.85rem; margin-bottom: 24px; }
  .auth-gate { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 32px; text-align: center; max-width: 420px; margin: 80px auto; }
  .auth-gate h2 { font-size: 1.1rem; margin-bottom: 16px; }
  .auth-gate p { color: var(--text-2); font-size: 0.85rem; margin-bottom: 20px; }
  .auth-input { display: flex; gap: 8px; }
  .auth-input input { flex: 1; background: var(--surface-2); border: 1px solid var(--border); color: var(--text); padding: 10px 14px; border-radius: 8px; font-size: 0.9rem; }
  .auth-input input:focus { outline: none; border-color: var(--accent); }
  .btn { background: var(--accent); color: #fff; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-size: 0.85rem; font-weight: 600; transition: opacity 0.2s; }
  .btn:hover { opacity: 0.85; }
  .btn-outline { background: transparent; border: 1px solid var(--border); color: var(--text-2); }
  .btn-outline:hover { border-color: var(--accent); color: var(--accent); }
  .auth-error { color: var(--red); font-size: 0.8rem; margin-top: 10px; display: none; }
  .reports-list { display: flex; flex-direction: column; gap: 12px; }
  .report-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px 20px; display: flex; align-items: center; gap: 16px; transition: border-color 0.2s; cursor: pointer; text-decoration: none; color: inherit; }
  .report-card:hover { border-color: var(--accent); }
  .report-icon { font-size: 1.6rem; opacity: 0.5; }
  .report-info { flex: 1; min-width: 0; }
  .report-title { font-weight: 600; font-size: 0.95rem; margin-bottom: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .report-meta { color: var(--text-3); font-size: 0.75rem; display: flex; gap: 12px; flex-wrap: wrap; }
  .report-actions { display: flex; gap: 6px; }
  .empty-state { text-align: center; padding: 60px 20px; color: var(--text-3); }
  .empty-state p { margin-top: 8px; font-size: 0.85rem; }
  .toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
  .badge { font-size: 0.65rem; padding: 2px 8px; border-radius: 100px; font-weight: 600; }
  .badge-count { background: rgba(108,159,255,0.15); color: var(--accent); }
  .badge-warn { background: rgba(255,209,92,0.15); color: #ffd15c; font-size: 0.7rem; margin-left: 8px; }
  .tabs { display: flex; gap: 4px; margin-bottom: 20px; }
  .tab { padding: 8px 16px; border-radius: 8px; font-size: 0.85rem; font-weight: 500; cursor: pointer; background: transparent; border: 1px solid var(--border); color: var(--text-2); transition: all 0.2s; }
  .tab.active { background: var(--accent); color: #fff; border-color: var(--accent); }
  .tab:hover:not(.active) { border-color: var(--accent); color: var(--accent); }
  .captures-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; }
  .capture-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; transition: border-color 0.2s; cursor: pointer; }
  .capture-card:hover { border-color: var(--accent); }
  .capture-thumb { width: 100%; aspect-ratio: 9/16; object-fit: cover; background: #000; display: block; }
  .capture-info { padding: 8px 10px; font-size: 0.7rem; color: var(--text-3); }
  .capture-info .cap-type { color: var(--accent); font-weight: 600; }
  .capture-info .cap-dim { margin-top: 2px; }
  .capture-actions { padding: 4px 10px 8px; }
</style>
</head>
<body>
<div class="container">
  <div id="auth-gate" class="auth-gate">
    <h2>Test Reports</h2>
    <p>Enter your admin token to access pipeline test reports.</p>
    <div class="auth-input">
      <input type="password" id="token-input" placeholder="Admin token" autocomplete="current-password" onkeydown="if(event.key==='Enter')login()" />
      <button class="btn" onclick="login()">Unlock</button>
    </div>
    <div class="auth-error" id="auth-error">Invalid token</div>
  </div>

  <div id="dashboard" style="display:none">
    <h1>Test Reports</h1>
    <div class="subtitle">Pipeline test results against the screenshot dataset</div>
    <div class="toolbar">
      <div class="tabs">
        <div class="tab active" id="tab-reports" onclick="switchTab('reports')">Reports</div>
        <div class="tab" id="tab-captures" onclick="switchTab('captures')">Captures <span class="badge badge-count" id="capture-count" style="margin-left:4px"></span></div>
      </div>
      <button class="btn btn-outline" onclick="logout()" style="font-size:0.75rem;padding:6px 12px;">Logout</button>
    </div>
    <div id="storage-warn-box" style="display:none;margin-bottom:12px;"><span class="badge badge-warn" id="storage-warn"></span></div>
    <div id="panel-reports">
      <div id="reports-list" class="reports-list"></div>
    </div>
    <div id="panel-captures" style="display:none">
      <div id="captures-grid" class="captures-grid"></div>
    </div>
  </div>
</div>
<script>
async function login() {
  var input = document.getElementById('token-input');
  var token = input.value.trim();
  input.value = '';
  if (!token) return;
  var res = await fetch('/api/reports/session', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({token: token}),
    credentials: 'same-origin'
  });
  if (res.ok) { showDashboard(); }
  else {
    document.getElementById('auth-error').style.display = 'block';
    setTimeout(function(){ document.getElementById('auth-error').style.display='none'; }, 3000);
  }
}
var currentTab = 'reports';
async function showDashboard() {
  document.getElementById('auth-gate').style.display = 'none';
  document.getElementById('dashboard').style.display = 'block';
  await loadReports();
  loadCaptures();
}
function switchTab(tab) {
  currentTab = tab;
  document.getElementById('tab-reports').className = 'tab' + (tab==='reports'?' active':'');
  document.getElementById('tab-captures').className = 'tab' + (tab==='captures'?' active':'');
  document.getElementById('panel-reports').style.display = tab==='reports'?'':'none';
  document.getElementById('panel-captures').style.display = tab==='captures'?'':'none';
  if (tab==='captures') loadCaptures();
}
async function loadReports() {
  var res = await fetch('/api/reports', {credentials:'same-origin'});
  if (res.status === 401) { logout(); return; }
  if (!res.ok) return;
  var data = await res.json();
  var reports = data.reports;
  document.getElementById('report-count').textContent = reports.length + ' report' + (reports.length !== 1 ? 's' : '');
  var warn = document.getElementById('storage-warn');
  var warnBox = document.getElementById('storage-warn-box');
  if (data.storage === 'memory') { warn.textContent = 'ephemeral storage — data lost on redeploy'; warnBox.style.display = ''; }
  else { warnBox.style.display = 'none'; }
  var list = document.getElementById('reports-list');
  if (!reports.length) {
    list.innerHTML = '<div class="empty-state"><div style="font-size:2rem;opacity:0.3">&#128202;</div><p>No reports yet.<br>Run: <code>npm run dataset:pipeline</code></p></div>';
    return;
  }
  list.innerHTML = reports.map(function(r) {
    var ago = timeSince(new Date(r.createdAt));
    var kb = Math.round(r.size/1024);
    var sc = r.meta&&r.meta.screenshotCount||'?';
    var ok = r.meta&&r.meta.succeeded||'?';
    return '<a class="report-card" href="/api/reports/'+esc(r.id)+'" target="_blank">' +
      '<div class="report-icon">&#128196;</div><div class="report-info">' +
      '<div class="report-title">'+esc(r.title)+'</div>' +
      '<div class="report-meta"><span>'+ago+'</span><span>'+sc+' screenshots</span><span>'+ok+' ok</span><span>'+kb+'KB</span></div>' +
      '</div><div class="report-actions" onclick="event.preventDefault();event.stopPropagation();">' +
      '<button class="btn btn-outline" style="font-size:0.7rem;padding:4px 10px;" onclick="del(\\''+esc(r.id)+'\\')">Delete</button></div></a>';
  }).join('');
}
async function del(id) {
  if (!confirm('Delete this report?')) return;
  await fetch('/api/reports/'+id, {method:'DELETE',credentials:'same-origin'});
  await loadReports();
}
async function loadCaptures() {
  var res = await fetch('/api/captures',{credentials:'same-origin'});
  if (!res.ok) return;
  var data = await res.json();
  document.getElementById('capture-count').textContent = data.total || 0;
  var grid = document.getElementById('captures-grid');
  if (!data.captures.length) {
    grid.innerHTML = '<div class="empty-state"><div style="font-size:2rem;opacity:0.3">&#128247;</div><p>No captured screenshots yet.<br>Screenshots are captured automatically from production usage.</p></div>';
    return;
  }
  grid.innerHTML = data.captures.map(function(c) {
    var ago = timeSince(new Date(c.capturedAt));
    return '<div class="capture-card" onclick="window.open(\\'/api/captures/'+esc(c.id)+'/full\\',\\'_blank\\')">' +
      '<img class="capture-thumb" src="/api/captures/'+esc(c.id)+'/thumb" loading="lazy" alt="" />' +
      '<div class="capture-info">' +
        '<div class="cap-type">'+ esc(c.contentType||'unknown') + (c.platform?' · '+esc(c.platform):'') +'</div>' +
        '<div class="cap-dim">'+c.width+'x'+c.height+' · '+ago+'</div>' +
      '</div>' +
      '<div class="capture-actions" onclick="event.stopPropagation()">' +
        '<button class="btn btn-outline" style="font-size:0.65rem;padding:3px 8px;" onclick="delCapture(\\''+esc(c.id)+'\\')">Delete</button>' +
      '</div>' +
    '</div>';
  }).join('');
}
async function delCapture(id) {
  if (!confirm('Delete this captured screenshot?')) return;
  await fetch('/api/captures/'+id,{method:'DELETE',credentials:'same-origin'});
  await loadCaptures();
}
async function logout() {
  await fetch('/api/reports/session', {method:'DELETE',credentials:'same-origin'});
  document.getElementById('auth-gate').style.display = '';
  document.getElementById('dashboard').style.display = 'none';
}
function esc(s){var d=document.createElement('div');d.textContent=s;return d.innerHTML;}
function timeSince(d){var s=Math.floor((Date.now()-d.getTime())/1000);if(s<60)return'just now';if(s<3600)return Math.floor(s/60)+'m ago';if(s<86400)return Math.floor(s/3600)+'h ago';return Math.floor(s/86400)+'d ago';}
(async function(){
  var res = await fetch('/api/reports',{credentials:'same-origin'});
  if(res.ok) showDashboard();
})();
</script>
</body>
</html>`;
}

// ============================================
// Keypoints Extraction API
// Extract structured keypoints from screenshots with card-based navigation
// ============================================
const { extractKeypoints } = require('./generators/keypoint-extractor');

app.post('/api/keypoints', upload.single('image'), async (req, res) => {
  try {
    let imageData = null;
    let mediaType = null;

    // Handle JSON request with base64 image (from Apple Shortcuts)
    if (req.is('application/json') || (req.body && req.body.image && typeof req.body.image === 'string')) {
      const body = req.body;

      if (!body.image) {
        return res.status(400).json({ error: 'No image provided' });
      }

      let base64Data = body.image;

      // Extract media type and data from data URL if present
      if (base64Data.startsWith('data:')) {
        const matches = base64Data.match(/^data:([^;]+);base64,(.+)$/);
        if (matches) {
          mediaType = matches[1];
          base64Data = matches[2];
        } else {
          return res.status(400).json({ error: 'Invalid image format' });
        }
      } else {
        mediaType = body.mediaType || body.media_type || 'image/png';
      }

      // Validate base64 format
      if (!/^[A-Za-z0-9+/]+=*$/.test(base64Data)) {
        return res.status(400).json({ error: 'Invalid base64 data' });
      }

      imageData = base64Data;

    } else if (req.file) {
      // Traditional multipart file upload
      imageData = req.file.buffer.toString('base64');
      mediaType = req.file.mimetype;
    } else {
      return res.status(400).json({
        error: 'No image provided',
        message: 'Provide image as multipart form-data or JSON with base64'
      });
    }

    // Validate media type
    const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!validTypes.includes(mediaType)) {
      return res.status(400).json({
        error: 'Invalid image type',
        message: `Supported: JPEG, PNG, GIF, WebP. Got: ${mediaType}`
      });
    }

    console.log('[KEYPOINTS] Extracting keypoints from image...');

    // Extract keypoints using Claude Vision
    const result = await extractKeypoints({
      imageData,
      mediaType,
      adapterConfig: {
        provider: 'claude', // Use Claude for best vision analysis
      },
    });

    console.log('[KEYPOINTS] Extraction complete:', result.keypoints.length, 'keypoints found');

    res.json({
      success: true,
      overview: result.overview,
      keypoints: result.keypoints,
      trails: result.trails,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('[KEYPOINTS] Error:', error);
    res.status(500).json({
      error: 'Keypoint extraction failed',
      message: error.message
    });
  }
});

// ============================================
// Shared Utilities
// ============================================
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

// ============================================
// Content Layout Pipeline
// Screenshot → Layout Designer → Parallel Card Research → Populated Layout
// ============================================
const { runPipeline } = require('./agents/orchestrator-v2');

// In-memory pipeline job store (keyed by requestId)
const pipelineJobs = new Map();

// Step 1: POST image, get requestId immediately (no SSE, fast response)
app.post('/api/hub/v2/start', async (req, res) => {
  try {
    const { image, question, mediaType: rawMediaType } = req.body || {};
    const normalized = normalizeImagePayload({ image, mediaType: rawMediaType });
    const requestId = crypto.randomUUID().slice(0, 8);

    pipelineJobs.set(requestId, {
      imageData: normalized.imageData,
      mediaType: normalized.mediaType,
      question: question || null,
      createdAt: Date.now(),
    });

    // Evict old jobs (keep last 50)
    if (pipelineJobs.size > 50) {
      const oldest = pipelineJobs.keys().next().value;
      pipelineJobs.delete(oldest);
    }

    // Capture screenshot for test dataset (async, non-blocking)
    // Hold a direct reference — the job may be removed from the map before capture completes
    const jobRef = pipelineJobs.get(requestId);
    screenshotCapture.captureScreenshot({
      base64Data: normalized.imageData,
      mediaType: normalized.mediaType,
      requestId,
    }).then(entry => {
      if (entry && jobRef) {
        jobRef._captureId = entry.id;
        logger.info('Capture', `Saved screenshot ${entry.id}`, { requestId, w: entry.width, h: entry.height, size: entry.originalSize });
      }
    }).catch(() => {});

    res.json({ requestId });
  } catch (error) {
    logger.error('PipelineStart', 'Failed to start', { err: error.message });
    res.status(400).json({ error: error.message });
  }
});

// Step 2: GET SSE stream for a requestId (mobile-friendly streaming)
app.get('/api/hub/v2/stream/:requestId', async (req, res) => {
  const { requestId } = req.params;
  const job = pipelineJobs.get(requestId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found or expired' });
  }

  // Remove from store (one-time use)
  pipelineJobs.delete(requestId);

  let streamEnded = false;
  let keepAlive = null;

  const endStream = () => {
    if (streamEnded) return;
    streamEnded = true;
    if (!res.writableEnded && !res.destroyed) {
      res.end();
    }
  };

  const sendEvent = (event, data) => {
    if (streamEnded || res.closed || res.destroyed || res.writableEnded) return;
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      if (res.flush) res.flush();
      logger.pipelineEvent(requestId, event);
    } catch (err) {
      logger.error('SSE', `Failed to send ${event}`, { requestId, err: err.message });
      endStream();
    }
  };

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Padding flush to push through proxy/CDN buffers
  res.write(`:${' '.repeat(2048)}\n\n`);
  if (res.flush) res.flush();

  if (res.socket) res.socket.setNoDelay(true);

  res.on('close', () => {
    if (!streamEnded) logger.sseDisconnect(requestId);
    streamEnded = true;
  });

  keepAlive = setInterval(() => {
    if (!streamEnded) {
      try { res.write(`: ping ${Date.now()}\n\n`); if (res.flush) res.flush(); } catch {}
    }
  }, 5000);

  const imageSize = job.imageData ? Math.round(job.imageData.length * 0.75 / 1024) : 0;
  logger.startPipeline(requestId, {
    mediaType: job.mediaType,
    imageSize: `${imageSize}KB`,
    hasQuestion: !!job.question,
    method: 'GET-stream',
  });

  sendEvent('connected', { message: 'Pipeline started', requestId, timestamp: new Date().toISOString() });

  try {
    await runPipeline({
      imageData: job.imageData,
      mediaType: job.mediaType,
      question: job.question,

      onProgress: (progress) => {
        logger.pipelinePhase(requestId, progress.phase || 'progress', { progress: progress.progress });
        sendEvent('progress', progress);
      },

      onBlueprint: (blueprint) => {
        logger.pipelinePhase(requestId, 'skeleton', { cardCount: (blueprint.cards || []).length, layoutType: blueprint.layout?.type || 'unknown' });
        sendEvent('blueprint', blueprint);
      },

      onLayoutPreview: (blueprint) => {
        logger.pipelinePhase(requestId, 'fast_classify', { cardCount: (blueprint.cards || []).length, layoutType: blueprint.layout?.type || 'unknown', contentType: blueprint.contentAnalysis?.contentType });
        sendEvent('layout_preview', blueprint);
      },

      onLayoutUpdate: (blueprint) => {
        logger.pipelinePhase(requestId, 'blueprint', { cardCount: (blueprint.cards || []).length, layoutType: blueprint.layout?.type || 'unknown' });
        sendEvent('layout_update', blueprint);

        const captureId = job._captureId;
        if (captureId) {
          screenshotCapture.updateCapturePipelineResult(captureId, {
            contentType: blueprint.contentAnalysis?.contentType,
            platform: blueprint.contentAnalysis?.platform,
            layoutType: blueprint.layout?.type,
            cardCount: (blueprint.cards || []).length,
          }).catch(() => {});
        }
      },

      onCardPopulated: (cardUpdate) => {
        logger.pipelineEvent(requestId, 'card', { cardId: cardUpdate.cardId, cardType: cardUpdate.cardType, completed: `${cardUpdate.completedCount}/${cardUpdate.totalCount}` });
        sendEvent('card', cardUpdate);
      },

      onComplete: (populatedLayout) => {
        clearInterval(keepAlive);
        logger.pipelineComplete(requestId, { cardCount: populatedLayout.cards?.length, layoutType: populatedLayout.layout?.type, designDuration: populatedLayout._meta?.designDuration });
        sendEvent('complete', { layout: populatedLayout.layout, contentAnalysis: populatedLayout.contentAnalysis, meta: populatedLayout._meta });
        endStream();

        // Auto-save live report (async, non-blocking)
        (async () => {
          try {
            let thumb = null;
            if (job._captureId) {
              thumb = await screenshotCapture.getCaptureThumbnail(job._captureId);
            }
            await liveReports.saveLiveReport(requestId, {
              contentType: populatedLayout.contentAnalysis?.contentType,
              platform: populatedLayout.contentAnalysis?.platform,
              layoutType: populatedLayout.layout?.type,
              cardCount: populatedLayout.cards?.length,
              duration: populatedLayout._meta?.totalDuration,
              designDuration: populatedLayout._meta?.designDuration,
              outcome: 'success',
              imageSize: `${imageSize}KB`,
              mediaType: job.mediaType,
              contentAnalysis: populatedLayout.contentAnalysis,
              layout: populatedLayout.layout,
              cards: populatedLayout.cards,
              meta: populatedLayout._meta,
              thumb,
            });
            logger.info('LiveReport', `Saved live report ${requestId}`, { requestId });
          } catch (err) {
            logger.warn('LiveReport', `Failed to save report: ${err.message}`, { requestId });
          }
        })();
      },

      onError: (error) => {
        clearInterval(keepAlive);
        logger.pipelineError(requestId, error, { phase: 'pipeline' });
        sendEvent('error', { message: error.message });
        endStream();

        // Save failed report too
        liveReports.saveLiveReport(requestId, {
          outcome: 'error',
          error: error.message,
          imageSize: `${imageSize}KB`,
          mediaType: job.mediaType,
        }).catch(() => {});
      },
    });
  } catch (error) {
    logger.pipelineError(requestId, error, { phase: 'catch' });
    if (keepAlive) clearInterval(keepAlive);
    sendEvent('error', { message: error.message || 'Pipeline failed' });
    endStream();
  }
});

// Hub v2 analyze - legacy SSE endpoint (POST-based, kept for backward compat)
app.post('/api/hub/v2/analyze', async (req, res) => {
  const requestId = crypto.randomUUID().slice(0, 8);

  // Declare stream helpers OUTSIDE try so they're accessible in catch
  let streamEnded = false;
  let keepAlive = null;

  const endStream = () => {
    if (streamEnded) return;
    streamEnded = true;
    if (!res.writableEnded && !res.destroyed) {
      res.end();
    }
  };

  const sendEvent = (event, data) => {
    if (streamEnded || res.closed || res.destroyed || res.writableEnded) return;
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      if (res.flush) res.flush();
      logger.pipelineEvent(requestId, event);
    } catch (err) {
      logger.error('SSE', `Failed to send ${event}`, { requestId, err: err.message });
      endStream();
    }
  };

  try {
    const { image, question, mediaType: rawMediaType } = req.body || {};
    const normalized = normalizeImagePayload({ image, mediaType: rawMediaType });

    const imageSize = normalized.imageData ? Math.round(normalized.imageData.length * 0.75 / 1024) : 0;
    logger.startPipeline(requestId, {
      mediaType: normalized.mediaType,
      imageSize: `${imageSize}KB`,
      hasQuestion: !!question,
    });

    if (!process.env.ANTHROPIC_API_KEY) {
      logger.error('Pipeline', 'Missing ANTHROPIC_API_KEY', { requestId });
      return res.status(500).json({
        error: 'API Configuration Missing',
        message: 'ANTHROPIC_API_KEY is not configured.',
      });
    }

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Padding flush: push 2KB through proxy/edge buffers to start streaming immediately.
    // Without this, Vercel/CDN/carrier proxies may buffer the entire response.
    res.write(`:${' '.repeat(2048)}\n\n`);
    if (res.flush) res.flush();

    // Disable Nagle's algorithm for lower latency if socket is accessible
    if (res.socket) {
      res.socket.setNoDelay(true);
    }

    res.on('close', () => {
      if (!streamEnded) {
        logger.warn('SSE', 'Client disconnected', { requestId });
      }
      streamEnded = true;
    });

    // Keep-alive every 5s (was 15s) -- more frequent pings push data through buffers
    keepAlive = setInterval(() => {
      if (!streamEnded) {
        try { res.write(`: ping ${Date.now()}\n\n`); if (res.flush) res.flush(); } catch {}
      }
    }, 5000);

    sendEvent('connected', { message: 'Pipeline started', requestId, timestamp: new Date().toISOString() });

    await runPipeline({
      imageData: normalized.imageData,
      mediaType: normalized.mediaType,
      question,

      onProgress: (progress) => {
        logger.pipelinePhase(requestId, progress.phase || 'progress', { progress: progress.progress });
        sendEvent('progress', progress);
      },

      onBlueprint: (blueprint) => {
        const cardCount = (blueprint.cards || []).length;
        const layoutType = blueprint.layout?.type || 'unknown';
        logger.pipelinePhase(requestId, 'skeleton', { cardCount, layoutType });
        sendEvent('blueprint', blueprint);
      },

      onLayoutPreview: (blueprint) => {
        const cardCount = (blueprint.cards || []).length;
        const layoutType = blueprint.layout?.type || 'unknown';
        logger.pipelinePhase(requestId, 'fast_classify', { cardCount, layoutType, contentType: blueprint.contentAnalysis?.contentType });
        sendEvent('layout_preview', blueprint);
      },

      onLayoutUpdate: (blueprint) => {
        const cardCount = (blueprint.cards || []).length;
        const layoutType = blueprint.layout?.type || 'unknown';
        logger.pipelinePhase(requestId, 'blueprint', { cardCount, layoutType });
        sendEvent('layout_update', blueprint);
      },

      onCardPopulated: (cardUpdate) => {
        logger.pipelineEvent(requestId, 'card', {
          cardId: cardUpdate.cardId,
          cardType: cardUpdate.cardType,
          completed: `${cardUpdate.completedCount}/${cardUpdate.totalCount}`,
        });
        sendEvent('card', cardUpdate);
      },

      onComplete: (populatedLayout) => {
        clearInterval(keepAlive);
        logger.pipelineComplete(requestId, {
          cardCount: populatedLayout.cards?.length,
          layoutType: populatedLayout.layout?.type,
          designDuration: populatedLayout._meta?.designDuration,
        });
        sendEvent('complete', {
          layout: populatedLayout.layout,
          contentAnalysis: populatedLayout.contentAnalysis,
          meta: populatedLayout._meta,
        });
        endStream();

        // Auto-save live report (async, non-blocking)
        liveReports.saveLiveReport(requestId, {
          contentType: populatedLayout.contentAnalysis?.contentType,
          platform: populatedLayout.contentAnalysis?.platform,
          layoutType: populatedLayout.layout?.type,
          cardCount: populatedLayout.cards?.length,
          duration: populatedLayout._meta?.totalDuration,
          designDuration: populatedLayout._meta?.designDuration,
          outcome: 'success',
          imageSize: `${imageSize}KB`,
          mediaType: normalized.mediaType,
          contentAnalysis: populatedLayout.contentAnalysis,
          layout: populatedLayout.layout,
          cards: populatedLayout.cards,
          meta: populatedLayout._meta,
        }).catch(() => {});
      },

      onError: (error) => {
        clearInterval(keepAlive);
        logger.pipelineError(requestId, error, { phase: 'pipeline' });
        sendEvent('error', { message: error.message });
        endStream();

        liveReports.saveLiveReport(requestId, {
          outcome: 'error',
          error: error.message,
          imageSize: `${imageSize}KB`,
          mediaType: normalized.mediaType,
        }).catch(() => {});
      },
    });
  } catch (error) {
    logger.pipelineError(requestId, error, { phase: 'catch', headersSent: res.headersSent });
    if (keepAlive) clearInterval(keepAlive);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Pipeline failed', message: error.message });
    } else {
      sendEvent('error', { message: error.message || 'Pipeline failed' });
      endStream();
    }
  }
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

// ============================================
// Live Run Reports — public with 4-digit PIN
// ============================================
const REPORT_PIN = process.env.REPORT_PIN || '0427';
const RPIN_COOKIE = 'thinx_rpin';
const RPIN_MAX_AGE = 3600 * 1000; // 1 hour

function signPin(pin) {
  return pin + '.' + crypto.createHmac('sha256', REPORT_PIN).update(pin).digest('hex').slice(0, 12);
}
function verifyPin(cookie) {
  if (!cookie || !cookie.includes('.')) return false;
  const [pin, sig] = cookie.split('.');
  return pin === REPORT_PIN && sig === crypto.createHmac('sha256', REPORT_PIN).update(pin).digest('hex').slice(0, 12);
}

// PIN verification endpoint
app.post('/api/r/auth', (req, res) => {
  const { pin } = req.body || {};
  if (String(pin) !== REPORT_PIN) return res.status(401).json({ error: 'Invalid PIN' });
  res.cookie(RPIN_COOKIE, signPin(REPORT_PIN), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: RPIN_MAX_AGE,
    path: '/',
  });
  res.json({ ok: true });
});

function requirePin(req, res, next) {
  if (req.cookies[RPIN_COOKIE] && verifyPin(req.cookies[RPIN_COOKIE])) return next();
  return res.status(401).json({ error: 'PIN required' });
}

// JSON API for report data (PIN-protected)
app.get('/api/r/list', requirePin, async (req, res) => {
  const live = await liveReports.listLiveReports();
  res.json({ reports: live });
});

app.get('/api/r/search', requirePin, async (req, res) => {
  const { q, contentType, layoutType, outcome, from, to, cardType, limit, offset } = req.query;
  const result = await liveReports.searchArchive({
    q, contentType, layoutType, outcome, from, to, cardType,
    limit: Math.min(parseInt(limit) || 50, 200),
    offset: parseInt(offset) || 0,
  });
  res.json(result);
});

app.get('/api/r/:requestId/data', requirePin, async (req, res) => {
  const report = await liveReports.getReport(req.params.requestId);
  if (!report) return res.status(404).json({ error: 'Report not found or expired' });
  const { thumb, ...data } = report;
  res.json({ report: data, hasThumb: !!thumb });
});

app.get('/api/r/:requestId/thumb', requirePin, async (req, res) => {
  const thumb = await liveReports.getReportThumb(req.params.requestId);
  if (!thumb) return res.status(404).json({ error: 'No thumbnail' });
  res.set('Content-Type', 'image/jpeg');
  res.send(Buffer.from(thumb, 'base64'));
});

// Public report pages (HTML — PIN gate is client-side JS calling /api/r/auth)
app.get('/r', (req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(getLiveReportIndexHtml());
});

app.get('/r/:requestId', async (req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8');
  const authed = !!(req.cookies[RPIN_COOKIE] && verifyPin(req.cookies[RPIN_COOKIE]));
  if (authed) {
    const report = await liveReports.getReport(req.params.requestId);
    const thumb = report ? await liveReports.getReportThumb(req.params.requestId) : null;
    res.send(getLiveReportViewerHtml(req.params.requestId, report, thumb, true));
  } else {
    res.send(getLiveReportViewerHtml(req.params.requestId, null, null, false));
  }
});

function getLiveReportIndexHtml() {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>thinx.fun — Live Reports</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#0a0d12;--s:#151a22;--s2:#1b222c;--b:#1e2736;--b2:#2d3a4e;--t:#e8ecf2;--t2:#8d99ae;--t3:#5c6878;--a:#6c9fff;--g:#5bdb8a;--r:#ff6b6b;--y:#ffd15c;--rad:12px}
body{font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;background:var(--bg);color:var(--t);min-height:100vh}
.wrap{max-width:640px;margin:0 auto;padding:24px 16px}
h1{font-size:1.4rem;font-weight:700;margin-bottom:4px}
.sub{color:var(--t2);font-size:.82rem;margin-bottom:24px}
.pin-gate{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;gap:16px}
.pin-gate h2{font-size:1.1rem;color:var(--t2);font-weight:500}
.pin-row{display:flex;gap:8px}
.pin-box{width:48px;height:56px;background:var(--s);border:2px solid var(--b);border-radius:var(--rad);text-align:center;font-size:1.5rem;font-weight:700;color:var(--a);caret-color:var(--a);outline:none;transition:border-color .2s}
.pin-box:focus{border-color:var(--a)}
.pin-err{color:var(--r);font-size:.8rem;height:20px}
.content{display:none}
.badge{display:inline-block;padding:2px 10px;border-radius:100px;font-size:.68rem;font-weight:600;text-transform:uppercase;letter-spacing:.04em}
.badge-g{background:rgba(91,219,138,.12);color:var(--g)}
.badge-r{background:rgba(255,107,107,.12);color:var(--r)}
.badge-a{background:rgba(108,159,255,.1);color:var(--a)}
.badge-y{background:rgba(255,209,92,.1);color:var(--y)}
.empty{text-align:center;color:var(--t3);padding:48px 16px;font-size:.9rem}
.rlist{display:flex;flex-direction:column;gap:10px}
.rcard{display:flex;align-items:center;gap:14px;padding:14px 16px;background:var(--s);border:1px solid var(--b);border-radius:var(--rad);text-decoration:none;color:inherit;transition:border-color .2s,transform .15s}
.rcard:hover{border-color:var(--a);transform:translateY(-1px)}
.rcard .thumb{width:48px;height:48px;border-radius:8px;object-fit:cover;background:var(--s2);flex-shrink:0}
.rcard .info{flex:1;min-width:0}
.rcard .rid{font-family:'SF Mono',monospace;font-weight:700;font-size:.9rem;color:var(--a)}
.rcard .meta{font-size:.75rem;color:var(--t2);margin-top:3px;display:flex;flex-wrap:wrap;gap:8px}
.rcard .meta span{white-space:nowrap}
.rcard .arrow{color:var(--t3);font-size:1.2rem}
.refresh-btn{background:var(--s);border:1px solid var(--b);color:var(--t2);padding:6px 14px;border-radius:100px;font-size:.75rem;cursor:pointer;transition:border-color .2s}
.refresh-btn:hover{border-color:var(--a);color:var(--a)}
.hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
.tabs{display:flex;gap:4px;margin-bottom:14px;background:var(--s);border-radius:10px;padding:3px;border:1px solid var(--b)}
.tab{flex:1;background:none;border:none;color:var(--t3);font-size:.78rem;font-weight:600;padding:8px 0;border-radius:8px;cursor:pointer;font-family:inherit;transition:all .2s}
.tab.active{background:var(--a);color:#fff}
.search-bar{margin-bottom:14px}
.search-input{width:100%;background:var(--s);border:1px solid var(--b);border-radius:var(--rad);padding:10px 14px;color:var(--t);font-size:.84rem;font-family:inherit;outline:none;transition:border-color .2s}
.search-input:focus{border-color:var(--a)}
.search-input::placeholder{color:var(--t3)}
.search-filters{display:flex;gap:8px;margin-top:8px}
.search-filters select{background:var(--s);border:1px solid var(--b);border-radius:8px;padding:6px 10px;color:var(--t2);font-size:.74rem;font-family:inherit;outline:none;cursor:pointer;flex:1}
.search-count{font-size:.74rem;color:var(--t3);text-align:center;padding:8px 0}
.rcard .title{font-size:.78rem;color:var(--t);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
</style>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
</head><body>
<div class="wrap">
<div id="gate" class="pin-gate">
  <h2>Enter 4-digit PIN</h2>
  <div class="pin-row">
    <input class="pin-box" type="tel" maxlength="1" inputmode="numeric" autofocus>
    <input class="pin-box" type="tel" maxlength="1" inputmode="numeric">
    <input class="pin-box" type="tel" maxlength="1" inputmode="numeric">
    <input class="pin-box" type="tel" maxlength="1" inputmode="numeric">
  </div>
  <div class="pin-err" id="pin-err"></div>
</div>
<div id="content" class="content">
  <div class="hdr">
    <div><h1>Pipeline Reports</h1><div class="sub">Auto-generated for every production run</div></div>
    <button class="refresh-btn" onclick="loadCurrent()">Refresh</button>
  </div>
  <div class="tabs"><button class="tab active" id="tab-live" onclick="switchTab('live')">Live</button><button class="tab" id="tab-all" onclick="switchTab('all')">All Reports</button></div>
  <div id="search-bar" class="search-bar" style="display:none"><input type="text" id="search-input" placeholder="Search by title, content type, platform..." class="search-input" oninput="debounceSearch()"><div class="search-filters"><select id="f-outcome" onchange="doSearch()"><option value="">Any outcome</option><option value="success">Success</option><option value="error">Error</option></select><select id="f-layout" onchange="doSearch()"><option value="">Any layout</option><option value="editorial">Editorial</option><option value="dashboard">Dashboard</option><option value="product_showcase">Product</option><option value="social_feed">Social</option><option value="investigation">Investigation</option><option value="simple">Simple</option></select></div></div>
  <div id="list" class="rlist"><div class="empty">Loading...</div></div>
  <div id="search-count" class="search-count" style="display:none"></div>
</div>
</div>
<script>
var boxes=document.querySelectorAll('.pin-box');
boxes.forEach(function(b,i){
  b.addEventListener('input',function(){
    if(b.value.length===1&&i<3)boxes[i+1].focus();
    if(i===3&&b.value.length===1)tryPin();
  });
  b.addEventListener('keydown',function(e){
    if(e.key==='Backspace'&&!b.value&&i>0){boxes[i-1].focus();boxes[i-1].value='';}
  });
  b.addEventListener('paste',function(e){
    e.preventDefault();
    var d=(e.clipboardData||window.clipboardData).getData('text').replace(/\\D/g,'').slice(0,4);
    for(var j=0;j<d.length&&j<4;j++){boxes[j].value=d[j];}
    if(d.length>=4)tryPin();
  });
});
async function tryPin(){
  var pin=Array.from(boxes).map(function(b){return b.value}).join('');
  if(pin.length!==4)return;
  var r=await fetch('/api/r/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:pin}),credentials:'same-origin'});
  if(r.ok){document.getElementById('gate').style.display='none';document.getElementById('content').style.display='block';loadList();}
  else{document.getElementById('pin-err').textContent='Wrong PIN';boxes.forEach(function(b){b.value='';});boxes[0].focus();}
}
function esc(s){var d=document.createElement('div');d.textContent=String(s||'');return d.innerHTML;}
function timeSince(d){var s=Math.floor((Date.now()-new Date(d).getTime())/1000);if(s<60)return'just now';if(s<3600)return Math.floor(s/60)+'m ago';if(s<86400)return Math.floor(s/3600)+'h ago';return Math.floor(s/86400)+'d ago';}
function ttlLeft(d){if(!d)return'';var ms=new Date(d).getTime()-Date.now();if(ms<=0)return'expired';return Math.floor(ms/60000)+'m left';}
var currentTab='live';
function switchTab(t){
  currentTab=t;
  document.getElementById('tab-live').className='tab'+(t==='live'?' active':'');
  document.getElementById('tab-all').className='tab'+(t==='all'?' active':'');
  document.getElementById('search-bar').style.display=t==='all'?'':'none';
  document.getElementById('search-count').style.display='none';
  loadCurrent();
}
function loadCurrent(){if(currentTab==='live')loadLive();else doSearch();}
function renderCard(r,isLive){
  var badge=r.outcome==='success'?'<span class="badge badge-g">success</span>':'<span class="badge badge-r">'+(r.outcome||'?')+'</span>';
  var ttl=isLive&&r.expiresAt?'<span class="badge badge-y">'+ttlLeft(r.expiresAt)+'</span>':'';
  return '<a class="rcard" href="/r/'+esc(r.requestId)+'">'
    +(r.hasThumb?'<img class="thumb" src="/api/r/'+esc(r.requestId)+'/thumb" alt="">':'<div class="thumb"></div>')
    +'<div class="info"><div class="rid">'+esc(r.requestId)+' '+badge+' '+ttl+'</div>'
    +(r.heroTitle?'<div class="title">'+esc(r.heroTitle)+'</div>':'')
    +'<div class="meta"><span>'+timeSince(r.createdAt)+'</span>'
    +(r.contentType?'<span>'+esc(r.contentType)+'</span>':'')
    +(r.layoutType?'<span>'+esc(r.layoutType)+'</span>':'')
    +(r.cardCount?'<span>'+r.cardCount+' cards</span>':'')
    +(r.duration?'<span>'+Math.round(r.duration/1000)+'s</span>':'')
    +'</div></div><span class="arrow">&#8250;</span></a>';
}
async function loadLive(){
  var r=await fetch('/api/r/list',{credentials:'same-origin'});
  if(r.status===401){document.getElementById('gate').style.display='flex';document.getElementById('content').style.display='none';return;}
  var data=await r.json();
  var el=document.getElementById('list');
  if(!data.reports||!data.reports.length){el.innerHTML='<div class="empty">No live reports yet. Analyze a screenshot to generate one.</div>';return;}
  el.innerHTML=data.reports.map(function(r){return renderCard(r,true);}).join('');
}
var searchTimer;
function debounceSearch(){clearTimeout(searchTimer);searchTimer=setTimeout(doSearch,300);}
async function doSearch(){
  var q=document.getElementById('search-input').value;
  var outcome=document.getElementById('f-outcome').value;
  var layout=document.getElementById('f-layout').value;
  var params=new URLSearchParams();
  if(q)params.set('q',q);
  if(outcome)params.set('outcome',outcome);
  if(layout)params.set('layoutType',layout);
  params.set('limit','100');
  var r=await fetch('/api/r/search?'+params.toString(),{credentials:'same-origin'});
  if(r.status===401){document.getElementById('gate').style.display='flex';document.getElementById('content').style.display='none';return;}
  var data=await r.json();
  var el=document.getElementById('list');
  var countEl=document.getElementById('search-count');
  countEl.style.display='block';
  countEl.textContent=data.total+' report'+(data.total!==1?'s':'')+' found';
  if(!data.reports||!data.reports.length){el.innerHTML='<div class="empty">No reports match your search.</div>';return;}
  el.innerHTML=data.reports.map(function(r){return renderCard(r,false);}).join('');
}
(async function(){var r=await fetch('/api/r/list',{credentials:'same-origin'});if(r.ok){document.getElementById('gate').style.display='none';document.getElementById('content').style.display='block';loadLive();}})();
</script>
</body></html>`;
}

function getLiveReportViewerHtml(requestId, report, thumbBase64, isAuthenticated) {
  const { renderCardHtml, renderReflection, esc, fmtMs } = reportRenderer;

  // If no report data, show just the PIN gate (client-side JS will redirect after auth)
  const hasReport = !!report;
  const showPinGate = !isAuthenticated;
  const showExpired = isAuthenticated && !hasReport;

  function timeSince(ts) {
    const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    return Math.floor(s / 3600) + 'h ago';
  }
  function ttlLeft(ts) {
    const ms = new Date(ts).getTime() - Date.now();
    if (ms <= 0) return 'expired';
    return Math.floor(ms / 60000) + 'm left';
  }

  let reportHtml = '';
  if (hasReport && report.outcome !== undefined) {
    const cards = report.cards || [];
    const ca = report.contentAnalysis || {};
    const meta = report.meta || {};
    const duration = meta.totalDuration || report.duration;
    const designDur = meta.designDuration || report.designDuration;
    const researchDur = duration && designDur ? duration - designDur : null;
    const reflectionLines = renderReflection(report);

    // Screenshot + analysis header
    const thumbTag = thumbBase64 ? '<img class="report-thumb" src="data:image/jpeg;base64,' + thumbBase64 + '" alt="Screenshot">' : '';

    reportHtml = '<a class="back" href="/r">&lsaquo; All Reports</a>'
      + '<h1>Pipeline Report <code>' + esc(requestId) + '</code></h1>'
      + '<div class="sub">' + timeSince(report.createdAt) + ' &middot; <span class="badge badge-y">' + ttlLeft(report.expiresAt) + '</span>'
      + ' &middot; <span class="badge ' + (report.outcome === 'success' ? 'badge-g' : 'badge-r') + '">' + esc(report.outcome) + '</span></div>'

      // Stats row
      + '<div class="stats">'
      + '<div class="stat"><div class="sv">' + (duration ? fmtMs(duration) : '—') + '</div><div class="sl">Duration</div></div>'
      + '<div class="stat"><div class="sv">' + (cards.length || '—') + '</div><div class="sl">Cards</div></div>'
      + '<div class="stat"><div class="sv">' + esc(report.layoutType || '—') + '</div><div class="sl">Layout</div></div>'
      + '<div class="stat"><div class="sv">' + esc(report.imageSize || '—') + '</div><div class="sl">Image</div></div>'
      + '</div>'

      // Pipeline timing bar
      + (duration && designDur ? '<div class="section-card"><div class="sec-title">Pipeline Timing</div>'
        + '<div class="timing-bar"><div class="tb-design" style="width:' + Math.round(designDur / duration * 100) + '%"></div>'
        + '<div class="tb-research" style="width:' + Math.round(researchDur / duration * 100) + '%"></div></div>'
        + '<div class="timing-labels"><span class="tl-d">Design ' + fmtMs(designDur) + '</span>'
        + '<span class="tl-r">Research ' + fmtMs(researchDur) + '</span>'
        + '<span class="tl-t">Total ' + fmtMs(duration) + '</span></div></div>'
        : '')

      // Screenshot + content analysis
      + '<h2>Screenshot &amp; Content</h2>'
      + '<div class="screenshot-row">'
      + thumbTag
      + '<div class="section-card" style="flex:1">'
      + (ca.contentType ? '<div class="kv"><span class="k">Content Type</span><span class="v">' + esc(ca.contentType) + '</span></div>' : '')
      + (ca.platform ? '<div class="kv"><span class="k">Platform</span><span class="v">' + esc(ca.platform) + '</span></div>' : '')
      + (ca.intent ? '<div class="kv"><span class="k">Intent</span><span class="v">' + esc(ca.intent) + '</span></div>' : '')
      + '<div class="kv"><span class="k">Image Size</span><span class="v">' + esc(report.imageSize || '—') + '</span></div>'
      + (report.layout?.reason ? '<div class="kv"><span class="k">Layout Reason</span><span class="v">' + esc(report.layout.reason) + '</span></div>' : '')
      + '</div></div>'

      // Cards — the actual UI the user saw
      + '<h2>What the User Saw (' + cards.length + ' cards)</h2>'
      + '<div class="cards-grid">'
      + cards.map(c => renderCardHtml(c)).join('')
      + '</div>'

      // Reflection
      + '<h2>Reflection</h2>'
      + '<div class="reflection">'
      + reflectionLines.map(l => '<p>' + l + '</p>').join('')
      + '</div>';

  }

  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>thinx.fun — Report ${esc(requestId)}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#0a0d12;--bg-raised:#0f1319;--s:#151a22;--s2:#1b222c;--s3:#222a36;--sb:#2a3444;--b:#1e2736;--b2:#2d3a4e;--t:#e8ecf2;--t2:#8d99ae;--t3:#5c6878;--a:#6c9fff;--a-dim:#3d6cc7;--a-bg:rgba(108,159,255,.08);--a-bgs:rgba(108,159,255,.15);--g:#5bdb8a;--g-bg:rgba(91,219,138,.1);--r:#ff6b6b;--r-bg:rgba(255,107,107,.1);--y:#ffd15c;--y-bg:rgba(255,209,92,.08);--p:#b48eff;--p-bg:rgba(180,142,255,.08);--rad:12px;--rad-md:12px;--rad-pill:100px}
body{font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;background:var(--bg);color:var(--t);min-height:100vh;-webkit-font-smoothing:antialiased}
.mi{font-family:'Material Symbols Rounded';font-style:normal;font-weight:400;font-size:20px;display:inline-block;line-height:1;letter-spacing:normal;text-transform:none;white-space:nowrap;word-wrap:normal;direction:ltr;-webkit-font-smoothing:antialiased;font-variation-settings:'FILL' 0,'wght' 400,'GRAD' 0,'opsz' 24}
.wrap{max-width:640px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:1.3rem;font-weight:700} h1 code{font-size:.9rem;color:var(--a);background:var(--a-bg);padding:2px 8px;border-radius:6px}
h2{font-size:.95rem;font-weight:600;color:var(--a);margin:28px 0 12px;padding-bottom:6px;border-bottom:1px solid var(--b)}
.sub{color:var(--t2);font-size:.8rem;margin:4px 0 20px}
.back{color:var(--t3);text-decoration:none;font-size:.82rem;display:inline-flex;align-items:center;gap:4px;margin-bottom:12px;transition:color .2s}.back:hover{color:var(--a)}
.badge{display:inline-block;padding:2px 10px;border-radius:100px;font-size:.68rem;font-weight:600;text-transform:uppercase;letter-spacing:.04em}
.badge-g{background:rgba(91,219,138,.12);color:var(--g)}.badge-r{background:rgba(255,107,107,.12);color:var(--r)}.badge-a{background:rgba(108,159,255,.1);color:var(--a)}.badge-y{background:rgba(255,209,92,.1);color:var(--y)}

/* Stats */
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px}
@media(max-width:500px){.stats{grid-template-columns:repeat(2,1fr)}}
.stat{background:var(--s);border:1px solid var(--b);border-radius:var(--rad);padding:14px;text-align:center}
.sv{font-size:1.4rem;font-weight:700;color:var(--a)}.sl{font-size:.65rem;color:var(--t2);text-transform:uppercase;letter-spacing:.05em;margin-top:4px}

/* Timing bar */
.timing-bar{display:flex;gap:2px;height:10px;border-radius:5px;overflow:hidden;margin:8px 0}
.tb-design{background:var(--a);border-radius:5px 0 0 5px}.tb-research{background:var(--g);border-radius:0 5px 5px 0}
.timing-labels{display:flex;justify-content:space-between;font-size:.72rem;color:var(--t3)}.tl-d{color:var(--a)}.tl-r{color:var(--g)}

/* Screenshot */
.screenshot-row{display:flex;gap:16px;align-items:flex-start;margin:12px 0}
.report-thumb{max-width:200px;border-radius:var(--rad);border:1px solid var(--b);flex-shrink:0}
@media(max-width:500px){.screenshot-row{flex-direction:column}.report-thumb{max-width:100%}}

/* Section card & kv */
.section-card{background:var(--s);border:1px solid var(--b);border-radius:var(--rad);padding:16px;margin-bottom:12px}
.sec-title{font-size:.82rem;font-weight:600;margin-bottom:8px}
.kv{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid rgba(30,39,54,.6);font-size:.84rem}
.kv:last-child{border-bottom:none}.kv .k{color:var(--t2)}.kv .v{font-weight:500;text-align:right;max-width:60%;word-break:break-word}

/* === CARD STYLES — matches hub-v2.html exactly === */
.cards-grid{display:flex;flex-direction:column;gap:10px}
.card{background:var(--s);border:1px solid var(--b);border-radius:var(--rad);overflow:hidden;transition:border-color .2s}
.card:hover{border-color:var(--b2)}
.card-inner{padding:14px 16px}

/* Card type label */
.card-type-label{display:flex;align-items:center;gap:8px;font-size:.68rem;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px}
.card-type-icon{width:24px;height:24px;border-radius:6px;display:flex;align-items:center;justify-content:center;background:var(--s3);flex-shrink:0}
.card-type-icon .mi{font-size:14px;color:var(--t2)}

/* Hero */
.card-hero{background:linear-gradient(135deg,var(--s) 0%,var(--s2) 100%);border-color:var(--b2)}
.card-hero .card-inner{padding:20px 16px}
.hero-badge{display:inline-flex;align-items:center;gap:5px;font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;padding:4px 12px;border-radius:var(--rad-pill);background:var(--a-bgs);color:var(--a);margin-bottom:12px}
.hero-title{font-size:1.25rem;font-weight:800;color:#fff;margin-bottom:4px;line-height:1.3;letter-spacing:-.02em}
.hero-subtitle{font-size:.85rem;color:var(--t2);margin-bottom:14px;line-height:1.5}
.hero-takeaway{font-size:.84rem;color:var(--t);line-height:1.6;padding:12px 14px;background:var(--s3);border-radius:var(--rad-md);border-left:3px solid var(--a)}

/* Key metric */
.card-metric .card-inner{display:flex;flex-direction:column;align-items:flex-start}
.metric-value{font-size:2rem;font-weight:800;color:var(--a);line-height:1.1;letter-spacing:-.03em;margin:4px 0}
.metric-label{font-size:.78rem;font-weight:500;color:var(--t2);margin-top:4px}
.metric-context{font-size:.74rem;color:var(--t3);margin-top:10px;padding:6px 10px;background:var(--s2);border-radius:8px;width:100%}
.metric-trend{display:inline-flex;align-items:center;gap:3px;font-size:.68rem;font-weight:700;padding:3px 8px;border-radius:var(--rad-pill);margin-top:6px}
.metric-trend.up{background:var(--g-bg);color:var(--g)}.metric-trend.down{background:var(--r-bg);color:var(--r)}.metric-trend.stable{background:var(--a-bg);color:var(--a)}

/* Info list */
.list-title{font-size:.88rem;font-weight:700;color:#fff;margin-bottom:12px}
.list-item{display:flex;justify-content:space-between;align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--b);font-size:.8rem;gap:12px}
.list-item:last-child{border-bottom:none}
.list-item-label{color:var(--t2);flex-shrink:0;font-weight:500;display:flex;align-items:center;gap:6px}
.li-icon{font-size:.9rem}
.list-item-value{color:var(--t);text-align:right;word-break:break-word}
.list-item.highlight .list-item-value{color:var(--a);font-weight:600}

/* Fact check */
.fact-claim{font-size:.84rem;color:var(--t);line-height:1.6;padding:12px 14px;background:var(--s2);border-radius:var(--rad-md);margin-bottom:12px;font-style:italic}
.fact-verdict{display:inline-flex;align-items:center;gap:5px;font-size:.65rem;font-weight:800;text-transform:uppercase;letter-spacing:.08em;padding:5px 12px;border-radius:var(--rad-pill);margin-bottom:10px}
.fact-verdict.verified{background:var(--g-bg);color:var(--g)}
.fact-verdict.misleading,.fact-verdict.partially_true{background:var(--y-bg);color:var(--y)}
.fact-verdict.false{background:var(--r-bg);color:var(--r)}
.fact-verdict.unverified,.fact-verdict.needs_context{background:var(--a-bg);color:var(--a)}
.fact-explanation{font-size:.8rem;color:var(--t);line-height:1.6}
.fact-source{font-size:.7rem;color:var(--t3);margin-top:8px}

/* Person */
.person-header{display:flex;align-items:center;gap:12px;margin-bottom:12px}
.person-avatar{width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,var(--a-bgs),var(--p-bg));border:2px solid var(--b2);display:flex;align-items:center;justify-content:center;font-size:1.1rem;font-weight:700;color:var(--a);flex-shrink:0}
.person-name{font-size:.95rem;font-weight:700;color:#fff}
.person-role{font-size:.74rem;color:var(--t2);margin-top:2px}
.person-handle{font-size:.74rem;color:var(--a);margin-top:1px}
.person-context{font-size:.8rem;color:var(--t);line-height:1.6}
.person-details{margin-top:10px;display:flex;flex-direction:column;gap:3px}
.person-detail-item{font-size:.74rem;color:var(--t2);padding:3px 0 3px 10px;border-left:2px solid var(--b)}

/* Timeline */
.timeline-title{font-size:.88rem;font-weight:700;color:#fff;margin-bottom:12px}
.timeline-event{display:flex;align-items:flex-start;gap:10px;padding:8px 0;position:relative}
.timeline-date{font-size:.7rem;font-weight:600;color:var(--a);min-width:70px;flex-shrink:0;text-align:right}
.timeline-dot{width:8px;height:8px;border-radius:50%;background:var(--b2);margin-top:5px;flex-shrink:0;position:relative;z-index:1}
.timeline-event.highlight .timeline-dot{background:var(--a);box-shadow:0 0 8px rgba(108,159,255,.4)}
.timeline-text{font-size:.8rem;color:var(--t);line-height:1.5;flex:1}

/* Warning */
.card-warning{border-color:rgba(255,209,92,.2)}
.warning-header{display:flex;align-items:center;gap:10px;margin-bottom:10px}
.warning-icon-wrap{width:32px;height:32px;border-radius:50%;background:var(--y-bg);display:flex;align-items:center;justify-content:center}
.warning-icon-wrap .mi{font-size:18px;color:var(--y)}
.warning-title{font-size:.9rem;font-weight:700;color:var(--y)}
.warning-details{font-size:.8rem;color:var(--t);line-height:1.6}
.warning-advice{font-size:.78rem;color:var(--g);margin-top:10px;padding:8px 12px;background:rgba(91,219,138,.06);border-radius:8px;border-left:3px solid var(--g)}

/* Action */
.action-title{font-size:.88rem;font-weight:700;color:#fff;margin-bottom:12px}
.action-item{display:flex;gap:12px;padding:10px 0;border-bottom:1px solid var(--b)}
.action-item:last-child{border-bottom:none}
.action-bullet{width:24px;height:24px;border-radius:50%;background:var(--a-bgs);color:var(--a);display:flex;align-items:center;justify-content:center;font-size:.72rem;font-weight:700;flex-shrink:0}
.action-label{font-size:.84rem;font-weight:600;color:var(--t)}
.action-desc{font-size:.76rem;color:var(--t2);margin-top:3px;line-height:1.5}
.action-priority{display:inline-block;font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;padding:2px 8px;border-radius:var(--rad-pill);margin-top:4px}
.action-priority.high{background:var(--r-bg);color:var(--r)}.action-priority.medium{background:var(--y-bg);color:var(--y)}.action-priority.low{background:var(--a-bg);color:var(--a)}

/* Quote */
.quote-mark{font-size:2.5rem;font-weight:800;color:var(--a);line-height:1;opacity:.5}
.quote-text{font-size:.88rem;color:var(--t);line-height:1.7;font-style:italic;margin:4px 0 12px;padding-left:14px;border-left:3px solid var(--a)}
.quote-attribution{font-size:.78rem;color:var(--t2);font-weight:600}
.quote-context{font-size:.76rem;color:var(--t3);margin-top:8px;line-height:1.5}

/* Product */
.card-product{background:linear-gradient(135deg,var(--s) 0%,rgba(91,219,138,.04) 100%)}
.product-header{display:flex;gap:14px;margin-bottom:12px}
.product-name{font-size:1rem;font-weight:700;color:#fff;margin-bottom:4px}
.product-price{font-size:1.35rem;font-weight:800;color:var(--g);margin-bottom:6px}
.product-rating{font-size:.76rem;color:var(--y);display:flex;align-items:center;gap:3px}
.product-features{list-style:none;display:flex;flex-wrap:wrap;gap:6px;margin:12px 0}
.product-features li{font-size:.74rem;color:var(--t);padding:4px 10px;background:var(--s2);border-radius:var(--rad-pill)}
.product-features li::before{content:'';display:inline-block;width:5px;height:5px;border-radius:50%;background:var(--g);margin-right:5px}
.product-verdict{font-size:.8rem;color:var(--t);line-height:1.5;padding:8px 12px;background:var(--s2);border-radius:8px;margin-bottom:8px}
.product-warnings{list-style:none;margin-top:8px}
.product-warnings li{font-size:.74rem;color:var(--y);padding:4px 0 4px 14px;position:relative}
.product-warnings li::before{content:'';position:absolute;left:0;top:10px;width:6px;height:6px;border-radius:50%;background:var(--y)}

/* Text extract */
.extract-title{font-size:.88rem;font-weight:700;color:#fff;margin-bottom:8px}
.extract-text{font-size:.82rem;font-family:'SF Mono','Courier New',monospace;color:var(--t);line-height:1.6;padding:12px;background:var(--s2);border-radius:8px;white-space:pre-wrap;word-break:break-word}
.extract-source{font-size:.7rem;color:var(--t3);margin-top:6px}

/* Location */
.location-name{font-size:.95rem;font-weight:700;color:#fff;margin-bottom:6px}
.location-address{font-size:.78rem;color:var(--t2);display:flex;align-items:center;gap:4px;margin-bottom:8px}
.location-context{font-size:.8rem;color:var(--t);line-height:1.6}
.location-details{margin-top:10px;display:flex;flex-direction:column;gap:3px}
.location-detail-item{font-size:.74rem;color:var(--t2);padding:3px 0 3px 10px;border-left:2px solid var(--b)}

/* Link card */
.links-title{font-size:.88rem;font-weight:700;color:#fff;margin-bottom:12px}
.link-item{display:flex;gap:10px;padding:8px 0;border-bottom:1px solid var(--b)}
.link-item:last-child{border-bottom:none}
.link-icon{width:28px;height:28px;border-radius:6px;background:var(--a-bg);display:flex;align-items:center;justify-content:center;flex-shrink:0}
.link-icon .mi{font-size:14px;color:var(--a)}
.link-label a{color:var(--a);text-decoration:none;font-size:.84rem;font-weight:500}
.link-label a:hover{text-decoration:underline}
.link-desc{font-size:.74rem;color:var(--t3);margin-top:2px}

/* Reflection */
.reflection{background:var(--s2);border:1px solid var(--b);border-radius:var(--rad);padding:20px;margin:12px 0}
.reflection p{font-size:.85rem;color:var(--t2);line-height:1.65;margin-bottom:10px}
.reflection p:last-child{margin-bottom:0}
.reflection strong{color:var(--t)}

/* Expired */
.expired{text-align:center;padding:60px 16px;color:var(--t3)}.expired .big{font-size:2.5rem;margin-bottom:12px}

/* PIN gate */
.pin-gate{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;gap:16px}
.pin-gate h2{font-size:1.1rem;color:var(--t2);font-weight:500}
.pin-row{display:flex;gap:8px}
.pin-box{width:48px;height:56px;background:var(--s);border:2px solid var(--b);border-radius:var(--rad);text-align:center;font-size:1.5rem;font-weight:700;color:var(--a);caret-color:var(--a);outline:none;transition:border-color .2s}
.pin-box:focus{border-color:var(--a)}
.pin-err{color:var(--r);font-size:.8rem;height:20px}

/* Comparison */
.comparison-title{font-size:.88rem;font-weight:700;color:#fff;margin-bottom:12px}
table{width:100%;border-collapse:collapse;font-size:.78rem}
th{text-align:left;padding:6px 8px;border-bottom:1px solid var(--b);color:var(--t2);font-weight:600}
td{padding:6px 8px;border-bottom:1px solid rgba(30,39,54,.5);color:var(--t)}

footer{margin-top:48px;padding-top:16px;border-top:1px solid var(--b);color:var(--t3);font-size:.72rem;text-align:center}
</style>
</head><body>
<div class="wrap">
${showPinGate ? '<div id="gate" class="pin-gate"><h2>Enter 4-digit PIN</h2><div class="pin-row"><input class="pin-box" type="tel" maxlength="1" inputmode="numeric" autofocus><input class="pin-box" type="tel" maxlength="1" inputmode="numeric"><input class="pin-box" type="tel" maxlength="1" inputmode="numeric"><input class="pin-box" type="tel" maxlength="1" inputmode="numeric"></div><div class="pin-err" id="pin-err"></div></div>' : ''}
${hasReport ? reportHtml : showExpired ? '<div class="expired"><div class="big">&#9203;</div><p>This report has expired or does not exist.</p><p style="margin-top:8px"><a href="/r" style="color:var(--a)">View all reports</a></p></div>' : ''}
${(hasReport || showExpired) ? '<footer>thinx.fun live report &middot; auto-generated &middot; expires in 1 hour</footer>' : ''}
</div>
${showPinGate ? `<script>
var boxes=document.querySelectorAll('.pin-box');
boxes.forEach(function(b,i){
  b.addEventListener('input',function(){if(b.value.length===1&&i<3)boxes[i+1].focus();if(i===3&&b.value.length===1)tryPin();});
  b.addEventListener('keydown',function(e){if(e.key==='Backspace'&&!b.value&&i>0){boxes[i-1].focus();boxes[i-1].value='';}});
  b.addEventListener('paste',function(e){e.preventDefault();var d=(e.clipboardData||window.clipboardData).getData('text').replace(/\\\\D/g,'').slice(0,4);for(var j=0;j<d.length&&j<4;j++)boxes[j].value=d[j];if(d.length>=4)tryPin();});
});
async function tryPin(){
  var pin=Array.from(boxes).map(function(b){return b.value}).join('');
  if(pin.length!==4)return;
  var r=await fetch('/api/r/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:pin}),credentials:'same-origin'});
  if(r.ok)location.reload();
  else{document.getElementById('pin-err').textContent='Wrong PIN';boxes.forEach(function(b){b.value='';});boxes[0].focus();}
}
</script>` : ''}
</body></html>`;
}

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

// Catch-all route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'hub-v2.html'));
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
