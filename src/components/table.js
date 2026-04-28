const { styleNumber, styleColor, textAlign, lineHeightValue } = require('../pdf/style');
const { inlineRuns, selectFontForInline, gatherPlainText } = require('../pdf/text');
const { getRunLinkTextOptions } = require('../pdf/link');
const { Layout } = require('../pdf/layout');

function normalizePaint(val) {
  if (!val) return null;
  const s = String(val).trim().toLowerCase();
  if (s === 'none' || s === 'transparent') return null;
  return val;
}

function resolveBackground(cellStyles, rowStyles, tableStyles) {
  const cellBg = normalizePaint(styleColor(cellStyles || {}, 'background-color', null));
  if (cellBg) return cellBg;
  const rowBg = normalizePaint(styleColor(rowStyles || {}, 'background-color', null));
  if (rowBg) return rowBg;
  return normalizePaint(styleColor(tableStyles || {}, 'background-color', null));
}

function resolveBorder(cellStyles, rowStyles, tableStyles) {
  const borderStyle = String(
    (cellStyles && cellStyles['border-style']) ||
      (rowStyles && rowStyles['border-style']) ||
      (tableStyles && tableStyles['border-style']) ||
      ''
  )
    .trim()
    .toLowerCase();
  let borderWidth =
    styleNumber(cellStyles || {}, 'border-width', null) ??
    styleNumber(rowStyles || {}, 'border-width', null) ??
    styleNumber(tableStyles || {}, 'border-width', null) ??
    0;
  const borderColor =
    normalizePaint(styleColor(cellStyles || {}, 'border-color', null)) ||
    normalizePaint(styleColor(rowStyles || {}, 'border-color', null)) ||
    normalizePaint(styleColor(tableStyles || {}, 'border-color', null));

  const borderBottomStyle = String(
    (cellStyles && cellStyles['border-bottom-style']) ||
      (rowStyles && rowStyles['border-bottom-style']) ||
      (tableStyles && tableStyles['border-bottom-style']) ||
      borderStyle
  )
    .trim()
    .toLowerCase();
  let borderBottomWidth =
    styleNumber(cellStyles || {}, 'border-bottom-width', null) ??
    styleNumber(rowStyles || {}, 'border-bottom-width', null) ??
    styleNumber(tableStyles || {}, 'border-bottom-width', null) ??
    0;
  const borderBottomColor =
    normalizePaint(styleColor(cellStyles || {}, 'border-bottom-color', null)) ||
    normalizePaint(styleColor(rowStyles || {}, 'border-bottom-color', null)) ||
    normalizePaint(styleColor(tableStyles || {}, 'border-bottom-color', null)) ||
    borderColor;

  if (borderStyle === 'none' || borderStyle === 'hidden' || !borderColor) borderWidth = 0;
  if (borderBottomStyle === 'none' || borderBottomStyle === 'hidden' || !borderBottomColor) {
    borderBottomWidth = 0;
  }

  return { borderWidth, borderColor, borderBottomWidth, borderBottomColor, borderBottomStyle };
}

const BLOCK_CELL_TAGS = new Set([
  'div',
  'p',
  'section',
  'article',
  'header',
  'footer',
  'table',
  'ul',
  'ol',
  'blockquote',
  'pre',
  'figure',
  'svg',
  'img',
]);

function cellChildren(cell) {
  return (cell.children || []).filter((child) => {
    if (child.type === 'text') return /\S/.test(child.text || '');
    return child.type === 'element';
  });
}

function hasBlockCellContent(cell) {
  return cellChildren(cell).some((child) => {
    if (child.type !== 'element') return false;
    const tag = (child.tag || '').toLowerCase();
    return BLOCK_CELL_TAGS.has(tag);
  });
}

