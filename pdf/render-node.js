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
  parsePx,
} = require('./style');
const { inlineRuns, selectFontForInline, gatherPlainText } = require('./text');
const { renderList, renderPre } = require('./blocks');

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

function isInlineOnly(node) {
  if (!node || !node.children) return false;
  return (node.children || []).every((child) => {
    if (child.type === 'text') return true;
    if (child.type === 'element') return INLINE_TAGS.has((child.tag || '').toLowerCase()) && isInlineOnly(child);
    return false;
  });
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
  const { mt, mb } = computedMargins(styles, tag);
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
    const bg = styleColor(styles, 'background-color', null);
    const borderLeft = styles['border-left'] ? parsePx(styles['border-left'].split(' ')[0], 0) : 0;
    const borderLeftColor = styles['border-left']
      ? styleColor(styles, 'border-left-color', styles['border-left'].split(' ').slice(-1)[0])
      : '#333333';

    layout.ensureSpace(paddingTop + paddingBottom);
    const startY = layout.y;

    // Apply top padding
    if (paddingTop) layout.y += paddingTop;

    // Temporarily shrink available width for horizontal padding
    const originalX = layout.x;
    const originalContentWidth = layout.contentWidth;
    layout.x = layout.x + paddingLeft;
    layout.contentWidth = () => originalContentWidth() - paddingLeft - paddingRight;

    for (const child of node.children || []) {
      /* eslint-disable no-await-in-loop */
      await renderNode(child, ctx);
    }

    // Restore layout width/x
    layout.contentWidth = originalContentWidth;
    layout.x = originalX;

    // Apply bottom padding
    if (paddingBottom) layout.cursorToNextLine(paddingBottom);

    const endY = layout.y;
    const boxH = endY - startY;
    const w = originalContentWidth();

    if ((bg || borderLeft) && boxH > 0) {
      if (bg) {
        doc.save().rect(originalX, startY, w, boxH).fill(bg).restore();
      }
      if (borderLeft) {
        doc
          .save()
          .rect(originalX, startY, borderLeft, boxH)
          .fill(borderLeftColor || '#333333')
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
    const borderBottom = styles['border-bottom'] ? parsePx(styles['border-bottom'].split(' ')[0], 0) : 0;
    const borderBottomColor = styles['border-bottom']
      ? styleColor(styles, 'border-bottom-color', styles['border-bottom'].split(' ').slice(-1)[0])
      : '#333333';
    selectFontForInline(doc, styles, true, false, size);
    const h = doc.heightOfString(text, {
      width: layout.contentWidth(),
      align,
      lineGap: gap,
    });

    layout.ensureSpace(h + borderBottom);

    const startY = layout.y;
    doc.fillColor(color).text(text, layout.x, layout.y, { width: layout.contentWidth(), align, lineGap: gap });

    if (borderBottom) {
      const drawY = startY + h + borderBottom / 2;
      doc
        .save()
        .lineWidth(borderBottom)
        .strokeColor(borderBottomColor)
        .moveTo(layout.x, drawY)
        .lineTo(layout.x + layout.contentWidth(), drawY)
        .stroke()
        .restore();
    }

    layout.y = Math.max(layout.y, startY + h + borderBottom);
    finishBlock();
    return;
  }

  if (tag === 'p' || tag === 'span') {
    const size = styleNumber(styles, 'font-size', BASE_PT);
    const gap = lineGapFor(size, styles, tag);
    const runs = inlineRuns(node);
    const plain = runs.map((r) => r.text).join('');
    const padding = styleNumber(styles, 'padding', 0);
    const paddingTop = styleNumber(styles, 'padding-top', padding);
    const paddingBottom = styleNumber(styles, 'padding-bottom', padding);
    const paddingLeft = styleNumber(styles, 'padding-left', padding);
    const paddingRight = styleNumber(styles, 'padding-right', padding);
    const bg = styleColor(styles, 'background-color', null);
    const borderLeft = styles['border-left'] ? parsePx(styles['border-left'].split(' ')[0], 0) : 0;
    const borderLeftColor = styles['border-left']
      ? styleColor(styles, 'border-left-color', styles['border-left'].split(' ').slice(-1)[0])
      : '#333333';

    selectFontForInline(doc, styles, false, false, size);
    const availableWidth = layout.contentWidth() - paddingLeft - paddingRight;
    const h = doc.heightOfString(plain, {
      width: availableWidth,
      align,
      lineGap: gap,
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
        .fill(borderLeftColor || '#333333')
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
      if (ls != null) doc.characterSpacing(ls);
      doc.fillColor(styleColor(s, 'color', color)).text(run.text, {
        width: availableWidth,
        align,
        lineGap: gap,
        continued: true,
        underline: !!run.underline,
      });
      if (ls != null) doc.characterSpacing(0);
      if (ws != null) doc.x += ws; // crude word spacing adjustment between runs
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
    const borderLeft = styles['border-left'] ? parsePx(styles['border-left'].split(' ')[0], 0) : 0;
    const borderBottom = styles['border-bottom'] ? parsePx(styles['border-bottom'].split(' ')[0], 0) : 0;
    const borderBottomColor = styles['border-bottom']
      ? styleColor(styles, 'border-bottom-color', styles['border-bottom'].split(' ').slice(-1)[0])
      : '#333333';
    // Ensure we have space for the box chrome before drawing content.
    layout.ensureSpace(paddingTop + paddingBottom + borderBottom);
    const startY = layout.y;

    if (paddingTop || bg || borderLeft || borderBottom) layout.y += paddingTop; // apply top padding

    const originalX = layout.x;
    const originalContentWidth = layout.contentWidth;
    layout.x = layout.x + paddingLeft;
    layout.contentWidth = () => originalContentWidth() - paddingLeft - paddingRight;

    const inlineOnly = isInlineOnly(node);
    if (inlineOnly) {
      const size = styleNumber(styles, 'font-size', BASE_PT);
      const gap = lineGapFor(size, styles, tag);
      const runs = inlineRuns(node);
      const plain = runs.map((r) => r.text).join('');
      const h = doc.heightOfString(plain, {
        width: layout.contentWidth(),
        align,
        lineGap: gap,
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
        /* eslint-disable no-await-in-loop */
        await renderNode(child, ctx);
      }
    }

    // Restore layout width/x
    layout.contentWidth = originalContentWidth;
    layout.x = originalX;

    if (layout.pendingBottomMargin) {
      layout.cursorToNextLine(layout.pendingBottomMargin);
      layout.pendingBottomMargin = 0;
    }

    const endY = layout.y;
    const boxH = endY - startY + paddingBottom; // include bottom padding

    if ((bg || borderLeft || borderBottom) && boxH > 0) {
      const x = layout.x;
      const w = layout.contentWidth();
      if (bg) {
        doc.save().rect(x, startY, w, boxH).fill(bg).restore();
      }
      if (borderLeft) {
        doc.save().rect(x, startY, borderLeft, boxH).fill('#333333').restore();
      }
      if (borderBottom) {
        doc
          .save()
          .rect(x, startY + boxH - borderBottom, w, borderBottom) // draw after children
          .fill(borderBottomColor || '#333333')
          .restore();
      }
    }

    // Ensure we don't overrun the page when adding bottom padding/border.
    layout.ensureSpace(paddingBottom + borderBottom);
    if (paddingBottom || borderBottom) layout.cursorToNextLine(paddingBottom + borderBottom);
    finishBlock();
    return;
  }

  if (node.type === 'root' || tag === 'body') {
    for (const child of node.children || []) {
      /* eslint-disable no-await-in-loop */
      await renderNode(child, ctx);
    }
    finishBlock();
    return;
  }

  for (const child of node.children || []) {
    /* eslint-disable no-await-in-loop */
    await renderNode(child, ctx);
  }
  finishBlock();
}

module.exports = { renderNode };
