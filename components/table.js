const { styleNumber, styleColor, textAlign, lineHeightValue } = require('../pdf/style');
const { inlineRuns, selectFontForInline, gatherPlainText } = require('../pdf/text');

async function renderTable(node, ctx, tableStyles = {}) {
  const { doc, layout } = ctx;

  const tbody = (node.children || []).find((c) => c.type === 'element' && c.tag === 'tbody');
  if (!tbody) return;

  // Collect rows
  const rows = (tbody.children || []).filter((r) => r.type === 'element' && r.tag === 'tr');
  if (!rows.length) return;

  // Determine column count from max sum of colspans.
  let cols = 0;
  for (const row of rows) {
    const cells = (row.children || []).filter((c) => c.type === 'element' && (c.tag === 'td' || c.tag === 'th'));
    const spanSum = cells.reduce((sum, c) => sum + (parseInt(c.attrs?.colspan, 10) || 1), 0);
    cols = Math.max(cols, spanSum);
  }
  cols = cols || 1;

  const cellPadding = styleNumber(tableStyles, 'padding', 6);
  const borderColor = '#000000';
  const borderWidth = 1;
  const contentWidth = layout.contentWidth();

  // First pass: compute preferred column widths based on text measurements and colspans.
  const colWidths = Array(cols).fill(0);

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
      const availableWidth = Math.max(10, (contentWidth / cols) * colspan - padL - padR);
      const measured = doc.widthOfString(text, { width: availableWidth });
      const needed = measured + padL + padR;
      const perCol = needed / colspan;
      for (let i = 0; i < colspan && colIndex + i < cols; i++) {
        colWidths[colIndex + i] = Math.max(colWidths[colIndex + i], perCol);
      }
      colIndex += colspan;
    }
  }

  // Normalize widths to fit content width.
  let totalPreferred = colWidths.reduce((a, b) => a + b, 0);
  if (totalPreferred <= 0) {
    for (let i = 0; i < cols; i++) colWidths[i] = contentWidth / cols;
  } else if (totalPreferred > contentWidth) {
    const scale = contentWidth / totalPreferred;
    for (let i = 0; i < cols; i++) colWidths[i] *= scale;
  } else {
    const extra = contentWidth - totalPreferred;
    for (let i = 0; i < cols; i++) colWidths[i] += extra / cols;
  }

  for (const row of rows) {
    // Measure row height (max cell height)
    let rowHeight = 0;
    const cells = (row.children || []).filter((c) => c.type === 'element' && (c.tag === 'td' || c.tag === 'th'));

    // Pre-measure
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
      const h = doc.heightOfString(text, { width: spanWidth - padL - padR, lineGap });
      rowHeight = Math.max(rowHeight, h + padT + padB);
      measureCol += colspan;
    }

    layout.ensureSpace(rowHeight + 2);

    // Draw cells
    let drawCol = 0;
    for (const cell of cells) {
      const colspan = parseInt(cell.attrs?.colspan, 10) || 1;
      const spanWidth = colWidths.slice(drawCol, drawCol + colspan).reduce((a, b) => a + b, 0);
      const x = layout.x + colWidths.slice(0, drawCol).reduce((a, b) => a + b, 0);
      const y = layout.y;
      // Border
      doc.save().lineWidth(borderWidth).strokeColor(borderColor).rect(x, y, spanWidth, rowHeight).stroke().restore();

      const isHeader = cell.tag === 'th';
      const fs = styleNumber(cell.styles || {}, 'font-size', isHeader ? 12.5 : 12);
      const lh = lineHeightValue(cell.styles || {}, fs, cell.tag || 'td');
      const lineGap = Math.max(0, lh - fs);
      const runs = inlineRuns(cell);
      const align = textAlign(cell.styles || {});
      const padT = styleNumber(cell.styles || {}, 'padding-top', cellPadding);
      const padB = styleNumber(cell.styles || {}, 'padding-bottom', cellPadding);
      const padL = styleNumber(cell.styles || {}, 'padding-left', cellPadding);
      const padR = styleNumber(cell.styles || {}, 'padding-right', cellPadding);

      // Text
      doc.x = x + padL;
      doc.y = y + padT;
      for (const run of runs) {
        selectFontForInline(doc, run.styles || {}, isHeader || !!run.bold, !!run.italic);
        doc.fillColor(styleColor(run.styles || {}, 'color', '#000')).text(run.text, {
          width: spanWidth - padL - padR,
          align,
          lineGap,
          continued: true,
        });
      }
      doc.text('', { continued: false });
      drawCol += colspan;
    }

    layout.cursorToNextLine(rowHeight);
  }
}

module.exports = { renderTable };