function textTokens(text) {
  return String(text || '')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function measureTokenWidth(doc, text, styles, bold, fontSize) {
  selectFontForInline(doc, styles || {}, bold, false, fontSize);
  let max = 0;
  for (const token of textTokens(text)) {
    max = Math.max(max, doc.widthOfString(token));
  }
  return max;
}

function distributeColumnWidths(preferred, minimum, totalWidth) {
  const cols = preferred.length;
  if (!cols) return [];
  const prefSum = preferred.reduce((sum, w) => sum + w, 0);
  const minSum = minimum.reduce((sum, w) => sum + w, 0);

  if (prefSum <= 0) return Array.from({ length: cols }, () => totalWidth / cols);

  if (prefSum <= totalWidth) {
    const extra = totalWidth - prefSum;
    return preferred.map((w) => w + extra / cols);
  }

  if (minSum < totalWidth) {
    const shrinkable = preferred.map((w, i) => Math.max(0, w - minimum[i]));
    const shrinkTotal = shrinkable.reduce((sum, w) => sum + w, 0);
    const needShrink = prefSum - totalWidth;
    if (shrinkTotal > 0) {
      return preferred.map((w, i) => Math.max(minimum[i], w - needShrink * (shrinkable[i] / shrinkTotal)));
    }
  }

  if (minSum > 0) {
    const scale = totalWidth / minSum;
    return minimum.map((w) => w * scale);
  }

  return preferred.map((w) => w * (totalWidth / prefSum));
}

async function measureBlockCell(cell, ctx, x, width, top, bottomMargin) {
  const { doc } = ctx;
  const children = cellChildren(cell);
  if (!children.length) return 0;
  const { renderNode } = require('../pdf/render-node');
  const measureLayout = new Layout(doc, {
    margins: {
      left: x,
      right: doc.page.width - (x + width),
      top,
      bottom: bottomMargin,
    },
    measureOnly: true,
  });
  measureLayout.atStartOfPage = false;
  for (const child of children) {
    await renderNode(child, { doc, layout: measureLayout, options: ctx.options, measureOnly: true });
  }
  return Math.max(0, measureLayout.y - top);
}

async function renderBlockCell(cell, ctx, x, y, width, bottomMargin) {
  const { doc } = ctx;
  const children = cellChildren(cell);
  if (!children.length) return;
  const { renderNode } = require('../pdf/render-node');
  const cellLayout = new Layout(doc, {
    margins: {
      left: x,
      right: doc.page.width - (x + width),
      top: y,
      bottom: bottomMargin,
    },
  });
  cellLayout.atStartOfPage = false;
  for (const child of children) {
    await renderNode(child, { doc, layout: cellLayout, options: ctx.options });
  }
}

async function renderTable(node, ctx, tableStyles = {}) {
  const { doc, layout } = ctx;
  const measureOnly = !!ctx?.measureOnly;

  const tableChildren = node.children || [];
  const head = tableChildren.find((c) => c.type === 'element' && c.tag === 'thead');
  const body = tableChildren.find((c) => c.type === 'element' && c.tag === 'tbody');
  const foot = tableChildren.find((c) => c.type === 'element' && c.tag === 'tfoot');

  const headRows = head ? (head.children || []).filter((r) => r.type === 'element' && r.tag === 'tr') : [];
  const bodyRows = body ? (body.children || []).filter((r) => r.type === 'element' && r.tag === 'tr') : [];
  const footRows = foot ? (foot.children || []).filter((r) => r.type === 'element' && r.tag === 'tr') : [];
  const rows = [...headRows, ...bodyRows, ...footRows];
  if (!rows.length) return;

  let cols = 0;
  for (const row of rows) {
    const cells = (row.children || []).filter((c) => c.type === 'element' && (c.tag === 'td' || c.tag === 'th'));
    const spanSum = cells.reduce((sum, c) => sum + (parseInt(c.attrs?.colspan, 10) || 1), 0);
    cols = Math.max(cols, spanSum);
  }
  cols = cols || 1;

  const cellPadding = styleNumber(tableStyles, 'padding', 6);
  const contentWidth = layout.contentWidth();

  const preferredWidths = Array(cols).fill(0);
  const minWidths = Array(cols).fill(0);

  for (const row of rows) {
    let colIndex = 0;
    const cells = (row.children || []).filter((c) => c.type === 'element' && (c.tag === 'td' || c.tag === 'th'));
    for (const cell of cells) {
      const colspan = parseInt(cell.attrs?.colspan, 10) || 1;
      const text = gatherPlainText(cell) || '';
      const isHeader = cell.tag === 'th';
      const fs = styleNumber(cell.styles || {}, 'font-size', isHeader ? 12.5 : 12);
      const lh = lineHeightValue(cell.styles || {}, fs, cell.tag || 'td');
      const lineGap = Math.max(0, lh - fs);
      const padL = styleNumber(cell.styles || {}, 'padding-left', cellPadding);
      const padR = styleNumber(cell.styles || {}, 'padding-right', cellPadding);
      const explicitWidth = styleNumber(cell.styles || {}, 'width', null, { percentBase: contentWidth });
      const availableWidth = Math.max(10, (contentWidth / cols) * colspan - padL - padR);
      selectFontForInline(doc, cell.styles || {}, isHeader, false, fs);
      const measured = hasBlockCellContent(cell)
        ? availableWidth
        : Math.min(doc.widthOfString(text), contentWidth);
      const tokenWidth = measureTokenWidth(doc, text, cell.styles || {}, isHeader, fs);
      const needed = measured + padL + padR;
      const minNeeded = Math.min(tokenWidth + padL + padR, contentWidth);
      const target = explicitWidth != null ? explicitWidth : needed;
      const perCol = target / colspan;
      const minPerCol = minNeeded / colspan;
      for (let i = 0; i < colspan && colIndex + i < cols; i++) {
        preferredWidths[colIndex + i] = Math.max(preferredWidths[colIndex + i], perCol);
        minWidths[colIndex + i] = Math.max(minWidths[colIndex + i], minPerCol);
      }
      colIndex += colspan;
    }
  }

  const colWidths = distributeColumnWidths(preferredWidths, minWidths, contentWidth);

  for (const row of rows) {
    let rowHeight = 0;
    const cells = (row.children || []).filter((c) => c.type === 'element' && (c.tag === 'td' || c.tag === 'th'));
    const rowStyles = row.styles || {};

    let measureCol = 0;
    for (const cell of cells) {
      const colspan = parseInt(cell.attrs?.colspan, 10) || 1;
      const spanWidth = colWidths.slice(measureCol, measureCol + colspan).reduce((a, b) => a + b, 0);
      const text = gatherPlainText(cell) || '';
      const isHeader = cell.tag === 'th';
      const fs = styleNumber(cell.styles || {}, 'font-size', isHeader ? 12.5 : 12);
      const lh = lineHeightValue(cell.styles || {}, fs, cell.tag || 'td');
      const lineGap = Math.max(0, lh - fs);
      const padT = styleNumber(cell.styles || {}, 'padding-top', cellPadding);
      const padB = styleNumber(cell.styles || {}, 'padding-bottom', cellPadding);
      const padL = styleNumber(cell.styles || {}, 'padding-left', cellPadding);
      const padR = styleNumber(cell.styles || {}, 'padding-right', cellPadding);
      selectFontForInline(doc, cell.styles || {}, isHeader, false, fs);
      const innerWidth = Math.max(1, spanWidth - padL - padR);
      const h = hasBlockCellContent(cell)
        ? await measureBlockCell(cell, ctx, 0, innerWidth, 0, layout.marginBottom)
        : doc.heightOfString(text, { width: innerWidth, lineGap });
      rowHeight = Math.max(rowHeight, h + padT + padB);
      measureCol += colspan;
    }

    layout.ensureSpace(rowHeight + 2);

    let drawCol = 0;
    for (const cell of cells) {
      const colspan = parseInt(cell.attrs?.colspan, 10) || 1;
      const spanWidth = colWidths.slice(drawCol, drawCol + colspan).reduce((a, b) => a + b, 0);
      const x = layout.x + colWidths.slice(0, drawCol).reduce((a, b) => a + b, 0);
      const y = layout.y;
      const cellStyles = cell.styles || {};
      const bg = resolveBackground(cellStyles, rowStyles, tableStyles);
      const { borderWidth, borderColor, borderBottomWidth, borderBottomColor, borderBottomStyle } = resolveBorder(
        cellStyles,
        rowStyles,
        tableStyles
      );
      if (!measureOnly) {
        if (bg) {
          doc.save().rect(x, y, spanWidth, rowHeight).fill(bg).restore();
        }
        if (borderWidth > 0) {
          doc
            .save()
            .lineWidth(borderWidth)
            .strokeColor(borderColor || '#000')
            .rect(x, y, spanWidth, rowHeight)
            .stroke()
            .restore();
        } else if (borderBottomWidth > 0) {
          doc.save().lineWidth(borderBottomWidth).strokeColor(borderBottomColor || '#000');
          if (borderBottomStyle === 'dashed') {
            doc.dash(borderBottomWidth * 2, { space: borderBottomWidth * 2 });
          } else if (borderBottomStyle === 'dotted') {
            doc.dash(borderBottomWidth, { space: borderBottomWidth });
          }
          const lineY = y + rowHeight - borderBottomWidth / 2;
          doc.moveTo(x, lineY).lineTo(x + spanWidth, lineY).stroke();
          doc.undash().restore();
        }
      }

      const isHeader = cell.tag === 'th';
      const fs = styleNumber(cell.styles || {}, 'font-size', isHeader ? 12.5 : 12);
      const lh = lineHeightValue(cell.styles || {}, fs, cell.tag || 'td');
      const lineGap = Math.max(0, lh - fs);
      const runs = inlineRuns(cell);
      const align = textAlign(cellStyles || {});
      const padT = styleNumber(cell.styles || {}, 'padding-top', cellPadding);
      const padB = styleNumber(cell.styles || {}, 'padding-bottom', cellPadding);
      const padL = styleNumber(cell.styles || {}, 'padding-left', cellPadding);
      const padR = styleNumber(cell.styles || {}, 'padding-right', cellPadding);

      if (!measureOnly) {
        const innerWidth = Math.max(1, spanWidth - padL - padR);
        if (hasBlockCellContent(cell)) {
          await renderBlockCell(cell, ctx, x + padL, y + padT, innerWidth, layout.marginBottom);
        } else {
          doc.x = x + padL;
          doc.y = y + padT;
          for (const run of runs) {
            selectFontForInline(doc, run.styles || {}, isHeader || !!run.bold, !!run.italic);
            const linkOpts = getRunLinkTextOptions(run, {
              enableInternalAnchors: ctx?.options?.enableInternalAnchors,
            });
            doc.fillColor(styleColor(run.styles || {}, 'color', '#000')).text(run.text, {
              width: innerWidth,
              align,
              lineGap,
              continued: true,
              ...linkOpts,
            });
          }
          doc.text('', { continued: false });
        }
      }
      drawCol += colspan;
    }

    layout.cursorToNextLine(rowHeight);
  }
}

module.exports = { renderTable };
