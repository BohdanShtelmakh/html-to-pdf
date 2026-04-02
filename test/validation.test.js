const assert = require('assert');
const { renderPdfFromHtml } = require('../src/index.js');
const { assertBuffer } = require('./helpers');

async function run() {
  // TypeError for non-string input
  for (const bad of [null, undefined, 123, {}, [], true]) {
    let threw = false;
    try {
      await renderPdfFromHtml(bad);
    } catch (err) {
      threw = true;
      assert.ok(err instanceof TypeError, `expected TypeError for ${typeof bad}, got ${err.constructor.name}`);
    }
    assert.ok(threw, `should throw TypeError for ${typeof bad}`);
  }

  // Empty string still works (produces a valid PDF)
  const empty = await renderPdfFromHtml('<html><body></body></html>');
  assertBuffer(empty, 'empty body');

  // Minimal valid input
  const minimal = await renderPdfFromHtml('');
  assertBuffer(minimal, 'empty string');
}

module.exports = { name: 'validation', run };
