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
      },

      onError: (error) => {
        clearInterval(keepAlive);
        logger.pipelineError(requestId, error, { phase: 'pipeline' });
        sendEvent('error', { message: error.message });
        endStream();
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
  const reports = await liveReports.listLiveReports();
  res.json({ reports });
});

app.get('/api/r/:requestId/data', requirePin, async (req, res) => {
  const report = await liveReports.getLiveReport(req.params.requestId);
  if (!report) return res.status(404).json({ error: 'Report not found or expired' });
  const { thumb, ...data } = report;
  res.json({ report: data, hasThumb: !!thumb });
});

app.get('/api/r/:requestId/thumb', requirePin, async (req, res) => {
  const thumb = await liveReports.getLiveReportThumb(req.params.requestId);
  if (!thumb) return res.status(404).json({ error: 'No thumbnail' });
  res.set('Content-Type', 'image/jpeg');
  res.send(Buffer.from(thumb, 'base64'));
});

// Public report pages (HTML — PIN gate is client-side JS calling /api/r/auth)
app.get('/r', (req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(getLiveReportIndexHtml());
});

app.get('/r/:requestId', (req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(getLiveReportViewerHtml(req.params.requestId));
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
    <div><h1>Live Reports</h1><div class="sub">Auto-generated for every pipeline run &middot; 1hr TTL</div></div>
    <button class="refresh-btn" onclick="loadList()">Refresh</button>
  </div>
  <div id="list" class="rlist"><div class="empty">Loading...</div></div>
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
function timeSince(d){var s=Math.floor((Date.now()-new Date(d).getTime())/1000);if(s<60)return'just now';if(s<3600)return Math.floor(s/60)+'m ago';if(s<86400)return Math.floor(s/3600)+'h ago';return Math.floor(s/86400)+'d ago';}
function ttlLeft(d){var ms=new Date(d).getTime()-Date.now();if(ms<=0)return'expired';var m=Math.floor(ms/60000);return m+'m left';}
async function loadList(){
  var r=await fetch('/api/r/list',{credentials:'same-origin'});
  if(r.status===401){document.getElementById('gate').style.display='flex';document.getElementById('content').style.display='none';return;}
  var data=await r.json();
  var el=document.getElementById('list');
  if(!data.reports||!data.reports.length){el.innerHTML='<div class="empty">No live reports yet. Analyze a screenshot to generate one.</div>';return;}
  el.innerHTML=data.reports.map(function(r){
    var badge=r.outcome==='success'?'<span class="badge badge-g">success</span>':'<span class="badge badge-r">'+r.outcome+'</span>';
    return '<a class="rcard" href="/r/'+r.requestId+'">'
      +(r.hasThumb?'<img class="thumb" src="/api/r/'+r.requestId+'/thumb" alt="">':'<div class="thumb"></div>')
      +'<div class="info"><div class="rid">'+r.requestId+' '+badge+'</div>'
      +'<div class="meta"><span>'+timeSince(r.createdAt)+'</span>'
      +(r.layoutType?'<span>'+r.layoutType+'</span>':'')
      +(r.cardCount?'<span>'+r.cardCount+' cards</span>':'')
      +(r.duration?'<span>'+Math.round(r.duration/1000)+'s</span>':'')
      +'<span class="badge badge-y">'+ttlLeft(r.expiresAt)+'</span>'
      +'</div></div><span class="arrow">&#8250;</span></a>';
  }).join('');
}
(async function(){var r=await fetch('/api/r/list',{credentials:'same-origin'});if(r.ok){document.getElementById('gate').style.display='none';document.getElementById('content').style.display='block';loadList();}})();
</script>
</body></html>`;
}

function getLiveReportViewerHtml(requestId) {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>thinx.fun — Report ${requestId}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#0a0d12;--s:#151a22;--s2:#1b222c;--s3:#222a36;--b:#1e2736;--b2:#2d3a4e;--t:#e8ecf2;--t2:#8d99ae;--t3:#5c6878;--a:#6c9fff;--g:#5bdb8a;--r:#ff6b6b;--y:#ffd15c;--p:#b48eff;--rad:12px}
body{font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;background:var(--bg);color:var(--t);min-height:100vh}
.wrap{max-width:720px;margin:0 auto;padding:24px 16px 48px}
h1{font-size:1.3rem;font-weight:700}
h2{font-size:1rem;font-weight:600;color:var(--a);margin:28px 0 12px;padding-bottom:6px;border-bottom:1px solid var(--b)}
.sub{color:var(--t2);font-size:.8rem;margin:4px 0 20px}
.back{color:var(--t3);text-decoration:none;font-size:.82rem;display:inline-flex;align-items:center;gap:4px;margin-bottom:12px;transition:color .2s}
.back:hover{color:var(--a)}
.badge{display:inline-block;padding:2px 10px;border-radius:100px;font-size:.68rem;font-weight:600;text-transform:uppercase;letter-spacing:.04em}
.badge-g{background:rgba(91,219,138,.12);color:var(--g)}
.badge-r{background:rgba(255,107,107,.12);color:var(--r)}
.badge-a{background:rgba(108,159,255,.1);color:var(--a)}
.badge-y{background:rgba(255,209,92,.1);color:var(--y)}
.card{background:var(--s);border:1px solid var(--b);border-radius:var(--rad);padding:16px;margin-bottom:12px}
.kv{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid rgba(30,39,54,.6);font-size:.84rem}
.kv:last-child{border-bottom:none}
.kv .k{color:var(--t2)}.kv .v{font-weight:500;text-align:right;max-width:60%;word-break:break-word}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px}
@media(max-width:500px){.stats{grid-template-columns:repeat(2,1fr)}}
.stat{background:var(--s);border:1px solid var(--b);border-radius:var(--rad);padding:14px;text-align:center}
.stat .v{font-size:1.5rem;font-weight:700;color:var(--a)}
.stat .l{font-size:.68rem;color:var(--t2);text-transform:uppercase;letter-spacing:.05em;margin-top:4px}
.screenshot-row{display:flex;gap:16px;align-items:flex-start;margin:12px 0}
.screenshot-row img{max-width:200px;border-radius:var(--rad);border:1px solid var(--b);flex-shrink:0}
@media(max-width:500px){.screenshot-row{flex-direction:column}.screenshot-row img{max-width:100%}}
.cardlist{display:flex;flex-direction:column;gap:8px}
.ccard{background:var(--s2);border:1px solid var(--b);border-radius:10px;padding:14px;cursor:pointer;transition:border-color .2s}
.ccard:hover{border-color:var(--a)}
.ccard-hdr{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.ccard-hdr .icon{font-size:1.1rem}
.ccard-hdr .name{font-weight:600;font-size:.88rem}
.ccard-hdr .ctype{margin-left:auto;font-size:.7rem;color:var(--t3);font-family:'SF Mono',monospace}
.ccard-data{font-size:.82rem;color:var(--t2);line-height:1.5}
.ccard-data strong{color:var(--t);font-weight:600}
.ccard-data .field{margin:4px 0}
.ccard-data .field-label{color:var(--t3);font-size:.72rem;text-transform:uppercase;letter-spacing:.04em}
.ccard-data ul{padding-left:18px;margin:4px 0}
.timeline-bar{display:flex;gap:2px;height:8px;border-radius:4px;overflow:hidden;margin:8px 0}
.timeline-bar div{height:100%;border-radius:2px}
.pin-gate{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;gap:16px}
.pin-gate h2{font-size:1.1rem;color:var(--t2);font-weight:500}
.pin-row{display:flex;gap:8px}
.pin-box{width:48px;height:56px;background:var(--s);border:2px solid var(--b);border-radius:var(--rad);text-align:center;font-size:1.5rem;font-weight:700;color:var(--a);caret-color:var(--a);outline:none;transition:border-color .2s}
.pin-box:focus{border-color:var(--a)}
.pin-err{color:var(--r);font-size:.8rem;height:20px}
.expired{text-align:center;padding:48px;color:var(--t3)}
.expired .big{font-size:2rem;margin-bottom:12px}
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
<div id="content" style="display:none">
  <a class="back" href="/r">&lsaquo; All Reports</a>
  <div id="report">Loading...</div>
</div>
</div>
<script>
var RID='${requestId}';
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
  if(r.ok){document.getElementById('gate').style.display='none';document.getElementById('content').style.display='block';loadReport();}
  else{document.getElementById('pin-err').textContent='Wrong PIN';boxes.forEach(function(b){b.value='';});boxes[0].focus();}
}
function esc(s){var d=document.createElement('div');d.textContent=String(s||'');return d.innerHTML;}
function fmtMs(ms){return ms<1000?ms+'ms':(ms/1000).toFixed(1)+'s';}
function timeSince(d){var s=Math.floor((Date.now()-new Date(d).getTime())/1000);if(s<60)return'just now';if(s<3600)return Math.floor(s/60)+'m ago';return Math.floor(s/3600)+'h ago';}
function ttlLeft(d){var ms=new Date(d).getTime()-Date.now();if(ms<=0)return'expired';return Math.floor(ms/60000)+'m left';}
var cardIcons={hero_summary:'\\u{1F4F0}',key_metric:'\\u{1F4CA}',info_list:'\\u{1F4CB}',fact_check:'\\u2705',person_card:'\\u{1F464}',product_card:'\\u{1F6CD}',timeline_card:'\\u{1F4C5}',quote_card:'\\u{1F4AC}',comparison_card:'\\u2696\\uFE0F',warning_card:'\\u26A0\\uFE0F',action_card:'\\u{1F3AF}',text_extract:'\\u{1F4DD}',location_card:'\\u{1F4CD}',link_card:'\\u{1F517}'};

function renderCardData(type,data){
  if(!data)return'<div class="ccard-data" style="color:var(--t3)">No data</div>';
  var h='<div class="ccard-data">';
  // Render based on type
  if(data.title)h+='<div class="field"><strong>'+esc(data.title)+'</strong></div>';
  if(data.subtitle)h+='<div class="field">'+esc(data.subtitle)+'</div>';
  if(data.badge)h+='<span class="badge badge-a">'+esc(data.badge)+'</span> ';
  if(data.takeaway)h+='<div class="field" style="margin-top:6px">'+esc(data.takeaway)+'</div>';
  if(data.name&&type!=='hero_summary')h+='<div class="field"><strong>'+esc(data.name)+'</strong>'+(data.role?' &mdash; '+esc(data.role):'')+'</div>';
  if(data.claim)h+='<div class="field"><div class="field-label">Claim</div>'+esc(data.claim)+'</div>';
  if(data.verdict)h+='<div class="field"><div class="field-label">Verdict</div><span class="badge '+(data.verdict==='verified'||data.verdict==='true'?'badge-g':data.verdict==='false'?'badge-r':'badge-y')+'">'+esc(data.verdict)+'</span></div>';
  if(data.explanation)h+='<div class="field"><div class="field-label">Explanation</div>'+esc(data.explanation)+'</div>';
  if(data.context)h+='<div class="field">'+esc(data.context)+'</div>';
  if(data.level)h+='<span class="badge '+(data.level==='critical'?'badge-r':data.level==='warning'?'badge-y':'badge-a')+'">'+esc(data.level)+'</span> ';
  if(data.details&&typeof data.details==='string')h+='<div class="field">'+esc(data.details)+'</div>';
  if(data.advice)h+='<div class="field"><div class="field-label">Advice</div>'+esc(data.advice)+'</div>';
  if(data.label&&data.value)h+='<div class="field"><strong>'+esc(data.value)+(data.unit||'')+'</strong> '+esc(data.label)+'</div>';
  if(data.quote)h+='<div class="field" style="font-style:italic;border-left:3px solid var(--a);padding-left:10px">&ldquo;'+esc(data.quote)+'&rdquo;'+(data.attribution?' &mdash; '+esc(data.attribution):'')+'</div>';
  if(data.address)h+='<div class="field"><div class="field-label">Address</div>'+esc(data.address)+'</div>';
  if(data.price)h+='<div class="field"><div class="field-label">Price</div>'+esc(data.price)+'</div>';
  if(data.text)h+='<div class="field" style="font-family:monospace;font-size:.8rem;background:var(--s3);padding:8px;border-radius:6px">'+esc(data.text)+'</div>';
  // Arrays
  if(Array.isArray(data.items)){h+='<ul>';data.items.forEach(function(it){h+='<li>'+(typeof it==='string'?esc(it):(esc(it.label||'')+': <strong>'+esc(it.value||'')+'</strong>'))+'</li>';});h+='</ul>';}
  if(Array.isArray(data.events)){data.events.forEach(function(ev){h+='<div class="field"><span style="color:var(--a);font-weight:600">'+esc(ev.date||'')+'</span> '+esc(ev.event||'')+'</div>';});}
  if(Array.isArray(data.actions)){data.actions.forEach(function(a){h+='<div class="field">'+(a.priority?'<span class="badge '+(a.priority==='high'?'badge-r':a.priority==='medium'?'badge-y':'badge-a')+'">'+esc(a.priority)+'</span> ':'')+esc(a.label||'')+(a.description?' &mdash; '+esc(a.description):'')+'</div>';});}
  if(Array.isArray(data.features)){h+='<ul>';data.features.forEach(function(f){h+='<li>'+esc(typeof f==='string'?f:f.label||JSON.stringify(f))+'</li>';});h+='</ul>';}
  if(Array.isArray(data.details)){h+='<ul>';data.details.forEach(function(d){h+='<li>'+esc(d)+'</li>';});h+='</ul>';}
  if(Array.isArray(data.links)){data.links.forEach(function(l){h+='<div class="field"><a href="'+esc(l.url)+'" style="color:var(--a)" target="_blank">'+esc(l.label)+'</a>'+(l.description?' &mdash; '+esc(l.description):'')+'</div>';});}
  if(Array.isArray(data.warnings)){h+='<ul>';data.warnings.forEach(function(w){h+='<li style="color:var(--y)">'+esc(w)+'</li>';});h+='</ul>';}
  h+='</div>';
  return h;
}

async function loadReport(){
  var el=document.getElementById('report');
  var r=await fetch('/api/r/'+RID+'/data',{credentials:'same-origin'});
  if(r.status===401){document.getElementById('gate').style.display='flex';document.getElementById('content').style.display='none';return;}
  if(r.status===404){el.innerHTML='<div class="expired"><div class="big">\\u23F3</div><p>This report has expired or does not exist.</p><p style="margin-top:8px"><a href="/r" style="color:var(--a)">View all reports</a></p></div>';return;}
  var d=(await r.json()).report;
  var html='';

  // Header
  html+='<h1>Report '+esc(d.requestId)+'</h1>';
  html+='<div class="sub">'+timeSince(d.createdAt)+' &middot; <span class="badge badge-y">'+ttlLeft(d.expiresAt)+'</span> &middot; <span class="badge '+(d.outcome==='success'?'badge-g':'badge-r')+'">'+esc(d.outcome)+'</span></div>';

  // Stats
  html+='<div class="stats">';
  html+='<div class="stat"><div class="v">'+(d.duration?fmtMs(d.duration):'—')+'</div><div class="l">Duration</div></div>';
  html+='<div class="stat"><div class="v">'+(d.cardCount||'—')+'</div><div class="l">Cards</div></div>';
  html+='<div class="stat"><div class="v">'+(d.layoutType||'—')+'</div><div class="l">Layout</div></div>';
  html+='<div class="stat"><div class="v">'+(d.imageSize||'—')+'</div><div class="l">Image</div></div>';
  html+='</div>';

  // Pipeline timeline bar
  if(d.meta){
    var design=d.meta.designDuration||0;
    var research=(d.meta.totalDuration||0)-design;
    var total=d.meta.totalDuration||1;
    html+='<div class="card"><div style="font-size:.82rem;font-weight:600;margin-bottom:6px">Pipeline Timing</div>';
    html+='<div class="timeline-bar">';
    html+='<div style="width:'+Math.round(design/total*100)+'%;background:var(--a)" title="Design: '+fmtMs(design)+'"></div>';
    html+='<div style="width:'+Math.round(research/total*100)+'%;background:var(--g)" title="Research: '+fmtMs(research)+'"></div>';
    html+='</div>';
    html+='<div style="display:flex;justify-content:space-between;font-size:.72rem;color:var(--t3);margin-top:4px">';
    html+='<span style="color:var(--a)">Design: '+fmtMs(design)+'</span>';
    html+='<span style="color:var(--g)">Research: '+fmtMs(research)+'</span>';
    html+='<span>Total: '+fmtMs(total)+'</span>';
    html+='</div></div>';
  }

  // Screenshot + Content Analysis
  html+='<h2>Screenshot &amp; Content</h2>';
  html+='<div class="screenshot-row">';
  html+='<img src="/api/r/'+RID+'/thumb" alt="Screenshot" onerror="this.style.display=\\'none\\'">';
  html+='<div class="card" style="flex:1">';
  if(d.contentAnalysis){
    var ca=d.contentAnalysis;
    html+='<div class="kv"><span class="k">Content Type</span><span class="v">'+esc(ca.contentType)+'</span></div>';
    if(ca.platform)html+='<div class="kv"><span class="k">Platform</span><span class="v">'+esc(ca.platform)+'</span></div>';
    if(ca.intent)html+='<div class="kv"><span class="k">Intent</span><span class="v">'+esc(ca.intent)+'</span></div>';
    if(ca.topQuestions&&ca.topQuestions.length){html+='<div class="kv"><span class="k">Top Questions</span><span class="v">'+ca.topQuestions.map(function(q){return esc(q)}).join('<br>')+'</span></div>';}
  }
  html+='<div class="kv"><span class="k">Media Type</span><span class="v">'+esc(d.mediaType||'—')+'</span></div>';
  html+='<div class="kv"><span class="k">Image Size</span><span class="v">'+esc(d.imageSize||'—')+'</span></div>';
  html+='</div></div>';

  // Cards
  if(d.cards&&d.cards.length){
    html+='<h2>Cards Presented ('+d.cards.length+')</h2>';
    html+='<div class="cardlist">';
    d.cards.forEach(function(c,i){
      var icon=cardIcons[c.cardType]||'\\u{1F4C4}';
      html+='<div class="ccard">';
      html+='<div class="ccard-hdr"><span class="icon">'+icon+'</span><span class="name">'+(c.data?.title||c.data?.name||c.data?.claim||'Card '+(i+1))+'</span><span class="ctype">'+esc(c.cardType)+'</span></div>';
      html+=renderCardData(c.cardType,c.data);
      html+='</div>';
    });
    html+='</div>';
  }

  // Layout details
  if(d.layout){
    html+='<h2>Layout</h2>';
    html+='<div class="card">';
    html+='<div class="kv"><span class="k">Type</span><span class="v">'+esc(d.layout.type)+'</span></div>';
    if(d.layout.columns)html+='<div class="kv"><span class="k">Columns</span><span class="v">'+d.layout.columns+'</span></div>';
    if(d.layout.reason)html+='<div class="kv"><span class="k">Reason</span><span class="v">'+esc(d.layout.reason)+'</span></div>';
    html+='</div>';
  }

  el.innerHTML=html;
}
(async function(){var r=await fetch('/api/r/'+RID+'/data',{credentials:'same-origin'});if(r.ok){document.getElementById('gate').style.display='none';document.getElementById('content').style.display='block';loadReport();}})();
</script>
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
