const assert = require('assert');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const { renderPdfFromHtml } = require('../src');

async function run() {
  const calls = [];
  const rectangles = [];
  const originalText = PDFDocument.prototype.text;
  const originalRect = PDFDocument.prototype.rect;
  PDFDocument.prototype.text = function (text, x, y, options) {
    calls.push({ text: String(text), x: typeof x === 'number' ? x : this.x,
      y: typeof y === 'number' ? y : this.y, width: this.widthOfString(String(text)), font: this._font.name });
    return originalText.call(this, text, x, y, options);
  };
  PDFDocument.prototype.rect = function (x, y, width, height) {
    rectangles.push({ x, y, width, height });
    return originalRect.call(this, x, y, width, height);
  };
  try {
    const pdf = await renderPdfFromHtml(`
      <div>First<br>Second<br><strong>Third</strong></div>
      <div style="width:120px"><p><strong>Bold introduction</strong> followed by several ordinary words that must wrap inside this narrow column.</p></div>
      <div>After</div>
      <div style="display:flex;width:400px;gap:20px">
        <div style="width:46%"><div style="border:1px solid black;padding:8px"><p>Left panel</p></div></div>
        <div style="width:46%"><div style="border:1px solid black;padding:8px"><p>Right panel</p></div></div>
      </div>
      <div>EmptyStart<br><br>EmptyEnd</div>
    `, { autoResolveFonts: false, autoResolveEmojiFont: false });
    if (process.env.INLINE_LAYOUT_PREVIEW) fs.writeFileSync(process.env.INLINE_LAYOUT_PREVIEW, pdf);
  } finally {
    PDFDocument.prototype.text = originalText;
    PDFDocument.prototype.rect = originalRect;
  }
  const first = calls.find(call => call.text === 'First');
  const second = calls.find(call => call.text === 'Second');
  const third = calls.find(call => call.text === 'Third');
  assert.ok(first && second && third && first.y < second.y && second.y < third.y, 'br must advance each baseline');
  assert.ok(third.font.includes('Bold'), 'explicit breaks must preserve strong styling');
  const emptyStart = calls.find(call => call.text === 'EmptyStart');
  const emptyEnd = calls.find(call => call.text === 'EmptyEnd');
  assert.ok(emptyEnd.y - emptyStart.y >= 2 * (second.y - first.y) - 0.1, 'consecutive breaks must retain the empty line');
  const after = calls.find(call => call.text === 'After');
  const wrapped = calls.filter(call => call.y > third.y && call.y < after.y);
  assert.ok(new Set(wrapped.map(call => call.y)).size >= 3, 'mixed text must wrap into measured lines');
  for (const call of wrapped) assert.ok(call.x + call.width <= first.x + 90 + 0.1, 'mixed text must remain inside 120px column');
  assert.ok(after.y > Math.max(...wrapped.map(call => call.y)) + 8, 'following block must clear wrapped content');
  assert.ok(rectangles.filter(rect => Math.abs(rect.width - 138) < 1).length >= 2, 'nested panels must use full allocated 46% flex width');
}

module.exports = { name: 'inline-layout', run };
