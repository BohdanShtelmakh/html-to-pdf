const assert = require('assert');
const PDFDocument = require('pdfkit');
const { renderPdfFromHtml } = require('../src');
const { pageCount } = require('./helpers');
const { loadComparisonCases } = require('../examples/comparison-cases.cjs');
const { rowsByPage, validateResult } = require('../examples/comparison-checks.cjs');

async function run() {
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
  let emitted = [];
  PDFDocument.prototype.addPage = function (...args) {
    this._comparisonPage = (this._comparisonPage || 0) + 1;
    return originalAddPage.apply(this, args);
  };
  PDFDocument.prototype._fragment = function (text, ...args) {
    emitted.push({ page: this._comparisonPage, text: String(text) });
    return originalFragment.call(this, text, ...args);
  };
  try {
    for (const fixture of loadComparisonCases()) {
      emitted = [];
      const pdf = await renderPdfFromHtml(fixture.html, {
        autoResolveFonts: false, autoResolveEmojiFont: false, autoDownloadEmojiFont: false,
        allowScripts: false, fetchExternalCss: false,
      });
      const pages = pageCount(pdf);
      const text = Array.from({ length: pages }, (_, i) => emitted.filter(entry => entry.page === i + 1)
        .map(entry => entry.text).join(' ')).join('\f');
      assert.deepStrictEqual(validateResult(fixture, { text, pages }), [], `${fixture.name}: emitted content/pagination regression`);
    }
  } finally {
    PDFDocument.prototype.addPage = originalAddPage;
    PDFDocument.prototype._fragment = originalFragment;
  }
}

module.exports = { name: 'comparison-regressions', run };
