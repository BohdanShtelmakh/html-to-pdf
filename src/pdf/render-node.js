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
  'br',
]);

function isInlineDisplay(tag, styles = {}) {
  const display = String(styles.display || '').toLowerCase();
  if (display === 'inline' || display === 'inline-block') return true;
  if (display === 'block' || display === 'flex' || display === 'grid' || display === 'none') return false;
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
    if (run.isLineBreak) {
      out.push({ ...run, text: '\n' });
      prevSpace = true;
      continue;
    }
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

function containsBr(node) {
  if (!node || !node.children) return false;
  for (const child of node.children) {
    if (child.type === 'element') {
      if ((child.tag || '').toLowerCase() === 'br') return true;
      if (containsBr(child)) return true;
    }
  }
  return false;
}

/**
 * When a parent has mixed block + inline children, group consecutive inline/text/br
 * nodes into anonymous inline wrapper nodes so they render as a single text block.
 * This matches how browsers create anonymous block boxes around inline content
 * that sits alongside block-level siblings.
 */
function groupMixedChildren(children, parentStyles) {
  if (!children || !children.length) return children;

  // Check if there's a mix of block and inline children
  let hasBlock = false;
  let hasInline = false;
  for (const child of children) {
    if (child.type === 'text') { hasInline = true; continue; }
    if (child.type !== 'element') continue;
    const tag = (child.tag || '').toLowerCase();
    const styles = mergeStyles(child);
    if (isInlineDisplay(tag, styles)) hasInline = true;
    else hasBlock = true;
  }

  if (!hasBlock || !hasInline) return children;

  const groups = [];
  let inlineGroup = [];

  function flushInline() {
    if (!inlineGroup.length) return;
    // Check if the inline group has any meaningful content
    const hasContent = inlineGroup.some((n) =>
      n.type === 'text' ? /\S/.test(n.text || '') : true
    );
    if (hasContent) {
      // Trim leading whitespace-only text nodes (whitespace between block and inline content)
      while (inlineGroup.length && inlineGroup[0].type === 'text' && !/\S/.test(inlineGroup[0].text || '')) {
        inlineGroup.shift();
      }
      // Trim leading whitespace from first text node
      if (inlineGroup.length && inlineGroup[0].type === 'text') {
        inlineGroup[0] = { ...inlineGroup[0], text: (inlineGroup[0].text || '').replace(/^\s+/, '') };
      }
      if (!inlineGroup.length) { inlineGroup = []; return; }
      groups.push({
        type: 'element',
        tag: 'div',
        attrs: {},
        styles: { ...parentStyles },
        children: inlineGroup,
        _anonymous: true,
      });
    }
    inlineGroup = [];
  }

  for (const child of children) {
    if (child.type === 'text') {
      inlineGroup.push(child);
      continue;
    }
    if (child.type !== 'element') {
      inlineGroup.push(child);
      continue;
    }
    const tag = (child.tag || '').toLowerCase();
    const styles = mergeStyles(child);
    if (isInlineDisplay(tag, styles)) {
      inlineGroup.push(child);
    } else {
      flushInline();
      groups.push(child);
    }
  }
  flushInline();

  return groups;
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

    const spaces = (run.text || '').match(/ /g) || [];
    const text = run.text || '';
    // Subscript/superscript: smaller glyph drawn with a baseline shift, while the
    // line metrics keep the parent size so the line height doesn't collapse.
    const isSubSup = !!(run.subscript || run.superscript);
    const glyphSize = isSubSup ? size * 0.75 : size;
    const vShift = run.superscript ? -size * 0.33 : run.subscript ? size * 0.12 : 0;
    selectFontForInline(doc, s, !!run.bold, !!run.italic, glyphSize, text);
    // Emoji runs draw a Type 3 color glyph; width comes from the emoji font's
    // advance, baseline from the surrounding text font's ascender.
    const emojiInfo = run.isEmoji && doc._emoji ? doc._emoji.lookup(run.grapheme) : null;
    const emojiAscender = emojiInfo ? doc._font.ascender : 0;
    // An emoji run's text is normally just the grapheme, but upstream whitespace
    // normalization (e.g. table cells) can attach surrounding spaces. Account for
    // them so the emoji keeps its spacing from neighbouring words.
    const emojiLeadW = emojiInfo ? (/^\s+/.test(text) ? doc.widthOfString(' ') : 0) : 0;
    const emojiTrailW = emojiInfo && /\s+$/.test(text) ? doc.widthOfString(' ') : 0;
    const textWidth = emojiInfo
      ? doc._emoji.advanceWidth(emojiInfo, size) + emojiLeadW + emojiTrailW
      : doc.widthOfString(text, { characterSpacing: letterSpacing }) + wordSpacing * spaces.length;
    const measuredTextHeight = emojiInfo ? size : doc.heightOfString(text, { lineGap: 0 });
    const textHeight = measuredTextHeight;
    const runLineHeight = lineHeightValue(s, size, tag);
    const contentH = runLineHeight;
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
      emojiInfo,
      emojiAscender,
      emojiLeadW,
      glyphSize,
      vShift,
    });
    current.width += boxW;
    current.height = Math.max(current.height, boxH);
  }

  if (current.runs.length) lines.push(current);

  let y = layout.y;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let x = layout.x;
    if (align === 'right') x = layout.x + contentWidth - line.width;
    else if (align === 'center') x = layout.x + (contentWidth - line.width) / 2;
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
        if (item.emojiInfo) {
          doc._emoji.draw(item.emojiInfo, x + item.border + item.padL + (item.emojiLeadW || 0), textY, item.size, item.emojiAscender);
        } else {
          const linkOpts = getRunLinkTextOptions(item.run, {
            enableInternalAnchors: ctx?.options?.enableInternalAnchors,
          });
          selectFontForInline(doc, item.styles, !!item.run.bold, !!item.run.italic, item.glyphSize ?? item.size, item.run.text);
          doc.text(item.run.text || '', x + item.border + item.padL, textY + (item.vShift || 0), { lineGap: 0, ...linkOpts });
        }
      }

      x += item.boxW;
    }
    y += line.height + (i < lines.length - 1 ? lineGap : 0);
  }

  return y - layout.y;
}

