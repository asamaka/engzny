#!/usr/bin/env node

/**
 * Pulls captured production screenshots into the local test dataset.
 * Downloads full images from the /api/captures endpoints and adds them
 * to the tests/dataset/screenshots/ directory with metadata.
 *
 * Usage:
 *   node scripts/pull-captured-screenshots.js [--limit N] [--host URL]
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');

const DATASET_DIR = path.join(__dirname, '..', 'tests', 'dataset');
const SCREENSHOTS_DIR = path.join(DATASET_DIR, 'screenshots');
const CAPTURED_DIR = path.join(SCREENSHOTS_DIR, 'captured');
const MANIFEST_PATH = path.join(DATASET_DIR, 'manifest.json');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    limit: 50,
    host: 'https://www.thinx.fun',
    token: process.env.DEBUG_TOKEN || 'thinx-debug-2026',
  };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--limit': opts.limit = parseInt(args[++i], 10) || 50; break;
      case '--host': opts.host = args[++i]; break;
      case '--token': opts.token = args[++i]; break;
      case '--help':
        console.log(`
Usage: node scripts/pull-captured-screenshots.js [options]

Downloads captured production screenshots into the test dataset.

Options:
  --limit N     Max screenshots to pull (default: 50)
  --host URL    Server URL (default: https://www.thinx.fun)
  --token T     Debug token (default: from DEBUG_TOKEN env var)
  --help        Show this help
`);
        process.exit(0);
    }
  }
  return opts;
}

function log(msg) { console.log(`[pull] ${msg}`); }

function fetchJSON(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const proto = urlObj.protocol === 'https:' ? https : http;
    proto.get({ hostname: urlObj.hostname, port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80), path: urlObj.pathname + (urlObj.search || ''), headers }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

function downloadBuffer(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const proto = urlObj.protocol === 'https:' ? https : http;
    proto.get({ hostname: urlObj.hostname, port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80), path: urlObj.pathname + (urlObj.search || ''), headers }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

async function main() {
  const opts = parseArgs();
  const headers = { 'X-Debug-Token': opts.token };

  log(`Pulling captured screenshots from ${opts.host}`);

  const { total, captures } = await fetchJSON(`${opts.host}/api/captures?limit=${opts.limit}`, headers);
  log(`Found ${total} captures, pulling ${captures.length}`);

  if (captures.length === 0) {
    log('No captures available. Screenshots are captured from production usage.');
    return;
  }

  fs.mkdirSync(CAPTURED_DIR, { recursive: true });

  // Load existing manifest hashes to skip duplicates
  const existingHashes = new Set();
  if (fs.existsSync(MANIFEST_PATH)) {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
    manifest.images.forEach(img => { if (img.hash) existingHashes.add(img.hash); });
  }

  let pulled = 0;
  let skipped = 0;

  for (const cap of captures) {
    if (existingHashes.has(cap.hash)) {
      skipped++;
      continue;
    }

    try {
      const imgBuf = await downloadBuffer(`${opts.host}/api/captures/${cap.id}/full`, headers);
      const hash = crypto.createHash('sha256').update(imgBuf).digest('hex').slice(0, 16);

      if (existingHashes.has(hash)) {
        skipped++;
        continue;
      }

      const ext = cap.format === 'jpeg' ? '.jpg' : cap.format === 'png' ? '.png' : '.webp';
      const filename = `prod_${cap.id}_${cap.width}x${cap.height}${ext}`;
      const destPath = path.join(CAPTURED_DIR, filename);

      fs.writeFileSync(destPath, imgBuf);
      existingHashes.add(hash);
      pulled++;

      const type = cap.contentType || 'unknown';
      const platform = cap.platform ? ` (${cap.platform})` : '';
      log(`  ${filename} — ${cap.width}x${cap.height} — ${type}${platform}`);
    } catch (err) {
      log(`  Failed ${cap.id}: ${err.message}`);
    }
  }

  log(`\nPulled: ${pulled}, Skipped (duplicates): ${skipped}`);
  log(`Captured screenshots saved to: tests/dataset/screenshots/captured/`);

  if (pulled > 0) {
    log('\nRun the dataset fetch script to rebuild the manifest:');
    log('  node scripts/fetch-screenshot-dataset.js --curated-only');
  }
}

main().catch(err => {
  console.error('[pull] Fatal:', err.message);
  process.exit(1);
});
