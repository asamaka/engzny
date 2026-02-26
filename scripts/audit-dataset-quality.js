#!/usr/bin/env node

/**
 * Audits the quality of the screenshot test dataset.
 * Checks for: aspect ratio issues, too-small images, photos-of-phones
 * vs actual screenshots, miscategorized images, and content relevance.
 *
 * Usage: node scripts/audit-dataset-quality.js
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const DATASET_DIR = path.join(__dirname, '..', 'tests', 'dataset');
const MANIFEST_PATH = path.join(DATASET_DIR, 'manifest.json');

// Quality thresholds
const MIN_WIDTH = 200;
const MIN_HEIGHT = 300;
const MIN_PIXELS = 100000;      // 100K px minimum
const MAX_ASPECT_RATIO = 4.0;   // max width:height or height:width
const MOBILE_MIN_ASPECT = 0.4;  // portrait: width/height
const MOBILE_MAX_ASPECT = 0.75; // portrait: width/height
const LANDSCAPE_MIN_ASPECT = 1.3;
const LANDSCAPE_MAX_ASPECT = 2.5;

// Keywords that suggest the image is a photo-of-phone rather than a screenshot
const PHOTO_OF_PHONE_KEYWORDS = [
  'photograph', 'photo of', 'holding a phone', 'holding a smart phone',
  'smartphone on', 'device on', 'outside MOD', 'person holding',
  'on smartphone', 'on a work desk', 'grass background',
];

// Keywords that suggest the image is not a mobile screenshot
const NON_SCREENSHOT_KEYWORDS = [
  'banner', 'logo', 'advertisement', 'poster', 'FOSS4G',
  'copyright banner', 'pin map', 'georeferencing',
];

function classifyAspectRatio(width, height) {
  if (!width || !height) return 'unknown';
  const ratio = width / height;

  if (ratio >= MOBILE_MIN_ASPECT && ratio <= MOBILE_MAX_ASPECT) return 'mobile-portrait';
  if (ratio >= LANDSCAPE_MIN_ASPECT && ratio <= LANDSCAPE_MAX_ASPECT) return 'mobile-landscape';
  if (ratio >= 0.75 && ratio <= 1.3) return 'square-ish';
  if (ratio < MOBILE_MIN_ASPECT) return 'ultra-tall';
  if (ratio > LANDSCAPE_MAX_ASPECT) return 'ultra-wide';
  return 'non-standard';
}

function detectPhotoOfPhone(img) {
  const text = `${img.description || ''} ${img.filename || ''}`.toLowerCase();
  for (const kw of PHOTO_OF_PHONE_KEYWORDS) {
    if (text.includes(kw.toLowerCase())) return kw;
  }
  return null;
}

function detectNonScreenshot(img) {
  const text = `${img.description || ''} ${img.filename || ''}`.toLowerCase();
  for (const kw of NON_SCREENSHOT_KEYWORDS) {
    if (text.includes(kw.toLowerCase())) return kw;
  }
  return null;
}

async function getActualDimensions(filePath) {
  try {
    const meta = await sharp(filePath).metadata();
    return { width: meta.width, height: meta.height, format: meta.format, size: meta.size };
  } catch {
    return null;
  }
}

async function main() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error('No manifest found. Run: node scripts/fetch-screenshot-dataset.js');
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
  console.log(`\n=== Dataset Quality Audit ===`);
  console.log(`Total images: ${manifest.totalImages}\n`);

  const issues = {
    tooSmall: [],
    photoOfPhone: [],
    nonScreenshot: [],
    oddAspect: [],
    missingFile: [],
    corruptFile: [],
    tinyFile: [],
    miscategorized: [],
  };

  const aspectStats = {};
  const categoryStats = {};

  for (const img of manifest.images) {
    const fullPath = path.join(DATASET_DIR, img.path);
    const cat = img.category;

    if (!categoryStats[cat]) {
      categoryStats[cat] = { total: 0, goodScreenshots: 0, photoOfPhone: 0, nonScreenshot: 0, tooSmall: 0 };
    }
    categoryStats[cat].total++;

    // Check file exists
    if (!fs.existsSync(fullPath)) {
      issues.missingFile.push(img);
      continue;
    }

    // Get actual dimensions
    const actual = await getActualDimensions(fullPath);
    if (!actual) {
      issues.corruptFile.push(img);
      continue;
    }

    const w = actual.width;
    const h = actual.height;
    const pixels = w * h;

    // Too small
    if (w < MIN_WIDTH || h < MIN_HEIGHT || pixels < MIN_PIXELS) {
      issues.tooSmall.push({ ...img, actualWidth: w, actualHeight: h, pixels });
      categoryStats[cat].tooSmall++;
    }

    // Tiny file (likely placeholder or corrupt)
    if (img.fileSize < 5000) {
      issues.tinyFile.push({ ...img, actualSize: img.fileSize });
    }

    // Aspect ratio
    const aspect = classifyAspectRatio(w, h);
    aspectStats[aspect] = (aspectStats[aspect] || 0) + 1;
    if (aspect === 'ultra-wide' || aspect === 'non-standard') {
      issues.oddAspect.push({ ...img, actualWidth: w, actualHeight: h, aspect, ratio: (w / h).toFixed(2) });
    }

    // Photo-of-phone detection
    const photoMatch = detectPhotoOfPhone(img);
    if (photoMatch) {
      issues.photoOfPhone.push({ ...img, matchedKeyword: photoMatch });
      categoryStats[cat].photoOfPhone++;
    }

    // Non-screenshot detection
    const nonScreenshotMatch = detectNonScreenshot(img);
    if (nonScreenshotMatch) {
      issues.nonScreenshot.push({ ...img, matchedKeyword: nonScreenshotMatch });
      categoryStats[cat].nonScreenshot++;
    }

    // Count as good if no major issues
    if (!photoMatch && !nonScreenshotMatch && w >= MIN_WIDTH && h >= MIN_HEIGHT) {
      categoryStats[cat].goodScreenshots++;
    }

    // Miscategorization check: maps images that aren't maps
    if (cat === 'maps') {
      const text = `${img.description || ''} ${img.filename || ''}`.toLowerCase();
      const hasMapKeyword = ['map', 'osm', 'openstreet', 'google maps', 'location', 'geo', 'coordinate'].some(k => text.includes(k));
      if (!hasMapKeyword) {
        issues.miscategorized.push({ ...img, reason: 'No map-related keywords in maps category' });
      }
    }
  }

  // Print results
  console.log('--- Aspect Ratio Distribution ---');
  for (const [aspect, count] of Object.entries(aspectStats).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${aspect}: ${count}`);
  }

  console.log('\n--- Category Quality ---');
  for (const [cat, stats] of Object.entries(categoryStats)) {
    const goodPct = stats.total > 0 ? Math.round(100 * stats.goodScreenshots / stats.total) : 0;
    console.log(`  ${cat}: ${stats.total} total, ${stats.goodScreenshots} good (${goodPct}%), ${stats.photoOfPhone} photos-of-phones, ${stats.nonScreenshot} non-screenshots, ${stats.tooSmall} too-small`);
  }

  console.log('\n--- Issues Found ---');

  if (issues.photoOfPhone.length > 0) {
    console.log(`\n[PHOTOS-OF-PHONES] ${issues.photoOfPhone.length} images appear to be photos of phones, not screenshots:`);
    for (const img of issues.photoOfPhone) {
      console.log(`  ✗ ${img.category}/${img.filename} — matched: "${img.matchedKeyword}"`);
      console.log(`    desc: ${(img.description || '').substring(0, 100)}`);
    }
  }

  if (issues.nonScreenshot.length > 0) {
    console.log(`\n[NON-SCREENSHOTS] ${issues.nonScreenshot.length} images don't appear to be screenshots:`);
    for (const img of issues.nonScreenshot) {
      console.log(`  ✗ ${img.category}/${img.filename} — matched: "${img.matchedKeyword}"`);
    }
  }

  if (issues.tooSmall.length > 0) {
    console.log(`\n[TOO SMALL] ${issues.tooSmall.length} images below minimum dimensions (${MIN_WIDTH}x${MIN_HEIGHT}):`);
    for (const img of issues.tooSmall) {
      console.log(`  ✗ ${img.category}/${img.filename} — ${img.actualWidth}x${img.actualHeight} (${img.pixels} px)`);
    }
  }

  if (issues.oddAspect.length > 0) {
    console.log(`\n[ODD ASPECT RATIO] ${issues.oddAspect.length} images with unusual aspect ratios:`);
    for (const img of issues.oddAspect) {
      console.log(`  ? ${img.category}/${img.filename} — ${img.actualWidth}x${img.actualHeight} (ratio ${img.ratio}, ${img.aspect})`);
    }
  }

  if (issues.miscategorized.length > 0) {
    console.log(`\n[MISCATEGORIZED] ${issues.miscategorized.length} images possibly in wrong category:`);
    for (const img of issues.miscategorized) {
      console.log(`  ? ${img.category}/${img.filename} — ${img.reason}`);
    }
  }

  if (issues.tinyFile.length > 0) {
    console.log(`\n[TINY FILES] ${issues.tinyFile.length} files under 5KB:`);
    for (const img of issues.tinyFile) {
      console.log(`  ? ${img.category}/${img.filename} — ${img.actualSize} bytes`);
    }
  }

  // Summary score
  const totalIssues = issues.photoOfPhone.length + issues.nonScreenshot.length +
    issues.tooSmall.length + issues.miscategorized.length;
  const goodCount = manifest.totalImages - totalIssues;
  const qualityPct = Math.round(100 * goodCount / manifest.totalImages);

  console.log('\n=== Quality Summary ===');
  console.log(`Total images:         ${manifest.totalImages}`);
  console.log(`Good screenshots:     ${goodCount} (${qualityPct}%)`);
  console.log(`Photos-of-phones:     ${issues.photoOfPhone.length}`);
  console.log(`Non-screenshots:      ${issues.nonScreenshot.length}`);
  console.log(`Too small:            ${issues.tooSmall.length}`);
  console.log(`Miscategorized:       ${issues.miscategorized.length}`);
  console.log(`Overall quality:      ${qualityPct >= 80 ? 'GOOD' : qualityPct >= 60 ? 'FAIR' : 'NEEDS IMPROVEMENT'} (${qualityPct}%)`);

  // Return problematic filenames for filtering
  const problematic = new Set([
    ...issues.photoOfPhone.map(i => i.path),
    ...issues.nonScreenshot.map(i => i.path),
    ...issues.tooSmall.map(i => i.path),
  ]);

  console.log(`\n${problematic.size} images flagged for potential removal.`);

  // Write audit report
  const reportPath = path.join(DATASET_DIR, 'quality-audit.json');
  const report = {
    auditedAt: new Date().toISOString(),
    totalImages: manifest.totalImages,
    qualityScore: qualityPct,
    aspectDistribution: aspectStats,
    categoryQuality: categoryStats,
    flaggedImages: [...problematic],
    issues: {
      photoOfPhone: issues.photoOfPhone.map(i => ({ path: i.path, keyword: i.matchedKeyword })),
      nonScreenshot: issues.nonScreenshot.map(i => ({ path: i.path, keyword: i.matchedKeyword })),
      tooSmall: issues.tooSmall.map(i => ({ path: i.path, width: i.actualWidth, height: i.actualHeight })),
      miscategorized: issues.miscategorized.map(i => ({ path: i.path, reason: i.reason })),
    },
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nFull audit report: ${path.relative(process.cwd(), reportPath)}`);
}

main().catch(err => {
  console.error('Audit failed:', err.message);
  process.exit(1);
});