function renderInlineRunsAt(runs, ctx, { baseStyles, align, lineGap, tag, x, y, width, measureOnly = false }) {
  const { doc, layout } = ctx;
  const inlineLayout = new Layout(doc, {
    margins: {
      left: x,
      right: Math.max(0, doc.page.width - (x + width)),
      top: y,
      bottom: layout.marginBottom,
    },
    measureOnly: measureOnly || !!ctx?.measureOnly,
  });
  inlineLayout.atStartOfPage = false;
  return renderInlineRuns(
    runs,
    { ...ctx, layout: inlineLayout, measureOnly: measureOnly || !!ctx?.measureOnly },
    { baseStyles, align, lineGap, tag }
  );
}

// Measurement memoization. In measureOnly mode renderNode is pure: it draws
// nothing and only mutates the layout cursor (y / pendingBottomMargin /
// atStartOfPage). Nested flex/grid re-measure the same subtree many times
// (exponential in depth), so we cache the layout-state transition per
// (node, contentWidth, minHeight, entry-state) and replay it on a hit. The
// cache lives on the per-render `doc`, so it is naturally scoped to one render.
async function renderNode(node, ctx) {
  if (ctx && ctx.measureOnly && node && (node.type === 'element' || node.type === 'root') && ctx.doc && ctx.layout) {
    const { doc, layout } = ctx;
    const cache = doc._measureCache || (doc._measureCache = new WeakMap());
    let byKey = cache.get(node);
    if (!byKey) {
      byKey = new Map();
      cache.set(node, byKey);
    }
    const mh = Number.isFinite(ctx.minHeight) ? ctx.minHeight : 0;
    const key =
      layout.contentWidth().toFixed(2) +
      '|' + mh +
      '|' + (layout.atStartOfPage ? 1 : 0) +
      '|' + (layout.pendingBottomMargin || 0);
    const hit = byKey.get(key);
    if (hit) {
      layout.y += hit.dy;
      layout.pendingBottomMargin = hit.outPending;
      layout.atStartOfPage = hit.outAtStart;
      return;
    }
    const startY = layout.y;
    await renderNodeImpl(node, ctx);
    byKey.set(key, {
      dy: layout.y - startY,
      outPending: layout.pendingBottomMargin,
      outAtStart: layout.atStartOfPage,
    });
    return;
  }
  return renderNodeImpl(node, ctx);
}

