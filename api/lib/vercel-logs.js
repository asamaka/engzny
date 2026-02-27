/**
 * Vercel Runtime Logs API Client
 *
 * Fetches persistent runtime logs from Vercel's API. These logs survive
 * cold starts (unlike the in-memory logger) because Vercel captures all
 * stdout/stderr from every function invocation.
 *
 * Required env vars:
 *   VERCEL_TOKEN      — API bearer token (vercel.com/account/tokens)
 *   VERCEL_PROJECT_ID — Project ID (project settings → General)
 *   VERCEL_TEAM_ID    — Team/org ID (optional, for team projects)
 */

const VERCEL_API = 'https://api.vercel.com';

function getConfig() {
  return {
    token: process.env.VERCEL_TOKEN,
    projectId: process.env.VERCEL_PROJECT_ID,
    teamId: process.env.VERCEL_TEAM_ID || undefined,
  };
}

function isConfigured() {
  const { token, projectId } = getConfig();
  return !!(token && projectId);
}

async function vercelFetch(path, params = {}) {
  const { token, teamId } = getConfig();
  if (!token) throw new Error('VERCEL_TOKEN not configured');

  const url = new URL(path, VERCEL_API);
  if (teamId) params.teamId = teamId;
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Vercel API ${res.status}: ${body.slice(0, 200)}`);
  }

  return res;
}

/**
 * Get the latest production deployment ID.
 */
async function getLatestDeployment() {
  const { projectId } = getConfig();
  const res = await vercelFetch('/v6/deployments', {
    projectId,
    limit: 1,
    target: 'production',
    state: 'READY',
  });
  const data = await res.json();
  if (!data.deployments?.length) throw new Error('No production deployments found');
  return data.deployments[0];
}

/**
 * Fetch runtime logs from Vercel for the latest production deployment.
 * Returns parsed log entries (up to `limit`).
 */
async function fetchRuntimeLogs({ limit = 100, since, until, level } = {}) {
  const { projectId } = getConfig();
  const deployment = await getLatestDeployment();

  const params = {};
  if (since) params.since = String(since);
  if (until) params.until = String(until);

  const { token, teamId } = getConfig();
  const url = new URL(`/v1/projects/${projectId}/deployments/${deployment.uid}/runtime-logs`, VERCEL_API);
  if (teamId) url.searchParams.set('teamId', teamId);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }

  // Runtime logs is a streaming endpoint (NDJSON). Use AbortController to
  // stop reading after we have enough data or hit a timeout.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  let entries = [];
  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Vercel API ${res.status}: ${body.slice(0, 200)}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const maxEntries = limit * 2;

    while (entries.length < maxEntries) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try { entries.push(JSON.parse(line)); } catch {}
        if (entries.length >= maxEntries) break;
      }
    }
    reader.cancel().catch(() => {});
  } catch (err) {
    if (err.name !== 'AbortError') throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (level) {
    entries = entries.filter(e => e.level === level);
  }
  entries = entries.slice(0, limit);

  return {
    deployment: {
      id: deployment.uid,
      url: deployment.url,
      created: deployment.created ? new Date(deployment.created).toISOString() : null,
      state: deployment.state,
    },
    count: entries.length,
    logs: entries.map(e => ({
      timestamp: e.timestampInMs ? new Date(e.timestampInMs).toISOString() : null,
      level: e.level,
      message: e.message,
      source: e.source,
      path: e.requestPath,
      method: e.requestMethod,
      status: e.responseStatusCode,
      domain: e.domain,
    })),
  };
}

/**
 * List recent deployments with basic info.
 */
async function listDeployments({ limit = 10 } = {}) {
  const { projectId } = getConfig();
  const res = await vercelFetch('/v6/deployments', { projectId, limit });
  const data = await res.json();
  return (data.deployments || []).map(d => ({
    id: d.uid,
    url: d.url,
    state: d.state,
    target: d.target,
    created: d.created ? new Date(d.created).toISOString() : null,
    ready: d.ready ? new Date(d.ready).toISOString() : null,
    creator: d.creator?.username,
    meta: d.meta ? { branch: d.meta.githubCommitRef, message: d.meta.githubCommitMessage?.slice(0, 80) } : null,
  }));
}

module.exports = { isConfigured, fetchRuntimeLogs, listDeployments, getLatestDeployment };
