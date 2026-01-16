const { styleNumber, styleColor, lineHeightValue } = require('./style');
const { inlineRuns, selectFontForInline, gatherPlainText } = require('./text');

async function renderList(node, ctx, ordered = false) {
  const { doc, layout } = ctx;
  const measureOnly = !!ctx?.measureOnly;
  const items = (node.children || []).filter((c) => c.type === 'element' && c.tag === 'li');
  const listStyle = String((node.styles || {})['list-style'] || '').toLowerCase();
  const listStyleType = String((node.styles || {})['list-style-type'] || '').toLowerCase();
  const hideBullet = listStyle.includes('none') || listStyleType === 'none';
  let idx = 1;

  for (const li of items) {
    const bullet = hideBullet ? '' : ordered ? `${idx}. ` : '• ';
    const text = gatherPlainText(li) || '';

    const fontSize = styleNumber(li.styles || {}, 'font-size', 12);
    const lineGap = Math.max(0, lineHeightValue(li.styles || {}, fontSize, 'li') - fontSize);
    const padding = styleNumber(li.styles || {}, 'padding', 0);
    const padT = styleNumber(li.styles || {}, 'padding-top', padding);
    const padB = styleNumber(li.styles || {}, 'padding-bottom', padding);
    const padL = styleNumber(li.styles || {}, 'padding-left', padding);
    const padR = styleNumber(li.styles || {}, 'padding-right', padding);
    const borderBottomWidth = styleNumber(li.styles || {}, 'border-bottom-width', 0);
    const borderBottomStyle = String(li.styles?.['border-bottom-style'] || '').trim().toLowerCase();
    const borderBottomColor = styleColor(li.styles || {}, 'border-bottom-color', '#000');

    selectFontForInline(doc, li.styles || {}, false, false);
    doc.fontSize(fontSize);
    if (!measureOnly) doc.fillColor('#000');

    const h = doc.heightOfString(bullet + text, {
      width: layout.contentWidth() - padL - padR,
      lineGap,
    });
    const totalHeight = padT + h + padB + borderBottomWidth;
    const debug = process.env.HTML_TO_PDF_DEBUG === '1';
    if (debug) {
      console.log('[list-item]', {
        text: bullet + text,
        fontSize,
        lineGap,
        width: layout.contentWidth() - padL - padR,
        h,
        totalHeight,
        padT,
        padB,
        borderBottomWidth,
        y: layout.y,
        measureOnly,
      });
    }

    layout.ensureSpace(totalHeight);

    if (!measureOnly) {
      doc.x = layout.x + padL;
      doc.y = layout.y + padT;

      doc.text(bullet, doc.x, doc.y, { continued: true });
      const runs = inlineRuns(li);
      for (const run of runs) {
        selectFontForInline(doc, run.styles || {}, !!run.bold, !!run.italic);
        doc.fillColor(styleColor(run.styles || {}, 'color', '#000')).text(run.text, {
          lineGap,
          continued: true,
        });
      }
      doc.text('', { continued: false });
    }

    if (!measureOnly && borderBottomWidth > 0) {
      const lineW = Math.max(0.5, borderBottomWidth);
      const y = layout.y + totalHeight - lineW / 2;
      if (borderBottomStyle === 'dashed') {
        const dash = Math.max(2, lineW * 2);
        doc
          .save()
          .dash(dash, { space: dash })
          .lineWidth(lineW)
          .strokeColor(borderBottomColor)
          .moveTo(layout.x, y)
          .lineTo(layout.x + layout.contentWidth(), y)
          .stroke()
          .undash()
          .restore();
      } else {
        doc
          .save()
          .lineWidth(lineW)
          .strokeColor(borderBottomColor)
          .moveTo(layout.x, y)
          .lineTo(layout.x + layout.contentWidth(), y)
          .stroke()
          .restore();
      }
    }

    layout.cursorToNextLine(totalHeight);
    idx++;
  }
}

function normalizeCodeText(raw) {
  if (!raw) return '';
  const lines = raw.split(/\r?\n/);
  while (lines.length && /^\s*$/.test(lines[0])) lines.shift();
  while (lines.length && /^\s*$/.test(lines[lines.length - 1])) lines.pop();
  let indent = Infinity;
  for (const l of lines) {
    if (!l.trim()) continue;
    const m = l.match(/^(\s*)/);
    indent = Math.min(indent, m ? m[1].length : 0);
  }
  if (!Number.isFinite(indent)) indent = 0;
  return lines.map((l) => l.slice(indent)).join('\n');
}

async function renderPre(node, ctx, styles) {
  const { doc, layout } = ctx;
  const measureOnly = !!ctx?.measureOnly;
  const codeText = normalizeCodeText(gatherPlainText(node));
  const fs = styleNumber(styles, 'font-size', 10);
  const lineGap = 0;
  const padding = styleNumber(styles, 'padding', 0);

  if (!measureOnly) doc.font('Courier').fontSize(fs).fillColor('#000');

  const h =
    doc.heightOfString(codeText, {
      width: layout.contentWidth() - padding * 2,
      lineGap,
    }) +
    padding * 2;

  layout.ensureSpace(h);

  const x = layout.x;
  const y = layout.y;
  const w = layout.contentWidth();

  if (!measureOnly) {
    doc.text(codeText, x + padding, y + padding, {
      width: w - padding * 2,
      lineGap,
    });
  }

  layout.y = y + h;
}

module.exports = { renderList, renderPre };
