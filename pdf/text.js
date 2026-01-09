const { BASE_PT, mergeStyles, styleNumber, lineHeightValue, textDecorations, styleColor } = require('./style');

function selectFontForInline(doc, styles, strong = false, italic = false, sizeOverride = null) {
  const requested = sizeOverride != null ? sizeOverride : styleNumber(styles, 'font-size', BASE_PT);
  const size = requested || BASE_PT;

  const isBold =
    strong ||
    (!!styles['font-weight'] && (String(styles['font-weight']) >= '600' || String(styles['font-weight']).toLowerCase() === 'bold'));
  const isItalic = italic || (styles['font-style'] || '').toLowerCase() === 'italic';

  const family = (styles['font-family'] || '').toLowerCase();
  const wantsSans =
    family.includes('arial') || family.includes('helvetica') || family.includes('sans-serif') || family.includes('sans');

  const custom = doc._fontMap && (wantsSans ? doc._fontMap.sans : doc._fontMap.serif);
  let fontName = wantsSans ? 'Helvetica' : 'Times-Roman';
  if (custom && custom.regular) {
    if (isBold && isItalic && custom.boldItalic) fontName = custom.boldItalic;
    else if (isBold && custom.bold) fontName = custom.bold;
    else if (isItalic && custom.italic) fontName = custom.italic;
    else fontName = custom.regular;
  } else {
    if (isBold && isItalic) fontName = wantsSans ? 'Helvetica-BoldOblique' : 'Times-BoldItalic';
    else if (isBold) fontName = wantsSans ? 'Helvetica-Bold' : 'Times-Bold';
    else if (isItalic) fontName = wantsSans ? 'Helvetica-Oblique' : 'Times-Italic';
  }

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
