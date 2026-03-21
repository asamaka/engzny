/**
 * TV Briefing Trigger
 *
 * Manages hourly TV briefing agent dispatches via GitHub Actions.
 * Tracks briefing history, user view timestamps, and unseen stories
 * so the agent can merge across multiple runs without losing content.
 *
 * Security model (same as continuous improvement):
 *   Vercel has: GITHUB_DISPATCH_TOKEN (fine-grained PAT, actions:write only)
 *   GitHub has: FIX_IT secret (Cursor API key, only exposed during CI runs)
 *
 * Required env vars (Vercel):
 *   GITHUB_DISPATCH_TOKEN — GitHub fine-grained PAT
 *
 * Optional env vars (Vercel):
 *   TV_BRIEFING_ENABLED     — "true" to enable (default: true when GITHUB_DISPATCH_TOKEN exists)
 *   TV_BRIEFING_MIN_INTERVAL — Min seconds between triggers (default: 3000 = 50 min)
 */

const GITHUB_API = 'https://api.github.com';

const REDIS_KEYS = {
  LAST_TRIGGER: 'tv:briefing:trigger:last',
  TRIGGER_LOG: 'tv:briefing:trigger:log',
  BRIEFING_HISTORY: 'tv:briefing:history',
  LAST_VIEWED: 'tv:briefing:last_viewed',
  TRIGGER_COUNT: 'tv:briefing:trigger:count',
};

const MAX_TRIGGER_LOG = 50;
const MAX_HISTORY = 24;

let _getRedis = null;

function init(getRedisFunc) { _getRedis = getRedisFunc; }

async function redis() { return _getRedis ? await _getRedis() : null; }

function getConfig() {
  const hasToken = !!process.env.GITHUB_DISPATCH_TOKEN;
  return {
    enabled: hasToken && process.env.TV_BRIEFING_ENABLED !== 'false',
    githubToken: process.env.GITHUB_DISPATCH_TOKEN || '',
    repoOwner: process.env.IMPROVEMENT_REPO_OWNER || 'asamaka',
    repoName: process.env.IMPROVEMENT_REPO_NAME || 'engzny',
    minInterval: parseInt(process.env.TV_BRIEFING_MIN_INTERVAL || '3000', 10),
  };
}

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
 * Save the current briefing to history before it's replaced.
 * Called by the POST /api/tv/briefing endpoint.
 */
async function archiveBriefing(briefingJson) {
  const r = await redis();
  if (!r) return;

  const entry = {
    archivedAt: new Date().toISOString(),
    agentRunAt: briefingJson.agentRunAt || null,
    storyIds: (briefingJson.videoRecommendations || []).map(v => v.id),
    storyTracker: briefingJson.storyTracker || {},
    stories: (briefingJson.videoRecommendations || []).map(v => ({
      id: v.id,
      storyTitle: v.storyTitle,
      tag: v.tag,
      videoId: v.videoId,
      ongoingStory: v.ongoingStory,
      ongoingStoryId: v.ongoingStoryId,
      storyPublishedAt: v.storyPublishedAt,
    })),
  };

  await r.pipeline()
    .lpush(REDIS_KEYS.BRIEFING_HISTORY, JSON.stringify(entry))
    .ltrim(REDIS_KEYS.BRIEFING_HISTORY, 0, MAX_HISTORY - 1)
    .exec();
}

/**
 * Record that the user viewed the briefing.
 * Called when the TV app fetches GET /api/tv/briefing.
 */
async function recordView() {
  const r = await redis();
  if (!r) return;
  await r.set(REDIS_KEYS.LAST_VIEWED, new Date().toISOString());
}

/**
 * Get the full briefing context for the agent.
 * Includes current briefing state, history, unseen stories, and view info.
 */
