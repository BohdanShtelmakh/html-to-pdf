const { renderImage, renderTable } = require('../components');
const { Resvg } = require('@resvg/resvg-js');
const {
  BASE_PT,
  defaultFontSizeFor,
  computedMargins,
  mergeStyles,
  styleColor,
  styleNumber,
  textAlign,
  lineGapFor,
  lineHeightValue,
  parsePx,
  parsePxWithOptions,
} = require('./style');
const { inlineRuns, selectFontForInline, gatherPlainText } = require('./text');
const { renderList, renderPre } = require('./blocks');
const { Layout } = require('./layout');

const PX_TO_PT = 72 / 96;

const INLINE_TAGS = new Set([
  'span',
  'strong',
  'b',
  'em',
  'i',
  'u',
  'label',
  'small',
  'big',
  'sub',
  'sup',
  'code',
  'a',
]);

function isInlineDisplay(tag, styles = {}) {
  const display = String(styles.display || '').toLowerCase();
  if (display === 'inline' || display === 'inline-block') return true;
  return INLINE_TAGS.has(tag);
}

function shouldCollapseWhitespace(styles) {
  const ws = String(styles['white-space'] || '')
    .trim()
    .toLowerCase();
  return ws !== 'pre' && ws !== 'pre-wrap';
}

function normalizeRuns(runs, collapse) {
  if (!collapse) return runs;
  const out = [];
  let prevSpace = false;
  for (const run of runs) {
    let text = run.text || '';
    text = text.replace(/\s+/g, ' ');
    if (prevSpace) text = text.replace(/^ /, '');
    if (!text) continue;
    prevSpace = text.endsWith(' ');
    out.push({ ...run, text });
  }
  if (out.length) {
    out[out.length - 1].text = out[out.length - 1].text.replace(/ $/, '');
  }
  return out;
}

function isInlineOnly(node) {
  if (!node || !node.children) return false;
  return (node.children || []).every((child) => {
    if (child.type === 'text') return true;
    if (child.type === 'element') {
      const tag = (child.tag || '').toLowerCase();
      const styles = mergeStyles(child);
      return isInlineDisplay(tag, styles) && isInlineOnly(child);
    }
    return false;
  });
}

function elementChildren(node) {
  return (node.children || []).filter((child) => child.type === 'element');
}

