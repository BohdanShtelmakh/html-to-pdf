const assert = require('assert');
const PDFDocument = require('pdfkit');
const { renderPdfFromHtml } = require('../src');
const { computedMargins } = require('../src/pdf/style');
const { nativeLineGap } = require('../src/pdf/text');

async function run() {
  assert.deepStrictEqual(computedMargins({}, 'table'), { mt: 0, mb: 0 }, 'tables have no implicit 1em margin');
  assert.deepStrictEqual(computedMargins({ margin: '8px 0 12px' }, 'table'), { mt: 6, mb: 9 }, 'explicit table margins must remain effective');
  const metrics = new PDFDocument({ autoFirstPage: false });
  metrics.font('Helvetica').fontSize(10);
  assert.strictEqual(nativeLineGap(metrics, {}, 10, 'p'), 0, 'normal line height uses font metrics without extra leading');
  assert.strictEqual(nativeLineGap(metrics, { 'line-height': 'normal' }, 10, 'h1'), 0);
  assert.ok(Math.abs(nativeLineGap(metrics, { 'line-height': '1.5' }, 10, 'p') + metrics.currentLineHeight(true) - 15) < 0.001);
  metrics.end();

  const fragments = [];
  const original = PDFDocument.prototype._fragment;
  PDFDocument.prototype._fragment = function (text, x, y, options) {
    fragments.push({ text: String(text).trim(), x, y });
    return original.call(this, text, x, y, options);
  };
  try {
    await renderPdfFromHtml(`<body style="font-family:Helvetica;font-size:10pt">
      <div style="width:55px"><p style="line-height:1.5;margin:0">Alpha beta gamma delta epsilon zeta</p></div>
      <table style="width:100%;margin:0;line-height:1.5"><tr><td style="padding:0">
        <strong>FirstCell</strong><br>SecondCell<br><br>FourthCell
      </td></tr><tr><td style="padding:0">NextRow</td></tr></table>
      <table style="margin:0;line-height:1.5"><tr><td style="padding:0;white-space:nowrap">NoWrap</td></tr>
        <tr><td style="padding:0">AfterNoWrap</td></tr></table>
      <table style="margin:0;line-height:1.5"><tr><td style="padding:0"><span style="font-size:20pt">LargeCell</span><br>SmallCell</td></tr>
        <tr><td style="padding:0">AfterLargeCell</td></tr></table>
    </body>`, { autoResolveFonts: false, autoResolveEmojiFont: false });
  } finally {
    PDFDocument.prototype._fragment = original;
  }
  const find = text => fragments.find(fragment => fragment.text === text);
  const first = find('FirstCell');
  const paragraphLines = fragments.filter(fragment => fragment.y < first.y);
  assert.ok(paragraphLines.length >= 3, 'native paragraph wrapping must be exercised');
  for (let i = 1; i < paragraphLines.length; i++) assert.ok(Math.abs(paragraphLines[i].y - paragraphLines[i - 1].y - 15) < 0.01,
    'native paragraph baseline spacing must equal CSS line-height');
  assert.ok(Math.abs(find('SecondCell').y - first.y - 15) < 0.01, 'mixed-weight cell lines use consistent leading');
  assert.ok(Math.abs(find('FourthCell').y - first.y - 45) < 0.01, 'empty cell line reserves a full line-height');
  assert.ok(Math.abs(find('NextRow').y - first.y - 60) < 0.01, 'row measurement matches all four drawn lines');
  assert.ok(Math.abs(find('AfterNoWrap').y - find('NoWrap').y - 15) < 0.01, 'nowrap cells reserve height without relying on doc.y');
  assert.ok(Math.abs(find('SmallCell').y - find('LargeCell').y - 30) < 0.01, 'larger inline fonts must retain sufficient line height');
  assert.ok(Math.abs(find('AfterLargeCell').y - find('LargeCell').y - 45) < 0.01, 'larger fonts must also affect row measurement');
}

module.exports = { name: 'typography-metrics', run };
