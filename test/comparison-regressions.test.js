const assert = require('assert');
const PDFDocument = require('pdfkit');
const { renderPdfFromHtml } = require('../src');
const { pageCount } = require('./helpers');
const { loadComparisonCases, loadStressCases } = require('../examples/comparison-cases.cjs');
const { rowsByPage, validateResult } = require('../examples/comparison-checks.cjs');
const { invoiceOffsets, compareGeometry } = require('../examples/comparison-geometry.cjs');

async function run() {
  assert.ok(compareGeometry([10, 20], [10.5, 20], 1).passed);
  assert.ok(!compareGeometry([10, 20], [12, 20], 1).passed, 'shifted geometry must fail');
  assert.throws(() => compareGeometry([NaN], [10], 1), /Invalid geometry/);
  assert.throws(() => compareGeometry([10], [], 1), /matching nonempty/);
  assert.throws(() => invoiceOffsets('<html xmlns="http://www.w3.org/1999/xhtml"><body/></html>'), /Expected one geometry marker/);
  const spec = { expectedPages: 2, markers: ['Customer 001', 'Customer 002'],
    expectedRowsByPage: [[1], [2]], pageMarkers: [['Header'], ['Header']] };
  const good = 'Header Customer 001\fHeader Customer 002\f';
  assert.deepStrictEqual(validateResult(spec, { text: good, pages: 2 }), []);
  assert.ok(validateResult(spec, { text: 'Header Customer 001 Customer 002\fHeader\f', pages: 2 })
    .some(issue => issue.includes('distribution')), 'equal page count must not hide shifted rows');
  assert.ok(validateResult(spec, { text: good + 'Customer 002', pages: 2 }).some(issue => issue.includes('occurrence')),
    'duplicate rows must fail validation');
  assert.ok(validateResult(spec, { text: good.replace('Header Customer 002', 'Customer 002'), pages: 2 })
    .some(issue => issue.includes('Missing Header')), 'missing repeated headers must fail validation');
  assert.ok(validateResult(spec, { text: good, pages: 3 }).some(issue => issue.includes('pages')),
    'extra blank pages must fail validation');
  assert.deepStrictEqual(rowsByPage('\fCustomer 001\f', 2), [[], [1]], 'empty pages must retain their index');
  assert.ok(validateResult({ expectedPages: 2, markers: ['Before', 'After'], pageMarkers: [['Before'], ['After']] },
    { text: 'After\fBefore\f', pages: 2 }).some(issue => issue.includes('Missing Before')),
  'correct content on the wrong page must fail forced-break validation');

  const originalAddPage = PDFDocument.prototype.addPage;
  const originalFragment = PDFDocument.prototype._fragment;
  const originalRect = PDFDocument.prototype.rect;
  let emitted = [];
  let rectangles = [];
  PDFDocument.prototype.rect = function (x, y, width, height) {
    const range = this.bufferedPageRange();
    rectangles.push({ page: range.start + this._pageBuffer.indexOf(this.page) + 1, x, y, width, height });
    return originalRect.call(this, x, y, width, height);
  };
  PDFDocument.prototype.addPage = function (...args) {
    this._comparisonPage = (this._comparisonPage || 0) + 1;
    return originalAddPage.apply(this, args);
  };
  PDFDocument.prototype._fragment = function (text, ...args) {
    const range = this.bufferedPageRange();
    const page = range.start + this._pageBuffer.indexOf(this.page) + 1;
    emitted.push({ page, text: String(text), size: this._fontSize, font: this._font.name, x: args[0], y: args[1],
      height: this.currentLineHeight(false), top: this.page.margins.top, bottom: this.page.height - this.page.margins.bottom });
    return originalFragment.call(this, text, ...args);
  };
  try {
    for (const fixture of [...loadComparisonCases(), ...loadStressCases()]) {
      emitted = [];
      rectangles = [];
      const pdf = await renderPdfFromHtml(fixture.html, {
        autoResolveFonts: false, autoResolveEmojiFont: false, autoDownloadEmojiFont: false,
        allowScripts: false, fetchExternalCss: false,
      });
      const pages = pageCount(pdf);
      const text = Array.from({ length: pages }, (_, i) => emitted.filter(entry => entry.page === i + 1)
        .map(entry => entry.text).join(' ')).join('\f');
      assert.deepStrictEqual(validateResult(fixture, { text, pages }), [], `${fixture.name}: emitted content/pagination regression`);
      if (fixture.name.startsWith('stress-')) {
        assert.ok(emitted.every(entry => entry.y >= entry.top - 1 && entry.y + entry.height <= entry.bottom + 1),
          `${fixture.name}: text must stay inside page margins`);
        for (let page = 1; page <= pages; page++) {
          assert.ok(rectangles.some(rect => rect.page === page), `${fixture.name}: frame missing on page ${page}`);
        }
      }
      if (fixture.name === 'stress-framed-block') {
        const left = Math.min(...rectangles.map(rect => rect.x));
        assert.ok(emitted.filter(entry => entry.text.startsWith('StressLine')).every(entry => entry.x >= left + 9),
          'framed continuation pages must preserve horizontal padding');
        const markers = emitted.filter(entry => /^StressLine\d+$/.test(entry.text));
        for (let index = 1; index < markers.length; index++) {
          if (markers[index].page === markers[index - 1].page) {
            assert.ok(Math.abs(markers[index].y - markers[index - 1].y - 26.625) < 0.01,
              'paragraph margin must survive the first rendered block on a continuation page');
          }
        }
      }
      if (fixture.name === 'nested-tables') {
        for (const label of ['NorthRegion', 'SouthRegion']) {
          const fragment = emitted.find(entry => entry.text.trim() === label);
          assert.ok(fragment, `${label}: missing label`);
          assert.strictEqual(fragment.size, 9.75, `${label}: inherit the cell font size`);
          assert.strictEqual(fragment.font, 'Helvetica', `${label}: inherit the cell font family`);
        }
      }
    }
    emitted = [];
    await renderPdfFromHtml('<table><tr><td style="font-family: Helvetica; font-size: 10px; font-weight: bold">InheritedLabel<table><tr><td><span style="font-size: 18px; font-weight: normal">OverrideLabel</span></td></tr></table></td></tr></table>', {
      autoResolveFonts: false, autoResolveEmojiFont: false, autoDownloadEmojiFont: false,
      allowScripts: false, fetchExternalCss: false,
    });
    const inherited = emitted.find(entry => entry.text.trim() === 'InheritedLabel');
    const override = emitted.find(entry => entry.text.trim() === 'OverrideLabel');
    assert.ok(inherited);
    assert.ok(override);
    assert.strictEqual(inherited.size, 7.5);
    assert.strictEqual(inherited.font, 'Helvetica-Bold');
    assert.strictEqual(override.size, 13.5);
    assert.strictEqual(override.font, 'Helvetica');
    emitted = [];
    const column = prefix => Array.from({ length: 70 }, (_, i) => `${prefix}${String(i).padStart(3, '0')}`).join('<br>');
    const twoColumns = await renderPdfFromHtml(`<body style="margin:32px;font-family:Helvetica;font-size:13px"><table>
      <tr><td>${column('Left')}</td><td>${column('Right')}</td></tr></table><p>AfterBoth</p></body>`, {
      autoResolveFonts: false, autoResolveEmojiFont: false,
    });
    assert.strictEqual(pageCount(twoColumns), 2, 'two tall cells must reuse the same continuation pages');
    for (const marker of ['Left000', 'Right000']) assert.strictEqual(emitted.find(entry => entry.text === marker).page, 1);
    for (const marker of ['Left069', 'Right069', 'AfterBoth']) assert.strictEqual(emitted.find(entry => entry.text === marker).page, 2);
  } finally {
    PDFDocument.prototype.addPage = originalAddPage;
    PDFDocument.prototype._fragment = originalFragment;
    PDFDocument.prototype.rect = originalRect;
  }
}

module.exports = { name: 'comparison-regressions', run };
