const { styleNumber, styleColor, textAlign } = require('./style');
const { inlineRuns, selectFontForInline, gatherPlainText } = require('./text');

async function renderList(node, ctx, ordered = false) {
  const { doc, layout } = ctx;
  const items = (node.children || []).filter((c) => c.type === 'element' && c.tag === 'li');
  let idx = 1;

  for (const li of items) {
    const bullet = ordered ? `${idx}. ` : '• ';
    const text = gatherPlainText(li) || '';

    const fontSize = styleNumber(li.styles || {}, 'font-size', 12);

    const lineGap = Math.max(0, fontSize * (1.2 - 1));
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

    layout.cursorToNextLine(h + lineGap);
    idx++;
  }
}

async function renderPre(node, ctx, styles) {
  const { doc, layout } = ctx;
  const codeText = gatherPlainText(node);
  const fs = styleNumber(styles, 'font-size', 11);
  const lineGap = Math.max(0, fs * (1.3 - 1));
  const padding = 6;

  const h =
    doc.heightOfString(codeText, {
      width: layout.contentWidth() - padding * 2,
      lineGap,
    }) +
    padding * 2;

  layout.ensureSpace(h + 4);
  const x = layout.x;
  const y = layout.y;
  const w = layout.contentWidth();

  doc.save().rect(x, y, w, h).fill('#f5f5f5').restore();

  doc.font('Courier').fontSize(fs).fillColor('#000');
  doc.text(codeText, x + padding, y + padding, {
    width: w - padding * 2,
    lineGap,
  });

  layout.y = y + h + 2;
}

module.exports = { renderList, renderPre };
