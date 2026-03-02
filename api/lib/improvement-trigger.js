/**
 * Continuous Improvement Trigger
 *
 * Spawns a Cursor Cloud Agent via the REST API when a pipeline report
 * meets certain criteria (errors, slow performance, periodic review).
 *
 * Required env vars:
 *   CURSOR_API_KEY       — Cursor API key (from cursor.com/dashboard → Integrations)
 *   IMPROVEMENT_ENABLED  — "true" to enable (default: disabled)
 *
 * Optional env vars:
 *   IMPROVEMENT_REPO     — GitHub repo URL (default: https://github.com/asamaka/engzny)
 *   IMPROVEMENT_REF      — Branch to base off (default: main)
 *   IMPROVEMENT_MODEL    — LLM model for the agent (default: claude-4-sonnet)
 *   IMPROVEMENT_MIN_INTERVAL — Minimum seconds between triggers (default: 1800 = 30 min)
 *   IMPROVEMENT_TRIGGER_ON   — Comma-separated: error,slow,periodic,all (default: error,slow)
 *   IMPROVEMENT_SLOW_THRESHOLD — Pipeline duration in ms to be "slow" (default: 25000)
 *   IMPROVEMENT_PERIODIC_EVERY — Trigger every Nth successful report (default: 20)
 */

const CURSOR_API_BASE = 'https://api.cursor.com';

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
    apiKey: process.env.CURSOR_API_KEY || '',
    repo: process.env.IMPROVEMENT_REPO || 'https://github.com/asamaka/engzny',
    ref: process.env.IMPROVEMENT_REF || 'main',
    model: process.env.IMPROVEMENT_MODEL || 'claude-4-sonnet',
    minInterval: parseInt(process.env.IMPROVEMENT_MIN_INTERVAL || '1800', 10),
    triggerOn: (process.env.IMPROVEMENT_TRIGGER_ON || 'error,slow').split(',').map(s => s.trim()),
    slowThreshold: parseInt(process.env.IMPROVEMENT_SLOW_THRESHOLD || '25000', 10),
    periodicEvery: parseInt(process.env.IMPROVEMENT_PERIODIC_EVERY || '20', 10),
  };
}

/**
 * Evaluate a completed pipeline report and decide whether to trigger
 * an improvement agent. Returns { shouldTrigger, reason } or null.
 */
