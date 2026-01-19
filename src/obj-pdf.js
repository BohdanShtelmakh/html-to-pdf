const fs = require('fs');
const PDFDocument = require('pdfkit');
const { Layout } = require('./pdf/layout');
const { renderNode } = require('./pdf/render-node');
const { parsePxWithOptions } = require('./pdf/style');
const { resolveSystemFonts } = require('./fonts');

function registerFonts(doc, fonts = {}) {
  const sansRegular = fonts.sansRegular;
  const sansBold = fonts.sansBold;
  const sansItalic = fonts.sansItalic;
  const sansBoldItalic = fonts.sansBoldItalic;
  const serifRegular = fonts.serifRegular;
  const serifBold = fonts.serifBold;
  const serifItalic = fonts.serifItalic;
  const serifBoldItalic = fonts.serifBoldItalic;

  const map = { sans: {}, serif: {} };
  let hasSans = false;
  let hasSerif = false;

  if (sansRegular) {
    doc.registerFont('CustomSans', sansRegular);
    map.sans.regular = 'CustomSans';
    hasSans = true;
  }
  if (sansBold) {
    doc.registerFont('CustomSans-Bold', sansBold);
    map.sans.bold = 'CustomSans-Bold';
    hasSans = true;
  }
  if (sansItalic) {
    doc.registerFont('CustomSans-Italic', sansItalic);
    map.sans.italic = 'CustomSans-Italic';
    hasSans = true;
  }
  if (sansBoldItalic) {
    doc.registerFont('CustomSans-BoldItalic', sansBoldItalic);
    map.sans.boldItalic = 'CustomSans-BoldItalic';
    hasSans = true;
  }

  if (serifRegular) {
    doc.registerFont('CustomSerif', serifRegular);
    map.serif.regular = 'CustomSerif';
    hasSerif = true;
  }
  if (serifBold) {
    doc.registerFont('CustomSerif-Bold', serifBold);
    map.serif.bold = 'CustomSerif-Bold';
    hasSerif = true;
  }
  if (serifItalic) {
    doc.registerFont('CustomSerif-Italic', serifItalic);
    map.serif.italic = 'CustomSerif-Italic';
    hasSerif = true;
  }
  if (serifBoldItalic) {
    doc.registerFont('CustomSerif-BoldItalic', serifBoldItalic);
    map.serif.boldItalic = 'CustomSerif-BoldItalic';
    hasSerif = true;
  }

  if (hasSans || hasSerif) {
    if (hasSans && !map.sans.bold) map.sans.bold = map.sans.regular;
    if (hasSans && !map.sans.italic) map.sans.italic = map.sans.regular;
    if (hasSans && !map.sans.boldItalic) map.sans.boldItalic = map.sans.bold || map.sans.italic;
    if (hasSerif && !map.serif.bold) map.serif.bold = map.serif.regular;
    if (hasSerif && !map.serif.italic) map.serif.italic = map.serif.regular;
    if (hasSerif && !map.serif.boldItalic) map.serif.boldItalic = map.serif.bold || map.serif.italic;
    doc._fontMap = map;
  }
}

function parseFontFamilies(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((part) => part.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

function collectFontFamilies(node, out) {
  if (!node) return;
  if (node.styles && node.styles['font-family']) {
    parseFontFamilies(node.styles['font-family']).forEach((f) => out.add(f));
  }
  if (node.children) {
    node.children.forEach((child) => collectFontFamilies(child, out));
  }
}

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

function hasMarginStyles(styles) {
  if (!styles) return false;
  return (
    styles.margin != null ||
    styles['margin-top'] != null ||
    styles['margin-right'] != null ||
    styles['margin-bottom'] != null ||
    styles['margin-left'] != null
  );
}

async function makePdf(json, options = {}) {
  const defaultBodyMargin = parsePxWithOptions('8px', 8);
  const bodyMargins = parseMarginBox(json?.styles, defaultBodyMargin);
  const pageMargins = hasMarginStyles(json?.page) ? parseMarginBox(json.page, 0) : null;
  const effectiveMargins = pageMargins
    ? {
        top: pageMargins.top + bodyMargins.top,
        right: pageMargins.right + bodyMargins.right,
        bottom: pageMargins.bottom + bodyMargins.bottom,
        left: pageMargins.left + bodyMargins.left,
      }
    : bodyMargins;
  const minMargins = {
    top: 6,
    right: 0,
    bottom: 0,
    left: 0,
  };
  const buffers = [];
  const doc = new PDFDocument({
    autoFirstPage: true,
    size: 'A4',
    margins: options.margins || {
      top: Math.max(minMargins.top, effectiveMargins.top ?? minMargins.top),
      right: Math.max(minMargins.right, effectiveMargins.right ?? minMargins.right),
      bottom: Math.max(minMargins.bottom, effectiveMargins.bottom ?? minMargins.bottom),
      left: Math.max(minMargins.left, effectiveMargins.left ?? minMargins.left),
    },
  });
  doc.on('data', (data) => {
    buffers.push(data);
  });
  const outputStream = options.outputPath ? fs.createWriteStream(options.outputPath) : null;
  if (outputStream) {
    doc.pipe(outputStream);
  }

  const autoResolve = options.autoResolveFonts !== false;
  const requestedFonts = options.fonts || {};
  const familySet = new Set();
  collectFontFamilies(json, familySet);
  const familyNames = Array.from(familySet);

  const hasAllDefaults =
    !!requestedFonts.sansRegular &&
    !!requestedFonts.sansBold &&
    !!requestedFonts.sansItalic &&
    !!requestedFonts.sansBoldItalic &&
    !!requestedFonts.serifRegular &&
    !!requestedFonts.serifBold &&
    !!requestedFonts.serifItalic &&
    !!requestedFonts.serifBoldItalic;

  const resolved = autoResolve && !hasAllDefaults
    ? resolveSystemFonts(requestedFonts, familyNames)
    : { fonts: requestedFonts, familyMap: {} };
  const fontPayload = autoResolve ? resolved.fonts : requestedFonts;
  const familyMap = autoResolve ? resolved.familyMap : {};

  if (process.env.HTML_TO_PDF_DEBUG_FONTS === '1') {
    console.log('[font-resolve]', {
      autoResolve,
      requestedFonts,
      effectiveFonts: fontPayload,
      families: familyNames,
      familyMap,
    });
  }

  if (familyMap && Object.keys(familyMap).length) doc._fontFamilyMap = familyMap;
  registerFonts(doc, fontPayload);

  const layout = new Layout(doc, { margins: doc.page.margins });
  await renderNode(json, { doc, layout, options });
  const docDone = new Promise((resolve, reject) => {
    doc.on('end', resolve);
    doc.on('error', reject);
  });
  const streamDone = outputStream
    ? new Promise((resolve, reject) => {
        outputStream.on('finish', resolve);
        outputStream.on('error', reject);
      })
    : Promise.resolve();
  doc.end();
  await Promise.all([docDone, streamDone]);
  return Buffer.concat(buffers);
}

module.exports = { makePdf };