async function getBriefingContext() {
  const r = await redis();
  if (!r) return { error: 'Redis not configured' };

  const [currentRaw, lastViewed, historyRaw] = await Promise.all([
    r.get('tv:briefing'),
    r.get(REDIS_KEYS.LAST_VIEWED),
    r.lrange(REDIS_KEYS.BRIEFING_HISTORY, 0, MAX_HISTORY - 1),
  ]);

  const current = currentRaw
    ? (typeof currentRaw === 'string' ? JSON.parse(currentRaw) : currentRaw)
    : null;

  const history = (historyRaw || []).map(entry => {
    if (typeof entry === 'string') {
      try { return JSON.parse(entry); } catch { return null; }
    }
    return entry;
  }).filter(Boolean);

  const lastViewedAt = lastViewed || null;
  const currentAgentRunAt = current?.agentRunAt || null;

  let briefingsSinceLastView = 0;
  const unseenStoryIds = new Set();
  const currentStoryIds = new Set(
    (current?.videoRecommendations || []).map(v => v.id)
  );

  if (lastViewedAt) {
    const viewedTime = new Date(lastViewedAt).getTime();

    for (const h of history) {
      const archivedTime = new Date(h.archivedAt).getTime();
      if (archivedTime > viewedTime) {
        briefingsSinceLastView++;
        for (const sid of (h.storyIds || [])) {
          if (!currentStoryIds.has(sid)) {
            unseenStoryIds.add(sid);
          }
        }
      }
    }
  }

  const unseenStories = [];
  if (unseenStoryIds.size > 0) {
    for (const h of history) {
      for (const story of (h.stories || [])) {
        if (unseenStoryIds.has(story.id)) {
          unseenStories.push(story);
          unseenStoryIds.delete(story.id);
        }
      }
      if (unseenStoryIds.size === 0) break;
    }
  }

  return {
    lastViewedAt,
    currentAgentRunAt,
    briefingsSinceLastView,
    unseenStoryCount: unseenStories.length,
    unseenStories,
    storyTracker: current?.storyTracker || {},
    watchLog: current?.watchLog || [],
    currentStoryIds: [...currentStoryIds],
    historyCount: history.length,
  };
}

/**
 * Dispatch the tv-briefing-agent.yml workflow via GitHub API.
 */
async function dispatchGitHub(config, inputs) {
  const workflowFile = 'tv-briefing-agent.yml';
  const url = `${GITHUB_API}/repos/${config.repoOwner}/${config.repoName}/actions/workflows/${workflowFile}/dispatches`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.githubToken}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ref: 'main',
      inputs,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API ${response.status}: ${body}`);
  }
}

/**
 * Trigger the TV briefing agent.
 * Called by the hourly cron (via API endpoint) or manually.
 */
async function trigger(options = {}) {
  const config = getConfig();

  if (!config.enabled) {
    return { triggered: false, reason: 'disabled' };
  }

  if (!config.githubToken) {
    throw new Error('GITHUB_DISPATCH_TOKEN not configured');
  }

  const rateCheck = await checkRateLimit();
  if (!rateCheck.allowed && !options.force) {
    return {
      triggered: false,
      reason: 'rate_limited',
      retryAfter: rateCheck.retryAfter,
    };
  }

  let briefingContext = '';
  try {
    const ctx = await getBriefingContext();
    briefingContext = JSON.stringify(ctx);
    if (briefingContext.length > 60000) {
      const slim = { ...ctx, unseenStories: ctx.unseenStories.slice(0, 10) };
      briefingContext = JSON.stringify(slim);
    }
  } catch (err) {
    console.warn(`[TV Briefing] Failed to build context: ${err.message}`);
  }

  const reason = options.source === 'cron' ? 'hourly_cron' : 'manual';
  const detail = options.focus || `Hourly briefing refresh at ${new Date().toISOString()}`;

  await dispatchGitHub(config, {
    reason,
    detail,
    briefing_context: briefingContext,
  });

  const r = await redis();
  if (r) {
    await r.incr(REDIS_KEYS.TRIGGER_COUNT);
  }

  const triggerEntry = {
    method: 'github_dispatch',
    reason,
    detail,
    triggeredAt: new Date().toISOString(),
  };

  await recordTrigger(triggerEntry);

  console.log(`[TV Briefing] Dispatched agent (reason: ${reason})`);
  return { triggered: true, ...triggerEntry };
}

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

async function getStatus() {
  const config = getConfig();
  const r = await redis();

  let lastTrigger = null;
  let totalTriggers = 0;
  let lastViewed = null;

  if (r) {
    const [lt, tc, lv] = await Promise.all([
      r.get(REDIS_KEYS.LAST_TRIGGER),
      r.get(REDIS_KEYS.TRIGGER_COUNT),
      r.get(REDIS_KEYS.LAST_VIEWED),
    ]);
    lastTrigger = lt ? new Date(parseInt(lt, 10)).toISOString() : null;
    totalTriggers = parseInt(tc || '0', 10);
    lastViewed = lv || null;
  }

  return {
    enabled: config.enabled,
    hasGithubToken: !!config.githubToken,
    repo: `${config.repoOwner}/${config.repoName}`,
    minInterval: config.minInterval,
    lastTrigger,
    totalTriggers,
    lastViewed,
  };
}

module.exports = {
  init,
  trigger,
  archiveBriefing,
  recordView,
  getBriefingContext,
  getTriggerHistory,
  getStatus,
  getConfig,
  checkRateLimit,
  _REDIS_KEYS: REDIS_KEYS,
};
