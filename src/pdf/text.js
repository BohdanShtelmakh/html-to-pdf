const { BASE_PT, mergeStyles, styleNumber, lineHeightValue, textDecorations, styleColor } = require('./style');
const { normalizeName } = require('../fonts');

const fontDebugCache = new Set();

function parseFontFamilies(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((part) => part.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

function pickFamilyFont(family, map, bold, italic) {
  const entry = map?.[normalizeName(family)];
  if (!entry) return null;
  if (bold && italic) return entry.boldItalic || entry.bold || entry.italic || entry.regular || null;
  if (bold) return entry.bold || entry.regular || entry.boldItalic || entry.italic || null;
  if (italic) return entry.italic || entry.regular || entry.boldItalic || entry.bold || null;
  return entry.regular || entry.bold || entry.italic || entry.boldItalic || null;
}

function selectFontForInline(doc, styles, strong = false, italic = false, sizeOverride = null) {
  const requested = sizeOverride != null ? sizeOverride : styleNumber(styles, 'font-size', BASE_PT);
  const size = requested || BASE_PT;

  const isBold =
    strong ||
    (!!styles['font-weight'] && (String(styles['font-weight']) >= '600' || String(styles['font-weight']).toLowerCase() === 'bold'));
  const isItalic = italic || (styles['font-style'] || '').toLowerCase() === 'italic';

  const families = parseFontFamilies(styles['font-family']);
  if (families.length && doc._fontFamilyMap) {
    for (const family of families) {
      const matched = pickFamilyFont(family, doc._fontFamilyMap, isBold, isItalic);
      if (matched) {
        try {
          doc.font(matched).fontSize(size);
          if (process.env.HTML_TO_PDF_DEBUG_FONTS === '1') {
            const key = `${family}|${isBold ? 'b' : 'n'}${isItalic ? 'i' : 'n'}|${matched}`;
            if (!fontDebugCache.has(key)) {
              fontDebugCache.add(key);
              console.log('[font-pick]', { family, bold: isBold, italic: isItalic, path: matched });
            }
          }
          return;
        } catch {}
      }
    }
  }

  const family = (styles['font-family'] || '').toLowerCase();
  const hasSans = family.includes('sans-serif') || family.includes('sans') || family.includes('arial') || family.includes('helvetica');
  const hasSerif = family.includes('serif') || family.includes('times');
  const wantsSans = hasSans || (family && !hasSerif);
  let fontName = wantsSans ? 'Helvetica' : 'Times-Roman';
  if (isBold && isItalic) fontName = wantsSans ? 'Helvetica-BoldOblique' : 'Times-BoldItalic';
  else if (isBold) fontName = wantsSans ? 'Helvetica-Bold' : 'Times-Bold';
  else if (isItalic) fontName = wantsSans ? 'Helvetica-Oblique' : 'Times-Italic';

  doc.font(fontName).fontSize(size);
}

function inlineRuns(node, parentStyles = {}) {
  const runs = [];

  function walk(n, inherited = { bold: false, italic: false, underline: false, styles: parentStyles }) {
    if (!n) return;

    if (n.type === 'text') {
      runs.push({ text: n.text || '', ...inherited });
      return;
    }
    if (n.type !== 'element') return;

    const tag = (n.tag || '').toLowerCase();
    const styles = { ...inherited.styles, ...mergeStyles(n) };
    const next = { ...inherited, styles };

    if (tag === 'b' || tag === 'strong') next.bold = true;
    if (tag === 'i' || tag === 'em') next.italic = true;
    if (tag === 'u') next.underline = true;

    const deco = textDecorations(styles);
    if (deco.underline) next.underline = true;
    if (deco.lineThrough) next.lineThrough = true;

    const ls = styles['letter-spacing'];
    const ws = styles['word-spacing'];
    if (ls != null) next.letterSpacing = ls;
    if (ws != null) next.wordSpacing = ws;

    (n.children || []).forEach((child) => walk(child, next));
  }

  walk(node);
  return runs;
}

function gatherPlainText(node) {
  let out = '';
  function walk(n) {
    if (!n) return;
    if (n.type === 'text') out += n.text || '';
    else if (n.type === 'element') (n.children || []).forEach(walk);
  }
  walk(node);
  return out;
}

module.exports = { selectFontForInline, inlineRuns, gatherPlainText };
