const { renderPdfFromHtml } = require('../src/index.js');
const { assertBuffer } = require('./helpers');

async function run() {
  const out = await renderPdfFromHtml('<p>OK</p>');
  assertBuffer(out, 'smoke output');
}

module.exports = { name: 'smoke', run };
