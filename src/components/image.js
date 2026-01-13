const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { mergeStyles, styleNumber, parsePx, textAlign } = require('../pdf/style');

async function renderImage(node, ctx) {
  const { doc, layout } = ctx;
  const styles = mergeStyles(node);
  let width = styleNumber(styles, 'width', null);
  let height = styleNumber(styles, 'height', null);
  const attrWidth = parsePx(node.attrs?.width, null);
  const attrHeight = parsePx(node.attrs?.height, null);

  if ((!width || !height) && node.attrs && typeof node.attrs.style === 'string') {
    const map = {};
    node.attrs.style.split(';').forEach((d) => {
      const [k, v] = d.split(':');
      if (k && v) map[k.trim()] = v.trim();
    });
    if (!width && map.width) width = parsePx(map.width, null);
    if (!height && map.height) height = parsePx(map.height, null);
  }
  if (!width && attrWidth != null) width = attrWidth;
  if (!height && attrHeight != null) height = attrHeight;

  const widthSpecified = width != null;
  const heightSpecified = height != null;

  const src = node.attrs?.src;
  if (!src) return;

  let buf;
  try {
    if (/^https?:\/\//i.test(src)) {
      const res = await axios.get(src, { responseType: 'arraybuffer' });
      buf = Buffer.from(res.data);
    } else {
      const localPath = path.isAbsolute(src) ? src : path.resolve(process.cwd(), src);
      buf = fs.readFileSync(localPath);
    }
  } catch (err) {
    console.error(`Image load failed for ${src}:`, err.message || err);
    return;
  }

  let intrinsicWidth = null;
  let intrinsicHeight = null;
  try {
    const img = doc.openImage(buf);
    intrinsicWidth = img?.width || null;
    intrinsicHeight = img?.height || null;
  } catch {}

  const maxW = layout.contentWidth();
  const maxH = Number.isFinite(styleNumber(styles, 'max-height', Infinity))
    ? styleNumber(styles, 'max-height', Infinity)
    : Infinity;
  const minW = styleNumber(styles, 'min-width', 0);
  const minH = styleNumber(styles, 'min-height', 0);
  const maxWidthStyle = styleNumber(styles, 'max-width', widthSpecified ? Infinity : maxW);

  const aspect =
    widthSpecified && heightSpecified
      ? width / height
      : attrWidth && attrHeight
      ? attrWidth / attrHeight
      : intrinsicWidth && intrinsicHeight
      ? intrinsicWidth / intrinsicHeight
      : null;

  if (!width && !height) {
    width = Math.min(intrinsicWidth || 400, maxW);
    height = aspect ? width / aspect : intrinsicHeight ? intrinsicHeight * (width / intrinsicWidth) : width * 0.6;
  } else if (width && !height && aspect) {
    height = width / aspect;
  } else if (height && !width && aspect) {
    width = height * aspect;
  }

  if (!width) width = Math.min(maxW, 300);
  if (!height) height = aspect ? width / aspect : width * 0.6;

  width = Math.max(minW, Math.min(width, maxWidthStyle));
  height = Math.max(minH, Math.min(height, maxH));

  const shouldCapToContent = !(widthSpecified && heightSpecified);
  if (shouldCapToContent && width > maxW) {
    const scale = maxW / width;
    width = maxW;
    height = height * scale;
  }

  const PX_TO_PT = 72 / 96;
  width *= PX_TO_PT;
  height *= PX_TO_PT;

  const estimatedH = height || (width ? width * 0.5 : 120);
  layout.ensureSpace(estimatedH + 6);

  const align = textAlign(styles);
  let x = layout.x;
  if (align === 'center') x = layout.x + (layout.contentWidth() - width) / 2;
  else if (align === 'right') x = layout.x + layout.contentWidth() - width;

  doc.image(buf, x, layout.y, { width, height });
  layout.cursorToNextLine(height + 4);
}

module.exports = { renderImage };
