#!/usr/bin/env node
/**
 * eval-intel.js — run the snapshot-vs-reality accuracy evaluation for the intel feed.
 *
 * Loads the bundle the TV is currently showing (Redis tv:war:intel:v1, or the
 * on-disk fallback), establishes ground truth at "now" via a live web search,
 * scores coverage / freshness / staleness / market alignment, asks Opus to
 * reflect on what we missed and recommend fixes, then stores the report with
 * history (tv:war:eval:*). Run on a cron (.github/workflows/intel-eval-cron.yml)
 * or on demand via POST /api/tv/intel/eval.
 *
 * Usage: node scripts/eval-intel.js            # eval current live bundle
 *        node scripts/eval-intel.js --no-reflect
 */
require('dotenv').config();
const E = require('../api/lib/intel-eval');
const W = require('../api/lib/war-sources');

function log(...a) { console.error('[eval-intel]', ...a); }

async function main() {
  const reflectEnabled = !process.argv.includes('--no-reflect');
  const redis = W.getRedis();
  log('redis', redis ? 'connected' : 'NOT configured (file fallback)');

  const bundle = await E.loadBundle(redis);
  if (!bundle || !Array.isArray(bundle.stories) || !bundle.stories.length) {
    log('no intel bundle to evaluate; aborting');
    process.exit(1);
  }
  log(`evaluating bundle generated ${bundle.generatedAt} (${bundle.stories.length} stories, ${(bundle.signals || []).length} signals)`);

  const report = await E.scoreSnapshot({ bundle, reflectEnabled });
  const summary = await E.saveReport(report, redis);

  log('=== ACCURACY ===');
  log(`composite ${report.scores.composite}/100  (coverage ${report.scores.coverage}, freshness ${report.scores.freshness}, staleness ${report.scores.staleness}, markets ${report.scores.marketAlignment})`);
  log(`grade ${report.reflection && report.reflection.grade} | median displayed age ${report.freshness.medianDisplayedAgeH}h | stale fraction ${report.staleness.staleFraction}`);
  const missed = report.coverage.missed || [];
  if (missed.length) {
    log(`MISSED ${missed.length} real development(s):`);
    for (const m of missed.slice(0, 6)) log(`  - (${m.importance}/5) ${m.title}`);
  } else {
    log('no misses — feed covers the real top developments');
  }
  if (report.reflection && report.reflection.narrative) log('reflection:', report.reflection.narrative);
  for (const r of (report.reflection && report.reflection.recommendations) || []) {
    log(`  rec [${r.priority}/${r.type}] ${r.target}: ${r.detail}`);
  }
  log('stored:', JSON.stringify(summary));
}

main().catch(e => { console.error('[eval-intel] FATAL', e); process.exit(1); });
