const { renderImage, renderTable } = require('../components');
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
} = require('./style');
const { inlineRuns, selectFontForInline, gatherPlainText } = require('./text');
const { renderList, renderPre } = require('./blocks');
const { Layout } = require('./layout');
const { getRunLinkTextOptions } = require('./link');
const { drawBox } = require('./draw-box');
const {
  applyPageBreakAfter,
  applyPageBreakBefore,
  maybeApplyBreakInsideAvoid,
  registerAnchorDestination,
} = require('./page-break');
const { renderInlineSvg } = require('./render-svg');
const { renderFlexRow } = require('./render-flex');
const { renderGrid, parseGridTemplateColumns, parseGridColumnCount } = require('./render-grid');

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
        const linkOpts = getRunLinkTextOptions(item.run, {
          enableInternalAnchors: ctx?.options?.enableInternalAnchors,
        });
        doc.text(item.run.text || '', x + item.border + item.padL, textY, { lineGap: 0, ...linkOpts });
      }

      x += item.boxW;
    }
    y += line.height + (i < lines.length - 1 ? lineGap : 0);
  }

  return y - layout.y;
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
  applyPageBreakBefore(styles, ctx);
  await maybeApplyBreakInsideAvoid(node, styles, ctx);
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
  registerAnchorDestination(node, ctx);
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
        if ((bg || borderLeft) && boxH > 0) {
          drawBox(doc, blockX, startY, blockWidth, boxH, {
            bg,
            borderTop: { width: 0, color: null },
            borderRight: { width: 0, color: null },
            borderBottom: { width: 0, color: null },
            borderLeft: { width: borderLeft, color: borderLeftPaint },
            radius: 0,
          });
        }

        doc.fillColor(color);
        doc.x = blockX + paddingLeft;
        doc.y = startY + paddingTop;
        for (const run of runs) {
          const s = { ...styles, ...(run.styles || {}) };
          selectFontForInline(doc, s, !!run.bold, !!run.italic);
          const linkOpts = getRunLinkTextOptions(run, {
            enableInternalAnchors: ctx?.options?.enableInternalAnchors,
          });
          doc.fillColor(styleColor(s, 'color', color)).text(run.text, {
            width: availableWidth,
            align,
            lineGap: gap,
            continued: true,
            underline: !!run.underline,
            ...linkOpts,
          });
        }
        doc.text('', { continued: false });
      }
      layout.y = Math.max(layout.y, startY + boxH);
      finishBlock();
      applyPageBreakAfter(styles, ctx, node);
      return;
    }

    const originalX = layout.x;
    const originalContentWidth = layout.contentWidth;
    const blockX = layout.x + marginLeft;
    const blockWidth = Math.max(0, originalContentWidth() - marginLeft - marginRight);
    const contentX = blockX + paddingLeft;
    const contentW = blockWidth - paddingLeft - paddingRight;

    // Measure-then-prepaint: draw bg/border BEFORE content so text is visible
    if (!measureOnly && (bg || borderLeft)) {
      const measureLayout = new Layout(doc, {
        margins: {
          left: contentX,
          right: doc.page.width - (contentX + contentW),
          top: startY + paddingTop,
          bottom: layout.marginBottom,
        },
        measureOnly: true,
      });
      measureLayout.atStartOfPage = false;
      for (const child of node.children || []) {
        await renderNode(child, { doc, layout: measureLayout, options: ctx.options, measureOnly: true });
      }
      const measuredContent = Math.max(0, measureLayout.y - (startY + paddingTop));
      const boxH = paddingTop + measuredContent + paddingBottom;
      if (boxH > 0) {
        drawBox(doc, blockX, startY, blockWidth, boxH, {
          bg,
          borderTop: { width: 0, color: null },
          borderRight: { width: 0, color: null },
          borderBottom: { width: 0, color: null },
          borderLeft: { width: borderLeft, color: borderLeftPaint },
          radius: 0,
        });
      }
    }

    if (paddingTop) layout.y += paddingTop;
    layout.x = contentX;
    layout.contentWidth = () => contentW;

    for (const child of node.children || []) {
      await renderNode(child, ctx);
    }

    layout.contentWidth = originalContentWidth;
    layout.x = originalX;

    if (paddingBottom) layout.cursorToNextLine(paddingBottom);

    finishBlock();
    applyPageBreakAfter(styles, ctx, node);
    return;
  }

  if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) {
    const size = styleNumber(styles, 'font-size', defaultFontSizeFor(tag));

    const gap = lineGapFor(size, styles, tag);
    const runs = normalizeRuns(inlineRuns(node), shouldCollapseWhitespace(styles));
    const text = runs.map((r) => r.text).join('');
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
      doc.fillColor(color);
      doc.x = layout.x;
      doc.y = textY;
      for (const run of runs) {
        const s = { ...styles, ...(run.styles || {}) };
        selectFontForInline(doc, s, true, !!run.italic);
        const linkOpts = getRunLinkTextOptions(run, {
          enableInternalAnchors: ctx?.options?.enableInternalAnchors,
        });
        doc.fillColor(styleColor(s, 'color', color)).text(run.text, {
          width: layout.contentWidth(),
          align,
          lineGap: gap,
          continued: true,
          underline: !!run.underline,
          ...linkOpts,
        });
      }
      doc.text('', { continued: false });
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
      if ((bg || borderLeft) && boxHeight > 0) {
        drawBox(doc, layout.x, layout.y, layout.contentWidth(), boxHeight, {
          bg,
          borderTop: { width: 0, color: null },
          borderRight: { width: 0, color: null },
          borderBottom: { width: 0, color: null },
          borderLeft: { width: borderLeft, color: borderLeftPaint },
          radius: 0,
        });
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
        const linkOpts = getRunLinkTextOptions(run, {
          enableInternalAnchors: ctx?.options?.enableInternalAnchors,
        });
        const textOptions = {
          width: availableWidth,
          align,
          lineGap: gap,
          continued: true,
          underline: !!run.underline,
          ...linkOpts,
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
        drawBox(doc, blockX, startY, blockWidth, desiredBoxH, {
          bg,
          borderTop,
          borderRight,
          borderBottom,
          borderLeft,
          radius,
        });
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
          usedHeight = await renderFlexRow(children, { ...childCtx, _isInlineDisplay: isInlineDisplay }, {
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
              const linkOpts = getRunLinkTextOptions(run, {
                enableInternalAnchors: ctx?.options?.enableInternalAnchors,
              });
              doc.fillColor(styleColor(s, 'color', '#000')).text(run.text, {
                width: layout.contentWidth(),
                align,
                lineGap: singleLine ? 0 : gap,
                continued: true,
                ...linkOpts,
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

    if (
      !measureOnly &&
      !prepaint &&
      (bg || borderTop.width || borderRight.width || borderBottom.width || borderLeft.width) &&
      boxH > 0
    ) {
      drawBox(doc, layout.x, startY, layout.contentWidth(), boxH, {
        bg,
        borderTop,
        borderRight,
        borderBottom,
        borderLeft,
        radius,
      });
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
