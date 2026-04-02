const assert = require('assert');
const { renderPdfFromHtml } = require('../src/index.js');
const { assertBuffer } = require('./helpers');

async function run() {
  // Renders with auto font resolution enabled (default)
  const autoFonts = await renderPdfFromHtml(`
    <p style="font-family: Helvetica;">Helvetica text</p>
  `);
  assertBuffer(autoFonts, 'auto font resolve');

  // Renders with auto font resolution disabled
  const noAutoFonts = await renderPdfFromHtml(
    '<p style="font-family: Arial;">Arial text</p>',
    { autoResolveFonts: false }
  );
  assertBuffer(noAutoFonts, 'disabled auto font resolve');

  // Bold and italic variants
  const variants = await renderPdfFromHtml(`
    <p><strong>Bold</strong> <em>Italic</em> <strong><em>Bold Italic</em></strong></p>
  `);
  assertBuffer(variants, 'font variants');

  // Sans-serif fallback
  const sansSerif = await renderPdfFromHtml(`
    <p style="font-family: sans-serif;">Sans-serif</p>
  `);
  assertBuffer(sansSerif, 'sans-serif fallback');

  // Serif fallback
  const serif = await renderPdfFromHtml(`
    <p style="font-family: serif;">Serif</p>
  `);
  assertBuffer(serif, 'serif fallback');

  // Multiple font families
  const multi = await renderPdfFromHtml(`
    <p style="font-family: 'NonExistent', Arial, sans-serif;">Fallback chain</p>
  `);
  assertBuffer(multi, 'font family fallback chain');

  // Font weight numeric
  const weight = await renderPdfFromHtml(`
    <p style="font-weight: 700;">Bold weight</p>
    <p style="font-weight: 400;">Normal weight</p>
  `);
  assertBuffer(weight, 'numeric font weight');
}

module.exports = { name: 'fonts', run };
