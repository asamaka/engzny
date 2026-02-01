#!/usr/bin/env node
/**
 * Image Compression Test Script
 * 
 * Tests various compression configurations to find the smallest possible
 * base64 representation that can fit in a URL.
 * 
 * URL Limits:
 * - Most browsers: 2,000-8,000 chars
 * - Vercel query string: ~4KB
 * - Safe target: <3,000 chars base64
 * 
 * Usage:
 *   node scripts/compress-test.js <image-path>
 *   node scripts/compress-test.js test-images/test-gradient.png
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// Compression configurations - ORDERED from smallest to largest
const CONFIGS = [
  // Ultra-tiny: for URL feasibility testing
  { width: 64, format: 'webp', quality: 1 },
  { width: 64, format: 'webp', quality: 5 },
  { width: 64, format: 'webp', quality: 10 },
  { width: 64, format: 'jpeg', quality: 5 },
  { width: 64, format: 'jpeg', quality: 10 },
  
  // Tiny thumbnails
  { width: 96, format: 'webp', quality: 5 },
  { width: 96, format: 'webp', quality: 10 },
  { width: 96, format: 'webp', quality: 20 },
  { width: 128, format: 'webp', quality: 10 },
  { width: 128, format: 'webp', quality: 20 },
  
  // Small but viewable
  { width: 192, format: 'webp', quality: 10 },
  { width: 192, format: 'webp', quality: 20 },
  { width: 256, format: 'webp', quality: 10 },
  { width: 256, format: 'webp', quality: 20 },
  { width: 256, format: 'webp', quality: 30 },
  
  // Larger (likely too big for URL)
  { width: 384, format: 'webp', quality: 20 },
  { width: 512, format: 'webp', quality: 20 },
];

async function compressImage(inputPath, config) {
  const { width, format, quality } = config;
  
  let pipeline = sharp(inputPath)
    .resize(width, null, { 
      fit: 'inside',
      withoutEnlargement: true 
    });
  
  if (format === 'webp') {
    pipeline = pipeline.webp({ quality, effort: 6 });
  } else if (format === 'jpeg') {
    pipeline = pipeline.jpeg({ quality, mozjpeg: true });
  } else if (format === 'avif') {
    pipeline = pipeline.avif({ quality, effort: 9 });
  }
  
  const buffer = await pipeline.toBuffer();
  const base64 = buffer.toString('base64');
  const dataUrl = `data:image/${format};base64,${base64}`;
  
  return {
    config,
    binarySize: buffer.length,
    base64Length: base64.length,
    dataUrlLength: dataUrl.length,
    base64,
    dataUrl,
  };
}

async function runTests(inputPath) {
  console.log(`\n🔬 Compression Test: ${inputPath}\n`);
  console.log('=' .repeat(80));
  
  // Get original file info
  const originalBuffer = fs.readFileSync(inputPath);
  const originalMeta = await sharp(inputPath).metadata();
  console.log(`Original: ${originalMeta.width}x${originalMeta.height}, ${(originalBuffer.length / 1024).toFixed(1)}KB, ${originalMeta.format}\n`);
  
  console.log('Config'.padEnd(25) + 'Binary'.padStart(10) + 'Base64'.padStart(10) + 'DataURL'.padStart(10) + '  Status');
  console.log('-'.repeat(80));
  
  const results = [];
  let foundViable = false;
  
  for (const config of CONFIGS) {
    try {
      const result = await compressImage(inputPath, config);
      results.push(result);
      
      const configStr = `${config.width}px ${config.format} q${config.quality}`;
      const binaryStr = `${(result.binarySize / 1024).toFixed(1)}KB`;
      const base64Str = `${(result.base64Length / 1024).toFixed(1)}KB`;
      const dataUrlStr = `${(result.dataUrlLength / 1024).toFixed(1)}KB`;
      
      // Check URL viability
      let status = '';
      if (result.dataUrlLength < 2000) {
        status = '✅ URL-safe (< 2KB)';
        foundViable = true;
      } else if (result.dataUrlLength < 4000) {
        status = '⚠️  Borderline (2-4KB)';
        foundViable = true;
      } else if (result.dataUrlLength < 8000) {
        status = '🟡 Large (4-8KB)';
      } else {
        status = '❌ Too large (> 8KB)';
      }
      
      console.log(configStr.padEnd(25) + binaryStr.padStart(10) + base64Str.padStart(10) + dataUrlStr.padStart(10) + '  ' + status);
      
    } catch (err) {
      console.log(`${config.width}px ${config.format} q${config.quality}`.padEnd(25) + `  ERROR: ${err.message}`);
    }
  }
  
  console.log('=' .repeat(80));
  
  // Find best viable result
  const viable = results.filter(r => r.dataUrlLength < 4000);
  if (viable.length > 0) {
    const best = viable[viable.length - 1]; // Largest that's still viable
    console.log(`\n✅ Best viable config: ${best.config.width}px ${best.config.format} q${best.config.quality}`);
    console.log(`   Data URL length: ${best.dataUrlLength} chars`);
    
    // Output the data URL for testing
    console.log(`\n📋 Test URL (copy this):`);
    console.log(`   http://localhost:3000/url-test.html#img=${encodeURIComponent(best.dataUrl)}`);
    
    // Also save to a file for easy access
    const outputPath = path.join(path.dirname(inputPath), 'compressed-test.txt');
    fs.writeFileSync(outputPath, best.dataUrl);
    console.log(`\n💾 Data URL saved to: ${outputPath}`);
    
    return best;
  } else {
    console.log('\n❌ No viable compression found under 4KB. Image may be too complex.');
    console.log('   Consider using a simpler image or a different approach (POST + redirect).');
    return null;
  }
}

// CLI entry point
const inputPath = process.argv[2];
if (!inputPath) {
  console.log('Usage: node scripts/compress-test.js <image-path>');
  console.log('Example: node scripts/compress-test.js test-images/test-gradient.png');
  process.exit(1);
}

if (!fs.existsSync(inputPath)) {
  console.error(`File not found: ${inputPath}`);
  process.exit(1);
}

runTests(inputPath).catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
