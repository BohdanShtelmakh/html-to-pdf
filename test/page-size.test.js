const assert = require('assert');
const { renderPdfFromHtml } = require('../src/index.js');
const { assertBuffer, pageCount } = require('./helpers');

function mediaBoxes(buffer) {
  const text = buffer.toString('latin1');
  return Array.from(text.matchAll(/\/MediaBox\s*\[([^\]]*)\]/g), (m) => m[1].trim().split(/\s+/).map(Number));
}

function assertBox(box, expected, label) {
  assert.strictEqual(box.length, 4, `${label}: MediaBox should have 4 numbers`);
  box.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 0.01, `${label}: expected [${expected}], got [${box}]`));
}

async function expectTypeError(options, label) {
  let threw = false;
  try {
    await renderPdfFromHtml('<p>x</p>', options);
  } catch (err) {
    threw = true;
    assert.ok(err instanceof TypeError, `${label}: expected TypeError, got ${err.constructor.name}`);
  }
  assert.ok(threw, `${label}: should throw`);
}

async function run() {
  const html = '<html><body><p>Hello page size</p></body></html>';

  // Default stays A4 portrait
  const a4 = await renderPdfFromHtml(html);
  assertBuffer(a4, 'default');
  assertBox(mediaBoxes(a4)[0], [0, 0, 595.28, 841.89], 'default A4');

  // Named size, case-insensitive
  const letter = await renderPdfFromHtml(html, { pageSize: 'letter' });
  assertBox(mediaBoxes(letter)[0], [0, 0, 612, 792], 'LETTER');

  // Landscape swaps the sides
  const landscape = await renderPdfFromHtml(html, { pageSize: 'LETTER', orientation: 'landscape' });
  assertBox(mediaBoxes(landscape)[0], [0, 0, 792, 612], 'LETTER landscape');

  // Custom size in points
  const custom = await renderPdfFromHtml(html, { pageSize: [300, 500] });
  assertBox(mediaBoxes(custom)[0], [0, 0, 300, 500], 'custom');

  // Pagination follows the custom height
  const tall = '<html><body>' + '<p>line</p>'.repeat(200) + '</body></html>';
  const short = await renderPdfFromHtml(tall, { pageSize: [300, 200] });
  const regular = await renderPdfFromHtml(tall, { pageSize: [300, 800] });
  assert.ok(pageCount(short) > pageCount(regular), 'shorter pages should paginate into more pages');

  // Auto height: one page, shrunk to the content, top edge kept at the page top
  const auto = await renderPdfFromHtml(html, { pageSize: [300, 'auto'] });
  assert.strictEqual(pageCount(auto), 1, 'auto height short content should be one page');
  const [x0, y0, x1, y1] = mediaBoxes(auto)[0];
  assert.strictEqual(x0, 0);
  assert.strictEqual(x1, 300);
  assert.strictEqual(y1, 14400, 'auto height keeps the top of the drawing area');
  const autoHeight = y1 - y0;
  assert.ok(autoHeight > 10 && autoHeight < 200, `auto height should fit one paragraph, got ${autoHeight}`);

  // Auto height grows with content
  const autoTall = await renderPdfFromHtml(tall, { pageSize: [300, 'auto'] });
  const [, ty0, , ty1] = mediaBoxes(autoTall)[0];
  assert.strictEqual(pageCount(autoTall), 1, 'auto height long content should stay one page');
  assert.ok(ty1 - ty0 > autoHeight * 20, 'auto height should grow with content');

  // Empty content must still produce a usable page when margins are zero.
  const emptyAuto = await renderPdfFromHtml('<html><body></body></html>', {
    pageSize: [300, 'auto'],
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
  });
  assert.strictEqual(pageCount(emptyAuto), 1, 'empty auto content should be one page');
  assertBox(mediaBoxes(emptyAuto)[0], [0, 14399, 300, 14400], 'empty auto minimum height');

  const emptyWithMargins = await renderPdfFromHtml('<html><body></body></html>', {
    pageSize: [300, 'auto'],
    margins: { top: 10, right: 0, bottom: 20, left: 0 },
  });
  assertBox(mediaBoxes(emptyWithMargins)[0], [0, 14370, 300, 14400], 'empty auto preserves margins');

  // Invalid input
  await expectTypeError({ pageSize: [0, 100] }, 'zero width');
  await expectTypeError({ pageSize: [100, -1] }, 'negative height');
  await expectTypeError({ pageSize: [20000, 100] }, 'too wide');
  await expectTypeError({ pageSize: [100] }, 'one side');
  await expectTypeError({ pageSize: '' }, 'empty name');
  await expectTypeError({ pageSize: ['auto', 100] }, 'auto width');
  await expectTypeError({ orientation: 'sideways' }, 'bad orientation');
  await expectTypeError({ pageSize: [300, 'auto'], orientation: 'landscape' }, 'auto + landscape');
}

module.exports = { name: 'page-size', run };
