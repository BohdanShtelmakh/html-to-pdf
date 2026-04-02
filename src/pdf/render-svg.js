const { Resvg } = require('@resvg/resvg-js');
const { PX_TO_PT, mergeStyles, styleNumber, styleColor, textAlign, parsePx } = require('./style');

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeSvgAttrName(name) {
  const key = String(name || '');
  const lower = key.toLowerCase();
  const map = {
    viewbox: 'viewBox',
    preserveaspectratio: 'preserveAspectRatio',
    gradientunits: 'gradientUnits',
    gradienttransform: 'gradientTransform',
    spreadmethod: 'spreadMethod',
    patternunits: 'patternUnits',
    patterncontentunits: 'patternContentUnits',
    patterntransform: 'patternTransform',
    clippathunits: 'clipPathUnits',
  };
  return map[lower] || key;
}

function normalizeSvgTagName(tag) {
  const key = String(tag || '');
  const lower = key.toLowerCase();
  const map = {
    lineargradient: 'linearGradient',
    radialgradient: 'radialGradient',
    clippath: 'clipPath',
    foreignobject: 'foreignObject',
    textpath: 'textPath',
  };
  return map[lower] || key;
}

function serializeSvg(node, inSvg = false) {
  if (!node) return '';
  if (node.type === 'text') return escapeXml(node.text || '');
  if (node.type !== 'element') return '';
  const rawTag = node.tag || '';
  const nextInSvg = inSvg || rawTag.toLowerCase() === 'svg';
  const tag = nextInSvg ? normalizeSvgTagName(rawTag) : rawTag;
  const attrs = node.attrs || {};
  const attrEntries = Object.entries(attrs).map(([k, v]) => [nextInSvg ? normalizeSvgAttrName(k) : k, v]);
  if (tag.toLowerCase() === 'svg' && !('xmlns' in attrs)) {
    attrEntries.push(['xmlns', 'http://www.w3.org/2000/svg']);
  }
  const attrString = attrEntries.map(([k, v]) => `${k}="${escapeXml(v)}"`).join(' ');
  const open = attrString ? `<${tag} ${attrString}>` : `<${tag}>`;
  const children = (node.children || []).map((child) => serializeSvg(child, nextInSvg)).join('');
  return `${open}${children}</${tag}>`;
}

