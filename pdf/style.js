const BASE_PT = 13; // Browser-like base font size
const BODY_LH = 1.5;
const em = (n, base = BASE_PT) => n * base;

function tagDefaults(tag) {
  switch ((tag || '').toLowerCase()) {
    case 'h1':
      return { size: em(2), mt: em(0.67), mb: em(0.67), lh: 1.2, bold: true };
    case 'h2':
      return { size: em(1.5), mt: em(0.83), mb: em(0.83), lh: 1.25, bold: true };
    case 'h3':
      return { size: em(1.17), mt: em(1), mb: em(1), lh: 1.3, bold: true };
    case 'h4':
      return { size: em(1), mt: em(1.33), mb: em(1.33), lh: 1.35, bold: true };
    case 'h5':
      return { size: em(0.83), mt: em(1.67), mb: em(1.67), lh: 1.4, bold: true };
    case 'h6':
      return { size: em(0.75), mt: em(2), mb: em(2), lh: 1.45, bold: true };
    case 'p':
      return { size: BASE_PT, mt: em(1), mb: em(1), lh: BODY_LH, bold: false };
    case 'pre':
    case 'code':
      return { size: em(0.92), mt: em(1), mb: em(1), lh: 1.35, bold: false };
    case 'ul':
    case 'ol':
      return { size: BASE_PT, mt: 0, mb: em(1), lh: BODY_LH, bold: false };
    case 'table':
      return { size: BASE_PT, mt: em(1), mb: em(1), lh: BODY_LH, bold: false };
    default:
      return { size: BASE_PT, mt: 0, mb: em(0.6), lh: BODY_LH, bold: false };
  }
}

function defaultFontSizeFor(tag) {
  return tagDefaults(tag).size;
}

function defaultMarginsFor(tag) {
  const d = tagDefaults(tag);
  return { mt: d.mt, mb: d.mb };
}

function defaultLineHeightFor(tag) {
  return tagDefaults(tag).lh;
}

function computedMargins(styles, tag) {
  const d = defaultMarginsFor(tag);
  const mt = styles['margin-top'] != null ? parsePx(styles['margin-top'], d.mt) : d.mt;
  const mb = styles['margin-bottom'] != null ? parsePx(styles['margin-bottom'], d.mb) : d.mb;
  return { mt, mb };
}

function parsePx(val, fallback = 0) {
  if (val == null) return fallback;
  if (typeof val === 'number') return val;
  const m = String(val)
    .trim()
    .match(/^(-?\d+(\.\d+)?)px$/i);
  if (m) return parseFloat(m[1]);
  const num = parseFloat(val);
  return Number.isFinite(num) ? num : fallback;
}

function parseColor(val, fallback = '#000000') {
  if (!val || typeof val !== 'string') return fallback;
  const s = val.trim().toLowerCase();
  if (s === 'gray' || s === 'grey') return '#808080';
  return s;
}

function mergeStyles(node) {
  const styles = { ...(node.styles || {}) };
  if (node.attrs && typeof node.attrs.style === 'string') {
    node.attrs.style.split(';').forEach((decl) => {
      const [prop, v] = decl.split(':');
      if (prop && v) styles[prop.trim()] = v.trim();
    });
  }
  return styles;
}

function styleNumber(styles, key, fallback) {
  return parsePx(styles[key], fallback);
}

function styleColor(styles, key, fallback) {
  return parseColor(styles[key], fallback);
}

function textAlign(styles) {
  const v = (styles['text-align'] || '').toLowerCase();
  return ['left', 'right', 'center', 'justify'].includes(v) ? v : 'left';
}

function lineGapFor(size, styles, tag) {
  const lh = styles['line-height'] ? parseFloat(String(styles['line-height'])) : defaultLineHeightFor(tag);
  return Math.max(0, size * (lh - 1));
}

module.exports = {
  BASE_PT,
  BODY_LH,
  em,
  defaultFontSizeFor,
  defaultMarginsFor,
  defaultLineHeightFor,
  computedMargins,
  parsePx,
  parseColor,
  mergeStyles,
  styleNumber,
  styleColor,
  textAlign,
  lineGapFor,
};
