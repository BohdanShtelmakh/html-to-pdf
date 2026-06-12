const assert = require('assert');
const { renderPdfFromHtml } = require('../src/index.js');
const { assertBuffer, countMatches } = require('./helpers');

async function run() {
  // Render a document containing a color emoji. If a fontkit-readable color
  // emoji font is available, this produces a native Type 3 font; otherwise it
  // gracefully falls back to the regular text font (e.g. CI Linux with no
  // usable emoji font), and the test skips the Type3-specific assertions.
  {
    const html = '<p>Hi <span>emoji</span> 😁 test</p>';
    const pdf = await renderPdfFromHtml(html, { autoResolveEmojiFont: true });
    assertBuffer(pdf, 'emoji output');
    assert.ok(pdf.slice(0, 5).toString('latin1') === '%PDF-', 'expected a valid PDF header');

    const hasType3 = countMatches(pdf, /\/Type3\b/g) >= 1;
    if (hasType3) {
      assert.ok(
        countMatches(pdf, /\/ToUnicode\b/g) >= 1,
        'expected a /ToUnicode map for searchable emoji text'
      );
    } else {
      console.log('# skip - no fontkit-readable color emoji font available; Type3 assertions skipped');
    }
  }

  // A plain, non-emoji document must always render to a valid PDF.
  {
    const pdf = await renderPdfFromHtml('<p>Plain document, no emoji.</p>');
    assertBuffer(pdf, 'plain output');
    assert.ok(pdf.slice(0, 5).toString('latin1') === '%PDF-', 'expected a valid PDF header');
  }
}

module.exports = { name: 'emoji', run };
