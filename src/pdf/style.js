const BASE_PT = 12;
const BODY_LH = 1.2;
const em = (n, base = BASE_PT) => n * base;
const PX_PER_IN = 72;
const PX_TO_PT = 72 / 96; // map CSS px to PDF points (browser 96dpi vs PDF 72dpi)

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
      return { size: BASE_PT, mt: 12, mb: 4, lh: BODY_LH, bold: false };
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

function parseMarginShorthand(val, fallbackTop, fallbackBottom, base = BASE_PT) {
  if (!val) return { top: fallbackTop, bottom: fallbackBottom };
  const parts = String(val).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { top: fallbackTop, bottom: fallbackBottom };
  const nums = parts.map((p) => parsePxWithOptions(p, null, { base })).filter((n) => n != null);
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
  const fontSize = styleNumber(styles, 'font-size', defaultFontSizeFor(tag));
  const scale = fontSize / BASE_PT;
  const d = defaultMarginsFor(tag);
  const defaultTop = d.mt * scale;
  const defaultBottom = d.mb * scale;
  const marginFromShorthand = parseMarginShorthand(styles.margin, defaultTop, defaultBottom, fontSize);
  const mt =
    styles['margin-top'] != null
      ? parsePxWithOptions(styles['margin-top'], defaultTop, { base: fontSize })
      : marginFromShorthand.top;
  const mb =
    styles['margin-bottom'] != null
      ? parsePxWithOptions(styles['margin-bottom'], defaultBottom, { base: fontSize })
      : marginFromShorthand.bottom;
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
        return num * PX_TO_PT;
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
  let s = val.trim();
  const lower = s.toLowerCase();
  if (lower === 'gray' || lower === 'grey') return '#808080';

  const rgbMatch = s.match(/^rgba?\((.*)\)$/i);
  if (rgbMatch) {
    let body = rgbMatch[1].trim();
    let alpha = null;
    if (body.includes('/')) {
      const parts = body.split('/');
      body = parts[0].trim();
      alpha = parts[1].trim();
    }
    const comps = body
      .split(/[\s,]+/)
      .map((c) => c.trim())
      .filter(Boolean);
    if (comps.length >= 3) {
      let alphaValue = alpha;
      if (alphaValue == null && comps.length >= 4) alphaValue = comps[3];
      const rgb = comps.slice(0, 3).map((c) => Math.max(0, Math.min(255, parseInt(c, 10) || 0)));
      let alphaOut = null;
      if (alphaValue != null) {
        const alphaStr = String(alphaValue).trim();
        if (alphaStr.endsWith('%')) {
          const pct = parseFloat(alphaStr);
          if (Number.isFinite(pct)) alphaOut = pct / 100;
        } else {
          const num = parseFloat(alphaStr);
          if (Number.isFinite(num)) alphaOut = num;
        }
      }
      if (alphaOut != null && alphaOut <= 0) return 'transparent';
      return `#${rgb.map((n) => n.toString(16).padStart(2, '0')).join('')}`;
    }
  }

  s = lower;
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
  return parsePxWithOptions(styles[key], fallback, {
    base: opts.baseSize ?? BASE_PT,
    percentBase: opts.percentBase ?? null,
  });
}

function styleColor(styles, key, fallback) {
  return parseColor(styles[key], fallback);
}

function textAlign(styles) {
  const v = (styles['text-align'] || '').toLowerCase();
  return ['left', 'right', 'center', 'justify'].includes(v) ? v : 'left';
}

function lineHeightValue(styles, fontSize, tag) {
  const CHROME_LH_FACTOR = 0.82;

  const raw = styles['line-height'];
  if (raw == null) return fontSize * defaultLineHeightFor(tag) * CHROME_LH_FACTOR;

  const str = String(raw).trim();
  if (!str || str.toLowerCase() === 'normal') return fontSize * defaultLineHeightFor(tag) * CHROME_LH_FACTOR;

  if (/^-?\d+(\.\d+)?$/.test(str)) {
    const num = parseFloat(str);
    return num > 0 && num < 10 ? fontSize * num : num;
  }

  return parsePxWithOptions(str, fontSize * defaultLineHeightFor(tag), { base: fontSize, percentBase: fontSize });
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
