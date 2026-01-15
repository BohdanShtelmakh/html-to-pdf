const fs = require('fs');
const path = require('path');
const { mergeStyles, styleNumber, parsePx, textAlign } = require('../pdf/style');
const { Resvg } = require('@resvg/resvg-js');

async function renderImage(node, ctx) {
  const { doc, layout } = ctx;
  const measureOnly = !!ctx?.measureOnly;
  const ignoreInvalid = !!ctx?.options?.ignoreInvalidImages;
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

  const src = node.attrs?.src ? String(node.attrs.src).trim() : null;
  if (!src) return;

  let buf;
  let svgText = null;
  try {
    if (/^data:image\//i.test(src)) {
      const commaIndex = src.indexOf(',');
      if (commaIndex === -1) throw new Error('Invalid data URI');
      const header = src.slice(5, commaIndex);
      let payload = src.slice(commaIndex + 1);
      const parts = header.split(';').filter(Boolean);
      const mime = (parts.shift() || '').toLowerCase();
      const isBase64 = parts.some((p) => p.toLowerCase() === 'base64');

      if (payload.includes('%')) {
        try {
          payload = decodeURIComponent(payload);
        } catch {}
      }
      payload = payload.replace(/\s+/g, '');

      if (mime.includes('svg')) {
        if (isBase64) {
          let normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
          const pad = normalized.length % 4;
          if (pad) normalized += '='.repeat(4 - pad);
          svgText = Buffer.from(normalized, 'base64').toString('utf8');
        } else {
          svgText = payload;
        }
      } else if (isBase64) {
        let normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
        const pad = normalized.length % 4;
        if (pad) normalized += '='.repeat(4 - pad);
        buf = Buffer.from(normalized, 'base64');
      } else {
        buf = Buffer.from(payload, 'binary');
      }

      if (buf) {
        const isPng = buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
        const isJpeg = buf.length > 2 && buf[0] === 0xff && buf[1] === 0xd8;
        if (mime.includes('png') && !isPng) throw new Error('Invalid PNG data');
        if ((mime.includes('jpeg') || mime.includes('jpg')) && !isJpeg) throw new Error('Invalid JPEG data');
      }
    } else if (/^https?:\/\//i.test(src)) {
      const res = await fetch(src);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      if (contentType.includes('image/svg+xml')) {
        svgText = await res.text();
      } else {
        buf = Buffer.from(await res.arrayBuffer());
      }
    } else {
      const localPath = path.isAbsolute(src) ? src : path.resolve(process.cwd(), src);
      if (localPath.toLowerCase().endsWith('.svg')) {
        svgText = fs.readFileSync(localPath, 'utf8');
      } else {
        buf = fs.readFileSync(localPath);
      }
    }
  } catch (err) {
    if (!ignoreInvalid) console.error(`Image load failed for ${src}:`, err.message || err);
    return;
  }

  if (svgText) {
    try {
      const fitTo =
        width != null
          ? { mode: 'width', value: Math.max(1, Math.round(width)) }
          : height != null
          ? { mode: 'height', value: Math.max(1, Math.round(height)) }
          : undefined;
      const resvg = new Resvg(svgText, fitTo ? { fitTo } : undefined);
      const rendered = resvg.render();
      buf = Buffer.from(rendered.asPng());
    } catch (err) {
      if (!ignoreInvalid) console.error(`Image load failed for ${src}:`, err.message || err);
      return;
    }
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

  if (!measureOnly) {
    try {
      doc.image(buf, x, layout.y, { width, height });
    } catch (err) {
      if (!ignoreInvalid) throw err;
      return;
    }
  }

  layout.cursorToNextLine(height + 4);
}

module.exports = { renderImage };
