const assert = require('assert');
const { renderPdfFromHtml } = require('../src/index.js');
const { assertBuffer } = require('./helpers');

async function run() {
  // Basic inline SVG
  const basic = await renderPdfFromHtml(`
    <svg width="100" height="100" viewBox="0 0 100 100">
      <rect fill="red" width="100" height="100" />
    </svg>
  `);
  assertBuffer(basic, 'basic inline SVG');

  // SVG with viewBox and no explicit dimensions
  const viewBox = await renderPdfFromHtml(`
    <svg viewBox="0 0 200 100">
      <circle cx="100" cy="50" r="40" fill="blue" />
    </svg>
  `);
  assertBuffer(viewBox, 'SVG with viewBox only');

  // SVG with width/height styles
  const styled = await renderPdfFromHtml(`
    <svg style="width: 150px; height: 75px;" viewBox="0 0 300 150">
      <rect fill="green" width="300" height="150" />
    </svg>
  `);
  assertBuffer(styled, 'SVG with style dimensions');

  // SVG with border
  const bordered = await renderPdfFromHtml(`
    <svg width="80" height="80" viewBox="0 0 80 80" style="border: 2px solid #333;">
      <circle cx="40" cy="40" r="30" fill="orange" />
    </svg>
  `);
  assertBuffer(bordered, 'SVG with border');

  // SVG with dashed border
  const dashed = await renderPdfFromHtml(`
    <svg width="80" height="80" viewBox="0 0 80 80" style="border: 2px dashed #999;">
      <rect fill="#eee" width="80" height="80" />
    </svg>
  `);
  assertBuffer(dashed, 'SVG with dashed border');

  // SVG with dotted border
  const dotted = await renderPdfFromHtml(`
    <svg width="60" height="60" viewBox="0 0 60 60" style="border: 1px dotted #666;">
      <rect fill="#ffc" width="60" height="60" />
    </svg>
  `);
  assertBuffer(dotted, 'SVG with dotted border');

  // SVG with max-width constraint
  const maxWidth = await renderPdfFromHtml(`
    <svg width="2000" height="200" viewBox="0 0 2000 200" style="max-width: 300px;">
      <rect fill="purple" width="2000" height="200" />
    </svg>
  `);
  assertBuffer(maxWidth, 'SVG with max-width');

  // SVG with min-width / min-height
  const minDims = await renderPdfFromHtml(`
    <svg width="10" height="10" viewBox="0 0 10 10" style="min-width: 50px; min-height: 50px;">
      <rect fill="teal" width="10" height="10" />
    </svg>
  `);
  assertBuffer(minDims, 'SVG with min dimensions');

  // SVG with linearGradient (tests camelCase normalization)
  const gradient = await renderPdfFromHtml(`
    <svg width="100" height="100" viewBox="0 0 100 100">
      <defs>
        <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" style="stop-color:rgb(255,255,0)" />
          <stop offset="100%" style="stop-color:rgb(255,0,0)" />
        </linearGradient>
      </defs>
      <rect fill="url(#grad1)" width="100" height="100" />
    </svg>
  `);
  assertBuffer(gradient, 'SVG with linearGradient');

  // SVG with text-align center
  const centered = await renderPdfFromHtml(`
    <div style="text-align: center;">
      <svg width="50" height="50" viewBox="0 0 50 50">
        <rect fill="pink" width="50" height="50" />
      </svg>
    </div>
  `);
  assertBuffer(centered, 'SVG centered');

  // SVG with custom svgScale option
  const scaled = await renderPdfFromHtml(
    `<svg width="100" height="100" viewBox="0 0 100 100">
      <rect fill="red" width="100" height="100" />
    </svg>`,
    { svgScale: 3, svgDpi: 144 }
  );
  assertBuffer(scaled, 'SVG with custom scale/dpi');

  // Empty SVG doesn't crash
  const empty = await renderPdfFromHtml('<svg></svg>');
  assertBuffer(empty, 'empty SVG');

  // SVG with ignoreInvalidImages
  const invalid = await renderPdfFromHtml(
    '<svg width="100" height="100"><invalid-element /></svg>',
    { ignoreInvalidImages: true }
  );
  assertBuffer(invalid, 'invalid SVG ignored');
}

module.exports = { name: 'svg', run };
