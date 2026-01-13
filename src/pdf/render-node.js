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
    if (child.type === 'element') return INLINE_TAGS.has((child.tag || '').toLowerCase()) && isInlineOnly(child);
    return false;
  });
}

function elementChildren(node) {
  return (node.children || []).filter((child) => child.type === 'element');
}

function parseGridColumnCount(value) {
  if (!value || typeof value !== 'string') return null;
  const repeatMatch = value.match(/repeat\(\s*(\d+)\s*,/i);
  if (repeatMatch) return parseInt(repeatMatch[1], 10);
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return parts.length || null;
}

function parseGridSpan(value) {
  if (!value || typeof value !== 'string') return 1;
  const match = value.match(/span\s+(\d+)/i);
  if (!match) return 1;
  const span = parseInt(match[1], 10);
  return Number.isFinite(span) && span > 0 ? span : 1;
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

    const isInline = INLINE_TAGS.has(tag);
    if (!isInline && !isRoot) pushLine();
    (n.children || []).forEach((child) => walk(child, next, false));
    if (!isInline && !isRoot) pushLine();
  }

  walk(node, { bold: false, italic: false, styles: parentStyles }, true);
  if (lines.length && lines[lines.length - 1].length === 0) lines.pop();
  return lines;
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
  const lines = collectLineRuns(node, styles);
  let maxWidth = 0;
  for (const line of lines) {
    maxWidth = Math.max(maxWidth, measureLineWidth(line, doc));
  }
  return maxWidth + padL + padR;
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

async function renderFlexRow(children, ctx, { startX, startY, width, gap, bottomMargin, justify }) {
  const { doc } = ctx;
  if (!children.length) return 0;
  const baseGap = Number.isFinite(gap) ? gap : 0;
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
    const childLayout = new Layout(doc, { margins: { left: x, right, top: startY, bottom: bottomMargin } });
    childLayout.atStartOfPage = false;
    await renderNode(child, { doc, layout: childLayout });
    maxHeight = Math.max(maxHeight, childLayout.y - startY);
    x += childWidth + actualGap;
  }
  return maxHeight;
}

async function renderGrid(children, ctx, { startX, startY, width, columns, colGap, rowGap, bottomMargin }) {
  const { doc } = ctx;
  if (!children.length) return 0;
  const cols = Math.max(1, columns);
  const colWidth = Math.max(0, (width - colGap * (cols - 1)) / cols);
  let colIndex = 0;
  let rowY = startY;
  let rowHeight = 0;
  let maxY = startY;

  for (const child of children) {
    let span = parseGridSpan(child.styles?.['grid-column']);
    if (span > cols) span = cols;
    if (colIndex + span > cols) {
      rowY += rowHeight + rowGap;
      colIndex = 0;
      rowHeight = 0;
    }

    const cellWidth = colWidth * span + colGap * (span - 1);
    const x = startX + colIndex * (colWidth + colGap);
    const right = doc.page.width - (x + cellWidth);
    const childLayout = new Layout(doc, { margins: { left: x, right, top: rowY, bottom: bottomMargin } });
    childLayout.atStartOfPage = false;
    await renderNode(child, { doc, layout: childLayout });
    rowHeight = Math.max(rowHeight, childLayout.y - rowY);
    maxY = Math.max(maxY, rowY + rowHeight);
    colIndex += span;
  }

  return maxY - startY;
}

