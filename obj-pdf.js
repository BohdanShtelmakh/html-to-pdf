const fs = require('fs');
const PDFDocument = require('pdfkit');
const { Layout } = require('./pdf/layout');
const { renderNode } = require('./pdf/render-node');
const { parsePxWithOptions } = require('./pdf/style');

function parseMarginBox(styles, fallback = 6) {
  const out = { top: fallback, right: fallback, bottom: fallback, left: fallback };
  if (!styles) return out;

  const val = styles.margin || styles['margin'];
  const parts = typeof val === 'string' ? val.trim().split(/\s+/).filter(Boolean) : [];

  const toPx = (v) => parsePxWithOptions(v, fallback);

  if (parts.length === 1) {
    const m = toPx(parts[0]);
    out.top = out.right = out.bottom = out.left = m;
  } else if (parts.length === 2) {
    const v = toPx(parts[0]);
    const h = toPx(parts[1]);
    out.top = out.bottom = v;
    out.left = out.right = h;
  } else if (parts.length === 3) {
    out.top = toPx(parts[0]);
    out.left = out.right = toPx(parts[1]);
    out.bottom = toPx(parts[2]);
  } else if (parts.length >= 4) {
    out.top = toPx(parts[0]);
    out.right = toPx(parts[1]);
    out.bottom = toPx(parts[2]);
    out.left = toPx(parts[3]);
  }

  if (styles['margin-top'] != null) out.top = toPx(styles['margin-top']);
  if (styles['margin-bottom'] != null) out.bottom = toPx(styles['margin-bottom']);
  if (styles['margin-left'] != null) out.left = toPx(styles['margin-left']);
  if (styles['margin-right'] != null) out.right = toPx(styles['margin-right']);

  return out;
}

async function makePdf(json, outputPath = 'output.pdf', options = {}) {
  const bodyMargins = parseMarginBox(json?.styles, 8);
  const minMargins = {
    top: 6,
    right: 0,
    bottom: 0,
    left: 0,
  }; // keep a small inset even when CSS margins are zero

  const doc = new PDFDocument({
    autoFirstPage: true,
    size: 'A4',
    // Drive page margins from body styles when provided; fall back to small defaults.
    margins: options.margins || {
      top: Math.max(minMargins.top, bodyMargins.top ?? minMargins.top),
      right: Math.max(minMargins.right, bodyMargins.right ?? minMargins.right),
      bottom: Math.max(minMargins.bottom, bodyMargins.bottom ?? minMargins.bottom),
      left: Math.max(minMargins.left, bodyMargins.left ?? minMargins.left),
    },
  });
  doc.pipe(fs.createWriteStream(outputPath));

  const layout = new Layout(doc, { margins: doc.page.margins });
  await renderNode(json, { doc, layout });

  doc.end();
  return outputPath;
}

module.exports = { makePdf };
