const assert = require('assert');

function countMatches(buffer, pattern) {
  const text = Buffer.isBuffer(buffer) ? buffer.toString('latin1') : String(buffer || '');
  const matches = text.match(pattern);
  return matches ? matches.length : 0;
}

function pageCount(buffer) {
  return countMatches(buffer, /\/Type\s*\/Page\b/g);
}

function linkAnnotationCount(buffer) {
  return countMatches(buffer, /\/Subtype\s*\/Link\b/g);
}

function assertBuffer(value, label = 'value') {
  assert.ok(Buffer.isBuffer(value), `${label} must be a Buffer`);
}

module.exports = {
  countMatches,
  pageCount,
  linkAnnotationCount,
  assertBuffer,
};
