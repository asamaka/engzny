/**
 * Continuous Improvement Trigger
 *
 * Evaluates pipeline reports and dispatches a GitHub Actions workflow
 * that spawns a Cursor Cloud Agent. The Cursor API key NEVER touches
 * the Vercel runtime — it stays in GitHub Secrets.
 *
 * Security model:
 *   Vercel has: GITHUB_DISPATCH_TOKEN (fine-grained PAT, repo:contents scope only)
 *   GitHub has: CURSOR_API_KEY (only exposed during CI workflow runs)
 *
 * Required env vars (Vercel):
 *   IMPROVEMENT_ENABLED       — "true" to enable (default: disabled)
 *   GITHUB_DISPATCH_TOKEN     — GitHub fine-grained PAT with contents:write scope
 *
 * Optional env vars (Vercel):
 *   IMPROVEMENT_REPO_OWNER    — GitHub owner (default: asamaka)
 *   IMPROVEMENT_REPO_NAME     — GitHub repo  (default: engzny)
 *   IMPROVEMENT_MIN_INTERVAL  — Min seconds between triggers (default: 1800)
 *   IMPROVEMENT_TRIGGER_ON    — Comma-separated: error,slow,periodic,all (default: error,slow)
 *   IMPROVEMENT_SLOW_THRESHOLD — Pipeline duration ms to be "slow" (default: 25000)
 *   IMPROVEMENT_PERIODIC_EVERY — Trigger every Nth successful report (default: 20)
 *
 * Required GitHub Secrets (for the workflow, NOT Vercel):
 *   CURSOR_API_KEY — Cursor API key from cursor.com/dashboard → Integrations
 */

const GITHUB_API = 'https://api.github.com';

const REDIS_KEYS = {
  LAST_TRIGGER: 'thinx:improvement:last_trigger',
  TRIGGER_LOG: 'thinx:improvement:triggers',
  REPORT_COUNT: 'thinx:improvement:report_count',
};

const MAX_TRIGGER_LOG = 50;

let _getRedis = null;

function init(getRedisFunc) { _getRedis = getRedisFunc; }

async function redis() { return _getRedis ? await _getRedis() : null; }

function getConfig() {
  return {
    enabled: process.env.IMPROVEMENT_ENABLED === 'true',
    githubToken: process.env.GITHUB_DISPATCH_TOKEN || '',
    repoOwner: process.env.IMPROVEMENT_REPO_OWNER || 'asamaka',
    repoName: process.env.IMPROVEMENT_REPO_NAME || 'engzny',
    minInterval: parseInt(process.env.IMPROVEMENT_MIN_INTERVAL || '1800', 10),
    triggerOn: (process.env.IMPROVEMENT_TRIGGER_ON || 'error,slow').split(',').map(s => s.trim()),
    slowThreshold: parseInt(process.env.IMPROVEMENT_SLOW_THRESHOLD || '25000', 10),
    periodicEvery: parseInt(process.env.IMPROVEMENT_PERIODIC_EVERY || '20', 10),
  };
}

/**
 * Evaluate a completed pipeline report and decide whether to trigger
 * an improvement agent. Returns { reason, detail } or null.
 */
async function evaluateReport(report) {
  const config = getConfig();

  if (!config.enabled || !config.githubToken) return null;

  const triggers = config.triggerOn;

  if (triggers.includes('all') || triggers.includes('error')) {
    if (report.outcome === 'error') {
      return { reason: 'pipeline_error', detail: report.error || 'unknown error' };
    }
  }

  if (triggers.includes('all') || triggers.includes('slow')) {
    const duration = report.duration || report.meta?.totalDuration;
    if (duration && duration > config.slowThreshold) {
      return { reason: 'slow_pipeline', detail: `${duration}ms (threshold: ${config.slowThreshold}ms)` };
    }
  }

  if (triggers.includes('all') || triggers.includes('periodic')) {
    const r = await redis();
    let count = 0;
    if (r) {
      count = await r.incr(REDIS_KEYS.REPORT_COUNT);
    }
    if (count > 0 && count % config.periodicEvery === 0) {
      return { reason: 'periodic_review', detail: `Report #${count}` };
    }
  }

  return null;
}

/**
 * Check rate limit — don't trigger more often than minInterval seconds.
 */
async function checkRateLimit() {
  const config = getConfig();
  const r = await redis();

  if (r) {
    const lastTrigger = await r.get(REDIS_KEYS.LAST_TRIGGER);
    if (lastTrigger) {
      const elapsed = (Date.now() - parseInt(lastTrigger, 10)) / 1000;
      if (elapsed < config.minInterval) {
        return { allowed: false, retryAfter: Math.ceil(config.minInterval - elapsed) };
      }
    }
  }

  return { allowed: true };
}

