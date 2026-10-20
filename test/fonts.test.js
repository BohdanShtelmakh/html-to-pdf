const assert = require('assert');
const PDFDocument = require('pdfkit');
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

  // Verify the font at actual glyph emission, not merely during measurement.
  const fragments = [];
  const originalFragment = PDFDocument.prototype._fragment;
  PDFDocument.prototype._fragment = function (text, ...args) {
    fragments.push({ text: String(text), font: this._font.name });
    return originalFragment.call(this, text, ...args);
  };
  try {
    const standardFonts = await renderPdfFromHtml(`
      <body style="font-family: Helvetica;">
        <p>RegularMarker <strong>StrongMarker</strong> <em>ItalicMarker</em></p>
        <p style="font-weight:bold">CssBoldMarker</p>
        <p style="font-weight:700">NumericBoldMarker</p>
        <p style="font-weight:400">NormalMarker</p>
        <div style="text-align:right"><strong>AlignedBoldMarker</strong><br>AlignedNormalMarker</div>
        <table><tr><td><strong>CellBoldMarker</strong><br>CellNormalMarker</td></tr></table>
        <p><strong><em>BoldItalicMarker</em></strong></p>
      </body>
    `, { autoResolveFonts: false, autoResolveEmojiFont: false });
    assertBuffer(standardFonts, 'standard font emission');
    await renderPdfFromHtml(`<style>h3 { font-weight: lighter !important; }
      .hh { font-weight: lighter !important; }</style><body style="font-family:Helvetica">
      <h3 style="font-weight:100!important">HeadingAAA</h3>
      <div class="hh"><h3 style="font-weight:normal!important">HeadingBBB</h3></div>
      <h3>HeadingLighter</h3></body>`, { autoResolveFonts: false, autoResolveEmojiFont: false });
    await renderPdfFromHtml(`<body style="font-family:Helvetica;font-weight:normal">
      ${[1, 2, 3, 4, 5, 6].map(level => `<h${level}>DefaultHeading${level}</h${level}>
        <h${level} style="font-weight:normal">NormalHeading${level}</h${level}>`).join('')}
      <h3 style="font-weight:700">BoldHeading</h3>
      <h3 style="font-weight:inherit">InheritedHeading</h3>
      <h3><span style="font-weight:normal">NormalHeadingChild</span></h3>
      </body>`, { autoResolveFonts: false, autoResolveEmojiFont: false });
    // Force the emoji layout path without depending on an installed color font.
    const originalAddPage = PDFDocument.prototype.addPage;
    PDFDocument.prototype.addPage = function (...args) {
      const result = originalAddPage.apply(this, args);
      this._emoji = { lookup: () => null, finalize: () => {} };
      return result;
    };
    try {
      await renderPdfFromHtml('<body style="font-family:Helvetica"><h3 style="font-weight:normal">EmojiNormalHeading &#x1f601;</h3><h3>EmojiBoldHeading &#x1f601;</h3></body>', {
        autoResolveFonts: false, autoResolveEmojiFont: false, autoDownloadEmojiFont: false,
      });
    } finally {
      PDFDocument.prototype.addPage = originalAddPage;
    }
    for (const font of ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique']) {
      assert.ok(standardFonts.includes(Buffer.from(`/BaseFont /${font}\n`)), `${font} must be present in PDF resources`);
    }
  } finally {
    PDFDocument.prototype._fragment = originalFragment;
  }
  for (const [marker, font] of Object.entries({
    HeadingAAA: 'Helvetica', HeadingBBB: 'Helvetica', HeadingLighter: 'Helvetica',
    BoldHeading: 'Helvetica-Bold', NormalHeadingChild: 'Helvetica', InheritedHeading: 'Helvetica',
    EmojiNormalHeading: 'Helvetica', EmojiBoldHeading: 'Helvetica-Bold',
    ...Object.fromEntries([1, 2, 3, 4, 5, 6].flatMap(level => [
      [`DefaultHeading${level}`, 'Helvetica-Bold'], [`NormalHeading${level}`, 'Helvetica'],
    ])),
    RegularMarker: 'Helvetica', StrongMarker: 'Helvetica-Bold', ItalicMarker: 'Helvetica-Oblique',
    CssBoldMarker: 'Helvetica-Bold', NumericBoldMarker: 'Helvetica-Bold', NormalMarker: 'Helvetica',
    AlignedBoldMarker: 'Helvetica-Bold', AlignedNormalMarker: 'Helvetica',
    CellBoldMarker: 'Helvetica-Bold', CellNormalMarker: 'Helvetica', BoldItalicMarker: 'Helvetica-BoldOblique',
  })) {
    const matching = fragments.filter(fragment => new RegExp(`\\b${marker}\\b`).test(fragment.text));
    assert.ok(matching.length && matching.every(fragment => fragment.font === font), `${marker} must draw using ${font}`);
  }

  // Text-aware fallback avoids missing glyph boxes for common currency symbols.
  const currency = await renderPdfFromHtml(`
    <p style="font-family: Arial, sans-serif;">Total (₹)</p>
    <table><tr><th>MRP (₹)</th><td>₹ 5,14,119.00</td></tr></table>
  `);
  assertBuffer(currency, 'currency glyph fallback');
}

module.exports = { name: 'fonts', run };
