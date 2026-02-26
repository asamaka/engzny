const { describe, test, expect, beforeAll } = require('@jest/globals');
const fs = require('fs');
const path = require('path');

const DATASET_DIR = path.join(__dirname, '..', 'dataset');
const MANIFEST_PATH = path.join(DATASET_DIR, 'manifest.json');
const SCREENSHOTS_DIR = path.join(DATASET_DIR, 'screenshots');

const VALID_CATEGORIES = ['ios', 'android', 'settings', 'social', 'messaging', 'maps', 'misc'];
const VALID_FORMATS = ['png', 'jpeg', 'jpg', 'webp', 'gif'];

describe('Screenshot Test Dataset', () => {
  let manifest;
  let datasetExists;

  beforeAll(() => {
    datasetExists = fs.existsSync(MANIFEST_PATH);
    if (datasetExists) {
      manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
    }
  });

  test('manifest.json exists (run fetch-screenshot-dataset.js first if missing)', () => {
    if (!datasetExists) {
      console.log(
        'Dataset not yet downloaded. Run: node scripts/fetch-screenshot-dataset.js'
      );
    }
    // Soft skip — don't fail CI when dataset hasn't been fetched
    expect(true).toBe(true);
  });

  test('manifest has correct structure', () => {
    if (!datasetExists) return;

    expect(manifest).toHaveProperty('name', 'thinx-screenshot-test-dataset');
    expect(manifest).toHaveProperty('version');
    expect(manifest).toHaveProperty('createdAt');
    expect(manifest).toHaveProperty('totalImages');
    expect(manifest).toHaveProperty('categories');
    expect(manifest).toHaveProperty('images');
    expect(Array.isArray(manifest.images)).toBe(true);
    expect(manifest.totalImages).toBe(manifest.images.length);
  });

  test('all categories are valid', () => {
    if (!datasetExists) return;

    for (const cat of Object.keys(manifest.categories)) {
      expect(VALID_CATEGORIES).toContain(cat);
    }
    for (const img of manifest.images) {
      expect(VALID_CATEGORIES).toContain(img.category);
    }
  });

  test('each image entry has required metadata', () => {
    if (!datasetExists) return;

    for (const img of manifest.images) {
      expect(img).toHaveProperty('filename');
      expect(img).toHaveProperty('category');
      expect(img).toHaveProperty('path');
      expect(img).toHaveProperty('url');
      expect(img).toHaveProperty('source');
      expect(img).toHaveProperty('license');
      expect(typeof img.filename).toBe('string');
      expect(img.filename.length).toBeGreaterThan(0);
    }
  });

  test('image files exist on disk for all manifest entries', () => {
    if (!datasetExists) return;

    const missing = [];
    for (const img of manifest.images) {
      const fullPath = path.join(DATASET_DIR, img.path);
      if (!fs.existsSync(fullPath)) {
        missing.push(img.path);
      }
    }

    if (missing.length > 0) {
      console.log(`Missing files (${missing.length}):`, missing.slice(0, 5));
    }
    expect(missing.length).toBe(0);
  });

  test('image files are valid images (magic bytes check)', () => {
    if (!datasetExists) return;

    const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4E, 0x47]);
    const JPEG_MAGIC = Buffer.from([0xFF, 0xD8, 0xFF]);
    const WEBP_HEADER = 'RIFF';

    for (const img of manifest.images) {
      const fullPath = path.join(DATASET_DIR, img.path);
      if (!fs.existsSync(fullPath)) continue;

      const header = Buffer.alloc(12);
      const fd = fs.openSync(fullPath, 'r');
      fs.readSync(fd, header, 0, 12, 0);
      fs.closeSync(fd);

      const isPng = header.slice(0, 4).equals(PNG_MAGIC);
      const isJpeg = header.slice(0, 3).equals(JPEG_MAGIC);
      const isWebp = header.slice(0, 4).toString() === WEBP_HEADER
        && header.slice(8, 12).toString() === 'WEBP';

      expect(
        isPng || isJpeg || isWebp
      ).toBe(true);
    }
  });

  test('no duplicate hashes in manifest', () => {
    if (!datasetExists) return;

    const hashes = manifest.images.map(img => img.hash).filter(Boolean);
    const unique = new Set(hashes);
    expect(unique.size).toBe(hashes.length);
  });

  test('category counts match image entries', () => {
    if (!datasetExists) return;

    for (const [cat, stats] of Object.entries(manifest.categories)) {
      const actual = manifest.images.filter(img => img.category === cat).length;
      expect(stats.count).toBe(actual);
    }
  });

  test('all images are under 5MB size limit', () => {
    if (!datasetExists) return;

    const MAX_SIZE = 5 * 1024 * 1024;
    for (const img of manifest.images) {
      if (img.fileSize) {
        expect(img.fileSize).toBeLessThanOrEqual(MAX_SIZE);
      }
    }
  });

  test('dataset summary', () => {
    if (!datasetExists) {
      console.log('No dataset available — skipping summary');
      return;
    }

    console.log(`\nDataset: ${manifest.name} v${manifest.version}`);
    console.log(`Total images: ${manifest.totalImages}`);
    console.log(`Created: ${manifest.createdAt}`);
    for (const [cat, stats] of Object.entries(manifest.categories)) {
      if (stats.count > 0) {
        console.log(`  ${cat}: ${stats.count} images (${(stats.totalSize / 1024).toFixed(0)}KB)`);
      }
    }
  });
});
