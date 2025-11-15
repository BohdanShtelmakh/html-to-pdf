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
    await renderTable(node, ctx, styles);
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
    const h = doc.heightOfString(text, {
      width: layout.contentWidth(),
      align,
      lineGap: gap,
    });
    layout.ensureSpace(h);

    doc
      .fillColor(color)
      .font('Times-Bold')
      .fontSize(size)
      .text(text, layout.x, layout.y, { width: layout.contentWidth(), align, lineGap: gap });

    layout.y = Math.max(layout.y, doc.y);
    finishBlock();
    return;
  }

  if (tag === 'p' || tag === 'span') {
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

    doc.fillColor(color);
    doc.x = layout.x;
    doc.y = layout.y;

    for (const run of runs) {
      const s = { ...styles, ...(run.styles || {}) };
      selectFontForInline(doc, s, !!run.bold, !!run.italic);
      doc.fillColor(styleColor(s, 'color', color)).text(run.text, {
        width: layout.contentWidth(),
        align,
        lineGap: gap,
        continued: true,
      });
    }
    doc.text('', { continued: false });

    layout.y = Math.max(layout.y, doc.y);
    finishBlock();
    return;
  }

  if (tag === 'div') {
    const padding = styleNumber(styles, 'padding', 0);
    const bg = styleColor(styles, 'background-color', null);
    const borderLeft = styles['border-left'] ? parsePx(styles['border-left'].split(' ')[0], 0) : 0;
    const startY = layout.y;

    if (padding || bg || borderLeft) {
      layout.y += padding || 0;
    }

    for (const child of node.children || []) {
      /* eslint-disable no-await-in-loop */
      await renderNode(child, ctx);
    }

    const endY = layout.y;
    const boxH = endY - startY + (padding || 0);

    if ((bg || borderLeft) && boxH > 0) {
      const x = layout.x;
      const w = layout.contentWidth();
      if (bg) {
        doc.save().rect(x, startY, w, boxH).fill(bg).restore();
      }
      if (borderLeft) {
        doc.save().rect(x, startY, borderLeft, boxH).fill('#333333').restore();
      }
    }

    if (padding) layout.cursorToNextLine(padding);
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
