const fs = require('fs');
const path = require('path');
const { mergeStyles, styleNumber, styleColor, parsePx, textAlign } = require('../pdf/style');
const { Resvg } = require('@resvg/resvg-js');

function borderInfo(styles) {
  const border = styles.border ? String(styles.border) : '';
  const borderWidth = styleNumber(styles, 'border-width', null) ?? (border ? parsePx(border.split(/\s+/)[0], 0) : 0);

  let borderStyle = styles['border-style'] ? String(styles['border-style']).toLowerCase() : '';
  if (!borderStyle && border) {
    const styleToken = border
      .split(/\s+/)
      .map((p) => p.toLowerCase())
      .find((p) => ['none', 'solid', 'dashed', 'dotted', 'double'].includes(p));
    if (styleToken) borderStyle = styleToken;
  }
  if (!borderStyle && borderWidth > 0) borderStyle = 'solid';

  let borderColor = styleColor(styles, 'border-color', null);
  if (!borderColor && border) {
    const colorToken = border.split(/\s+/).find((p) => p.startsWith('#') || p.startsWith('rgb'));
    if (colorToken) borderColor = styleColor({ color: colorToken }, 'color', null);
  }

  const hasBorder = borderWidth > 0 && !['none', 'hidden'].includes(borderStyle || '');
  return {
    width: hasBorder ? borderWidth : 0,
    color: hasBorder ? borderColor || '#000000' : null,
  };
}

async function renderImage(node, ctx) {
  const { doc, layout } = ctx;
  const measureOnly = !!ctx?.measureOnly;
  const ignoreInvalid = !!ctx?.options?.ignoreInvalidImages;
  const styles = mergeStyles(node);
  let width = styleNumber(styles, 'width', null);
  let height = styleNumber(styles, 'height', null);
  const attrWidth = parseAttrLength(node.attrs?.width);
  const attrHeight = parseAttrLength(node.attrs?.height);

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
  const debug = process.env.HTML_TO_PDF_DEBUG === '1';
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
      if (isBase64) {
        payload = payload.replace(/\s+/g, '');
      } else if (!mime.includes('svg')) {
        payload = payload.replace(/\s+/g, '');
      }

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
    if (debug) {
      console.log('[image-open]', {
        src: src.slice(0, 64),
        mime: src.startsWith('data:') ? src.slice(5, src.indexOf(',')) : 'file/http',
        bufLen: buf ? buf.length : 0,
        intrinsicWidth,
        intrinsicHeight,
      });
    }
  } catch {}

  const maxW = layout.contentWidth();
  const maxH = Number.isFinite(styleNumber(styles, 'max-height', Infinity))
    ? styleNumber(styles, 'max-height', Infinity)
    : Infinity;
  const minW = styleNumber(styles, 'min-width', 0);
  const minH = styleNumber(styles, 'min-height', 0);
  const maxWidthStyle = styleNumber(styles, 'max-width', widthSpecified ? Infinity : maxW);
  const PX_TO_PT = 72 / 96;
  const intrinsicWidthPt = intrinsicWidth ? intrinsicWidth * PX_TO_PT : null;
  const intrinsicHeightPt = intrinsicHeight ? intrinsicHeight * PX_TO_PT : null;

  const aspect =
    widthSpecified && heightSpecified
      ? width / height
      : attrWidth && attrHeight
      ? attrWidth / attrHeight
      : intrinsicWidthPt && intrinsicHeightPt
      ? intrinsicWidthPt / intrinsicHeightPt
      : null;

  if (!width && !height) {
    const fallback = 400 * PX_TO_PT;
    width = Math.min(intrinsicWidthPt || fallback, maxW);
    height = aspect ? width / aspect : intrinsicHeightPt ? intrinsicHeightPt * (width / intrinsicWidthPt) : width * 0.6;
  } else if (width && !height && aspect) {
    height = width / aspect;
  } else if (height && !width && aspect) {
    width = height * aspect;
  }

  if (!width) width = Math.min(maxW, 300 * PX_TO_PT);
  if (!height) height = aspect ? width / aspect : width * 0.6;

  width = Math.max(minW, Math.min(width, maxWidthStyle));
  height = Math.max(minH, Math.min(height, maxH));

  if (width > maxW && maxW > 0) {
    const scale = maxW / width;
    width = maxW;
    height = height * scale;
  }
  if (height > maxH && Number.isFinite(maxH)) {
    const scale = maxH / height;
    height = maxH;
    width = width * scale;
  }

  if (debug) {
    console.log('[image-size]', {
      src: src.slice(0, 64),
      width,
      height,
      maxW,
      maxH,
      widthSpecified,
      heightSpecified,
    });
  }

  const border = borderInfo(styles);
  const totalWidth = width + border.width * 2;
  const totalHeight = height + border.width * 2;

  const estimatedH = totalHeight || (totalWidth ? totalWidth * 0.5 : 120);
  layout.ensureSpace(estimatedH + 6);

  const align = textAlign(styles);
  let x = layout.x;
  if (align === 'center') x = layout.x + (layout.contentWidth() - totalWidth) / 2;
  else if (align === 'right') x = layout.x + layout.contentWidth() - totalWidth;

  if (!measureOnly) {
    try {
      const objectFit = String(styles['object-fit'] || '').toLowerCase();
      const imgX = x + border.width;
      const imgY = layout.y + border.width;
      if (border.width > 0 && border.color) {
        const inset = border.width / 2;
        doc
          .save()
          .lineWidth(border.width)
          .strokeColor(border.color)
          .rect(x + inset, layout.y + inset, totalWidth - border.width, totalHeight - border.width)
          .stroke()
          .restore();
      }
      if (objectFit === 'cover') {
        doc
          .save()
          .rect(imgX, imgY, width, height)
          .clip()
          .image(buf, imgX, imgY, { cover: [width, height], align: 'center', valign: 'center' })
          .restore();
      } else if (objectFit === 'contain') {
        doc
          .save()
          .rect(imgX, imgY, width, height)
          .clip()
          .image(buf, imgX, imgY, { fit: [width, height], align: 'center', valign: 'center' })
          .restore();
      } else {
        doc.image(buf, imgX, imgY, { width, height });
      }
    } catch (err) {
      if (!ignoreInvalid) throw err;
      return;
    }
  }

  layout.cursorToNextLine(totalHeight);
}

function parseAttrLength(value) {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value * (72 / 96);
  const str = String(value).trim();
  if (!str) return null;
  if (/^-?\d+(\.\d+)?$/.test(str)) return parseFloat(str) * (72 / 96);
  return parsePx(str, null);
}

module.exports = { renderImage };