function applyPageBreakAfter(styles, ctx, node) {
  if (!styles || ctx?.measureOnly) return;
  const value = String(styles['page-break-after'] || '').trim().toLowerCase();
  const isLast = !!node?._isLastInParent;
  const parentTag = String(node?._parentTag || '').toLowerCase();
  if (value === 'always' && !(isLast && (parentTag === 'body' || parentTag === 'root'))) {
    ctx.layout.doc.addPage();
    ctx.layout.x = ctx.layout.marginLeft;
    ctx.layout.y = ctx.layout.marginTop;
    ctx.layout.pendingBottomMargin = 0;
    ctx.layout.atStartOfPage = true;
  }
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function serializeSvg(node) {
  if (!node) return '';
  if (node.type === 'text') return escapeXml(node.text || '');
  if (node.type !== 'element') return '';
  const tag = node.tag || '';
  const attrs = node.attrs || {};
  const attrString = Object.entries(attrs)
    .map(([k, v]) => `${k}="${escapeXml(v)}"`)
    .join(' ');
  const open = attrString ? `<${tag} ${attrString}>` : `<${tag}>`;
  const children = (node.children || []).map(serializeSvg).join('');
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

function parseGridColumnCount(value) {
  if (!value || typeof value !== 'string') return null;
  const repeatMatch = value.match(/repeat\(\s*(\d+)\s*,/i);
  if (repeatMatch) return parseInt(repeatMatch[1], 10);
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return parts.length || null;
}

function expandRepeatTokens(value) {
  if (!value || typeof value !== 'string') return value;
  return value.replace(/repeat\(\s*(\d+)\s*,\s*([^)]+)\)/gi, (_m, countRaw, inner) => {
    const count = parseInt(countRaw, 10);
    if (!Number.isFinite(count) || count <= 0) return inner;
    const tokens = inner.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return '';
    return Array.from({ length: count }, () => tokens.join(' ')).join(' ');
  });
}

function parseGridTemplateColumns(value, totalWidth, gap) {
  if (!value || typeof value !== 'string') return null;
  const expanded = expandRepeatTokens(value);
  const parts = expanded.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return null;

  const cols = [];
  let fixed = 0;
  let frTotal = 0;

  for (const token of parts) {
    const lower = token.toLowerCase();
    if (lower.endsWith('fr')) {
      const fr = parseFloat(lower.replace('fr', ''));
      const value = Number.isFinite(fr) && fr > 0 ? fr : 1;
      cols.push({ type: 'fr', value });
      frTotal += value;
      continue;
    }
    if (lower === 'auto') {
      cols.push({ type: 'fr', value: 1 });
      frTotal += 1;
      continue;
    }
    const px = parsePxWithOptions(token, null, { percentBase: totalWidth });
    if (px != null) {
      cols.push({ type: 'fixed', value: px });
      fixed += px;
      continue;
    }
    cols.push({ type: 'fr', value: 1 });
    frTotal += 1;
  }

  const gapsTotal = Math.max(0, gap) * Math.max(0, cols.length - 1);
  const remaining = Math.max(0, totalWidth - fixed - gapsTotal);

  return cols.map((col) => {
    if (col.type === 'fixed') return col.value;
    if (frTotal <= 0) return 0;
    return (remaining * col.value) / frTotal;
  });
}

function parseGridSpan(value) {
  if (!value || typeof value !== 'string') return 1;
  const match = value.match(/span\s+(\d+)/i);
  if (!match) return 1;
  const span = parseInt(match[1], 10);
  return Number.isFinite(span) && span > 0 ? span : 1;
}

function hasInlineBoxStyles(styles = {}) {
  const bg = styleColor(styles, 'background-color', null);
  if (bg && String(bg).toLowerCase() !== 'transparent') return true;
  if (styleNumber(styles, 'padding', 0) > 0) return true;
  if (styleNumber(styles, 'padding-top', 0) > 0) return true;
  if (styleNumber(styles, 'padding-right', 0) > 0) return true;
  if (styleNumber(styles, 'padding-bottom', 0) > 0) return true;
  if (styleNumber(styles, 'padding-left', 0) > 0) return true;
  if (styleNumber(styles, 'border-width', 0) > 0) return true;
  if (styleNumber(styles, 'border-radius', 0) > 0) return true;
  const display = String(styles.display || '').toLowerCase();
  return display === 'inline-block';
}

function runHasInlineBoxStyles(runStyles = {}, baseStyles = {}) {
  if (!runStyles) return false;
  const display = String(runStyles.display || '').toLowerCase();
  if (display === 'inline-block') return true;
  const bg = styleColor(runStyles, 'background-color', null);
  const baseBg = styleColor(baseStyles, 'background-color', null);
  if (bg && String(bg).toLowerCase() !== 'transparent' && bg !== baseBg) return true;
  const pad = styleNumber(runStyles, 'padding', 0);
  const basePad = styleNumber(baseStyles, 'padding', 0);
  if (pad > 0 && pad !== basePad) return true;
  const padT = styleNumber(runStyles, 'padding-top', 0);
  const padR = styleNumber(runStyles, 'padding-right', 0);
  const padB = styleNumber(runStyles, 'padding-bottom', 0);
  const padL = styleNumber(runStyles, 'padding-left', 0);
  const basePadT = styleNumber(baseStyles, 'padding-top', 0);
  const basePadR = styleNumber(baseStyles, 'padding-right', 0);
  const basePadB = styleNumber(baseStyles, 'padding-bottom', 0);
  const basePadL = styleNumber(baseStyles, 'padding-left', 0);
  if (padT > 0 && padT !== basePadT) return true;
  if (padR > 0 && padR !== basePadR) return true;
  if (padB > 0 && padB !== basePadB) return true;
  if (padL > 0 && padL !== basePadL) return true;
  const border = styleNumber(runStyles, 'border-width', 0);
  const baseBorder = styleNumber(baseStyles, 'border-width', 0);
  if (border > 0 && border !== baseBorder) return true;
  const radius = styleNumber(runStyles, 'border-radius', 0);
  const baseRadius = styleNumber(baseStyles, 'border-radius', 0);
  return radius > 0 && radius !== baseRadius;
}

function renderInlineRuns(runs, ctx, { baseStyles, align, lineGap, tag }) {
  const { doc, layout } = ctx;
  const measureOnly = !!ctx?.measureOnly;
  const debugInline = process.env.HTML_TO_PDF_DEBUG === '1';
  const contentWidth = layout.contentWidth();
  const lines = [];
  let current = { runs: [], width: 0, height: 0 };

  for (const run of runs) {
    const s = { ...baseStyles, ...(run.styles || {}) };
    const inlineBox = runHasInlineBoxStyles(run.styles || {}, baseStyles);
    const size = styleNumber(s, 'font-size', BASE_PT);
    const letterSpacing = styleNumber(s, 'letter-spacing', 0, { baseSize: size });
    const wordSpacing = styleNumber(s, 'word-spacing', 0, { baseSize: size });
    const padding = inlineBox ? styleNumber(s, 'padding', 0) : 0;
    const padT = inlineBox ? styleNumber(s, 'padding-top', padding) : 0;
    const padR = inlineBox ? styleNumber(s, 'padding-right', padding) : 0;
    const padB = inlineBox ? styleNumber(s, 'padding-bottom', padding) : 0;
    const padL = inlineBox ? styleNumber(s, 'padding-left', padding) : 0;
    const borderWidth = inlineBox ? styleNumber(s, 'border-width', 0) : 0;
    const borderStyle = inlineBox
      ? String(s['border-style'] || '')
          .trim()
          .toLowerCase()
      : 'none';
    const borderColor = inlineBox ? styleColor(s, 'border-color', '#333333') : null;
    const borderPaint =
      inlineBox && borderColor && !['none', 'transparent'].includes(String(borderColor).trim().toLowerCase())
        ? borderColor
        : null;
    const border = inlineBox && borderStyle !== 'none' && borderStyle !== 'hidden' && borderPaint ? borderWidth : 0;
    const radius = inlineBox ? styleNumber(s, 'border-radius', 0) : 0;
    const bg = inlineBox ? styleColor(s, 'background-color', null) : null;

    selectFontForInline(doc, s, !!run.bold, !!run.italic, size);
    const spaces = (run.text || '').match(/ /g) || [];
    const text = run.text || '';
    const textWidth = doc.widthOfString(text, { characterSpacing: letterSpacing }) + wordSpacing * spaces.length;
    const measuredTextHeight = doc.heightOfString(text, { lineGap: 0 });
    const textHeight = measuredTextHeight;
    const runLineHeight = lineHeightValue(s, size, tag);
    const contentH = inlineBox ? Math.max(runLineHeight, measuredTextHeight) : runLineHeight;
    const boxW = textWidth + padL + padR + border * 2;
    const boxH = contentH + padT + padB + border * 2;
    if (debugInline && inlineBox) {
      console.log('[inline-box]', {
        text,
        size,
        textWidth,
        measuredTextHeight,
        textHeight,
        runLineHeight,
        padT,
        padB,
        padL,
        padR,
        border,
        boxW,
        boxH,
      });
    }

    if (current.width > 0 && current.width + boxW > contentWidth) {
      lines.push(current);
      current = { runs: [], width: 0, height: 0 };
    }

    current.runs.push({
      run,
      styles: s,
      inlineBox,
      size,
      padT,
      padR,
      padB,
      padL,
      border,
      borderPaint,
      radius,
      bg,
      boxW,
      boxH,
      textHeight,
    });
    current.width += boxW;
    current.height = Math.max(current.height, boxH);
  }

  if (current.runs.length) lines.push(current);

  let y = layout.y;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let x = layout.x;
    for (const item of line.runs) {
      const yOffset = (line.height - item.boxH) / 2;
      if (!measureOnly) {
        if (item.bg && String(item.bg).toLowerCase() !== 'transparent' && item.boxW > 0 && item.boxH > 0) {
          if (item.radius > 0) {
            const r = Math.min(item.radius, item.boxW / 2, item.boxH / 2);
            doc
              .save()
              .roundedRect(x, y + yOffset, item.boxW, item.boxH, r)
              .fill(item.bg)
              .restore();
          } else {
            doc
              .save()
              .rect(x, y + yOffset, item.boxW, item.boxH)
              .fill(item.bg)
              .restore();
          }
        }
        if (item.border && item.boxW > 0 && item.boxH > 0) {
          if (item.radius > 0) {
            const r = Math.min(item.radius, item.boxW / 2, item.boxH / 2);
            doc
              .save()
              .lineWidth(item.border)
              .strokeColor(item.borderPaint || '#333333')
              .roundedRect(x, y + yOffset, item.boxW, item.boxH, r)
              .stroke()
              .restore();
          } else {
            doc
              .save()
              .lineWidth(item.border)
              .strokeColor(item.borderPaint || '#333333')
              .rect(x, y + yOffset, item.boxW, item.boxH)
              .stroke()
              .restore();
          }
        }

        doc.fillColor(styleColor(item.styles, 'color', '#000'));
        const inlineAdjust = item.inlineBox
          ? Math.max(0, (item.boxH - item.padT - item.padB - item.border * 2 - item.textHeight) / 2)
          : 0;
        const textY = y + yOffset + item.border + item.padT + inlineAdjust;
        doc.text(item.run.text || '', x + item.border + item.padL, textY, { lineGap: 0 });
      }

      x += item.boxW;
    }
    y += line.height + (i < lines.length - 1 ? lineGap : 0);
  }

  return y - layout.y;
}

function collectLineRuns(node, parentStyles = {}) {
  const lines = [[]];
  const pushLine = () => {
    if (lines[lines.length - 1].length) lines.push([]);
  };

  function walk(n, inherited, isRoot) {
    if (!n) return;
    if (n.type === 'text') {
      lines[lines.length - 1].push({ text: n.text || '', ...inherited });
      return;
    }
    if (n.type !== 'element') return;

    const tag = (n.tag || '').toLowerCase();
    const styles = { ...inherited.styles, ...mergeStyles(n) };
    const next = { ...inherited, styles };
    if (tag === 'b' || tag === 'strong') next.bold = true;
    if (tag === 'i' || tag === 'em') next.italic = true;

    const isInline = isInlineDisplay(tag, styles);
    if (!isInline && !isRoot) pushLine();
    (n.children || []).forEach((child) => walk(child, next, false));
    if (!isInline && !isRoot) pushLine();
  }

  walk(node, { bold: false, italic: false, styles: parentStyles }, true);
  if (lines.length && lines[lines.length - 1].length === 0) lines.pop();
  return lines;
}

async function renderInlineSvg(node, ctx) {
  const { doc, layout } = ctx;
  const measureOnly = !!ctx?.measureOnly;
  const ignoreInvalid = !!ctx?.options?.ignoreInvalidImages;
  const styles = mergeStyles(node);
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
  const renderScale = svgScale > 0 ? svgScale : 1;
  const widthPx = Math.max(1, Math.round((width / PX_TO_PT) * renderScale));
  const heightPx = Math.max(1, Math.round((height / PX_TO_PT) * renderScale));
  const svgText = serializeSvg(node);

  let buf;
  try {
    const fitTo =
      widthPx > 0 ? { mode: 'width', value: widthPx } : heightPx > 0 ? { mode: 'height', value: heightPx } : undefined;
    const resvg = new Resvg(svgText, {
      imageRendering: 0,
      textRendering: 2,
      shapeRendering: 2,
      dpi: 196,
      ...(fitTo ? { fitTo } : undefined),
    });
    buf = Buffer.from(resvg.render().asPng());
  } catch (err) {
    if (!ignoreInvalid) console.error('Inline SVG render failed:', err.message || err);
    return;
  }

  layout.ensureSpace(height + 6);
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

function measureLineWidth(line, doc) {
  let width = 0;
  for (const run of line) {
    const text = run.text || '';
    if (!text) continue;
    const size = styleNumber(run.styles || {}, 'font-size', BASE_PT);
    const letterSpacing = styleNumber(run.styles || {}, 'letter-spacing', 0, { baseSize: size });
    const wordSpacing = styleNumber(run.styles || {}, 'word-spacing', 0, { baseSize: size });
    selectFontForInline(doc, run.styles || {}, !!run.bold, !!run.italic, size);
    const spaces = (text.match(/ /g) || []).length;
    width += doc.widthOfString(text, { characterSpacing: letterSpacing }) + wordSpacing * spaces;
  }
  return width;
}

function estimateNodeWidth(node, doc) {
  if (!node) return 0;
  if (node.type === 'text') {
    const text = node.text || '';
    if (!text) return 0;
    selectFontForInline(doc, {}, false, false, BASE_PT);
    return doc.widthOfString(text);
  }
  if (node.type !== 'element') return 0;
  const styles = mergeStyles(node);
  const padding = styleNumber(styles, 'padding', 0);
  const padL = styleNumber(styles, 'padding-left', padding);
  const padR = styleNumber(styles, 'padding-right', padding);
  const borderWidth = styleNumber(styles, 'border-width', 0);
  const borderL = styleNumber(styles, 'border-left-width', borderWidth);
  const borderR = styleNumber(styles, 'border-right-width', borderWidth);
  const lines = collectLineRuns(node, styles);
  let maxWidth = 0;
  for (const line of lines) {
    maxWidth = Math.max(maxWidth, measureLineWidth(line, doc));
  }
  const widthEps = 1;
  return maxWidth + padL + padR + borderL + borderR + widthEps;
}

function parseFlexGrow(styles) {
  const grow = styles ? styles['flex-grow'] : null;
  if (grow != null) {
    const num = parseFloat(grow);
    if (Number.isFinite(num)) return num;
  }
  const flex = styles ? styles.flex : null;
  if (flex) {
    const first = String(flex).trim().split(/\s+/)[0];
    const num = parseFloat(first);
    if (Number.isFinite(num)) return num;
  }
  return 0;
}

async function renderFlexRow(children, ctx, { startX, startY, width, gap, rowGap, bottomMargin, justify, wrap }) {
  const { doc } = ctx;
  const measureOnly = !!ctx?.measureOnly;
  const debugInline = process.env.HTML_TO_PDF_DEBUG === '1';
  if (!children.length) return 0;
  const baseGap = Number.isFinite(gap) ? gap : 0;
  const rowSpace = Number.isFinite(rowGap) ? rowGap : baseGap;
  const count = children.length;
  const available = Math.max(0, width - baseGap * Math.max(0, count - 1));
  const items = children.map((child) => {
    const childStyles = child.styles || {};
    const basis = styleNumber(childStyles, 'flex-basis', null, { percentBase: width });
    const explicitWidth = styleNumber(childStyles, 'width', null, { percentBase: width });
    const baseWidth = basis ?? explicitWidth ?? estimateNodeWidth(child, doc);
    const grow = parseFlexGrow(childStyles);
    return { child, baseWidth: Math.max(0, baseWidth || 0), grow, hasExplicit: basis != null || explicitWidth != null };
  });

  let totalBase = items.reduce((sum, item) => sum + item.baseWidth, 0);
  const totalGrow = items.reduce((sum, item) => sum + (item.grow || 0), 0);
  let widths = items.map((item) => item.baseWidth);

  const justifyValue = String(justify || 'flex-start').toLowerCase();
  const canEven = ['space-between', 'space-around', 'space-evenly'].includes(justifyValue);
  const equalWidth = count ? available / count : 0;
  const allAuto = items.every((item) => !item.hasExplicit && (!item.grow || item.grow === 0));
  if (canEven && allAuto && equalWidth > 0 && items.every((item) => item.baseWidth <= equalWidth)) {
    widths = items.map(() => equalWidth);
    totalBase = available;
  }

  if (wrap && String(wrap).toLowerCase() !== 'nowrap') {
    let maxY = startY;
    let rowY = startY;
    let rowH = 0;
    let x = startX;
    for (let i = 0; i < count; i++) {
      const child = children[i];
      let childWidth = Math.max(0, widths[i] || 0);
      if (childWidth > width) childWidth = width;
      if (x > startX && x + childWidth > startX + width) {
        rowY += rowH + rowSpace;
        x = startX;
        rowH = 0;
      }
      const right = doc.page.width - (x + childWidth);
      const childLayout = new Layout(doc, {
        margins: { left: x, right, top: rowY, bottom: bottomMargin },
        measureOnly,
      });
      childLayout.atStartOfPage = false;
      await renderNode(child, { doc, layout: childLayout, options: ctx.options, measureOnly });
      const childHeight = childLayout.y - rowY;
      if (debugInline && child?.tag === 'div') {
        console.log('[flex-item]', {
          tag: child.tag,
          class: child.attrs?.class || '',
          childHeight,
          rowY,
          x,
          childWidth,
          containerWidth: width,
        });
      }
      rowH = Math.max(rowH, childHeight);
      maxY = Math.max(maxY, rowY + rowH);
      x += childWidth + baseGap;
    }
    return maxY - startY;
  }

  if (totalGrow > 0 && available > totalBase) {
    const extra = available - totalBase;
    widths = items.map((item) => item.baseWidth + extra * (item.grow / totalGrow));
    totalBase = available;
  } else if (totalBase > available && totalBase > 0) {
    const scale = available / totalBase;
    widths = widths.map((w) => w * scale);
    totalBase = available;
  }

  if (widths.every((w) => w <= 0)) {
    const fallback = count ? available / count : 0;
    widths = widths.map(() => fallback);
    totalBase = available;
  }

  const baseTotal = totalBase + baseGap * Math.max(0, count - 1);
  const remaining = Math.max(0, width - baseTotal);
  let offset = 0;
  let actualGap = baseGap;
  if (justifyValue === 'flex-end' || justifyValue === 'end') {
    offset = remaining;
  } else if (justifyValue === 'center') {
    offset = remaining / 2;
  } else if (justifyValue === 'space-between') {
    if (count > 1) actualGap = baseGap + remaining / (count - 1);
  } else if (justifyValue === 'space-around') {
    if (count > 0) {
      const add = remaining / count;
      actualGap = baseGap + add;
      offset = actualGap / 2;
    }
  } else if (justifyValue === 'space-evenly') {
    if (count > 0) {
      const add = remaining / (count + 1);
      actualGap = baseGap + add;
      offset = actualGap;
    }
  }

  let maxHeight = 0;
  let x = startX + offset;
  for (let i = 0; i < count; i++) {
    const child = children[i];
    const childWidth = Math.max(0, widths[i] || 0);
    const right = doc.page.width - (x + childWidth);
    const childLayout = new Layout(doc, {
      margins: { left: x, right, top: startY, bottom: bottomMargin },
      measureOnly,
    });
    childLayout.atStartOfPage = false;
    await renderNode(child, { doc, layout: childLayout, options: ctx.options, measureOnly });
    maxHeight = Math.max(maxHeight, childLayout.y - startY);
    x += childWidth + actualGap;
  }
  return maxHeight;
}

async function renderGrid(children, ctx, { startX, startY, width, columns, colGap, rowGap, bottomMargin, alignItems }) {
  const { doc } = ctx;
  const measureOnly = !!ctx?.measureOnly;
  const debug = process.env.HTML_TO_PDF_DEBUG === '1';
  if (!children.length) return 0;
  const colWidths = Array.isArray(columns) && columns.length
    ? columns.map((w) => Math.max(0, w || 0))
    : Array.from({ length: Math.max(1, columns || 1) }, () =>
        Math.max(0, (width - colGap * (Math.max(1, columns || 1) - 1)) / Math.max(1, columns || 1))
      );
  const cols = colWidths.length;
  const rows = [];
  let colIndex = 0;
  let rowY = startY;
  let currentRow = { y: rowY, height: 0, items: [] };

  for (const child of children) {
    let span = parseGridSpan(child.styles?.['grid-column']);
    if (span > cols) span = cols;
    if (colIndex + span > cols && currentRow.items.length) {
      rows.push(currentRow);
      rowY += currentRow.height + rowGap;
      colIndex = 0;
      currentRow = { y: rowY, height: 0, items: [] };
    }

    const cellWidth =
      colWidths.slice(colIndex, colIndex + span).reduce((sum, w) => sum + w, 0) + colGap * (span - 1);
    const x =
      startX +
      colWidths.slice(0, colIndex).reduce((sum, w) => sum + w, 0) +
      colGap * colIndex;

    const right = doc.page.width - (x + cellWidth);
    const measureLayout = new Layout(doc, {
      margins: { left: x, right, top: rowY, bottom: bottomMargin },
      measureOnly: true,
    });
    measureLayout.atStartOfPage = false;
    await renderNode(child, { doc, layout: measureLayout, options: ctx.options, measureOnly: true });
    const childHeight = Math.max(0, measureLayout.y - rowY);
    if (debug && !measureOnly) {
      console.log('[grid-item-measure]', {
        tag: child.tag,
        className: child.attrs?.class || '',
        rowY,
        colIndex,
        span,
        cellWidth,
        childHeight,
      });
    }

    currentRow.items.push({ child, x, width: cellWidth, height: childHeight });
    currentRow.height = Math.max(currentRow.height, childHeight);
    colIndex += span;
  }

  if (currentRow.items.length) {
    rows.push(currentRow);
  }

  const align = String(alignItems || 'stretch').toLowerCase();
  const totalHeight =
    rows.reduce((sum, row) => sum + row.height, 0) + Math.max(0, rows.length - 1) * rowGap;

  if (measureOnly) return totalHeight;

  let maxY = startY;
  for (const row of rows) {
    if (!row.items || !row.items.length) continue;
    for (const item of row.items) {
      const right = doc.page.width - (item.x + item.width);
      const childLayout = new Layout(doc, {
        margins: { left: item.x, right, top: row.y, bottom: bottomMargin },
      });
      childLayout.atStartOfPage = false;
      const minHeight = align === 'stretch' ? row.height : 0;
      await renderNode(item.child, {
        doc,
        layout: childLayout,
        options: ctx.options,
        minHeight: minHeight || undefined,
      });
      if (debug) {
        console.log('[grid-item-render]', {
          tag: item.child.tag,
          className: item.child.attrs?.class || '',
          x: item.x,
          y: item.y,
          width: item.width,
          minHeight,
          childY: childLayout.y,
        });
      }
    }
    maxY = Math.max(maxY, row.y + row.height);
  }

  return maxY - startY;
}

async function renderNode(node, ctx) {
  const { doc, layout } = ctx;
  const measureOnly = !!ctx?.measureOnly;
  const debugInline = process.env.HTML_TO_PDF_DEBUG === '1';
  const minHeight = Number.isFinite(ctx?.minHeight) ? ctx.minHeight : null;
  const childCtx = minHeight != null ? { ...ctx, minHeight: null } : ctx;
  if (!node) return;

  if (node.type === 'text') {
    const text = node.text || '';
    if (!text) return;
    if (!measureOnly) {
      const size = BASE_PT;
      const gap = lineGapFor(size, {}, 'div');
      selectFontForInline(doc, {}, false, false, size);
      const h = doc.heightOfString(text, {
        width: layout.contentWidth(),
        lineGap: gap,
      });
      layout.ensureSpace(h);
      doc.x = layout.x;
      doc.y = layout.y;
      doc.text(text, { width: layout.contentWidth(), lineGap: gap });
      layout.cursorToNextLine(h);
      return;
    }
    const size = BASE_PT;
    const gap = lineGapFor(size, {}, 'div');
    selectFontForInline(doc, {}, false, false, size);
    const h = doc.heightOfString(text, {
      width: layout.contentWidth(),
      lineGap: gap,
    });
    layout.ensureSpace(h);
    layout.cursorToNextLine(h);
    return;
  }

  if (node.type !== 'element' && node.type !== 'root') return;

  const tag = (node.tag || '').toLowerCase();
  const styles = mergeStyles(node);
  const display = String(styles.display || '').toLowerCase();
  if (display === 'none') return;
  if (process.env.HTML_TO_PDF_DEBUG === '1' && (tag === 'figure' || tag === 'figcaption' || tag === 'img')) {
    console.log('[node-start]', {
      tag,
      display: display || 'block',
      x: layout.x,
      y: layout.y,
      width: layout.contentWidth(),
      border: styles.border || '',
      borderWidth: styles['border-width'] || styles['border-top-width'] || '',
      borderColor: styles['border-color'] || '',
      padding: styles.padding || '',
      paddingTop: styles['padding-top'] || '',
      paddingLeft: styles['padding-left'] || '',
      margin: styles.margin || '',
    });
  }
  const computed = computedMargins(styles, tag);
  const isRoot = node.type === 'root' || tag === 'body';
  const mt = isRoot ? 0 : computed.mt;
  const mb = isRoot ? 0 : computed.mb;
  const finishBlock = layout.newBlock(mt, mb);
  const color = styleColor(styles, 'color', '#000');
  const align = textAlign(styles);

  if (display === 'inline' || display === 'inline-block') {
    const size = styleNumber(styles, 'font-size', BASE_PT);
    const gap = lineGapFor(size, styles, tag);
    const runs = inlineRuns(node);
    if (!runs.length) return;
    selectFontForInline(doc, styles, false, false, size);
    const estimated = doc.heightOfString(runs.map((r) => r.text).join(''), {
      width: layout.contentWidth(),
      align,
      lineGap: gap,
    });
    layout.ensureSpace(estimated);
    const startYInline = layout.y;
    const h = renderInlineRuns(runs, ctx, { baseStyles: styles, align, lineGap: gap, tag });
    layout.y = Math.max(layout.y, startYInline + h);
    return;
  }

  if (tag === 'img') {
    await renderImage(node, ctx);
    finishBlock();
    applyPageBreakAfter(styles, ctx, node);
    return;
  }

  if (tag === 'svg') {
    await renderInlineSvg(node, ctx);
    finishBlock();
    applyPageBreakAfter(styles, ctx, node);
    return;
  }

  if (tag === 'table') {
    await renderTable(node, ctx, styles || {});
    finishBlock();
    applyPageBreakAfter(styles, ctx, node);
    return;
  }

  if (tag === 'ul' || tag === 'ol') {
    await renderList(node, ctx, tag === 'ol');
    finishBlock();
    applyPageBreakAfter(styles, ctx, node);
    return;
  }

  if (tag === 'pre' || tag === 'code') {
    await renderPre(node, ctx, styles);
    finishBlock();
    applyPageBreakAfter(styles, ctx, node);
    return;
  }

  if (tag === 'blockquote') {
    const padding = styleNumber(styles, 'padding', 0);
    const paddingTop = styleNumber(styles, 'padding-top', padding);
    const paddingBottom = styleNumber(styles, 'padding-bottom', padding);
    const paddingLeft = styleNumber(styles, 'padding-left', padding);
    const paddingRight = styleNumber(styles, 'padding-right', padding);
    const defaultIndent = parsePx('40px', 0);
    const marginLeft = styleNumber(styles, 'margin-left', defaultIndent);
    const marginRight = styleNumber(styles, 'margin-right', defaultIndent);
    const bg = styleColor(styles, 'background-color', null);
    const borderLeftStyle = String(styles['border-left-style'] || styles['border-style'] || '')
      .trim()
      .toLowerCase();
    const borderLeftWidth =
      styleNumber(styles, 'border-left-width', null) ??
      (styles['border-left'] ? parsePx(styles['border-left'].split(' ')[0], 0) : 0);
    const borderLeftColor = styleColor(styles, 'border-left-color', '#333333');
    const borderLeftPaint = ['none', 'transparent'].includes(
      String(borderLeftColor || '')
        .trim()
        .toLowerCase()
    )
      ? null
      : borderLeftColor;
    const borderLeft =
      borderLeftStyle === 'none' || borderLeftStyle === 'hidden' || !borderLeftPaint ? 0 : borderLeftWidth;

    layout.ensureSpace(paddingTop + paddingBottom);
    const startY = layout.y;

    const inlineOnly = isInlineOnly(node);
    if (inlineOnly) {
      const size = styleNumber(styles, 'font-size', BASE_PT);
      const lineHeight = lineHeightValue(styles, size, tag);
      const rawGap = lineHeight - size;
      const gap = Number.isFinite(rawGap) ? rawGap : lineGapFor(size, styles, tag);
      const runs = normalizeRuns(inlineRuns(node), shouldCollapseWhitespace(styles));
      const plain = runs.map((r) => r.text).join('');
      const letterSpacing = styleNumber(styles, 'letter-spacing', 0, { baseSize: size });
      const wordSpacing = styleNumber(styles, 'word-spacing', 0, { baseSize: size });
      const blockWidth = Math.max(0, layout.contentWidth() - marginLeft - marginRight);
      const blockX = layout.x + marginLeft;
      const availableWidth = blockWidth - paddingLeft - paddingRight;
      selectFontForInline(doc, styles, false, false, size);
      const spaces = (plain.match(/ /g) || []).length;
      const textWidth = doc.widthOfString(plain, { characterSpacing: letterSpacing }) + wordSpacing * spaces;
      const isSingleLine = textWidth <= availableWidth && !plain.includes('\n');
      const h = isSingleLine
        ? lineHeight
        : doc.heightOfString(plain, {
            width: availableWidth,
            align,
            lineGap: gap,
            characterSpacing: letterSpacing,
            wordSpacing,
          });
      const boxH = paddingTop + h + paddingBottom;
      layout.ensureSpace(boxH);

      if (!measureOnly) {
        if (bg && boxH > 0) {
          doc.save().rect(blockX, startY, blockWidth, boxH).fill(bg).restore();
        }
        if (borderLeft && boxH > 0) {
          doc
            .save()
            .rect(blockX, startY, borderLeft, boxH)
            .fill(borderLeftPaint || '#333333')
            .restore();
        }

        doc.fillColor(color);
        doc.x = blockX + paddingLeft;
        doc.y = startY + paddingTop;
        for (const run of runs) {
          const s = { ...styles, ...(run.styles || {}) };
          selectFontForInline(doc, s, !!run.bold, !!run.italic);
          doc.fillColor(styleColor(s, 'color', color)).text(run.text, {
            width: availableWidth,
            align,
            lineGap: gap,
            continued: true,
            underline: !!run.underline,
          });
        }
        doc.text('', { continued: false });
      }
      layout.y = Math.max(layout.y, startY + boxH);
      finishBlock();
      applyPageBreakAfter(styles, ctx, node);
      return;
    }

    if (paddingTop) layout.y += paddingTop;

    const originalX = layout.x;
    const originalContentWidth = layout.contentWidth;
    const blockX = layout.x + marginLeft;
    const blockWidth = Math.max(0, originalContentWidth() - marginLeft - marginRight);
    layout.x = blockX + paddingLeft;
    layout.contentWidth = () => blockWidth - paddingLeft - paddingRight;

    for (const child of node.children || []) {
      await renderNode(child, ctx);
    }

    layout.contentWidth = originalContentWidth;
    layout.x = originalX;

    if (paddingBottom) layout.cursorToNextLine(paddingBottom);

    const endY = layout.y;
    const boxH = endY - startY;
    const w = blockWidth;

    if (!measureOnly && (bg || borderLeft) && boxH > 0) {
      if (bg) {
        doc.save().rect(blockX, startY, w, boxH).fill(bg).restore();
      }
      if (borderLeft) {
        doc
          .save()
          .rect(blockX, startY, borderLeft, boxH)
          .fill(borderLeftPaint || '#333333')
          .restore();
      }
    }

    finishBlock();
    applyPageBreakAfter(styles, ctx, node);
    return;
  }

  if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) {
    const size = styleNumber(styles, 'font-size', defaultFontSizeFor(tag));

    const gap = lineGapFor(size, styles, tag);
    const text = gatherPlainText(node);
    const letterSpacing = styleNumber(styles, 'letter-spacing', 0, { baseSize: size });
    const wordSpacing = styleNumber(styles, 'word-spacing', 0, { baseSize: size });
    const padding = styleNumber(styles, 'padding', 0);
    const paddingTop = styleNumber(styles, 'padding-top', padding);
    const paddingBottom = styleNumber(styles, 'padding-bottom', padding);
    const borderBottomStyle = String(styles['border-bottom-style'] || '')
      .trim()
      .toLowerCase();
    const borderBottomWidth = styleNumber(styles, 'border-bottom-width', 0);
    const borderBottomColor = styleColor(styles, 'border-bottom-color', '#333333');
    const borderBottomPaint = ['none', 'transparent'].includes(String(borderBottomColor).trim().toLowerCase())
      ? null
      : borderBottomColor;
    const borderBottom =
      borderBottomStyle === 'none' || borderBottomStyle === 'hidden' || !borderBottomPaint ? 0 : borderBottomWidth;

    selectFontForInline(doc, styles, true, false, size);
    const h = doc.heightOfString(text, {
      width: layout.contentWidth(),
      align,
      lineGap: gap,
      characterSpacing: letterSpacing,
      wordSpacing,
    });

    const totalHeight = paddingTop + h + paddingBottom + borderBottom;
    layout.ensureSpace(totalHeight);

    const startY = layout.y;
    const textY = startY + paddingTop;

    if (!measureOnly) {
      doc.fillColor(color).text(text, layout.x, textY, { width: layout.contentWidth(), align, lineGap: gap });
    }

    if (!measureOnly && borderBottom) {
      const drawY = startY + paddingTop + h + paddingBottom;

      doc
        .save()
        .rect(layout.x, drawY, layout.contentWidth(), borderBottom)
        .fill(borderBottomPaint || '#333333')
        .restore();
    }

    layout.y = Math.max(layout.y, startY + totalHeight);
    finishBlock();
    applyPageBreakAfter(styles, ctx, node);
    return;
  }

  if (tag === 'p' || tag === 'span' || tag === 'figcaption') {
    const size = styleNumber(styles, 'font-size', BASE_PT);
    const gap = lineGapFor(size, styles, tag);
    const runs = normalizeRuns(inlineRuns(node), shouldCollapseWhitespace(styles));
    const useInlineBoxes = runs.some((run) => runHasInlineBoxStyles(run.styles || {}, styles));
    const plain = runs.map((r) => r.text).join('');
    const letterSpacing = styleNumber(styles, 'letter-spacing', 0, { baseSize: size });
    const wordSpacing = styleNumber(styles, 'word-spacing', 0, { baseSize: size });
    const padding = styleNumber(styles, 'padding', 0);
    const paddingTop = styleNumber(styles, 'padding-top', padding);
    const paddingBottom = styleNumber(styles, 'padding-bottom', padding);
    const paddingLeft = styleNumber(styles, 'padding-left', padding);
    const paddingRight = styleNumber(styles, 'padding-right', padding);
    const bg = styleColor(styles, 'background-color', null);
    const borderLeftWidth = styleNumber(styles, 'border-left-width', 0);
    const borderLeftColor = styleColor(styles, 'border-left-color', '#333333');
    const borderLeftPaint = ['none', 'transparent'].includes(String(borderLeftColor).trim().toLowerCase())
      ? null
      : borderLeftColor;
    const borderLeft = borderLeftWidth > 0 && borderLeftPaint ? borderLeftWidth : 0;

    selectFontForInline(doc, styles, false, false, size);
    const availableWidth = layout.contentWidth() - paddingLeft - paddingRight;
    let h = doc.heightOfString(plain, {
      width: availableWidth,
      align,
      lineGap: gap,
      characterSpacing: letterSpacing,
      wordSpacing,
    });
    let boxHeight = h + paddingTop + paddingBottom;
    if (useInlineBoxes) {
      layout.ensureSpace(boxHeight);
      const startYInline = layout.y + paddingTop;
      const hInline = renderInlineRuns(runs, ctx, { baseStyles: styles, align, lineGap: gap, tag });
      h = hInline;
      boxHeight = hInline + paddingTop + paddingBottom;
      layout.y = Math.max(layout.y, startYInline + hInline + paddingBottom);
    }
    if (!useInlineBoxes) layout.ensureSpace(boxHeight);

    if (!measureOnly && !useInlineBoxes) {
      if (bg && boxHeight > 0) {
        doc.save().rect(layout.x, layout.y, layout.contentWidth(), boxHeight).fill(bg).restore();
      }
      if (borderLeft && boxHeight > 0) {
        doc
          .save()
          .rect(layout.x, layout.y, borderLeft, boxHeight)
          .fill(borderLeftPaint || '#333333')
          .restore();
      }

      doc.fillColor(color);
      doc.x = layout.x + paddingLeft;
    }
    const startY = layout.y;
    if (!measureOnly) doc.y = startY + paddingTop;

    if (!measureOnly && !useInlineBoxes) {
      for (const run of runs) {
        const s = { ...styles, ...(run.styles || {}) };
        selectFontForInline(doc, s, !!run.bold, !!run.italic);
        const ls = styleNumber(s, 'letter-spacing', null, { baseSize: size });
        const ws = styleNumber(s, 'word-spacing', null, { baseSize: size });
        const textOptions = {
          width: availableWidth,
          align,
          lineGap: gap,
          continued: true,
          underline: !!run.underline,
        };
        if (ls != null) textOptions.characterSpacing = ls;
        if (ws != null) textOptions.wordSpacing = ws;
        doc.fillColor(styleColor(s, 'color', color)).text(run.text, textOptions);
      }
      doc.text('', { continued: false });
    }

    if (!useInlineBoxes) {
      layout.y = Math.max(layout.y, startY + boxHeight);
    }
    finishBlock();
    applyPageBreakAfter(styles, ctx, node);
    return;
  }

  if (tag === 'div' || tag === 'figure' || tag === 'header') {
    const padding = styleNumber(styles, 'padding', 0);
    const paddingTop = styleNumber(styles, 'padding-top', padding);
    const paddingBottom = styleNumber(styles, 'padding-bottom', padding);
    const paddingLeft = styleNumber(styles, 'padding-left', padding);
    const paddingRight = styleNumber(styles, 'padding-right', padding);
    const bg = styleColor(styles, 'background-color', null);
    const borderWidth = styleNumber(styles, 'border-width', 0);
    const borderColor = styleColor(styles, 'border-color', '#333333');
    const borderStyle = String(styles['border-style'] || '')
      .trim()
      .toLowerCase();
    const normalizeBorder = (width, color, style) => {
      const paint = ['none', 'transparent'].includes(String(color).trim().toLowerCase()) ? null : color;
      const styleVal = String(style || '')
        .trim()
        .toLowerCase();
      if (styleVal === 'none' || styleVal === 'hidden') return { width: 0, color: null };
      if (!paint || !Number.isFinite(width) || width <= 0) return { width: 0, color: null };
      return { width, color: paint };
    };

    const borderTop = normalizeBorder(
      styleNumber(styles, 'border-top-width', borderWidth),
      styleColor(styles, 'border-top-color', borderColor),
      styles['border-top-style'] || borderStyle
    );
    const borderRight = normalizeBorder(
      styleNumber(styles, 'border-right-width', borderWidth),
      styleColor(styles, 'border-right-color', borderColor),
      styles['border-right-style'] || borderStyle
    );
    const borderBottom = normalizeBorder(
      styleNumber(styles, 'border-bottom-width', borderWidth),
      styleColor(styles, 'border-bottom-color', borderColor),
      styles['border-bottom-style'] || borderStyle
    );
    const borderLeft = normalizeBorder(
      styleNumber(styles, 'border-left-width', borderWidth),
      styleColor(styles, 'border-left-color', borderColor),
      styles['border-left-style'] || borderStyle
    );
    const radius = styleNumber(styles, 'border-radius', 0);

    layout.ensureSpace(paddingTop + paddingBottom + borderTop.width + borderBottom.width);
    const startY = layout.y;
    const blockX = layout.x;
    const blockWidth = layout.contentWidth();
    const contentX = blockX + borderLeft.width + paddingLeft;
    const contentWidth = Math.max(0, blockWidth - borderLeft.width - borderRight.width - paddingLeft - paddingRight);
    const contentStartY = startY + borderTop.width + paddingTop;
    if (process.env.HTML_TO_PDF_DEBUG === '1' && tag === 'figure') {
      console.log('[figure-box]', {
        paddingTop,
        paddingLeft,
        paddingRight,
        borderLeft: borderLeft.width,
        borderTop: borderTop.width,
        blockX,
        contentX,
        blockWidth,
        contentWidth,
      });
    }
    const hasFrame = bg || borderTop.width || borderRight.width || borderBottom.width || borderLeft.width;
    const prepaint = !measureOnly && hasFrame;
    const inlineOnly = isInlineOnly(node);

    if (prepaint && (node.children || []).length) {
      const debug = process.env.HTML_TO_PDF_DEBUG === '1';
      const className = node.attrs?.class || '';
      let measuredContent = 0;
      if (inlineOnly) {
        const size = styleNumber(styles, 'font-size', BASE_PT);
        const gap = lineGapFor(size, styles, tag);
        const plain = gatherPlainText(node);
        selectFontForInline(doc, styles, false, false, size);
        const letterSpacing = styleNumber(styles, 'letter-spacing', 0, { baseSize: size });
        const wordSpacing = styleNumber(styles, 'word-spacing', 0, { baseSize: size });
        const spaces = (plain.match(/ /g) || []).length;
        const textWidth = doc.widthOfString(plain, { characterSpacing: letterSpacing }) + wordSpacing * spaces;
        const lineHeight = lineHeightValue(styles, size, tag);
        const singleLine = !plain.includes('\n') && textWidth <= contentWidth;
        measuredContent = singleLine
          ? lineHeight
          : doc.heightOfString(plain, {
              width: contentWidth,
              align: textAlign(styles),
              lineGap: gap,
              characterSpacing: letterSpacing,
              wordSpacing,
            });
      } else {
        const measureLayout = new Layout(doc, {
          margins: {
            left: contentX,
            right: doc.page.width - (contentX + contentWidth),
            top: contentStartY,
            bottom: layout.marginBottom,
          },
          measureOnly: true,
        });
        measureLayout.atStartOfPage = false;
      for (const child of node.children || []) {
        await renderNode(child, { doc, layout: measureLayout, options: ctx.options, measureOnly: true });
      }
        measuredContent = Math.max(0, measureLayout.y - contentStartY);
      }

      if (debug && className) {
        console.log('[div-measure]', {
          className,
          measuredContent,
          paddingTop,
          paddingBottom,
          borderTop: borderTop.width,
          borderBottom: borderBottom.width,
        });
      }

      const boxH = borderTop.width + paddingTop + measuredContent + paddingBottom + borderBottom.width;
      const desiredBoxH = minHeight != null ? Math.max(boxH, minHeight) : boxH;
      if (desiredBoxH > 0) {
        const uniformBorderWidth =
          borderTop.width === borderRight.width &&
          borderTop.width === borderBottom.width &&
          borderTop.width === borderLeft.width;
        const uniformBorderColor =
          borderTop.color === borderRight.color &&
          borderTop.color === borderBottom.color &&
          borderTop.color === borderLeft.color;
        const anyBorderWidth = borderTop.width || borderRight.width || borderBottom.width || borderLeft.width;
        const anyBorderColor = borderTop.color || borderRight.color || borderBottom.color || borderLeft.color;
        const roundedStrokeWidth = uniformBorderWidth ? borderTop.width : anyBorderWidth;
        const roundedStrokeColor = uniformBorderColor ? borderTop.color : anyBorderColor;
        const useRounded = radius > 0 && (bg || anyBorderWidth);

        if (useRounded) {
          const r = Math.min(radius, blockWidth / 2, desiredBoxH / 2);
          if (bg) doc.save().roundedRect(blockX, startY, blockWidth, desiredBoxH, r).fill(bg).restore();
          if (roundedStrokeWidth) {
            const inset = Math.max(0, roundedStrokeWidth / 2);
            const insetW = Math.max(0, blockWidth - roundedStrokeWidth);
            const insetH = Math.max(0, desiredBoxH - roundedStrokeWidth);
            const insetR = Math.max(0, r - inset);
            doc
              .save()
              .lineWidth(roundedStrokeWidth)
              .strokeColor(roundedStrokeColor || '#333333')
              .roundedRect(blockX + inset, startY + inset, insetW, insetH, insetR)
              .stroke()
              .restore();
          }
        } else {
          if (bg) doc.save().rect(blockX, startY, blockWidth, desiredBoxH).fill(bg).restore();
          if (borderTop.width) {
            doc
              .save()
              .rect(blockX, startY, blockWidth, borderTop.width)
              .fill(borderTop.color || '#333333')
              .restore();
          }
          if (borderRight.width) {
            doc
              .save()
              .rect(blockX + blockWidth - borderRight.width, startY, borderRight.width, desiredBoxH)
              .fill(borderRight.color || '#333333')
              .restore();
          }
          if (borderBottom.width) {
            doc
              .save()
              .rect(blockX, startY + desiredBoxH - borderBottom.width, blockWidth, borderBottom.width)
              .fill(borderBottom.color || '#333333')
              .restore();
          }
          if (borderLeft.width) {
            doc
              .save()
              .rect(blockX, startY, borderLeft.width, desiredBoxH)
              .fill(borderLeft.color || '#333333')
              .restore();
          }
        }
      }
    }

    if (paddingTop || hasFrame) {
      layout.y += borderTop.width + paddingTop;
    }

    const originalX = layout.x;
    const originalContentWidth = layout.contentWidth;
    layout.x = contentX;
    layout.contentWidth = () => contentWidth;

    const display = String(styles.display || '').toLowerCase();
    const isFlex = display === 'flex';
    const isGrid = display === 'grid';
    const flexDirection = String(styles['flex-direction'] || 'row').toLowerCase();
    const justifyContent = String(styles['justify-content'] || 'flex-start').toLowerCase();

    if (isFlex || isGrid) {
      const children = elementChildren(node);
      const gap = styleNumber(styles, 'gap', 0);
      const colGap = styleNumber(styles, 'column-gap', gap);
      const rowGap = styleNumber(styles, 'row-gap', gap);
      const contentWidth = layout.contentWidth();
      const contentX = layout.x;
      let usedHeight = 0;

      if (isFlex) {
        const flexWrap = String(styles['flex-wrap'] || 'nowrap').toLowerCase();
        if (flexDirection === 'column') {
          let first = true;
          for (const child of children) {
            if (!first) layout.cursorToNextLine(rowGap);
            await renderNode(child, childCtx);
            first = false;
          }
          usedHeight = layout.y - contentStartY;
        } else {
          usedHeight = await renderFlexRow(children, childCtx, {
            startX: contentX,
            startY: contentStartY,
            width: contentWidth,
            gap: colGap,
            rowGap,
            bottomMargin: layout.marginBottom,
            justify: justifyContent,
            wrap: flexWrap,
          });
        }
      } else {
        const columns =
          parseGridTemplateColumns(styles['grid-template-columns'], contentWidth, colGap) ||
          parseGridColumnCount(styles['grid-template-columns']) ||
          1;
        const alignItems = String(styles['align-items'] || 'stretch').toLowerCase();
        usedHeight = await renderGrid(children, childCtx, {
          startX: contentX,
          startY: contentStartY,
          width: contentWidth,
          columns,
          colGap,
          rowGap,
          bottomMargin: layout.marginBottom,
          alignItems,
        });
      }

      layout.y = Math.max(layout.y, contentStartY + usedHeight);
    } else {
    if (inlineOnly) {
      const size = styleNumber(styles, 'font-size', BASE_PT);
      const gap = lineGapFor(size, styles, tag);
        const runs = inlineRuns(node);
        const useInlineBoxes = runs.some((run) => runHasInlineBoxStyles(run.styles || {}, styles));
        const hasFrame =
          bg || borderTop.width || borderRight.width || borderBottom.width || borderLeft.width || radius > 0;

        if (useInlineBoxes) {
          const plain = runs.map((r) => r.text).join('');
          selectFontForInline(doc, styles, false, false, size);
          const estimated = doc.heightOfString(plain, {
            width: layout.contentWidth(),
            align,
            lineGap: gap,
          });
          layout.ensureSpace(estimated);
          const startYInline = layout.y;
          const h = renderInlineRuns(runs, ctx, { baseStyles: styles, align, lineGap: gap, tag });
          layout.y = Math.max(layout.y, startYInline + h);
        } else {
          const plain = runs.map((r) => r.text).join('');
          const letterSpacing = styleNumber(styles, 'letter-spacing', 0, { baseSize: size });
          const wordSpacing = styleNumber(styles, 'word-spacing', 0, { baseSize: size });
          selectFontForInline(doc, styles, false, false, size);
          const spaces = (plain.match(/ /g) || []).length;
          const textWidth = doc.widthOfString(plain, { characterSpacing: letterSpacing }) + wordSpacing * spaces;
          const lineHeight = lineHeightValue(styles, size, tag);
          const singleLine = !plain.includes('\n') && textWidth <= layout.contentWidth();
          const h = singleLine
            ? lineHeight
            : doc.heightOfString(plain, {
                width: layout.contentWidth(),
                align,
                lineGap: gap,
                characterSpacing: letterSpacing,
                wordSpacing,
              });
          if (debugInline && plain) {
            console.log('[inline-text]', {
              text: plain,
              size,
              lineGap: gap,
              height: h,
              contentWidth: layout.contentWidth(),
              paddingTop,
              paddingBottom,
              borderTop: borderTop.width,
              borderBottom: borderBottom.width,
            });
          }
          layout.ensureSpace(h);
          const startYInline = layout.y;
          if (!measureOnly) {
            doc.fillColor(styleColor(styles, 'color', '#000'));
            doc.x = layout.x;
            const textHeight = singleLine ? doc.currentLineHeight(true) : h;
            const textOffset = hasFrame && singleLine ? Math.max(0, (lineHeight - textHeight) / 2) : 0;
            doc.y = startYInline + textOffset;
            for (const run of runs) {
              const s = { ...styles, ...(run.styles || {}) };
              selectFontForInline(doc, s, !!run.bold, !!run.italic);
              doc.fillColor(styleColor(s, 'color', '#000')).text(run.text, {
                width: layout.contentWidth(),
                align,
                lineGap: singleLine ? 0 : gap,
                continued: true,
              });
            }
            doc.text('', { continued: false });
          }
          layout.y = Math.max(layout.y, startYInline + h);
        }
      } else {
        for (const child of node.children || []) {
          await renderNode(child, childCtx);
        }
      }
    }

    layout.contentWidth = originalContentWidth;
    layout.x = originalX;

    if (layout.pendingBottomMargin) {
      layout.cursorToNextLine(layout.pendingBottomMargin);
      layout.pendingBottomMargin = 0;
    }

    if (minHeight != null) {
      const currentBoxH = layout.y - startY + paddingBottom + borderBottom.width;
      if (currentBoxH < minHeight) {
        layout.y += minHeight - currentBoxH;
      }
    }
    const endY = layout.y;
    if (process.env.HTML_TO_PDF_DEBUG === '1' && node.attrs?.class) {
      console.log('[div-render]', {
        className: node.attrs?.class || '',
        contentHeight: endY - contentStartY,
        paddingTop,
        paddingBottom,
        borderTop: borderTop.width,
        borderBottom: borderBottom.width,
        minHeight,
      });
    }
    const boxH = endY - startY + paddingBottom + borderBottom.width;

    const uniformBorderWidth =
      borderTop.width === borderRight.width &&
      borderTop.width === borderBottom.width &&
      borderTop.width === borderLeft.width;
    const uniformBorderColor =
      borderTop.color === borderRight.color &&
      borderTop.color === borderBottom.color &&
      borderTop.color === borderLeft.color;
    const anyBorderWidth = borderTop.width || borderRight.width || borderBottom.width || borderLeft.width;
    const anyBorderColor = borderTop.color || borderRight.color || borderBottom.color || borderLeft.color;
    const roundedStrokeWidth = uniformBorderWidth ? borderTop.width : anyBorderWidth;
    const roundedStrokeColor = uniformBorderColor ? borderTop.color : anyBorderColor;
    const useRounded = radius > 0 && (bg || anyBorderWidth);

    if (
      !measureOnly &&
      !prepaint &&
      (bg || borderTop.width || borderRight.width || borderBottom.width || borderLeft.width) &&
      boxH > 0
    ) {
      const x = layout.x;
      const w = layout.contentWidth();
      if (useRounded) {
        const r = Math.min(radius, w / 2, boxH / 2);
        if (bg) {
          doc.save().roundedRect(x, startY, w, boxH, r).fill(bg).restore();
        }
        if (roundedStrokeWidth) {
          const inset = Math.max(0, roundedStrokeWidth / 2);
          const insetW = Math.max(0, w - roundedStrokeWidth);
          const insetH = Math.max(0, boxH - roundedStrokeWidth);
          const insetR = Math.max(0, r - inset);
          doc
            .save()
            .lineWidth(roundedStrokeWidth)
            .strokeColor(roundedStrokeColor || '#333333')
            .roundedRect(x + inset, startY + inset, insetW, insetH, insetR)
            .stroke()
            .restore();
        }
      } else {
        if (bg) {
          doc.save().rect(x, startY, w, boxH).fill(bg).restore();
        }
        if (borderTop.width) {
          doc
            .save()
            .rect(x, startY, w, borderTop.width)
            .fill(borderTop.color || '#333333')
            .restore();
        }
        if (borderRight.width) {
          doc
            .save()
            .rect(x + w - borderRight.width, startY, borderRight.width, boxH)
            .fill(borderRight.color || '#333333')
            .restore();
        }
        if (borderBottom.width) {
          doc
            .save()
            .rect(x, startY + boxH - borderBottom.width, w, borderBottom.width)
            .fill(borderBottom.color || '#333333')
            .restore();
        }
        if (borderLeft.width) {
          doc
            .save()
            .rect(x, startY, borderLeft.width, boxH)
            .fill(borderLeft.color || '#333333')
            .restore();
        }
      }
    }

    layout.ensureSpace(paddingBottom + borderBottom.width);
    if (paddingBottom || borderBottom.width) layout.cursorToNextLine(paddingBottom + borderBottom.width);
    finishBlock();
    applyPageBreakAfter(styles, ctx, node);
    return;
  }

  if (node.type === 'root' || tag === 'body') {
    for (const child of node.children || []) {
      await renderNode(child, ctx);
    }
    finishBlock();
    applyPageBreakAfter(styles, ctx, node);
    return;
  }

  for (const child of node.children || []) {
    await renderNode(child, ctx);
  }
  finishBlock();
  applyPageBreakAfter(styles, ctx, node);
}

module.exports = { renderNode };
