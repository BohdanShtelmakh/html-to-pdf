const BASE_PT = 13; // Browser-like base font size
const BODY_LH = 1.5;
const em = (n, base = BASE_PT) => n * base;
const PX_PER_IN = 72; // pdfkit uses points; treat px/pt equivalently here.

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
    case 'div':
    case 'body':
    case 'root':
      return { size: BASE_PT, mt: 0, mb: 0, lh: BODY_LH, bold: false };
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

function parseMarginShorthand(val, fallbackTop, fallbackBottom) {
  if (!val) return { top: fallbackTop, bottom: fallbackBottom };
  const parts = String(val)
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return { top: fallbackTop, bottom: fallbackBottom };
  const nums = parts.map((p) => parsePx(p, null)).filter((n) => n != null);
  if (!nums.length) return { top: fallbackTop, bottom: fallbackBottom };
  if (nums.length === 1) return { top: nums[0], bottom: nums[0] };
  if (nums.length === 2) return { top: nums[0], bottom: nums[0] };
  if (nums.length === 3) return { top: nums[0], bottom: nums[2] };
  return { top: nums[0], bottom: nums[2] };
}

function defaultLineHeightFor(tag) {
  return tagDefaults(tag).lh;
}

function computedMargins(styles, tag) {
  const d = defaultMarginsFor(tag);
  const marginFromShorthand = parseMarginShorthand(styles.margin, d.mt, d.mb);
  const mt = styles['margin-top'] != null ? parsePx(styles['margin-top'], d.mt) : marginFromShorthand.top;
  const mb = styles['margin-bottom'] != null ? parsePx(styles['margin-bottom'], d.mb) : marginFromShorthand.bottom;
  return { mt, mb };
}

function parsePx(val, fallback = 0) {
  return parsePxWithOptions(val, fallback, { base: BASE_PT });
}

/** Parse lengths with basic units into pdf points. Supports px/pt/in/cm/mm/em/rem/% (with optional bases). */
function parsePxWithOptions(val, fallback = 0, { base = BASE_PT, percentBase = null } = {}) {
  if (val == null) return fallback;
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  const s = String(val).trim();
  if (!s) return fallback;

  const unitMatch = s.match(/^(-?\d+(\.\d+)?)(px|pt|in|cm|mm|em|rem|%)$/i);
  if (unitMatch) {
    const num = parseFloat(unitMatch[1]);
    const unit = unitMatch[3].toLowerCase();
    switch (unit) {
      case 'px':
      case 'pt':
        return num;
      case 'in':
        return num * PX_PER_IN;
      case 'cm':
        return num * (PX_PER_IN / 2.54);
      case 'mm':
        return num * (PX_PER_IN / 25.4);
      case 'em':
        return num * base;
      case 'rem':
        return num * BASE_PT;
      case '%': {
        if (percentBase != null) return (num / 100) * percentBase;
        return fallback;
      }
      default:
        return fallback;
    }
  }

  const num = parseFloat(s);
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

function styleNumber(styles, key, fallback, opts = {}) {
  return parsePxWithOptions(styles[key], fallback, { base: opts.baseSize ?? BASE_PT, percentBase: opts.percentBase ?? null });
}

function styleColor(styles, key, fallback) {
  return parseColor(styles[key], fallback);
}

function textAlign(styles) {
  const v = (styles['text-align'] || '').toLowerCase();
  return ['left', 'right', 'center', 'justify'].includes(v) ? v : 'left';
}

function lineHeightValue(styles, fontSize, tag) {
  const raw = styles['line-height'];
  if (raw == null) return fontSize * defaultLineHeightFor(tag);
  const str = String(raw).trim();
  if (!str) return fontSize * defaultLineHeightFor(tag);
  // Unitless => multiplier
  if (/^-?\d+(\.\d+)?$/.test(str)) {
    const num = parseFloat(str);
    return num > 0 && num < 10 ? fontSize * num : num;
  }
  // With unit
  return parsePxWithOptions(str, fontSize * defaultLineHeightFor(tag), { base: fontSize });
}

function lineGapFor(size, styles, tag) {
  const lh = lineHeightValue(styles, size, tag);
  return Math.max(0, lh - size);
}

function textDecorations(styles) {
  const val = (styles['text-decoration'] || styles['text-decoration-line'] || '').toLowerCase();
  const parts = val.split(/\s+/).filter(Boolean);
  return {
    underline: parts.includes('underline'),
    lineThrough: parts.includes('line-through') || parts.includes('strike') || parts.includes('strikethrough'),
  };
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
  parsePxWithOptions,
  parseColor,
  mergeStyles,
  styleNumber,
  styleColor,
  textAlign,
  lineGapFor,
  lineHeightValue,
  textDecorations,
  parseMarginShorthand,
};
