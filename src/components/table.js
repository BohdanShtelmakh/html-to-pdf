const { styleNumber, styleColor, textAlign, lineHeightValue, parsePxWithOptions } = require('../pdf/style');
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

function whiteSpaceMode(styles = {}) {
  return String(styles['white-space'] || 'normal').trim().toLowerCase();
}

function isNowrap(styles = {}) {
  const mode = whiteSpaceMode(styles);
  return mode === 'nowrap' || mode === 'pre';
}

function preservesSourceWhitespace(styles = {}) {
  const mode = whiteSpaceMode(styles);
  return mode === 'pre' || mode === 'pre-wrap' || mode === 'break-spaces';
}

function normalizeInlineText(raw, styles = {}) {
  const text = String(raw || '');
  if (preservesSourceWhitespace(styles)) return text.replace(/\u000b/g, '\n');

  return text
    .split('\u000b')
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cellPlainText(cell, styles = cell?.styles || {}) {
  let out = '';
  function walk(n) {
    if (!n) return;
    if (n.type === 'text') {
      out += n.text || '';
      return;
    }
    if (n.type !== 'element') return;
    const tag = (n.tag || '').toLowerCase();
    if (tag === 'br') {
      out += '\u000b';
      return;
    }
    (n.children || []).forEach(walk);
  }
  walk(cell);
  return normalizeInlineText(out, styles);
}

function normalizeCellRuns(runs, styles = {}) {
  if (preservesSourceWhitespace(styles)) {
    return runs.map((run) => (run.isLineBreak ? { ...run, text: '\n', isLineBreak: true } : run));
  }

  const out = [];
  let pendingSpace = false;
  let lineHasText = false;

  for (const run of runs) {
    if (run.isLineBreak) {
      if (out.length && out[out.length - 1].text) {
        out[out.length - 1] = { ...out[out.length - 1], text: out[out.length - 1].text.replace(/\s+$/g, '') };
      }
      out.push({ ...run, text: '\n', isLineBreak: true });
      pendingSpace = false;
      lineHasText = false;
      continue;
    }

    let text = '';
    for (const ch of String(run.text || '')) {
      if (/\s/.test(ch)) {
        pendingSpace = true;
        continue;
      }
      if (pendingSpace && lineHasText) text += ' ';
      text += ch;
      pendingSpace = false;
      lineHasText = true;
    }

    if (text) out.push({ ...run, text });
  }

  return out;
}

function renderCellRuns(doc, runs, { x, y, width, align, lineGap, isHeader, nowrap, ctx }) {
  const lines = [[]];
  for (const run of runs) {
    if (run.isLineBreak) {
      lines.push([]);
    } else if (run.text) {
      lines[lines.length - 1].push(run);
    }
  }

  let cursorY = y;
  for (const line of lines) {
    doc.x = x;
    doc.y = cursorY;
    if (!line.length) {
      doc.y += Math.max(1, lineGap || 0);
      cursorY = doc.y;
      continue;
    }

    const text = line.map((run) => run.text || '').join('');
    const firstRun = line.find((run) => run.text) || {};
    selectFontForInline(doc, firstRun.styles || {}, isHeader || !!firstRun.bold, !!firstRun.italic, null, text);
    const linkOpts = getRunLinkTextOptions(firstRun, {
      enableInternalAnchors: ctx?.options?.enableInternalAnchors,
    });
    doc
      .fillColor(styleColor(firstRun.styles || {}, 'color', '#000'))
      .text(text, {
        width,
        align,
        lineGap,
        lineBreak: !nowrap,
        ...linkOpts,
      });

    cursorY = doc.y;
  }
}

function measureCellRuns(doc, runs, { width, align, lineGap, isHeader, nowrap }) {
  const lines = [[]];
  for (const run of runs) {
    if (run.isLineBreak) {
      lines.push([]);
    } else if (run.text) {
      lines[lines.length - 1].push(run);
    }
  }

  let total = 0;
  for (const line of lines) {
    if (!line.length) {
      total += Math.max(1, lineGap || 0);
      continue;
    }

    const text = line.map((run) => run.text || '').join('');
    const firstRun = line.find((run) => run.text) || {};
    selectFontForInline(doc, firstRun.styles || {}, isHeader || !!firstRun.bold, !!firstRun.italic, null, text);
    total += doc.heightOfString(text, {
      width,
      align,
      lineGap,
      lineBreak: !nowrap,
    });
  }
  return total;
}

function parseLengthValue(value, percentBase, baseSize) {
  if (value == null) return null;
  const parsed = parsePxWithOptions(value, null, { base: baseSize, percentBase });
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function cellExplicitWidth(cell, contentWidth, baseSize) {
  const styles = cell?.styles || {};
  const cssWidth = parseLengthValue(styles.width, contentWidth, baseSize);
  if (cssWidth != null) return cssWidth;
  return parseLengthValue(cell?.attrs?.width, contentWidth, baseSize);
}

function cellMinWidth(cell, contentWidth, baseSize) {
  const styles = cell?.styles || {};
  return parseLengthValue(styles['min-width'], contentWidth, baseSize);
}

function measureTokenWidth(doc, text, styles, bold, fontSize) {
  selectFontForInline(doc, styles || {}, bold, false, fontSize, text);
  let max = 0;
  for (const token of textTokens(text)) {
    max = Math.max(max, doc.widthOfString(token));
  }
  return max;
}

function distributeColumnWidths(preferred, minimum, totalWidth, fixed = []) {
  const cols = preferred.length;
  if (!cols) return [];
  const fixedWidths = fixed.map((w) => (Number.isFinite(w) && w >= 0 ? w : null));
  const target = preferred.map((w, i) => Math.max(w || 0, minimum[i] || 0, fixedWidths[i] || 0));
  return distributeFlexibleColumnWidths(target, minimum, totalWidth);
}

function distributeFlexibleColumnWidths(preferred, minimum, totalWidth) {
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

// Header cells are bold by default; force bold on the non-emoji runs so the
// manual breaker keeps the weight that selectFontForInline would have applied.
function emojiCellRuns(runs, isHeader) {
  if (!isHeader) return runs;
  return runs.map((r) => (r.isEmoji ? r : { ...r, bold: true }));
}

function measureEmojiCell(ctx, runs, cellStyles, isHeader, innerWidth, align, lineGap, tag) {
  const { renderInlineRunsAt } = require('../pdf/render-node');
  return renderInlineRunsAt(emojiCellRuns(runs, isHeader), ctx, {
    baseStyles: cellStyles || {},
    align,
    lineGap,
    tag: tag || 'td',
    x: 0,
    y: 0,
    width: innerWidth,
    measureOnly: true,
  });
}

function drawEmojiCell(ctx, runs, cellStyles, isHeader, x, y, innerWidth, align, lineGap, tag) {
  const { renderInlineRunsAt } = require('../pdf/render-node');
  renderInlineRunsAt(emojiCellRuns(runs, isHeader), ctx, {
    baseStyles: cellStyles || {},
    align,
    lineGap,
    tag: tag || 'td',
    x,
    y,
    width: innerWidth,
  });
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
  const fixedWidths = Array(cols).fill(null);

  for (const row of rows) {
    let colIndex = 0;
    const cells = (row.children || []).filter((c) => c.type === 'element' && (c.tag === 'td' || c.tag === 'th'));
    for (const cell of cells) {
      const colspan = parseInt(cell.attrs?.colspan, 10) || 1;
      const cellStyles = cell.styles || {};
      const text = cellPlainText(cell, cellStyles) || '';
      const isHeader = cell.tag === 'th';
      const fs = styleNumber(cellStyles, 'font-size', isHeader ? 12.5 : 12);
      const lh = lineHeightValue(cellStyles, fs, cell.tag || 'td');
      const lineGap = Math.max(0, lh - fs);
      const padL = styleNumber(cellStyles, 'padding-left', cellPadding);
      const padR = styleNumber(cellStyles, 'padding-right', cellPadding);
      const explicitWidth = cellExplicitWidth(cell, contentWidth, fs);
      const explicitMinWidth = cellMinWidth(cell, contentWidth, fs);
      const availableWidth = Math.max(10, (contentWidth / cols) * colspan - padL - padR);
      selectFontForInline(doc, cellStyles, isHeader, false, fs, text);
      const measured = hasBlockCellContent(cell)
        ? availableWidth
        : Math.min(doc.widthOfString(text), contentWidth);
      const tokenWidth = isNowrap(cellStyles) ? measured : measureTokenWidth(doc, text, cellStyles, isHeader, fs);
      const needed = measured + padL + padR;
      const cssMinNeeded = explicitMinWidth != null ? explicitMinWidth : 0;
      const minNeeded = Math.min(Math.max(tokenWidth + padL + padR, cssMinNeeded), contentWidth);
      const target = explicitWidth != null ? explicitWidth : needed;
      const perCol = target / colspan;
      const minPerCol = minNeeded / colspan;
      for (let i = 0; i < colspan && colIndex + i < cols; i++) {
        preferredWidths[colIndex + i] = Math.max(preferredWidths[colIndex + i], perCol);
        minWidths[colIndex + i] = Math.max(minWidths[colIndex + i], minPerCol);
        if (explicitWidth != null) {
          fixedWidths[colIndex + i] = Math.max(fixedWidths[colIndex + i] || 0, perCol);
        }
      }
      colIndex += colspan;
    }
  }

  const colWidths = distributeColumnWidths(preferredWidths, minWidths, contentWidth, fixedWidths);

  for (const row of rows) {
    let rowHeight = 0;
    const cells = (row.children || []).filter((c) => c.type === 'element' && (c.tag === 'td' || c.tag === 'th'));
    const rowStyles = row.styles || {};

    let measureCol = 0;
    for (const cell of cells) {
      const colspan = parseInt(cell.attrs?.colspan, 10) || 1;
      const spanWidth = colWidths.slice(measureCol, measureCol + colspan).reduce((a, b) => a + b, 0);
      const cellStyles = cell.styles || {};
      const text = cellPlainText(cell, cellStyles) || '';
      const isHeader = cell.tag === 'th';
      const fs = styleNumber(cellStyles, 'font-size', isHeader ? 12.5 : 12);
      const lh = lineHeightValue(cellStyles, fs, cell.tag || 'td');
      const lineGap = Math.max(0, lh - fs);
      const padT = styleNumber(cellStyles, 'padding-top', cellPadding);
      const padB = styleNumber(cellStyles, 'padding-bottom', cellPadding);
      const padL = styleNumber(cellStyles, 'padding-left', cellPadding);
      const padR = styleNumber(cellStyles, 'padding-right', cellPadding);
      selectFontForInline(doc, cellStyles, isHeader, false, fs, text);
      const innerWidth = Math.max(1, spanWidth - padL - padR);
      const align = textAlign(cellStyles || {});
      const rawText = gatherPlainText(cell) || '';
      const normalizedRuns = normalizeCellRuns(inlineRuns(cell, cellStyles), cellStyles);
      const renderPlainText = text !== rawText || text.includes('\n') || isNowrap(cellStyles);
      const cellHasEmoji = !!doc._emoji && !hasBlockCellContent(cell) && normalizedRuns.some((r) => r.isEmoji);
      const h = hasBlockCellContent(cell)
        ? await measureBlockCell(cell, ctx, 0, innerWidth, 0, layout.marginBottom)
        : cellHasEmoji
          ? measureEmojiCell(ctx, normalizedRuns, cellStyles, isHeader, innerWidth, align, lineGap, cell.tag)
          : renderPlainText
            ? measureCellRuns(doc, normalizedRuns, {
                width: innerWidth,
                align,
                lineGap,
                isHeader,
                nowrap: isNowrap(cellStyles),
              })
            : doc.heightOfString(text, { width: innerWidth, lineGap, lineBreak: !isNowrap(cellStyles) });
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
      const runs = inlineRuns(cell, cellStyles);
      const text = cellPlainText(cell, cellStyles) || '';
      const rawText = gatherPlainText(cell) || '';
      const renderPlainText = text !== rawText || text.includes('\n') || isNowrap(cellStyles);
      const align = textAlign(cellStyles || {});
      const padT = styleNumber(cell.styles || {}, 'padding-top', cellPadding);
      const padB = styleNumber(cell.styles || {}, 'padding-bottom', cellPadding);
      const padL = styleNumber(cell.styles || {}, 'padding-left', cellPadding);
      const padR = styleNumber(cell.styles || {}, 'padding-right', cellPadding);

      if (!measureOnly) {
        const innerWidth = Math.max(1, spanWidth - padL - padR);
        const normalized = normalizeCellRuns(runs, cellStyles);
        const cellHasEmoji = !!doc._emoji && !hasBlockCellContent(cell) && normalized.some((r) => r.isEmoji);
        if (hasBlockCellContent(cell)) {
          await renderBlockCell(cell, ctx, x + padL, y + padT, innerWidth, layout.marginBottom);
        } else if (cellHasEmoji) {
          drawEmojiCell(ctx, normalized, cellStyles, isHeader, x + padL, y + padT, innerWidth, align, lineGap, cell.tag);
        } else if (renderPlainText) {
          renderCellRuns(doc, normalizeCellRuns(runs, cellStyles), {
            x: x + padL,
            y: y + padT,
            width: innerWidth,
            align,
            lineGap,
            isHeader,
            nowrap: isNowrap(cellStyles),
            ctx,
          });
        } else {
          doc.x = x + padL;
          doc.y = y + padT;
          for (const run of runs) {
            selectFontForInline(doc, run.styles || {}, isHeader || !!run.bold, !!run.italic, null, run.text);
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

module.exports = {
  renderTable,
  _tableInternals: {
    cellExplicitWidth,
    cellMinWidth,
    cellPlainText,
    distributeColumnWidths,
  },
};
