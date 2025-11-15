const { styleNumber, styleColor, textAlign } = require('../pdf/style');
const { inlineRuns, selectFontForInline, gatherPlainText } = require('../pdf/text');

async function renderTable(node, ctx, tableStyles = {}) {
  const { doc, layout } = ctx;

  const tbody = (node.children || []).find((c) => c.type === 'element' && c.tag === 'tbody');
  if (!tbody) return;

  // Collect rows
  const rows = (tbody.children || []).filter((r) => r.type === 'element' && r.tag === 'tr');
  if (!rows.length) return;

  // Determine column count from first row
  const firstCells = (rows[0].children || []).filter((c) => c.type === 'element' && (c.tag === 'td' || c.tag === 'th'));
  const cols = firstCells.length || 1;

  const cellPadding = 6;
  const colW = layout.contentWidth() / cols;
  const borderColor = '#000000';
  const borderWidth = 1;

  for (const row of rows) {
    // Measure row height (max cell height)
    let rowHeight = 0;
    const cells = (row.children || []).filter((c) => c.type === 'element' && (c.tag === 'td' || c.tag === 'th'));

    // Pre-measure
    for (let ci = 0; ci < cols; ci++) {
      const cell = cells[ci];
      const text = cell ? gatherPlainText(cell) : '';
      const isHeader = cell && cell.tag === 'th';
      const fs = styleNumber(cell?.styles || {}, 'font-size', isHeader ? 12.5 : 12);
      const lineGap = Math.max(0, fs * (1.2 - 1));
      const h = doc.heightOfString(text, { width: colW - cellPadding * 2, lineGap });
      rowHeight = Math.max(rowHeight, h + cellPadding * 2);
    }

    layout.ensureSpace(rowHeight + 2);

    // Draw cells
    for (let ci = 0; ci < cols; ci++) {
      const x = layout.x + ci * colW;
      const y = layout.y;
      // Border
      doc.save().lineWidth(borderWidth).strokeColor(borderColor).rect(x, y, colW, rowHeight).stroke().restore();

      const cell = cells[ci];
      if (!cell) continue;

      const isHeader = cell.tag === 'th';
      const fs = styleNumber(cell.styles || {}, 'font-size', isHeader ? 12.5 : 12);
      const align = textAlign(cell.styles || {});
      const lineGap = Math.max(0, fs * (1.2 - 1));
      const runs = inlineRuns(cell);

      // Text
      doc.x = x + cellPadding;
      doc.y = y + cellPadding;
      for (const run of runs) {
        selectFontForInline(doc, run.styles || {}, isHeader || !!run.bold, !!run.italic);
        doc.fillColor(styleColor(run.styles || {}, 'color', '#000')).text(run.text, {
          width: colW - cellPadding * 2,
          align,
          lineGap,
          continued: true,
        });
      }
      doc.text('', { continued: false });
    }

    layout.cursorToNextLine(rowHeight);
  }
}

module.exports = { renderTable };
