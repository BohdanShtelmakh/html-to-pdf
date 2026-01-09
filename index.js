const fs = require('fs');
const path = require('path');
const { parseHtmlToObject } = require('./read-html');
const { makePdf } = require('./obj-pdf');
async function renderPdfFromHtml(html, options = {}) {
  const tree = await parseHtmlToObject(html, {
    fetchExternalCss: !!options.fetchExternalCss,
    rootSelector: options.rootSelector || 'body',
  });

  const outputPath = options.outputPath || path.resolve(process.cwd(), 'output.pdf');
  const pdfPath = await makePdf(tree, outputPath, { fonts: options.fonts });
  return fs.readFileSync(pdfPath);
}

module.exports = { renderPdfFromHtml };
