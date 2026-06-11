const fs = require('fs');
const path = require('path');

// The /m market-rail mini trend line was vertically inverted (it used a separate
// precomputed `spark` field). It now derives from the same `history` the detail chart
// uses, with the same orientation (higher probability -> higher on screen / smaller y).
// Extract the REAL function from m.html so this guards against a regression in source.
const src = fs.readFileSync(path.join(__dirname, '../../public/m.html'), 'utf8');
const m = src.match(/function miniSparkPts\(hist,w,h\)\{[\s\S]*?\.join\(' '\);\}/);
const miniSparkPts = new Function('return (' + m[0] + ')')();

function ys(pointsStr) {
  return pointsStr.trim().split(/\s+/).map(p => parseFloat(p.split(',')[1]));
}

describe('miniSparkPts — mini market trend line', () => {
  test('the function was found and is callable', () => {
    expect(typeof miniSparkPts).toBe('function');
  });

  test('a RISING probability history renders an UP line (last point higher = smaller y)', () => {
    const y = ys(miniSparkPts([0.1, 0.3, 0.6, 0.9], 84, 28));
    expect(y[y.length - 1]).toBeLessThan(y[0]);   // SVG y grows downward → up-trend = decreasing y
  });

  test('a FALLING probability history renders a DOWN line (last point lower = larger y)', () => {
    const y = ys(miniSparkPts([0.9, 0.6, 0.3, 0.1], 84, 28));
    expect(y[y.length - 1]).toBeGreaterThan(y[0]);
  });

  test('all points stay within the viewbox height', () => {
    const y = ys(miniSparkPts([0.05, 0.95, 0.4, 0.7, 0.2], 84, 28));
    for (const v of y) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(28); }
  });

  test('x spans the full width left→right', () => {
    const pts = miniSparkPts([0.2, 0.5, 0.8], 84, 28).trim().split(/\s+/);
    const xs = pts.map(p => parseFloat(p.split(',')[0]));
    expect(xs[0]).toBeCloseTo(0, 1);
    expect(xs[xs.length - 1]).toBeCloseTo(84, 1);
  });

  test('a single/empty history falls back to a flat mid line', () => {
    expect(miniSparkPts([0.5], 84, 28)).toBe('0,14.0 84,14.0');
  });
});
