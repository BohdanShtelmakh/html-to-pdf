const assert = require('assert');
const { renderPdfFromHtml } = require('../src/index.js');
const { assertBuffer, countMatches, linkAnnotationCount } = require('./helpers');

async function run() {
  {
    const html = `
      <html><body>
        <p>Visit <a href="https://example.com">Example</a> and <a href="mailto:test@example.com">Email</a>.</p>
      </body></html>
    `;
    const pdf = await renderPdfFromHtml(html);
    assertBuffer(pdf, 'external links output');
    assert.ok(linkAnnotationCount(pdf) >= 2, 'expected at least two link annotations for external links');
    assert.ok(countMatches(pdf, /https:\/\/example\.com/g) >= 1, 'expected external URL in PDF');
  }

  {
    const html = `
      <html><body>
        <p><a href="#target">Jump down</a></p>
        <div style="page-break-before: always; height: 40pt;"></div>
        <h2 id="target">Anchor</h2>
      </body></html>
    `;
    const pdf = await renderPdfFromHtml(html, { enableInternalAnchors: true });
    assertBuffer(pdf, 'internal links output');
    assert.ok(linkAnnotationCount(pdf) >= 1, 'expected at least one link annotation for internal link');
    const hasGoToAction = countMatches(pdf, /\/S\s*\/GoTo\b/g) >= 1;
    const hasDestLinks = countMatches(pdf, /\/Dest\s*\([^)]+\)/g) >= 1;
    assert.ok(hasGoToAction || hasDestLinks, 'expected internal link action (GoTo or Dest) in PDF');
  }
}

module.exports = { name: 'links', run };