function parseViewBox(viewBox) {
  if (!viewBox) return null;
  const parts = String(viewBox)
    .trim()
    .split(/[\s,]+/)
    .map((p) => parseFloat(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  return { w: parts[2], h: parts[3] };
}

function parseAttrDimension(value) {
  if (value == null) return null;
  const parsed = parsePx(value, null);
  if (parsed != null) return parsed;
  const num = parseFloat(String(value).trim());
  if (!Number.isFinite(num)) return null;
  return num * PX_TO_PT;
}

async function renderInlineSvg(node, ctx) {
  const { doc, layout } = ctx;
  const measureOnly = !!ctx?.measureOnly;
  const ignoreInvalid = !!ctx?.options?.ignoreInvalidImages;
  const styles = mergeStyles(node);
  const borderWidth = styleNumber(styles, 'border-width', 0);
  const borderStyle = String(styles['border-style'] || '')
    .trim()
    .toLowerCase();
  const borderColor = styleColor(styles, 'border-color', '#333333');
  const borderPaint = ['none', 'transparent'].includes(String(borderColor).trim().toLowerCase()) ? null : borderColor;
  const hasBorder = borderWidth > 0 && borderPaint && !['none', 'hidden'].includes(borderStyle);
  let width = styleNumber(styles, 'width', null, { percentBase: layout.contentWidth() });
  let height = styleNumber(styles, 'height', null);
  const attrWidth = parseAttrDimension(node.attrs?.width);
  const attrHeight = parseAttrDimension(node.attrs?.height);

  if (width == null && attrWidth != null) width = attrWidth;
  if (height == null && attrHeight != null) height = attrHeight;

  const viewBox = parseViewBox(node.attrs?.viewBox);
  const aspect = width && height ? width / height : viewBox ? viewBox.w / viewBox.h : null;

  const maxW = layout.contentWidth();
  const maxH = Number.isFinite(styleNumber(styles, 'max-height', Infinity))
    ? styleNumber(styles, 'max-height', Infinity)
    : Infinity;
  const minW = styleNumber(styles, 'min-width', 0);
  const minH = styleNumber(styles, 'min-height', 0);
  const widthSpecified = width != null;
  const heightSpecified = height != null;
  const maxWidthStyle = styleNumber(styles, 'max-width', widthSpecified ? Infinity : maxW);

  if (!width && !height) {
    if (viewBox) {
      width = Math.min(maxW, viewBox.w * PX_TO_PT);
      height = aspect ? width / aspect : width * 0.6;
    } else {
      width = Math.min(maxW, 400 * PX_TO_PT);
      height = width * 0.6;
    }
  } else if (width && !height && aspect) {
    height = width / aspect;
  } else if (height && !width && aspect) {
    width = height * aspect;
  }

  if (!width) width = Math.min(maxW, 300 * PX_TO_PT);
  if (!height) height = aspect ? width / aspect : width * 0.6;

  width = Math.max(minW, Math.min(width, maxWidthStyle));
  height = Math.max(minH, Math.min(height, maxH));

  const shouldCapToContent = !(widthSpecified && heightSpecified);
  if (shouldCapToContent && width > maxW) {
    const scale = maxW / width;
    width = maxW;
    height = height * scale;
  }

  const svgScale = Number.isFinite(ctx?.options?.svgScale) ? ctx.options.svgScale : 2;
  const svgDpi = Number.isFinite(ctx?.options?.svgDpi) ? ctx.options.svgDpi : 72;
  const renderScale = svgScale > 0 ? svgScale : 1;
  const widthPx = Math.max(1, Math.round((width / PX_TO_PT) * renderScale));
  const heightPx = Math.max(1, Math.round((height / PX_TO_PT) * renderScale));
  const svgText = serializeSvg(node);
  if (process.env.HTML_TO_PDF_DEBUG_SVG) {
    const fs = require('fs');
    const debugPath = process.env.HTML_TO_PDF_DEBUG_SVG;
    fs.writeFileSync(debugPath, svgText);
  }

  let buf;
  if (!measureOnly) {
    try {
      const fitTo =
        widthPx > 0
          ? { mode: 'width', value: widthPx }
          : heightPx > 0
          ? { mode: 'height', value: heightPx }
          : undefined;
      const resvg = new Resvg(svgText, {
        imageRendering: 0,
        textRendering: 2,
        shapeRendering: 2,
        dpi: svgDpi,
        ...(fitTo ? { fitTo } : undefined),
      });
      buf = Buffer.from(resvg.render().asPng());
    } catch (err) {
      if (!ignoreInvalid) console.error('Inline SVG render failed:', err.message || err);
      return;
    }
  }

  const totalWidth = width + (hasBorder ? borderWidth * 2 : 0);
  const totalHeight = height + (hasBorder ? borderWidth * 2 : 0);
  layout.ensureSpace(totalHeight);
  const align = textAlign(styles);
  let x = layout.x;
  if (align === 'center') x = layout.x + (layout.contentWidth() - totalWidth) / 2;
  else if (align === 'right') x = layout.x + layout.contentWidth() - totalWidth;

  if (!measureOnly) {
    try {
      const imgX = x + (hasBorder ? borderWidth : 0);
      const imgY = layout.y + (hasBorder ? borderWidth : 0);
      if (hasBorder) {
        const inset = borderWidth / 2;
        doc.save().lineWidth(borderWidth).strokeColor(borderPaint);
        if (borderStyle === 'dashed') {
          doc.dash(borderWidth * 2, { space: borderWidth * 2 });
        } else if (borderStyle === 'dotted') {
          doc.dash(borderWidth, { space: borderWidth });
        }
        doc.rect(x + inset, layout.y + inset, totalWidth - borderWidth, totalHeight - borderWidth).stroke();
        doc.undash().restore();
      }
      doc.image(buf, imgX, imgY, { width, height });
    } catch (err) {
      if (!ignoreInvalid) throw err;
      return;
    }
  }

  layout.cursorToNextLine(totalHeight);
}

module.exports = { renderInlineSvg, serializeSvg, parseViewBox, parseAttrDimension };
