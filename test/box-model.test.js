const assert = require('assert');
const PDFDocument = require('pdfkit');
const { renderPdfFromHtml } = require('../src');
const { _tableInternals } = require('../src/components/table');

async function capture(html) {
  const text = [];
  const rectangles = [];
  const originalText = PDFDocument.prototype.text;
  const originalRect = PDFDocument.prototype.rect;
  PDFDocument.prototype.text = function (value, x, y, options) {
    text.push({ value: String(value), x: typeof x === 'number' ? x : this.x,
      y: typeof y === 'number' ? y : this.y, font: this._font.name, nativeHeight: this.currentLineHeight(true) });
    return originalText.call(this, value, x, y, options);
  };
  PDFDocument.prototype.rect = function (x, y, width, height) {
    rectangles.push({ x, y, width, height });
    return originalRect.call(this, x, y, width, height);
  };
  try {
    await renderPdfFromHtml(html, { autoResolveFonts: false, autoResolveEmojiFont: false });
  } finally {
    PDFDocument.prototype.text = originalText;
    PDFDocument.prototype.rect = originalRect;
  }
  return { text, rectangles };
}

async function run() {
  assert.deepStrictEqual(_tableInternals.distributeColumnWidths([60, 40], [20, 20], 200), [120, 80],
    'auto columns distribute excess width in proportion to their preferred widths');
  const aligned = {};
  for (const align of ['', 'top', 'middle', 'bottom']) {
    const table = await capture(`<body style="font-family:Helvetica;font-size:10pt"><table>
      <tr><td style="padding:0">Tall<br>Second<br>Third</td>
      <td style="padding:0;${align ? `vertical-align:${align}` : ''}">AmountMarker</td></tr></table></body>`);
    aligned[align] = table.text.find(call => call.value === 'AmountMarker').y;
  }
  assert.ok(Math.abs(aligned[''] - aligned.middle) < 0.01, 'table cells default to middle alignment');
  assert.ok(aligned.top < aligned.middle && aligned.middle < aligned.bottom, 'top, middle and bottom must produce distinct positions');
  assert.ok(Math.abs(aligned.middle - (aligned.top + aligned.bottom) / 2) < 0.01, 'middle alignment centers the content');
  const borderedHeights = [];
  for (const border of [0, 2]) {
    const table = await capture(`<body style="font-family:Helvetica;font-size:10pt"><table>
      <tr><td style="padding:0;border:${border}px solid black">BorderCell</td></tr></table><p style="margin:0">AfterBorder</p></body>`);
    borderedHeights.push(table.text.find(call => call.value === 'AfterBorder').y);
  }
  assert.ok(Math.abs(borderedHeights[1] - borderedHeights[0] - 1.5) < 0.01,
    'collapsed cell border must contribute once to the row height');
  for (const marker of ['LeadingMarker', '<strong>LeadingMarker</strong>']) {
    const offsets = [];
    for (const lineHeight of [1.5, 2]) {
      const leading = await capture(`<body style="margin:0;font-family:Helvetica;font-size:10pt">
        <p style="margin:0;line-height:${lineHeight}">${marker}</p></body>`);
      offsets.push(leading.text.find(call => call.value === 'LeadingMarker').y);
    }
    assert.ok(Math.abs(offsets[1] - offsets[0] - 2.5) < 0.01,
      'native and mixed-style text must share extra leading above and below the glyphs');
  }
  const forced = await capture(`<style>@page{margin:32px}body{margin:0;padding:12px;font-family:Helvetica;font-size:10pt}p{margin:0;line-height:1.5}</style>
    <p>FirstPage</p><div style="page-break-before:always"><p>ForcedMarker</p></div>`);
  const forcedText = forced.text.find(call => call.value === 'ForcedMarker');
  assert.ok(Math.abs(forcedText.y - Math.max(0, (15 - forcedText.nativeHeight) / 2) - 24) < 0.01,
    'forced page break must not repeat the body top padding');
  for (const content of ['<strong>Wrapped bold words followed by ordinary text</strong>',
    '<strong>Mixed bold</strong> followed by <em>italic words</em><br>FinalLine']) {
    const heights = [];
    for (const margin of [0, 16]) {
      const framed = await capture(`<div style="width:110px;border:1px solid black;padding:8px;font-family:Helvetica;font-size:13px">
        <p style="margin:0 0 ${margin}px;line-height:1.5">${content}</p></div>`);
      assert.ok(framed.rectangles.length, 'outer frame must be painted');
      heights.push(Math.max(...framed.rectangles.map(rect => rect.y + rect.height)) -
        Math.min(...framed.rectangles.map(rect => rect.y)));
    }
    assert.ok(Math.abs(heights[1] - heights[0] - 12) < 0.01,
      'prepainted frame must include the final child bottom margin');
  }
  const mixed = await capture(`<div style="width:200px;padding:16px;border:1px solid black;font-family:Helvetica;font-weight:bold">
    InlineMarker<div>BlockMarker</div></div>`);
  const inline = mixed.text.find(call => call.value === 'InlineMarker');
  const block = mixed.text.find(call => call.value === 'BlockMarker');
  assert.ok(inline && block && Math.abs(inline.x - block.x) < 0.01, 'anonymous text must not repeat parent padding');
  assert.ok(inline.font.includes('Bold'), 'anonymous text must retain inherited font styles');

  const flex = await capture(`<div style="display:flex;width:600px;gap:0">
    <div style="width:100px;padding:10px;border:1px solid black"><div>ContentBox</div></div>
    <div style="width:100px;padding:10px;border:1px solid black;box-sizing:border-box"><div>BorderBox</div></div>
    <div style="width:20%;padding:10px;border:1px solid black"><div>PercentBox</div></div>
    <div style="flex-basis:80px;padding:10px;border:1px solid black"><div>BasisBox</div></div>
  </div>`);
  for (const [marker, expectedWidth] of Object.entries({ ContentBox: 91.5, BorderBox: 75, PercentBox: 106.5, BasisBox: 76.5 })) {
    const call = flex.text.find(item => item.value === marker);
    assert.ok(call && flex.rectangles.some(rect => Math.abs(rect.x + 8.25 - call.x) < 0.01 &&
      Math.abs(rect.width - expectedWidth) < 0.01), `${marker} must respect its outer box width`);
  }
  const shrink = await capture(`<div style="display:flex;width:400px;gap:20px">
    <div style="width:46%;padding:10px;border:1px solid black"><div>Left</div></div>
    <div style="width:46%;padding:10px;border:1px solid black"><div>Right</div></div>
  </div>`);
  assert.ok(shrink.rectangles.filter(rect => Math.abs(rect.width - 142.5) < 0.01).length >= 2,
    'padded percentage items must shrink to the available row width');

  const lines = await capture(`<div style="font-size:10pt;line-height:1.5;font-family:Helvetica">
    <strong>LineOne</strong><br>LineTwo<br><em>LineThree</em></div>
    <div style="width:70px;font-size:10pt;line-height:1.5"><strong>Alpha beta</strong> gamma delta epsilon zeta</div>`);
  const y = ['LineOne', 'LineTwo', 'LineThree'].map(marker => {
    const call = lines.text.find(call => call.value === marker);
    return call.y - Math.max(0, (15 - call.nativeHeight) / 2);
  });
  assert.ok(Math.abs(y[1] - y[0] - 15) < 0.01 && Math.abs(y[2] - y[1] - 15) < 0.01,
    'explicit breaks must use CSS line-height once');
  const wrappedY = [...new Set(lines.text.filter(call => !['LineOne', 'LineTwo', 'LineThree', ''].includes(call.value))
    .map(call => Number((call.y - Math.max(0, (15 - call.nativeHeight) / 2)).toFixed(4))))];
  assert.ok(wrappedY.length >= 3, 'regression must exercise mixed-style automatic wrapping');
  for (let i = 1; i < wrappedY.length; i++) assert.ok(Math.abs(wrappedY[i] - wrappedY[i - 1] - 15) < 0.01,
    'automatic wrapping must use CSS line-height once');
}

module.exports = { name: 'box-model', run };
