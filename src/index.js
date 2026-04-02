const { parseHtmlToObject } = require('./read-html');
const { makePdf } = require('./obj-pdf');

/**
 * Render a PDF buffer from an HTML string.
 * @param {string} html
 * @param {Object} [options]
 * @param {string} [options.rootSelector]
 * @param {boolean} [options.fetchExternalCss]
 * @param {number} [options.loadTimeoutMs]
 * @param {number} [options.externalCssTimeoutMs]
 * @param {boolean} [options.allowScripts]
 * @param {boolean} [options.ignoreInvalidImages]
 * @param {number} [options.imgLoadTimeoutMs]
 * @param {number} [options.imgLoadTimeout]
 * @param {boolean} [options.enableInternalAnchors]
 * @param {boolean} [options.autoResolveFonts]
 * @param {{top?: number, right?: number, bottom?: number, left?: number}} [options.margins]
 * @param {number} [options.svgScale]
 * @param {number} [options.svgDpi]
 * @param {Object<string, string|{regular?: string, bold?: string, italic?: string, boldItalic?: string}>} [options.fonts]
 * @returns {Promise<Buffer>}
 */
const MAX_HTML_LENGTH = 50_000_000; // 50 MB

async function renderPdfFromHtml(html, options = {}) {
  if (typeof html !== 'string') {
    throw new TypeError('renderPdfFromHtml: html must be a string, got ' + typeof html);
  }
  if (html.length > MAX_HTML_LENGTH) {
    throw new RangeError('renderPdfFromHtml: html exceeds maximum length of ' + MAX_HTML_LENGTH + ' characters');
  }

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
    imgLoadTimeoutMs: options.imgLoadTimeoutMs,
    imgLoadTimeout: options.imgLoadTimeout,
    enableInternalAnchors: options.enableInternalAnchors,
    autoResolveFonts: options.autoResolveFonts,
    margins: options.margins,
    svgScale: options.svgScale,
    svgDpi: options.svgDpi,
  });
  return pdfBuffer;
}

module.exports = { renderPdfFromHtml };
