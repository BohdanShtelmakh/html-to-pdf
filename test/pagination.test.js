const assert = require('assert');
const { renderPdfFromHtml } = require('../src/index.js');
const { assertBuffer, pageCount } = require('./helpers');

function paragraphBlock(lines) {
  return Array.from({ length: lines }, (_v, i) => `<p>Line ${i + 1} lorem ipsum dolor sit amet.</p>`).join('');
}

async function run() {
  {
    const html = `
      <html><body>
        <div>${paragraphBlock(8)}</div>
        <div style="page-break-before: always;"><h2>Next page</h2><p>content</p></div>
      </body></html>
    `;
    const pdf = await renderPdfFromHtml(html);
    assertBuffer(pdf, 'page-break-before output');
    assert.ok(pageCount(pdf) >= 2, 'page-break-before should produce at least 2 pages');
  }

  {
    const html = `
      <html><body>
        <div>${paragraphBlock(8)}</div>
        <div style="break-before: page;"><h2>Next page</h2><p>content</p></div>
      </body></html>
    `;
    const pdf = await renderPdfFromHtml(html);
    assertBuffer(pdf, 'break-before output');
    assert.ok(pageCount(pdf) >= 2, 'break-before: page should produce at least 2 pages');
  }

  {
    const html = `
      <html><body>
        <div>${paragraphBlock(32)}</div>
        <section style="break-inside: avoid; border: 1px solid #999; padding: 8px;">
          <h3>Keep together</h3>
          ${paragraphBlock(10)}
        </section>
      </body></html>
    `;
    const pdf = await renderPdfFromHtml(html);
    assertBuffer(pdf, 'break-inside output');
    assert.ok(pageCount(pdf) >= 2, 'break-inside: avoid scenario should paginate');
  }
}

module.exports = { name: 'pagination', run };
