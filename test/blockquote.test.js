const assert = require('assert');
const { renderPdfFromHtml } = require('../src/index.js');
const { assertBuffer } = require('./helpers');

async function run() {
  // Basic blockquote
  const basic = await renderPdfFromHtml('<blockquote>Quoted text</blockquote>');
  assertBuffer(basic, 'basic blockquote');

  // Blockquote with background color
  const withBg = await renderPdfFromHtml(`
    <blockquote style="background-color: #f0f0f0; padding: 10px;">
      Background blockquote
    </blockquote>
  `);
  assertBuffer(withBg, 'blockquote with background');

  // Blockquote with left border
  const withBorder = await renderPdfFromHtml(`
    <blockquote style="border-left: 4px solid #ccc; padding-left: 16px;">
      Bordered blockquote
    </blockquote>
  `);
  assertBuffer(withBorder, 'blockquote with border');

  // Blockquote with bg + border (paint order test)
  const paintOrder = await renderPdfFromHtml(`
    <blockquote style="background-color: #eef; border-left: 3px solid #33f; padding: 12px;">
      This text should be visible over the background
    </blockquote>
  `);
  assertBuffer(paintOrder, 'blockquote paint order');

  // Nested content in blockquote
  const nested = await renderPdfFromHtml(`
    <blockquote style="background-color: #f9f9f9; padding: 10px;">
      <p>First paragraph</p>
      <p>Second paragraph with <strong>bold</strong> text</p>
    </blockquote>
  `);
  assertBuffer(nested, 'blockquote with nested content');

  // Empty blockquote doesn't crash
  const empty = await renderPdfFromHtml('<blockquote></blockquote>');
  assertBuffer(empty, 'empty blockquote');
}

module.exports = { name: 'blockquote', run };
