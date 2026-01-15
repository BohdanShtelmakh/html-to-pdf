const fs = require('fs');
const path = require('path');
const { parseHtmlToObject } = require('./read-html');
const { makePdf } = require('./obj-pdf');
async function renderPdfFromHtml(html, options = {}) {
  const tree = await parseHtmlToObject(html, {
    fetchExternalCss: !!options.fetchExternalCss,
    rootSelector: options.rootSelector || 'body',
    loadTimeoutMs: options.loadTimeoutMs,
    externalCssTimeoutMs: options.externalCssTimeoutMs,
    allowScripts: options.allowScripts,
  });

  const pdfBuffer = await makePdf(tree, {
    fonts: options.fonts,
    ignoreInvalidImages: options.ignoreInvalidImages,
  });
  return pdfBuffer;
}

module.exports = { renderPdfFromHtml };
