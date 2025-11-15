const { BASE_PT, mergeStyles, styleNumber } = require('./style');

function selectFontForInline(doc, styles, strong = false, italic = false) {
  const requested = styleNumber(styles, 'font-size', BASE_PT);
  const size = requested || BASE_PT;

  const isBold = strong || (!!styles['font-weight'] && String(styles['font-weight']) >= '600');
  const isItalic = italic || (styles['font-style'] || '').toLowerCase() === 'italic';

  let fontName = 'Times-Roman';
  if (isBold && isItalic) fontName = 'Times-BoldItalic';
  else if (isBold) fontName = 'Times-Bold';
  else if (isItalic) fontName = 'Times-Italic';

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
