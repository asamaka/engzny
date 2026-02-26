#!/usr/bin/env node

/**
 * Fetches publicly available mobile phone screenshots from Wikimedia Commons
 * and other open sources, then organizes them into a categorized test dataset
 * with full metadata for use in thinx.fun pipeline testing.
 *
 * Sources:
 *   - Wikimedia Commons (CC-licensed screenshot categories)
 *   - Curated public URLs from research/forum posts
 *
 * Usage:
 *   node scripts/fetch-screenshot-dataset.js [--limit N] [--categories cat1,cat2] [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { pipeline } = require('stream/promises');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DATASET_DIR = path.join(__dirname, '..', 'tests', 'dataset');
const SCREENSHOTS_DIR = path.join(DATASET_DIR, 'screenshots');
const MANIFEST_PATH = path.join(DATASET_DIR, 'manifest.json');

const WIKIMEDIA_API = 'https://commons.wikimedia.org/w/api.php';
const USER_AGENT = 'thinx-dataset-builder/1.0 (https://github.com/asamaka/engzny)';

const REQUEST_DELAY_MS = 1500;
const DOWNLOAD_DELAY_MS = 2000;
const DOWNLOAD_TIMEOUT_MS = 30000;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB cap per image
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = 5000;

// Categories on Wikimedia Commons that contain mobile screenshots.
// Each entry maps to a local subfolder and Commons category name.
const WIKIMEDIA_CATEGORIES = {
  ios: [
    'Category:IOS_screenshots',
    'Category:Wikipedia_iOS_app_screenshots',
    'Category:Commons_iOS_app_screenshots',
    'Category:Screenshots_of_Safari_mobile',
  ],
  android: [
    'Category:Screenshots_of_Android_applications',
    'Category:Android_(operating_system)_screenshots',
    'Category:Screenshots_of_F-Droid',
  ],
  settings: [
    'Category:IOS_settings_screenshots',
  ],
  social: [
    'Category:Screenshots_of_Twitter',
    'Category:Screenshots_of_Instagram',
    'Category:Screenshots_of_Facebook',
    'Category:Screenshots_of_WhatsApp',
    'Category:Screenshots_of_Telegram_(software)',
  ],
  messaging: [
    'Category:Screenshots_of_Signal_(software)',
    'Category:Screenshots_of_WhatsApp',
  ],
  maps: [
    'Category:Screenshots_of_Google_Maps',
    'Category:Screenshots_of_OpenStreetMap',
  ],
  misc: [
    'Category:Mobile_phone_screenshots',
    'Category:Smartphone_screenshots',
    'Category:Screenshots_of_mobile_web_browsers',
  ],
};

// Wikimedia search queries for finding more mobile screenshots beyond categories.
// Each maps a local category to search terms.
const WIKIMEDIA_SEARCHES = {
  android: ['Android phone screenshot', 'Android app screenshot mobile'],
  ios: ['iPhone screenshot app', 'iOS mobile screenshot'],
  messaging: ['WhatsApp screenshot', 'Telegram screenshot mobile'],
  social: ['Twitter screenshot mobile', 'Instagram screenshot phone'],
  maps: ['Google Maps screenshot mobile', 'map app screenshot phone'],
  misc: ['mobile phone screenshot', 'smartphone screenshot app'],
};

// Hand-curated URLs of verified-existing Wikimedia Commons images.
const CURATED_URLS = [
  {
    url: 'https://upload.wikimedia.org/wikipedia/commons/b/b2/Asus_ZC500TG-1A024TW_about-the-mobile-phone_screenshot_20151021.png',
    category: 'android',
    source: 'Wikimedia Commons',
    license: 'CC BY-SA 4.0',
    description: 'Asus ZenFone C Android about phone screenshot',
  },
  {
    url: 'https://upload.wikimedia.org/wikipedia/commons/b/ba/Asus_ZC500TG-1A024TW_about-the-mobile-phone_screenshot_20151030.png',
    category: 'android',
    source: 'Wikimedia Commons',
    license: 'CC BY-SA 4.0',
    description: 'Asus ZenFone C Android about phone screenshot (updated)',
  },
  {
    url: 'https://upload.wikimedia.org/wikipedia/commons/8/82/Alignment_problem_screenshot.png',
    category: 'misc',
    source: 'Wikimedia Commons',
    license: 'CC BY-SA 4.0',
    description: 'Mobile UI alignment issue screenshot',
  },
  {
    url: 'https://upload.wikimedia.org/wikipedia/commons/a/a8/Alerta_SAE_Rengo_20240204-0109.png',
    category: 'misc',
    source: 'Wikimedia Commons',
    license: 'CC BY-SA 4.0',
    description: 'Chilean emergency alert (SAE) on mobile phone',
  },
  {
    url: 'https://upload.wikimedia.org/wikipedia/commons/8/80/Image_in_a_spanish_whatsapp_chat.jpg',
    category: 'messaging',
    source: 'Wikimedia Commons',
    license: 'CC BY-SA 4.0',
    description: 'WhatsApp chat screenshot in Spanish',
  },
  {
    url: 'https://upload.wikimedia.org/wikipedia/commons/6/60/Acid2iPod.png',
    category: 'ios',
    source: 'Wikimedia Commons',
    license: 'CC BY-SA 3.0',
    description: 'iPod Touch Safari browser Acid2 test screenshot',
  },
  {
    url: 'https://upload.wikimedia.org/wikipedia/commons/e/e1/Commons_app_for_iOS.PNG',
    category: 'ios',
    source: 'Wikimedia Commons',
    license: 'CC BY-SA 4.0',
    description: 'Wikimedia Commons iOS app screenshot',
  },
  {
    url: 'https://upload.wikimedia.org/wikipedia/commons/4/46/Example_Instagram_CC_licence.png',
    category: 'social',
    source: 'Wikimedia Commons',
    license: 'CC BY-SA 4.0',
    description: 'Instagram CC license example screenshot',
  },
  {
    url: 'https://upload.wikimedia.org/wikipedia/commons/8/82/Dad_joke.jpg',
    category: 'social',
    source: 'Wikimedia Commons',
    license: 'CC BY-SA 4.0',
    description: 'Social media dad joke screenshot',
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    limit: 10,
    categories: Object.keys(WIKIMEDIA_CATEGORIES),
    dryRun: false,
    verbose: false,
    curatedOnly: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--limit':
        opts.limit = parseInt(args[++i], 10) || 10;
        break;
      case '--categories':
        opts.categories = args[++i].split(',').map(s => s.trim());
        break;
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '--verbose':
        opts.verbose = true;
        break;
      case '--curated-only':
        opts.curatedOnly = true;
        break;
      case '--help':
        console.log(`
Usage: node scripts/fetch-screenshot-dataset.js [options]

Options:
  --limit N            Max screenshots per Wikimedia category (default: 10)
  --categories a,b,c   Comma-separated category names (default: all)
                        Available: ${Object.keys(WIKIMEDIA_CATEGORIES).join(', ')}
  --curated-only       Only download hand-curated URLs (skip Wikimedia API)
  --dry-run            List what would be downloaded without downloading
  --verbose            Show detailed progress
  --help               Show this help message
`);
        process.exit(0);
    }
  }
  return opts;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function log(msg) {
  console.log(`[dataset] ${msg}`);
}

function verbose(msg, opts) {
  if (opts && opts.verbose) console.log(`  > ${msg}`);
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);
}

function sanitizeFilename(name) {
  return name
    .replace(/^File:/, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .substring(0, 120);
}

function extensionFromMime(mime) {
  const map = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
  };
  return map[mime] || '.png';
}

// ---------------------------------------------------------------------------
// HTTP utilities
// ---------------------------------------------------------------------------

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJSON(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Invalid JSON from ${url}: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(DOWNLOAD_TIMEOUT_MS, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function downloadFileOnce(url, destPath) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const req = proto.get(url, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadFileOnce(res.headers.location, destPath).then(resolve, reject);
      }
      if (res.statusCode === 429) {
        res.resume();
        return reject(Object.assign(new Error('HTTP 429'), { retryable: true }));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }

      const contentLength = parseInt(res.headers['content-length'], 10);
      if (contentLength && contentLength > MAX_FILE_SIZE) {
        res.resume();
        return reject(new Error(`File too large: ${(contentLength / 1024 / 1024).toFixed(1)}MB`));
      }

      const chunks = [];
      let totalSize = 0;
      res.on('data', chunk => {
        totalSize += chunk.length;
        if (totalSize > MAX_FILE_SIZE) {
          res.destroy();
          return reject(new Error(`Download exceeded ${MAX_FILE_SIZE / 1024 / 1024}MB limit`));
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        fs.writeFileSync(destPath, buffer);
        resolve({ size: buffer.length, hash: sha256(buffer) });
      });
    });
    req.on('error', reject);
    req.setTimeout(DOWNLOAD_TIMEOUT_MS, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function downloadFile(url, destPath) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await downloadFileOnce(url, destPath);
    } catch (err) {
      if (err.retryable && attempt < MAX_RETRIES) {
        const wait = RETRY_BACKOFF_MS * Math.pow(2, attempt);
        await sleep(wait);
        continue;
      }
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Wikimedia Commons API
// ---------------------------------------------------------------------------

async function fetchCategoryMembers(category, limit) {
  const params = new URLSearchParams({
    action: 'query',
    generator: 'categorymembers',
    gcmtitle: category,
    gcmtype: 'file',
    gcmlimit: String(Math.min(limit, 50)),
    prop: 'imageinfo',
    iiprop: 'url|size|mime|extmetadata',
    iiurlwidth: '640',
    format: 'json',
    origin: '*',
  });

  const url = `${WIKIMEDIA_API}?${params}`;
  const data = await fetchJSON(url);

  if (!data.query || !data.query.pages) return [];

  return Object.values(data.query.pages)
    .filter(page => page.imageinfo && page.imageinfo.length > 0)
    .map(page => {
      const info = page.imageinfo[0];
      const meta = info.extmetadata || {};
      return {
        title: page.title,
        url: info.thumburl || info.url,
        originalUrl: info.url,
        width: info.thumbwidth || info.width,
        height: info.thumbheight || info.height,
        mime: info.mime,
        size: info.size,
        license: meta.LicenseShortName ? meta.LicenseShortName.value : 'Unknown',
        description: meta.ImageDescription ? meta.ImageDescription.value.replace(/<[^>]*>/g, '').substring(0, 200) : '',
        author: meta.Artist ? meta.Artist.value.replace(/<[^>]*>/g, '').substring(0, 100) : 'Unknown',
        source: 'Wikimedia Commons',
        sourceCategory: category,
      };
    })
    .filter(item => {
      if (!item.mime) return false;
      return ['image/png', 'image/jpeg', 'image/webp'].includes(item.mime);
    });
}

async function searchWikimediaFiles(searchTerm, limit) {
  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: searchTerm,
    gsrnamespace: '6',
    gsrlimit: String(Math.min(limit, 50)),
    prop: 'imageinfo',
    iiprop: 'url|size|mime|extmetadata',
    iiurlwidth: '640',
    format: 'json',
    origin: '*',
  });

  const url = `${WIKIMEDIA_API}?${params}`;
  const data = await fetchJSON(url);

  if (!data.query || !data.query.pages) return [];

  return Object.values(data.query.pages)
    .filter(page => page.imageinfo && page.imageinfo.length > 0)
    .map(page => {
      const info = page.imageinfo[0];
      const meta = info.extmetadata || {};
      return {
        title: page.title,
        url: info.thumburl || info.url,
        originalUrl: info.url,
        width: info.thumbwidth || info.width,
        height: info.thumbheight || info.height,
        mime: info.mime,
        size: info.size,
        license: meta.LicenseShortName ? meta.LicenseShortName.value : 'Unknown',
        description: meta.ImageDescription
          ? meta.ImageDescription.value.replace(/<[^>]*>/g, '').substring(0, 200)
          : '',
        author: meta.Artist
          ? meta.Artist.value.replace(/<[^>]*>/g, '').substring(0, 100)
          : 'Unknown',
        source: 'Wikimedia Commons',
        sourceCategory: `search:${searchTerm}`,
      };
    })
    .filter(item => {
      if (!item.mime) return false;
      return ['image/png', 'image/jpeg', 'image/webp'].includes(item.mime);
    });
}

// ---------------------------------------------------------------------------
// Image validation (uses sharp if available, falls back to basic checks)
// ---------------------------------------------------------------------------

async function validateImage(filePath) {
  try {
    const sharp = require('sharp');
    const metadata = await sharp(filePath).metadata();
    return {
      valid: true,
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
      channels: metadata.channels,
    };
  } catch {
    const buffer = fs.readFileSync(filePath);
    const isPng = buffer[0] === 0x89 && buffer[1] === 0x50;
    const isJpeg = buffer[0] === 0xFF && buffer[1] === 0xD8;
    const isWebp = buffer.slice(0, 4).toString() === 'RIFF' && buffer.slice(8, 12).toString() === 'WEBP';

    return {
      valid: isPng || isJpeg || isWebp,
      width: null,
      height: null,
      format: isPng ? 'png' : isJpeg ? 'jpeg' : isWebp ? 'webp' : 'unknown',
      channels: null,
    };
  }
}

// ---------------------------------------------------------------------------
// Dataset builder
// ---------------------------------------------------------------------------

function ensureDirectories() {
  fs.mkdirSync(DATASET_DIR, { recursive: true });
  for (const cat of Object.keys(WIKIMEDIA_CATEGORIES)) {
    fs.mkdirSync(path.join(SCREENSHOTS_DIR, cat), { recursive: true });
  }
}

async function fetchWikimediaScreenshots(opts) {
  const results = [];

  for (const cat of opts.categories) {
    const wikiCategories = WIKIMEDIA_CATEGORIES[cat];
    if (!wikiCategories) {
      log(`Warning: unknown category "${cat}", skipping`);
      continue;
    }

    log(`Fetching from Wikimedia categories: ${cat} (${wikiCategories.length} sources)...`);

    for (const wikiCat of wikiCategories) {
      verbose(`  Querying ${wikiCat}...`, opts);
      try {
        const members = await fetchCategoryMembers(wikiCat, opts.limit);
        verbose(`  Found ${members.length} images in ${wikiCat}`, opts);
        for (const member of members) {
          results.push({ ...member, localCategory: cat });
        }
        await sleep(REQUEST_DELAY_MS);
      } catch (err) {
        log(`  Warning: failed to query ${wikiCat}: ${err.message}`);
      }
    }
  }

  // Also run search-based discovery
  for (const cat of opts.categories) {
    const searches = WIKIMEDIA_SEARCHES[cat];
    if (!searches) continue;

    log(`Searching Wikimedia for: ${cat}...`);
    for (const query of searches) {
      verbose(`  Searching "${query}"...`, opts);
      try {
        const found = await searchWikimediaFiles(query, opts.limit);
        verbose(`  Found ${found.length} images for "${query}"`, opts);
        for (const item of found) {
          results.push({ ...item, localCategory: cat });
        }
        await sleep(REQUEST_DELAY_MS);
      } catch (err) {
        log(`  Warning: search failed for "${query}": ${err.message}`);
      }
    }
  }

  return results;
}

function prepareCuratedDownloads(categories) {
  return CURATED_URLS
    .filter(item => categories.includes(item.category))
    .map(item => {
      const filename = path.basename(new URL(item.url).pathname);
      return {
        title: filename,
        url: item.url,
        originalUrl: item.url,
        width: null,
        height: null,
        mime: filename.endsWith('.png') ? 'image/png' : 'image/jpeg',
        size: null,
        license: item.license,
        description: item.description,
        author: 'See source',
        source: item.source,
        sourceCategory: 'curated',
        localCategory: item.category,
      };
    });
}

async function downloadScreenshots(items, opts) {
  const manifest = {
    name: 'thinx-screenshot-test-dataset',
    version: '1.0.0',
    createdAt: new Date().toISOString(),
    description: 'Mobile phone screenshots from public sources for testing the thinx.fun analysis pipeline',
    sources: ['Wikimedia Commons (CC-licensed)', 'Curated public URLs'],
    totalImages: 0,
    categories: {},
    images: [],
  };

  const seenUrls = new Set();
  const seenOriginalUrls = new Set();
  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const item of items) {
    const dedupeKey = item.originalUrl || item.url;
    if (seenUrls.has(item.url) || seenOriginalUrls.has(dedupeKey)) {
      skipped++;
      continue;
    }
    seenUrls.add(item.url);
    seenOriginalUrls.add(dedupeKey);

    const ext = extensionFromMime(item.mime);
    const safeName = sanitizeFilename(item.title);
    const filename = `${safeName}${ext.startsWith('.') || safeName.includes('.') ? '' : ext}`;
    const catDir = path.join(SCREENSHOTS_DIR, item.localCategory);
    const destPath = path.join(catDir, filename);

    if (fs.existsSync(destPath)) {
      verbose(`Skipping (exists): ${filename}`, opts);
      skipped++;

      const validation = await validateImage(destPath);
      if (validation.valid) {
        const stat = fs.statSync(destPath);
        manifest.images.push({
          filename,
          category: item.localCategory,
          path: path.relative(DATASET_DIR, destPath),
          url: item.originalUrl || item.url,
          source: item.source,
          license: item.license,
          description: item.description,
          author: item.author,
          width: validation.width || item.width,
          height: validation.height || item.height,
          format: validation.format,
          fileSize: stat.size,
          hash: sha256(fs.readFileSync(destPath)),
        });
        downloaded++;
      }
      continue;
    }

    if (opts.dryRun) {
      log(`[dry-run] Would download: ${item.url} -> ${item.localCategory}/${filename}`);
      downloaded++;
      continue;
    }

    try {
      verbose(`Downloading: ${filename}`, opts);
      const { size, hash } = await downloadFile(item.url, destPath);

      const validation = await validateImage(destPath);
      if (!validation.valid) {
        log(`  Invalid image, removing: ${filename}`);
        fs.unlinkSync(destPath);
        failed++;
        continue;
      }

      manifest.images.push({
        filename,
        category: item.localCategory,
        path: path.relative(DATASET_DIR, destPath),
        url: item.originalUrl || item.url,
        source: item.source,
        license: item.license,
        description: item.description,
        author: item.author,
        width: validation.width || item.width,
        height: validation.height || item.height,
        format: validation.format,
        fileSize: size,
        hash,
      });

      downloaded++;
      verbose(`  OK: ${filename} (${(size / 1024).toFixed(1)}KB, ${validation.width}x${validation.height})`, opts);

      await sleep(DOWNLOAD_DELAY_MS);
    } catch (err) {
      log(`  Failed to download ${filename}: ${err.message}`);
      failed++;
      if (err.retryable) {
        await sleep(RETRY_BACKOFF_MS);
      }
    }
  }

  // Scan for any existing images from prior runs in non-selected categories
  const allCategories = Object.keys(WIKIMEDIA_CATEGORIES);
  const existingManifestPaths = new Set(manifest.images.map(img => img.path));
  const existingHashes = new Set(manifest.images.map(img => img.hash).filter(Boolean));

  for (const cat of allCategories) {
    if (opts.categories.includes(cat)) continue;
    const catDir = path.join(SCREENSHOTS_DIR, cat);
    if (!fs.existsSync(catDir)) continue;

    const files = fs.readdirSync(catDir).filter(f => /\.(png|jpe?g|webp|gif)$/i.test(f));
    for (const file of files) {
      const filePath = path.join(catDir, file);
      const relPath = path.relative(DATASET_DIR, filePath);
      if (existingManifestPaths.has(relPath)) continue;

      try {
        const validation = await validateImage(filePath);
        if (!validation.valid) continue;
        const stat = fs.statSync(filePath);
        const fileHash = sha256(fs.readFileSync(filePath));
        if (existingHashes.has(fileHash)) continue;
        existingHashes.add(fileHash);
        manifest.images.push({
          filename: file,
          category: cat,
          path: relPath,
          url: 'local (from previous run)',
          source: 'Wikimedia Commons',
          license: 'Unknown',
          description: '',
          author: 'Unknown',
          width: validation.width,
          height: validation.height,
          format: validation.format,
          fileSize: stat.size,
          hash: fileHash,
        });
      } catch { /* skip unreadable files */ }
    }
  }

  // Populate category stats for all categories with images
  for (const cat of allCategories) {
    const catImages = manifest.images.filter(img => img.category === cat);
    if (catImages.length > 0) {
      manifest.categories[cat] = {
        count: catImages.length,
        totalSize: catImages.reduce((sum, img) => sum + (img.fileSize || 0), 0),
      };
    }
  }
  manifest.totalImages = manifest.images.length;

  return { manifest, downloaded, skipped, failed };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs();

  log('=== thinx.fun Screenshot Test Dataset Builder ===');
  log(`Categories: ${opts.categories.join(', ')}`);
  log(`Limit per source category: ${opts.limit}`);
  if (opts.dryRun) log('DRY RUN MODE — no files will be downloaded');
  log('');

  ensureDirectories();

  // Gather download list from all sources
  let items = [];

  if (!opts.curatedOnly) {
    const wikimediaItems = await fetchWikimediaScreenshots(opts);
    log(`Found ${wikimediaItems.length} images from Wikimedia Commons`);
    items.push(...wikimediaItems);
  }

  const curatedItems = prepareCuratedDownloads(opts.categories);
  log(`Found ${curatedItems.length} curated images`);
  items.push(...curatedItems);

  if (items.length === 0) {
    log('No images found. Try different categories or increase the limit.');
    process.exit(1);
  }

  log(`\nTotal candidates: ${items.length}`);
  log('Starting downloads...\n');

  const { manifest, downloaded, skipped, failed } = await downloadScreenshots(items, opts);

  // Write manifest
  if (!opts.dryRun) {
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
    log(`\nManifest written to ${path.relative(process.cwd(), MANIFEST_PATH)}`);
  }

  // Summary
  log('\n=== Summary ===');
  log(`Downloaded: ${downloaded}`);
  log(`Skipped (duplicates/existing): ${skipped}`);
  log(`Failed: ${failed}`);
  log(`Total in dataset: ${manifest.totalImages}`);
  log('');
  for (const [cat, stats] of Object.entries(manifest.categories)) {
    if (stats.count > 0) {
      log(`  ${cat}: ${stats.count} images (${(stats.totalSize / 1024).toFixed(0)}KB)`);
    }
  }

  if (!opts.dryRun && manifest.totalImages > 0) {
    log(`\nDataset ready at: ${path.relative(process.cwd(), DATASET_DIR)}`);
    log('Run pipeline tests with: npm run test:dataset');
  }
}

main().catch(err => {
  console.error('[dataset] Fatal error:', err.message);
  process.exit(1);
});
