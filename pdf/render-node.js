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

  if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) {
    const size = styleNumber(styles, 'font-size', defaultFontSizeFor(tag));
    const gap = lineGapFor(size, styles, tag);
    const text = gatherPlainText(node);
    selectFontForInline(doc, styles, true, false, size);
    const h = doc.heightOfString(text, {
      width: layout.contentWidth(),
      align,
      lineGap: gap,
    });
    layout.ensureSpace(h);

    const startY = layout.y;
    doc.fillColor(color).text(text, layout.x, layout.y, { width: layout.contentWidth(), align, lineGap: gap });

    layout.y = Math.max(layout.y, startY + h);
    finishBlock();
    return;
  }

  if (tag === 'p' || tag === 'span') {
    const size = styleNumber(styles, 'font-size', BASE_PT);
    const gap = lineGapFor(size, styles, tag);
    const runs = inlineRuns(node);
    const plain = runs.map((r) => r.text).join('');
    selectFontForInline(doc, styles, false, false, size);
    const h = doc.heightOfString(plain, {
      width: layout.contentWidth(),
      align,
      lineGap: gap,
    });
    layout.ensureSpace(h);

    doc.fillColor(color);
    doc.x = layout.x;
    const startY = layout.y;
    doc.y = startY;

    for (const run of runs) {
      const s = { ...styles, ...(run.styles || {}) };
      selectFontForInline(doc, s, !!run.bold, !!run.italic);
      const ls = styleNumber(s, 'letter-spacing', null, { baseSize: size });
      const ws = styleNumber(s, 'word-spacing', null, { baseSize: size });
      if (ls != null) doc.characterSpacing(ls);
      doc.fillColor(styleColor(s, 'color', color)).text(run.text, {
        width: layout.contentWidth(),
        align,
        lineGap: gap,
        continued: true,
        underline: !!run.underline,
      });
      if (ls != null) doc.characterSpacing(0);
      if (ws != null) doc.x += ws; // crude word spacing adjustment between runs
    }
    doc.text('', { continued: false });

    layout.y = Math.max(layout.y, startY + h);
    finishBlock();
    return;
  }

  if (tag === 'div') {
    const padding = styleNumber(styles, 'padding', 0);
    const paddingTop = styleNumber(styles, 'padding-top', padding);
    const paddingBottom = styleNumber(styles, 'padding-bottom', padding);
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

    for (const child of node.children || []) {
      /* eslint-disable no-await-in-loop */
      await renderNode(child, ctx);
    }

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