async function renderNode(node, ctx) {
  const { doc, layout } = ctx;
  if (!node) return;

  if (node.type === 'text') {
    const text = node.text || '';
    doc.text(text, { continued: true });
    return;
  }

  if (node.type !== 'element' && node.type !== 'root') return;

  const tag = (node.tag || '').toLowerCase();
  const styles = mergeStyles(node);
  const computed = computedMargins(styles, tag);
  const isRoot = node.type === 'root' || tag === 'body';
  const mt = isRoot ? 0 : computed.mt;
  const mb = isRoot ? 0 : computed.mb;
  const finishBlock = layout.newBlock(mt, mb);
  const color = styleColor(styles, 'color', '#000');
  const align = textAlign(styles);

  if (tag === 'img') {
    await renderImage(node, ctx);
    finishBlock();
    return;
  }

  if (tag === 'table') {
    await renderTable(node, ctx, styles || {});
    finishBlock();
    return;
  }

  if (tag === 'ul' || tag === 'ol') {
    await renderList(node, ctx, tag === 'ol');
    finishBlock();
    return;
  }

  if (tag === 'pre' || tag === 'code') {
    await renderPre(node, ctx, styles);
    finishBlock();
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
      layout.y = Math.max(layout.y, startY + boxH);
      finishBlock();
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

    if ((bg || borderLeft) && boxH > 0) {
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

    doc.fillColor(color).text(text, layout.x, textY, { width: layout.contentWidth(), align, lineGap: gap });

    if (borderBottom) {
      const drawY = startY + paddingTop + h + paddingBottom;

      doc
        .save()
        .rect(layout.x, drawY, layout.contentWidth(), borderBottom)
        .fill(borderBottomPaint || '#333333')
        .restore();
    }

    layout.y = Math.max(layout.y, startY + totalHeight);
    finishBlock();
    return;
  }

  if (tag === 'p' || tag === 'span') {
    const size = styleNumber(styles, 'font-size', BASE_PT);
    const gap = lineGapFor(size, styles, tag);
    const runs = inlineRuns(node);
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
    const h = doc.heightOfString(plain, {
      width: availableWidth,
      align,
      lineGap: gap,
      characterSpacing: letterSpacing,
      wordSpacing,
    });
    const boxHeight = h + paddingTop + paddingBottom;
    layout.ensureSpace(boxHeight);

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
    const startY = layout.y;
    doc.y = startY + paddingTop;

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

    layout.y = Math.max(layout.y, startY + boxHeight);
    finishBlock();
    return;
  }

  if (tag === 'div') {
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

    if (paddingTop || bg || borderTop.width || borderRight.width || borderBottom.width || borderLeft.width) {
      layout.y += borderTop.width + paddingTop;
    }

    const originalX = layout.x;
    const originalContentWidth = layout.contentWidth;
    layout.x = layout.x + borderLeft.width + paddingLeft;
    layout.contentWidth = () =>
      originalContentWidth() - borderLeft.width - borderRight.width - paddingLeft - paddingRight;

    const display = String(styles.display || '').toLowerCase();
    const isFlex = display === 'flex';
    const isGrid = display === 'grid';
    const flexDirection = String(styles['flex-direction'] || 'row').toLowerCase();
    const justifyContent = String(styles['justify-content'] || 'flex-start').toLowerCase();
    const contentStartY = layout.y;

    if (isFlex || isGrid) {
      const children = elementChildren(node);
      const gap = styleNumber(styles, 'gap', 0);
      const colGap = styleNumber(styles, 'column-gap', gap);
      const rowGap = styleNumber(styles, 'row-gap', gap);
      const contentWidth = layout.contentWidth();
      const contentX = layout.x;
      let usedHeight = 0;

      if (isFlex) {
        if (flexDirection === 'column') {
          let first = true;
          for (const child of children) {
            if (!first) layout.cursorToNextLine(rowGap);
            await renderNode(child, ctx);
            first = false;
          }
          usedHeight = layout.y - contentStartY;
        } else {
          usedHeight = await renderFlexRow(children, ctx, {
            startX: contentX,
            startY: contentStartY,
            width: contentWidth,
            gap: colGap,
            bottomMargin: layout.marginBottom,
            justify: justifyContent,
          });
        }
      } else {
        const columns = parseGridColumnCount(styles['grid-template-columns']) || 1;
        usedHeight = await renderGrid(children, ctx, {
          startX: contentX,
          startY: contentStartY,
          width: contentWidth,
          columns,
          colGap,
          rowGap,
          bottomMargin: layout.marginBottom,
        });
      }

      layout.y = Math.max(layout.y, contentStartY + usedHeight);
    } else {
      const inlineOnly = isInlineOnly(node);
      if (inlineOnly) {
        const size = styleNumber(styles, 'font-size', BASE_PT);
        const gap = lineGapFor(size, styles, tag);
        const runs = inlineRuns(node);
        const plain = runs.map((r) => r.text).join('');
        const letterSpacing = styleNumber(styles, 'letter-spacing', 0, { baseSize: size });
        const wordSpacing = styleNumber(styles, 'word-spacing', 0, { baseSize: size });
        const h = doc.heightOfString(plain, {
          width: layout.contentWidth(),
          align,
          lineGap: gap,
          characterSpacing: letterSpacing,
          wordSpacing,
        });
        layout.ensureSpace(h);
        doc.fillColor(styleColor(styles, 'color', '#000'));
        doc.x = layout.x;
        const startYInline = layout.y;
        doc.y = startYInline;
        for (const run of runs) {
          const s = { ...styles, ...(run.styles || {}) };
          selectFontForInline(doc, s, !!run.bold, !!run.italic);
          doc.fillColor(styleColor(s, 'color', '#000')).text(run.text, {
            width: layout.contentWidth(),
            align,
            lineGap: gap,
            continued: true,
          });
        }
        doc.text('', { continued: false });
        layout.y = Math.max(layout.y, startYInline + h);
      } else {
        for (const child of node.children || []) {
          await renderNode(child, ctx);
        }
      }
    }

    layout.contentWidth = originalContentWidth;
    layout.x = originalX;

    if (layout.pendingBottomMargin) {
      layout.cursorToNextLine(layout.pendingBottomMargin);
      layout.pendingBottomMargin = 0;
    }

    const endY = layout.y;
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

    if ((bg || borderTop.width || borderRight.width || borderBottom.width || borderLeft.width) && boxH > 0) {
      const x = layout.x;
      const w = layout.contentWidth();
      if (useRounded) {
        const r = Math.min(radius, w / 2, boxH / 2);
        if (bg) {
          doc.save().roundedRect(x, startY, w, boxH, r).fill(bg).restore();
        }
        if (roundedStrokeWidth) {
          doc
            .save()
            .lineWidth(roundedStrokeWidth)
            .strokeColor(roundedStrokeColor || '#333333')
            .roundedRect(x, startY, w, boxH, r)
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
    return;
  }

  if (node.type === 'root' || tag === 'body') {
    for (const child of node.children || []) {
      await renderNode(child, ctx);
    }
    finishBlock();
    return;
  }

  for (const child of node.children || []) {
    await renderNode(child, ctx);
  }
  finishBlock();
}

module.exports = { renderNode };
