const { parsePxWithOptions } = require('./style');
const { Layout } = require('./layout');

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

async function renderGrid(children, ctx, { startX, startY, width, columns, colGap, rowGap, bottomMargin, alignItems }) {
  const { doc } = ctx;
  const measureOnly = !!ctx?.measureOnly;
  const debug = process.env.HTML_TO_PDF_DEBUG === '1';
  if (!children.length) return 0;
  const colWidths =
    Array.isArray(columns) && columns.length
      ? columns.map((w) => Math.max(0, w || 0))
      : Array.from({ length: Math.max(1, columns || 1) }, () =>
          Math.max(0, (width - colGap * (Math.max(1, columns || 1) - 1)) / Math.max(1, columns || 1))
        );
  const cols = colWidths.length;
  const rows = [];
  let colIndex = 0;
  let rowY = startY;
  let currentRow = { y: rowY, height: 0, items: [] };

  // Lazy require to break circular dependency (renderGrid → renderNode)
  const { renderNode } = require('./render-node');

  for (const child of children) {
    let span = parseGridSpan(child.styles?.['grid-column']);
    if (span > cols) span = cols;
    if (colIndex + span > cols && currentRow.items.length) {
      rows.push(currentRow);
      rowY += currentRow.height + rowGap;
      colIndex = 0;
      currentRow = { y: rowY, height: 0, items: [] };
    }

    const cellWidth = colWidths.slice(colIndex, colIndex + span).reduce((sum, w) => sum + w, 0) + colGap * (span - 1);
    const x = startX + colWidths.slice(0, colIndex).reduce((sum, w) => sum + w, 0) + colGap * colIndex;

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
  const totalHeight = rows.reduce((sum, row) => sum + row.height, 0) + Math.max(0, rows.length - 1) * rowGap;

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

module.exports = { renderGrid, parseGridTemplateColumns, parseGridColumnCount, parseGridSpan };
