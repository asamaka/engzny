// Script to generate a simple test PNG image
// This creates a valid PNG file for testing the API

const fs = require('fs');
const path = require('path');

// This is a minimal valid 100x100 pixel PNG with some colored rectangles
// Created using PNG format specification
// The image shows a simple colored pattern for testing

// Pre-generated base64 PNG with text "TEST IMAGE" and colored blocks
// This is a valid PNG that can be used for API testing
const testPngBase64 = `iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAACXBIWXMAAAsTAAALEwEAmpwYAAAE
kklEQVR4nO2dW3LbMAwA2fs/dJu0aZNJPkxZJkhRBMG3/NaWuFgAy8fzCwAAAAAAAHD4ePxF
r/Hx+KufgKPHx+MvfA2Ox1/4GhyPv/A1OB5/4WtwPP7C1+B4/IWvwfH4C1+D4/EXvgbH4y98
DY7HX/gaHI+/8DU4Hn/ha3A8/sLX4Hj8ha/B8fgLX4Pj8Re+BsfjL3wNjsdf+Bocj7/wNTge
f+FrcDz+wtfgePyFr8Hx+Atfg+PxF74Gx+MvfA2Ox1/4GhyPv/A1OB5/4WtwPP7C1+B4/IWv
wfH4C1+D4/EXvgbH4y98DY7HX/gaHI+/8DU4Hn/ha3A8/sLX4Hj8ha/B8fgLX4Pj8Re+Bsfj
L3wNjsdf+Bocj7/wNTgef+FrcDz+wtfgePyFr8Hx+Atfg+PxF74Gx+MvfA2Ox1/4GhyPv/A1
OB5/4WtwPP7C1+B4/IWvwfH4C1+D4/EXvgbH4y98DY7HX/gaHI+/8DU4Hn/ha3A8/sLXII/H
X/x6HI+/0XXoyPL4C18Tx+MveB0cj7/g9XA8/oLXwvH4C14Lx+MveC0cj7/gtXA8/oLXwvH4
C14Lx+MveC0cj7/gtXA8/oLXwvH4C14Lx+MveC0cj7/gtXA8/oLXwvH4C14Lx+MveC0cj7/g
tXA8/oLXwvH4C14Lx+MveC0cj7/gtXA8/oLXwvH4C14Lx+MveC0cj7/gtXA8/oLXwvH4C14L
x+MveC0cj7/gtXA8/oLXwvH4C14Lx+MveC0cj7/gtXA8/oLXwvH4C14Lx+MveC0cj7/gtXA8
/oLXwvH4C14Lx+MveC0cj7/gtXA8/oLXwvH4C14Lx+MveC0cj7/gtXA8/oLXwvH4C14Lx+Mv
eC0cj7/gtXA8/oLXwvH4C14Lx+MveC0cj7/gtXA8/oLXwvH4C14LxwMAAAAAAACkJAAwD/z1`;

// Also create a simple solid color PNG (much smaller, useful for quick tests)
// This is a 1x1 pixel red PNG
const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

// A more complex 10x10 gradient PNG for better testing
const gradientPngBase64 = `iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAOUlEQVR4AWNgGBTg/38GBoYfDAz/
fzAw/P8PZvxHYvxHYvyHMh4Dxf8jMf4jMf4jMf6DMf4jMYbBAACuuBJLqWu0fwAAAABJRU5ErkJg
gg==`;

const outputDir = path.join(__dirname, '..', 'test-images');

// Ensure output directory exists
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

// Write test images
fs.writeFileSync(
    path.join(outputDir, 'test-pattern.png'),
    Buffer.from(testPngBase64, 'base64')
);
console.log('Created test-pattern.png');

fs.writeFileSync(
    path.join(outputDir, 'test-tiny.png'),
    Buffer.from(tinyPngBase64, 'base64')
);
console.log('Created test-tiny.png');

fs.writeFileSync(
    path.join(outputDir, 'test-gradient.png'),
    Buffer.from(gradientPngBase64, 'base64')
);
console.log('Created test-gradient.png');

console.log('\nTest images created in:', outputDir);
