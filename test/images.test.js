const assert = require('assert');
const { renderPdfFromHtml } = require('../src/index.js');
const { assertBuffer } = require('./helpers');

// Valid 1x1 PNG as base64
const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

async function run() {
  // Data URI PNG image
  const png = await renderPdfFromHtml(`
    <img src="data:image/png;base64,${TINY_PNG}" width="50" height="50" />
  `);
  assertBuffer(png, 'data URI PNG');

  // Image with no src doesn't crash
  const noSrc = await renderPdfFromHtml('<img />');
  assertBuffer(noSrc, 'img without src');

  // Invalid image with ignoreInvalidImages
  const invalid = await renderPdfFromHtml(
    '<img src="data:image/png;base64,AAAA" width="50" height="50" />',
    { ignoreInvalidImages: true }
  );
  assertBuffer(invalid, 'invalid image ignored');

  // Image with width/height styles
  const sized = await renderPdfFromHtml(`
    <img src="data:image/png;base64,${TINY_PNG}" style="width: 100px; height: 100px;" />
  `);
  assertBuffer(sized, 'styled image dimensions');

  // Image with max-width
  const maxWidth = await renderPdfFromHtml(`
    <img src="data:image/png;base64,${TINY_PNG}" style="max-width: 200px;" />
  `);
  assertBuffer(maxWidth, 'image with max-width');

  // SVG data URI
  const svgUri = await renderPdfFromHtml(`
    <img src="data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect fill="blue" width="20" height="20"/></svg>').toString('base64')}" width="50" height="50" />
  `);
  assertBuffer(svgUri, 'SVG data URI image');
}

module.exports = { name: 'images', run };