async function recordTrigger(entry) {
  const r = await redis();
  if (r) {
    await r.set(REDIS_KEYS.LAST_TRIGGER, String(Date.now()));
    const serialized = JSON.stringify(entry);
    await r.pipeline()
      .lpush(REDIS_KEYS.TRIGGER_LOG, serialized)
      .ltrim(REDIS_KEYS.TRIGGER_LOG, 0, MAX_TRIGGER_LOG - 1)
      .exec();
  }
}

/**
 * Build a compact report summary safe to include in the GitHub dispatch payload.
 * Keeps it small — GitHub limits event payloads to 10 client_payload keys.
 */
function buildReportSummary(report) {
  return {
    requestId: report.requestId,
    outcome: report.outcome,
    contentType: report.contentType || null,
    layoutType: report.layoutType || null,
    cardCount: report.cardCount || null,
    duration: report.duration || null,
    designDuration: report.designDuration || null,
    error: report.error || null,
    imageSize: report.imageSize || null,
    cardTypes: (report.cards || []).map(c => c.cardType).filter(Boolean),
    llmTraceSummary: report.llmTraceSummary || null,
  };
}

/**
 * Send a repository_dispatch event to GitHub Actions.
 * This triggers the continuous-improvement.yml workflow, which
 * reads CURSOR_API_KEY from GitHub Secrets (never in Vercel).
 */
async function dispatchGitHub(config, eventType, payload) {
  const url = `${GITHUB_API}/repos/${config.repoOwner}/${config.repoName}/dispatches`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.githubToken}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      event_type: eventType,
      client_payload: payload,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API ${response.status}: ${body}`);
  }
}

/**
 * Main entry point — called after a pipeline report is saved.
 * Errors are caught and logged, never thrown to the caller.
 */
async function onReportSaved(report) {
  try {
    const evaluation = await evaluateReport(report);
    if (!evaluation) return null;

    const rateCheck = await checkRateLimit();
    if (!rateCheck.allowed) {
      console.log(`[Improvement] Rate limited — retry after ${rateCheck.retryAfter}s`);
      return null;
    }

    const config = getConfig();
    const reportSummary = buildReportSummary(report);

    await dispatchGitHub(config, 'improvement-trigger', {
      reason: evaluation.reason,
      detail: evaluation.detail,
      report: reportSummary,
    });

    const triggerEntry = {
      method: 'github_dispatch',
      reason: evaluation.reason,
      detail: evaluation.detail,
      requestId: report.requestId,
      triggeredAt: new Date().toISOString(),
    };

    await recordTrigger(triggerEntry);

    console.log(`[Improvement] Dispatched to GitHub Actions (reason: ${evaluation.reason})`);
    return triggerEntry;
  } catch (err) {
    console.warn(`[Improvement] Trigger failed: ${err.message}`);
    return null;
  }
}

/**
 * Manual trigger — bypasses evaluation, respects rate limiting.
 */
async function manualTrigger(options = {}) {
  const config = getConfig();
  if (!config.githubToken) {
    throw new Error('GITHUB_DISPATCH_TOKEN not configured');
  }

  const rateCheck = await checkRateLimit();
  if (!rateCheck.allowed && !options.force) {
    throw new Error(`Rate limited — retry after ${rateCheck.retryAfter}s (use force=true to override)`);
  }

  await dispatchGitHub(config, 'improvement-trigger', {
    reason: 'manual',
    detail: options.focus || 'manual trigger',
    report: null,
  });

  const triggerEntry = {
    method: 'github_dispatch',
    reason: 'manual',
    detail: options.focus || 'manual trigger',
    requestId: null,
    triggeredAt: new Date().toISOString(),
  };

  await recordTrigger(triggerEntry);
  return triggerEntry;
}

/**
 * Get trigger history from Redis.
 */
async function getTriggerHistory(limit = 20) {
  const r = await redis();
  if (!r) return [];

  const raw = await r.lrange(REDIS_KEYS.TRIGGER_LOG, 0, limit - 1);
  return (raw || []).map(entry => {
    if (typeof entry === 'string') {
      try { return JSON.parse(entry); } catch { return null; }
    }
    return entry;
  }).filter(Boolean);
}

/**
 * Get current configuration (safe — no tokens exposed).
 */
function getStatus() {
  const config = getConfig();
  return {
    enabled: config.enabled,
    hasGithubToken: !!config.githubToken,
    repo: `${config.repoOwner}/${config.repoName}`,
    minInterval: config.minInterval,
    triggerOn: config.triggerOn,
    slowThreshold: config.slowThreshold,
    periodicEvery: config.periodicEvery,
  };
}

module.exports = {
  init,
  onReportSaved,
  manualTrigger,
  getTriggerHistory,
  getStatus,
  getConfig,
  evaluateReport,
  checkRateLimit,
  buildReportSummary,
  _REDIS_KEYS: REDIS_KEYS,
};
