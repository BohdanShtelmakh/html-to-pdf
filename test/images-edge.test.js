const assert = require('assert');
const { renderPdfFromHtml } = require('../src/index.js');
const { assertBuffer } = require('./helpers');

const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

async function run() {
  // object-fit: cover
  const cover = await renderPdfFromHtml(`
    <img src="data:image/png;base64,${TINY_PNG}" style="width: 100px; height: 100px; object-fit: cover;" />
  `);
  assertBuffer(cover, 'object-fit cover');

  // object-fit: contain
  const contain = await renderPdfFromHtml(`
    <img src="data:image/png;base64,${TINY_PNG}" style="width: 100px; height: 100px; object-fit: contain;" />
  `);
  assertBuffer(contain, 'object-fit contain');

  // Image with border
  const bordered = await renderPdfFromHtml(`
    <img src="data:image/png;base64,${TINY_PNG}" style="width: 50px; height: 50px; border: 2px solid red;" />
  `);
  assertBuffer(bordered, 'image with border');

  // Image with text-align center
  const centered = await renderPdfFromHtml(`
    <div style="text-align: center;">
      <img src="data:image/png;base64,${TINY_PNG}" style="width: 50px; height: 50px;" />
    </div>
  `);
  assertBuffer(centered, 'centered image');

  // Image with text-align right
  const rightAligned = await renderPdfFromHtml(`
    <div style="text-align: right;">
      <img src="data:image/png;base64,${TINY_PNG}" style="width: 50px; height: 50px;" />
    </div>
  `);
  assertBuffer(rightAligned, 'right-aligned image');

  // Image with only width (aspect ratio inferred)
  const widthOnly = await renderPdfFromHtml(`
    <img src="data:image/png;base64,${TINY_PNG}" style="width: 200px;" />
  `);
  assertBuffer(widthOnly, 'image width only');

  // Image with only height (aspect ratio inferred)
  const heightOnly = await renderPdfFromHtml(`
    <img src="data:image/png;base64,${TINY_PNG}" style="height: 200px;" />
  `);
  assertBuffer(heightOnly, 'image height only');

  // Image with very short timeout (should still work for data URIs)
  const shortTimeout = await renderPdfFromHtml(
    `<img src="data:image/png;base64,${TINY_PNG}" width="50" height="50" />`,
    { imgLoadTimeoutMs: 1 }
  );
  assertBuffer(shortTimeout, 'image with short timeout');

  // Image with legacy imgLoadTimeout option
  const legacyTimeout = await renderPdfFromHtml(
    `<img src="data:image/png;base64,${TINY_PNG}" width="50" height="50" />`,
    { imgLoadTimeout: 5000 }
  );
  assertBuffer(legacyTimeout, 'image with legacy timeout option');

  // Invalid image without ignoreInvalidImages logs error but still produces PDF
  const invalidNoFlag = await renderPdfFromHtml('<img src="data:image/png;base64,AAAA" width="50" height="50" />');
  assertBuffer(invalidNoFlag, 'invalid image without flag still produces PDF');

  // URL-encoded SVG data URI
  const urlEncoded = await renderPdfFromHtml(`
    <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20'%3E%3Crect fill='blue' width='20' height='20'/%3E%3C/svg%3E" width="50" height="50" />
  `);
  assertBuffer(urlEncoded, 'URL-encoded SVG data URI');

  // Image with min-width / min-height
  const minDims = await renderPdfFromHtml(`
    <img src="data:image/png;base64,${TINY_PNG}" style="min-width: 100px; min-height: 100px;" />
  `);
  assertBuffer(minDims, 'image with min dimensions');
}

module.exports = { name: 'images-edge', run };
