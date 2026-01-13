const { styleNumber, styleColor, lineHeightValue } = require('./style');
const { inlineRuns, selectFontForInline, gatherPlainText } = require('./text');

async function renderList(node, ctx, ordered = false) {
  const { doc, layout } = ctx;
  const items = (node.children || []).filter((c) => c.type === 'element' && c.tag === 'li');
  let idx = 1;

  for (const li of items) {
    const bullet = ordered ? `${idx}. ` : '• ';
    const text = gatherPlainText(li) || '';

    const fontSize = styleNumber(li.styles || {}, 'font-size', 12);
    const lineGap = Math.max(0, lineHeightValue(li.styles || {}, fontSize, 'li') - fontSize);
    doc.font('Helvetica').fontSize(fontSize).fillColor('#000');

    const h = doc.heightOfString(bullet + text, {
      width: layout.contentWidth(),
      lineGap,
    });

    layout.ensureSpace(h);

    // Position at the list cursor for each item
    doc.x = layout.x;
    doc.y = layout.y;

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

    layout.cursorToNextLine(h);
    idx++;
  }
}

function normalizeCodeText(raw) {
  if (!raw) return '';
  const lines = raw.split(/\r?\n/);
  // Drop leading/trailing empty/whitespace-only lines.
  while (lines.length && /^\s*$/.test(lines[0])) lines.shift();
  while (lines.length && /^\s*$/.test(lines[lines.length - 1])) lines.pop();
  // Dedent by common indent of non-empty lines.
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
  const codeText = normalizeCodeText(gatherPlainText(node));
  const fs = styleNumber(styles, 'font-size', 10);
  const lineGap = 0;
  const padding = styleNumber(styles, 'padding', 0);

  doc.font('Courier').fontSize(fs).fillColor('#000');

  const h =
    doc.heightOfString(codeText.replace(/\n/g, ''), {
      width: layout.contentWidth() - padding * 2,
      lineGap,
    }) +
    padding * 2;

  layout.ensureSpace(h);

  const x = layout.x;
  const y = layout.y;
  const w = layout.contentWidth();

  doc.text(codeText, x + padding, y + padding, {
    width: w - padding * 2,
    lineGap,
  });

  layout.y = y + h;
}

module.exports = { renderList, renderPre };
