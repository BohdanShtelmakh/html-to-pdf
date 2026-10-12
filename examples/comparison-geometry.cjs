const { JSDOM } = require('jsdom');

function wordCenter(xml, text) {
  const document = new JSDOM(xml, { contentType: 'application/xhtml+xml' }).window.document;
  const words = [...document.querySelectorAll('word')].filter(word => word.textContent === text);
  if (words.length !== 1) throw new Error(`Expected one geometry marker: ${text}, found ${words.length}`);
  const word = words[0];
  const top = Number(word.getAttribute('yMin'));
  const bottom = Number(word.getAttribute('yMax'));
  if (!Number.isFinite(top) || !Number.isFinite(bottom)) throw new Error(`Invalid geometry: ${text}`);
  return (top + bottom) / 2;
}

function invoiceOffsets(xml) {
  return [['$300.00', 'consultation', 'Discovery,'], ['$450.00', 'Implementation', 'Responsive'],
    ['$150.00', 'Quality', 'Layout,']].map(([amount, first, second]) =>
    wordCenter(xml, amount) - (wordCenter(xml, first) + wordCenter(xml, second)) / 2);
}

function compareGeometry(lite, chromium, tolerance) {
  if (lite.length !== chromium.length || !lite.length) throw new Error('Geometry measurements must have matching nonempty shapes');
  const differences = lite.map((value, index) => Math.abs(value - chromium[index]));
  if (!differences.every(Number.isFinite) || !Number.isFinite(tolerance) || tolerance < 0) throw new Error('Invalid geometry measurements');
  const maxDifference = Math.max(...differences);
  return { lite, chromium, tolerance, maxDifference, passed: maxDifference <= tolerance };
}

module.exports = { wordCenter, invoiceOffsets, compareGeometry };
