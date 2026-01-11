const fs = require('fs');
const path = require('path');
const { parseHtmlToObject } = require('./read-html');
const { makePdf } = require('./obj-pdf');
/**
 * Render a PDF buffer from HTML.
 * @param {string} html
 * @param {object} [options]
 * @param {string} [options.outputPath] - Path to write the PDF (default: ./output.pdf).
 * @param {string} [options.rootSelector] - Root selector for rendering (default: body).
 * @param {boolean} [options.fetchExternalCss] - Whether to fetch external CSS.
 * @param {object} [options.fonts] - Font paths for PDFKit.
 * @param {string} [options.fonts.sansRegular]
 * @param {string} [options.fonts.sansBold]
 * @param {string} [options.fonts.sansItalic]
 * @param {string} [options.fonts.sansBoldItalic]
 * @param {string} [options.fonts.serifRegular]
 * @param {string} [options.fonts.serifBold]
 * @param {string} [options.fonts.serifItalic]
 * @param {string} [options.fonts.serifBoldItalic]
 * @returns {Promise<Buffer>}
 */
async function renderPdfFromHtml(html, options = {}) {
  const tree = await parseHtmlToObject(html, {
    fetchExternalCss: !!options.fetchExternalCss,
    rootSelector: options.rootSelector || 'body',
  });

  const pdfBuffer = await makePdf(tree, {
    fonts: options.fonts,
    outputPath: options.outputPath,
  });
  return pdfBuffer;
}

module.exports = { renderPdfFromHtml };