async function evaluateReport(report) {
  const config = getConfig();

  if (!config.enabled || !config.apiKey) return null;

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
 * Build the prompt for the improvement agent based on the report and trigger reason.
 */
function buildPrompt(report, evaluation) {
  const reportSummary = {
    requestId: report.requestId,
    outcome: report.outcome,
    contentType: report.contentType,
    layoutType: report.layoutType,
    cardCount: report.cardCount,
    duration: report.duration,
    designDuration: report.designDuration,
    error: report.error,
    imageSize: report.imageSize,
    cardTypes: (report.cards || []).map(c => c.cardType).filter(Boolean),
    llmTraceSummary: report.llmTraceSummary,
  };

  const triggerContext = {
    reason: evaluation.reason,
    detail: evaluation.detail,
    triggeredAt: new Date().toISOString(),
  };

  return `You are a Continuous Improvement Agent for thinx.fun — a mobile-first screenshot intelligence app.

## Context

A pipeline report has been flagged for review. Your job is to analyze the report, identify what went wrong or what could be better, and make targeted code improvements.

## Trigger

**Reason:** ${evaluation.reason}
**Detail:** ${evaluation.detail}

## Pipeline Report

\`\`\`json
${JSON.stringify(reportSummary, null, 2)}
\`\`\`

## Your Instructions

1. **Read CLAUDE.md** first — it contains the full project architecture and conventions.
2. **Read the agent spec** at \`.claude/agents/continuous-improvement.md\` for detailed guidelines.
3. **Analyze the report** to understand what happened.
4. **Investigate the relevant code** based on the trigger reason:
   - For \`pipeline_error\`: trace the error through the pipeline code
   - For \`slow_pipeline\`: profile the slow phases and look for optimization opportunities
   - For \`periodic_review\`: review recent patterns, look for recurring issues
5. **Make targeted improvements** — small, safe changes that address the specific issue.
6. **Run tests** (\`npm test\`) to verify your changes don't break anything.
7. **Commit and push** to a \`cursor/improvement-*\` branch. The auto-deploy workflow will handle the rest.

## Safety Rules

- Make ONE focused improvement per trigger. Don't refactor the world.
- Never change test expectations to make tests pass — fix the actual code.
- Never modify environment variables or secrets.
- Never remove existing features or endpoints.
- If you're unsure about a change, skip it and document your findings in the commit message.
- Prefer adding error handling, improving prompts, or optimizing performance over structural changes.`;
}

/**
 * Launch a Cursor Cloud Agent via the REST API.
 */
async function launchAgent(prompt, config) {
  const response = await fetch(`${CURSOR_API_BASE}/v0/agents`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt: { text: prompt },
      model: config.model,
      source: {
        repository: config.repo,
        ref: config.ref,
      },
      target: {
        autoCreatePr: false,
        autoBranch: true,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Cursor API ${response.status}: ${body}`);
  }

  return response.json();
}

/**
 * Main entry point — called after a pipeline report is saved.
 * Fire-and-forget: errors are caught and logged, never thrown.
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
    const prompt = buildPrompt(report, evaluation);
    const agent = await launchAgent(prompt, config);

    const triggerEntry = {
      agentId: agent.id,
      agentUrl: agent.target?.url,
      reason: evaluation.reason,
      detail: evaluation.detail,
      requestId: report.requestId,
      triggeredAt: new Date().toISOString(),
      status: agent.status,
    };

    await recordTrigger(triggerEntry);

    console.log(`[Improvement] Agent launched: ${agent.id} (reason: ${evaluation.reason})`);
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
  if (!config.apiKey) {
    throw new Error('CURSOR_API_KEY not configured');
  }

  const rateCheck = await checkRateLimit();
  if (!rateCheck.allowed && !options.force) {
    throw new Error(`Rate limited — retry after ${rateCheck.retryAfter}s (use force=true to override)`);
  }

  const prompt = options.prompt || buildManualPrompt(options.focus);
  const agent = await launchAgent(prompt, config);

  const triggerEntry = {
    agentId: agent.id,
    agentUrl: agent.target?.url,
    reason: 'manual',
    detail: options.focus || 'manual trigger',
    requestId: null,
    triggeredAt: new Date().toISOString(),
    status: agent.status,
  };

  await recordTrigger(triggerEntry);
  return triggerEntry;
}

function buildManualPrompt(focus) {
  const focusText = focus
    ? `\n\n## Focus Area\n\n${focus}`
    : '';

  return `You are a Continuous Improvement Agent for thinx.fun — a mobile-first screenshot intelligence app.

## Context

You have been manually triggered to review the codebase and make improvements.
${focusText}

## Your Instructions

1. **Read CLAUDE.md** first — it contains the full project architecture and conventions.
2. **Read the agent spec** at \`.claude/agents/continuous-improvement.md\` for detailed guidelines.
3. **Check the debug dashboard** for recent errors, slow pipelines, and patterns:
   \`curl 'https://www.thinx.fun/api/debug/dashboard?token=thinx-debug-2026'\`
4. **Identify the highest-impact improvement** you can make.
5. **Make targeted improvements** — small, safe changes.
6. **Run tests** (\`npm test\`) to verify nothing breaks.
7. **Commit and push** to a \`cursor/improvement-*\` branch.

## Safety Rules

- Make ONE focused improvement per trigger.
- Never change test expectations to make tests pass — fix the actual code.
- Never modify environment variables or secrets.
- Never remove existing features or endpoints.
- If you're unsure, document findings in the commit message and skip the change.`;
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
 * Get current configuration (safe — no API key exposed).
 */
function getStatus() {
  const config = getConfig();
  return {
    enabled: config.enabled,
    hasApiKey: !!config.apiKey,
    repo: config.repo,
    ref: config.ref,
    model: config.model,
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
  buildPrompt,
  _REDIS_KEYS: REDIS_KEYS,
};