async function renderNodeImpl(node, ctx) {
  const { doc, layout } = ctx;
  const measureOnly = !!ctx?.measureOnly;
  const debugInline = process.env.HTML_TO_PDF_DEBUG === '1';
  const minHeight = Number.isFinite(ctx?.minHeight) ? ctx.minHeight : null;
  const childCtx = minHeight != null ? { ...ctx, minHeight: null } : ctx;
  if (!node) return;

  if (node.type === 'text') {
    const text = node.text || '';
    if (!text) return;
    const size = BASE_PT;
    const gap = lineGapFor(size, {}, 'div');
    const textAlignValue = ctx.inheritedAlign || 'left';
    selectFontForInline(doc, {}, false, false, size, text);
    const h = doc.heightOfString(text, {
      width: layout.contentWidth(),
      lineGap: gap,
    });
    layout.ensureSpace(h);
    if (!measureOnly) {
      doc.x = layout.x;
      doc.y = layout.y;
      doc.text(text, { width: layout.contentWidth(), lineGap: gap, align: textAlignValue });
    }
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
  const computed = computedMargins(styles, tag, { percentBase: layout.contentWidth() });
  const isRoot = node.type === 'root' || tag === 'body';
  const mt = isRoot ? 0 : computed.mt;
  const mb = isRoot ? 0 : computed.mb;
  const finishBlock = layout.newBlock(mt, mb);
  registerAnchorDestination(node, ctx);
  const color = styleColor(styles, 'color', '#000');
  const hasTextAlign = styles['text-align'] != null;
  const align = hasTextAlign ? textAlign(styles) : (ctx.inheritedAlign || textAlign(styles));
  const alignCtx = { ...childCtx, inheritedAlign: align };

  if (display === 'inline' || display === 'inline-block') {
    const size = styleNumber(styles, 'font-size', BASE_PT);
    const gap = lineGapFor(size, styles, tag);
    const runs = inlineRuns(node);
    if (!runs.length) return;
    const inlineText = runs.map((r) => r.text).join('');
    selectFontForInline(doc, styles, false, false, size, inlineText);
    const estimated = doc.heightOfString(inlineText, {
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

  if (tag === 'hr') {
    // A void element (no children) reads as "inline-only" to the generic text
    // path, so handle it before that branch. Draws a rule from the border
    // styles (top margin already applied by newBlock); a bare <hr> defaults to a
    // thin grey line, while `border: none` (no border-top) renders nothing.
    const topStyle = String(styles['border-top-style'] || styles['border-style'] || '')
      .trim()
      .toLowerCase();
    const suppressed = topStyle === 'none' || topStyle === 'hidden';
    const explicitTop = styleNumber(styles, 'border-top-width', null);
    const explicitAll = styleNumber(styles, 'border-width', null);
    const lineW = explicitTop != null ? explicitTop : explicitAll != null ? explicitAll : parsePx('1px', 1);
    const lineColor = styles['border-top-color'] != null
      ? styleColor(styles, 'border-top-color', '#888888')
      : styles['border-color'] != null
        ? styleColor(styles, 'border-color', '#888888')
        : '#888888';
    if (!suppressed && lineW > 0) {
      layout.ensureSpace(lineW);
      if (!measureOnly) {
        doc.save().rect(layout.x, layout.y, layout.contentWidth(), lineW).fill(lineColor).restore();
      }
      layout.cursorToNextLine(lineW);
    }
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
      selectFontForInline(doc, styles, false, false, size, plain);
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
        const hasLinks = runs.some((r) => r.href);
        const bqHasEmoji = doc._emoji && runs.some((r) => r.isEmoji);
        if (bqHasEmoji) {
          renderInlineRunsAt(runs, ctx, {
            baseStyles: styles,
            align,
            lineGap: gap,
            tag,
            x: blockX + paddingLeft,
            y: startY + paddingTop,
            width: availableWidth,
          });
        } else if (!hasLinks && (align !== 'left' || runs.length > 1)) {
          selectFontForInline(doc, styles, false, false, size, plain);
          doc.fillColor(color).text(plain, {
            width: availableWidth,
            align,
            lineGap: gap,
          });
        } else {
        for (const run of runs) {
          const s = { ...styles, ...(run.styles || {}) };
          selectFontForInline(doc, s, !!run.bold, !!run.italic, null, run.text);
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
      const groupedBqMeasure = groupMixedChildren(node.children || [], styles);
      for (const child of groupedBqMeasure) {
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

    const groupedBq = groupMixedChildren(node.children || [], styles);
    for (const child of groupedBq) {
      await renderNode(child, alignCtx);
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

    selectFontForInline(doc, styles, true, false, size, text);
    // Emoji in a heading must go through the manual line-breaker; force bold on
    // the non-emoji runs to preserve the heading's default weight.
    const headingHasEmoji = doc._emoji && runs.some((r) => r.isEmoji);
    const headingRuns = headingHasEmoji ? runs.map((r) => (r.isEmoji ? r : { ...r, bold: true })) : runs;
    const h = headingHasEmoji
      ? renderInlineRunsAt(headingRuns, ctx, {
          baseStyles: styles,
          align,
          lineGap: gap,
          tag,
          x: layout.x,
          y: layout.y,
          width: layout.contentWidth(),
          measureOnly: true,
        })
      : doc.heightOfString(text, {
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
      if (headingHasEmoji) {
        renderInlineRunsAt(headingRuns, ctx, {
          baseStyles: styles,
          align,
          lineGap: gap,
          tag,
          x: layout.x,
          y: textY,
          width: layout.contentWidth(),
        });
      } else {
        for (const run of runs) {
          const s = { ...styles, ...(run.styles || {}) };
          selectFontForInline(doc, s, true, !!run.italic, null, run.text);
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

  // A div/figure/header with an explicit width must go through the block path
  // (which sizes + positions the box) rather than the simple inline-text path.
  const hasExplicitWidth = styles.width != null && String(styles.width).trim().toLowerCase() !== 'auto';
  const inlineOnlyNoBr =
    isInlineOnly(node) && !containsBr(node) && display !== 'flex' && display !== 'grid' && !hasExplicitWidth;
  if (tag === 'p' || tag === 'span' || tag === 'figcaption' || inlineOnlyNoBr) {
    const size = styleNumber(styles, 'font-size', BASE_PT);
    const gap = lineGapFor(size, styles, tag);
    const runs = normalizeRuns(inlineRuns(node), shouldCollapseWhitespace(styles));
    const useInlineBoxes = runs.some((run) => runHasInlineBoxStyles(run.styles || {}, styles));
    const plain = runs.map((r) => r.text).join('');
    const letterSpacing = styleNumber(styles, 'letter-spacing', 0, { baseSize: size });
    const wordSpacing = styleNumber(styles, 'word-spacing', 0, { baseSize: size });
    const pctW = layout.contentWidth();
    const padding = styleNumber(styles, 'padding', 0, { percentBase: pctW });
    const paddingTop = styleNumber(styles, 'padding-top', padding, { percentBase: pctW });
    const paddingBottom = styleNumber(styles, 'padding-bottom', padding, { percentBase: pctW });
    const paddingLeft = styleNumber(styles, 'padding-left', padding, { percentBase: pctW });
    const paddingRight = styleNumber(styles, 'padding-right', padding, { percentBase: pctW });
    const bg = styleColor(styles, 'background-color', null);
    const borderLeftWidth = styleNumber(styles, 'border-left-width', 0);
    const borderLeftColor = styleColor(styles, 'border-left-color', '#333333');
    const borderLeftPaint = ['none', 'transparent'].includes(String(borderLeftColor).trim().toLowerCase())
      ? null
      : borderLeftColor;
    const borderLeft = borderLeftWidth > 0 && borderLeftPaint ? borderLeftWidth : 0;

    selectFontForInline(doc, styles, false, false, size, plain);
    const availableWidth = layout.contentWidth() - paddingLeft - paddingRight;
    const hasLinks = runs.some((r) => r.href);
    const runsHaveEmoji = doc._emoji && runs.some((r) => r.isEmoji);
    const runsHaveSubSup = runs.some((r) => r.subscript || r.superscript);
    // Emoji and sub/superscript must go through the manual line-breaker — the
    // continued-text auto-wrap path can't position Type 3 glyphs or baseline
    // shifts.
    const renderRunsAsGroup = !hasLinks && (align !== 'left' || runs.length > 1 || runsHaveEmoji || runsHaveSubSup);
    let h = renderRunsAsGroup
      ? renderInlineRunsAt(runs, ctx, {
          baseStyles: styles,
          align,
          lineGap: gap,
          tag,
          x: layout.x + paddingLeft,
          y: layout.y + paddingTop,
          width: availableWidth,
          measureOnly: true,
        })
      : doc.heightOfString(plain, {
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
      if (renderRunsAsGroup) {
        h = renderInlineRunsAt(runs, ctx, {
          baseStyles: styles,
          align,
          lineGap: gap,
          tag,
          x: layout.x + paddingLeft,
          y: startY + paddingTop,
          width: availableWidth,
        });
      } else {
        for (const run of runs) {
          const s = { ...styles, ...(run.styles || {}) };
          selectFontForInline(doc, s, !!run.bold, !!run.italic, null, run.text);
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
    }

    if (!useInlineBoxes) {
      layout.y = Math.max(layout.y, startY + boxHeight);
    }
    finishBlock();
    applyPageBreakAfter(styles, ctx, node);
    return;
  }

  if (tag === 'div' || tag === 'figure' || tag === 'header') {
    // CSS resolves percentage padding against the containing block's width.
    const pctW = layout.contentWidth();
    const padding = styleNumber(styles, 'padding', 0, { percentBase: pctW });
    const paddingTop = styleNumber(styles, 'padding-top', padding, { percentBase: pctW });
    const paddingBottom = styleNumber(styles, 'padding-bottom', padding, { percentBase: pctW });
    const paddingLeft = styleNumber(styles, 'padding-left', padding, { percentBase: pctW });
    const paddingRight = styleNumber(styles, 'padding-right', padding, { percentBase: pctW });
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
    const boxSizing = String(styles['box-sizing'] || 'content-box').trim().toLowerCase();
    const explicitHeight = styleNumber(styles, 'height', null, { percentBase: doc.page.height });
    const cssMinHeight = styleNumber(styles, 'min-height', null, { percentBase: doc.page.height });
    const toOuterHeight = (value) => {
      if (value == null || !Number.isFinite(value)) return null;
      if (boxSizing === 'border-box') return value;
      return value + borderTop.width + paddingTop + paddingBottom + borderBottom.width;
    };
    const explicitOuterHeight = toOuterHeight(explicitHeight);
    const cssMinOuterHeight = toOuterHeight(cssMinHeight);
    const minimumOuterHeight = Math.max(
      explicitOuterHeight ?? 0,
      cssMinOuterHeight ?? 0,
      minHeight ?? 0
    );

    layout.ensureSpace(Math.max(paddingTop + paddingBottom + borderTop.width + borderBottom.width, minimumOuterHeight));
    const startY = layout.y;
    const availWidth = layout.contentWidth();
    // Honour an explicit width (px/%/mm/...) and horizontal margin auto, so e.g.
    // `width: 200mm; margin: 0 auto` produces a centred fixed-width block instead
    // of always filling the content area. Width-less blocks keep prior behaviour.
    const explicitWidth = styleNumber(styles, 'width', null, { percentBase: availWidth });
    let blockX = layout.x;
    let blockWidth = availWidth;
    if (explicitWidth != null && explicitWidth >= 0) {
      const outerWidth =
        boxSizing === 'border-box'
          ? explicitWidth
          : explicitWidth + borderLeft.width + borderRight.width + paddingLeft + paddingRight;
      blockWidth = Math.min(availWidth, Math.max(0, outerWidth));
      const free = Math.max(0, availWidth - blockWidth);
      const mlAuto = String(styles['margin-left'] || '').trim().toLowerCase() === 'auto';
      const mrAuto = String(styles['margin-right'] || '').trim().toLowerCase() === 'auto';
      if (mlAuto && mrAuto) blockX = layout.x + free / 2;
      else if (mlAuto) blockX = layout.x + free;
      else if (styles['margin-left'] != null) {
        const ml = styleNumber(styles, 'margin-left', 0, { percentBase: availWidth });
        blockX = layout.x + Math.max(0, Math.min(ml, free));
      }
    }
    const contentX = blockX + borderLeft.width + paddingLeft;
    const contentWidth = Math.max(0, blockWidth - borderLeft.width - borderRight.width - paddingLeft - paddingRight);
    const contentStartY = startY + borderTop.width + paddingTop;
    const display = String(styles.display || '').toLowerCase();
    const isFlex = display === 'flex';
    const isGrid = display === 'grid';
    const flexDirection = String(styles['flex-direction'] || 'row').toLowerCase();
    const justifyContent = String(styles['justify-content'] || 'flex-start').toLowerCase();
    const gap = styleNumber(styles, 'gap', 0);
    const colGap = styleNumber(styles, 'column-gap', gap);
    const rowGap = styleNumber(styles, 'row-gap', gap);
    const alignItems = String(styles['align-items'] || 'stretch').toLowerCase();
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
    let skippedPagedFrame = false;

    if (prepaint && (node.children || []).length) {
      const debug = process.env.HTML_TO_PDF_DEBUG === '1';
      const className = node.attrs?.class || '';
      let measuredContent = 0;
      if (inlineOnly) {
        const size = styleNumber(styles, 'font-size', BASE_PT);
        const gap = lineGapFor(size, styles, tag);
        const plain = gatherPlainText(node);
        selectFontForInline(doc, styles, false, false, size, plain);
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
      } else if (isFlex || isGrid) {
        const measureChildren = elementChildren(node);
        if (isFlex) {
          if (flexDirection === 'column') {
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
            let first = true;
            for (const child of measureChildren) {
              if (!first) measureLayout.cursorToNextLine(rowGap);
              await renderNode(child, { doc, layout: measureLayout, options: ctx.options, measureOnly: true });
              first = false;
            }
            measuredContent = Math.max(0, measureLayout.y - contentStartY);
          } else {
            measuredContent = await renderFlexRow(
              measureChildren,
              { ...childCtx, doc, measureOnly: true, _isInlineDisplay: isInlineDisplay },
              {
                startX: contentX,
                startY: contentStartY,
                width: contentWidth,
                gap: colGap,
                rowGap,
                bottomMargin: layout.marginBottom,
                justify: justifyContent,
                wrap: String(styles['flex-wrap'] || 'nowrap').toLowerCase(),
                alignItems,
              }
            );
          }
        } else {
          const columns =
            parseGridTemplateColumns(styles['grid-template-columns'], contentWidth, colGap) ||
            parseGridColumnCount(styles['grid-template-columns']) ||
            1;
          measuredContent = await renderGrid(measureChildren, { ...childCtx, doc, measureOnly: true }, {
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
        const groupedMeasure = groupMixedChildren(node.children || [], styles);
        for (const child of groupedMeasure) {
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
      const desiredBoxH = Math.max(boxH, minimumOuterHeight);
      const availableOnPage = doc.page.height - layout.marginBottom - startY;
      skippedPagedFrame = desiredBoxH > availableOnPage;
      if (desiredBoxH > 0 && !skippedPagedFrame) {
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

    if (isFlex || isGrid) {
      const children = elementChildren(node);
      const contentWidth = layout.contentWidth();
      const contentX = layout.x;
      let usedHeight = 0;
      let usedAbsoluteY = null;

      if (isFlex) {
        const flexWrap = String(styles['flex-wrap'] || 'nowrap').toLowerCase();
        if (flexDirection === 'column') {
          let first = true;
          for (const child of children) {
            if (!first) layout.cursorToNextLine(rowGap);
            await renderNode(child, alignCtx);
            first = false;
          }
          usedHeight = layout.y - contentStartY;
        } else {
          const flexResult = await renderFlexRow(children, { ...childCtx, _isInlineDisplay: isInlineDisplay }, {
            startX: contentX,
            startY: contentStartY,
            width: contentWidth,
            gap: colGap,
            rowGap,
            bottomMargin: layout.marginBottom,
            justify: justifyContent,
            wrap: flexWrap,
            alignItems,
          });
          if (flexResult && typeof flexResult === 'object') {
            usedAbsoluteY = flexResult.absoluteY;
          } else {
            usedHeight = flexResult;
          }
        }
      } else {
        const columns =
          parseGridTemplateColumns(styles['grid-template-columns'], contentWidth, colGap) ||
          parseGridColumnCount(styles['grid-template-columns']) ||
          1;
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

      if (usedAbsoluteY != null) {
        layout.y = Math.max(0, usedAbsoluteY);
      } else {
        layout.y = Math.max(layout.y, contentStartY + usedHeight);
      }
    } else {
      if (inlineOnly) {
        const size = styleNumber(styles, 'font-size', BASE_PT);
        const gap = lineGapFor(size, styles, tag);
        const runs = normalizeRuns(inlineRuns(node), shouldCollapseWhitespace(styles));
        const useInlineBoxes = runs.some((run) => runHasInlineBoxStyles(run.styles || {}, styles));
        const hasFrame =
          bg || borderTop.width || borderRight.width || borderBottom.width || borderLeft.width || radius > 0;

        if (useInlineBoxes) {
          const plain = runs.map((r) => r.text).join('');
          selectFontForInline(doc, styles, false, false, size, plain);
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
          selectFontForInline(doc, styles, false, false, size, plain);
          const spaces = (plain.match(/ /g) || []).length;
          const textWidth = doc.widthOfString(plain, { characterSpacing: letterSpacing }) + wordSpacing * spaces;
          const lineHeight = lineHeightValue(styles, size, tag);
          const singleLine = !plain.includes('\n') && textWidth <= layout.contentWidth();
          const hasLineBreaks = plain.includes('\n');
          const allSameStyle = !runs.some((r) => r.bold || r.italic || r.href);
          const hasLinks = runs.some((r) => r.href);
          const runsHaveEmoji = doc._emoji && runs.some((r) => r.isEmoji);
          const runsHaveSubSup = runs.some((r) => r.subscript || r.superscript);
          const renderRunsAsGroup =
            !hasLinks && (align !== 'left' || runs.length > 1 || runsHaveEmoji || runsHaveSubSup);
          const h = renderRunsAsGroup
            ? renderInlineRunsAt(runs, ctx, {
                baseStyles: styles,
                align,
                lineGap: gap,
                tag,
                x: layout.x,
                y: layout.y,
                width: layout.contentWidth(),
                measureOnly: true,
              })
            : singleLine
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
            if (renderRunsAsGroup) {
              renderInlineRunsAt(runs, ctx, {
                baseStyles: styles,
                align,
                lineGap: gap,
                tag,
                x: layout.x,
                y: startYInline + textOffset,
                width: layout.contentWidth(),
              });
            } else if (hasLineBreaks && allSameStyle) {
              selectFontForInline(doc, styles, false, false, size, plain);
              doc.text(plain, layout.x, startYInline + textOffset, {
                width: layout.contentWidth(),
                align,
                lineGap: gap,
              });
            } else {
              for (const run of runs) {
                const s = { ...styles, ...(run.styles || {}) };
                selectFontForInline(doc, s, !!run.bold, !!run.italic, null, run.text);
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
          }
          layout.y = Math.max(layout.y, startYInline + h);
        }
      } else {
        const grouped = groupMixedChildren(node.children || [], styles);
        for (const child of grouped) {
          await renderNode(child, alignCtx);
        }
      }
    }

    layout.contentWidth = originalContentWidth;
    layout.x = originalX;

    if (layout.pendingBottomMargin) {
      layout.cursorToNextLine(layout.pendingBottomMargin);
      layout.pendingBottomMargin = 0;
    }

    const currentBoxH = Math.max(0, layout.y - startY + paddingBottom + borderBottom.width);
    const desiredBoxH = Math.max(currentBoxH, minimumOuterHeight);
    if (currentBoxH < desiredBoxH) {
      layout.y += desiredBoxH - currentBoxH;
    }
    const endY = layout.y;
    const renderedContentHeight = Math.max(0, endY - contentStartY);
    if (process.env.HTML_TO_PDF_DEBUG === '1' && node.attrs?.class) {
      console.log('[div-render]', {
        className: node.attrs?.class || '',
        contentHeight: renderedContentHeight,
        paddingTop,
        paddingBottom,
        borderTop: borderTop.width,
        borderBottom: borderBottom.width,
        minHeight,
      });
    }
    const boxH = Math.max(endY - startY + paddingBottom + borderBottom.width, desiredBoxH);

    if (
      !measureOnly &&
      !prepaint &&
      !skippedPagedFrame &&
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

  if (tag === 'br') {
    if (!measureOnly) {
      const size = styleNumber(styles, 'font-size', BASE_PT);
      const lh = lineHeightValue(styles, size, tag);
      layout.cursorToNextLine(lh);
    }
    return;
  }

  if (node.type === 'root' || tag === 'body') {
    const groupedRoot = groupMixedChildren(node.children || [], styles);
    for (const child of groupedRoot) {
      await renderNode(child, alignCtx);
    }
    finishBlock();
    applyPageBreakAfter(styles, ctx, node);
    return;
  }

  const groupedFallback = groupMixedChildren(node.children || [], styles);
  for (const child of groupedFallback) {
    await renderNode(child, alignCtx);
  }
  finishBlock();
  applyPageBreakAfter(styles, ctx, node);
}

module.exports = { renderNode, renderInlineRunsAt };
