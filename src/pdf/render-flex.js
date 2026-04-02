const { BASE_PT, mergeStyles, styleNumber, parsePxWithOptions } = require('./style');
const { selectFontForInline } = require('./text');
const { Layout } = require('./layout');

function measureLineWidth(line, doc) {
  let width = 0;
  for (const run of line) {
    const text = run.text || '';
    if (!text) continue;
    const size = styleNumber(run.styles || {}, 'font-size', BASE_PT);
    const letterSpacing = styleNumber(run.styles || {}, 'letter-spacing', 0, { baseSize: size });
    const wordSpacing = styleNumber(run.styles || {}, 'word-spacing', 0, { baseSize: size });
    selectFontForInline(doc, run.styles || {}, !!run.bold, !!run.italic, size);
    const spaces = (text.match(/ /g) || []).length;
    width += doc.widthOfString(text, { characterSpacing: letterSpacing }) + wordSpacing * spaces;
  }
  return width;
}

function collectLineRuns(node, parentStyles, isInlineDisplay, mergeStylesFn) {
  const lines = [[]];
  const pushLine = () => {
    if (lines[lines.length - 1].length) lines.push([]);
  };

  function walk(n, inherited, isRoot) {
    if (!n) return;
    if (n.type === 'text') {
      lines[lines.length - 1].push({ text: n.text || '', ...inherited });
      return;
    }
    if (n.type !== 'element') return;

    const tag = (n.tag || '').toLowerCase();
    const styles = { ...inherited.styles, ...mergeStylesFn(n) };
    const next = { ...inherited, styles };
    if (tag === 'b' || tag === 'strong') next.bold = true;
    if (tag === 'i' || tag === 'em') next.italic = true;

    const isInline = isInlineDisplay(tag, styles);
    if (!isInline && !isRoot) pushLine();
    (n.children || []).forEach((child) => walk(child, next, false));
    if (!isInline && !isRoot) pushLine();
  }

  walk(node, { bold: false, italic: false, styles: parentStyles }, true);
  if (lines.length && lines[lines.length - 1].length === 0) lines.pop();
  return lines;
}

function estimateNodeWidth(node, doc, isInlineDisplay) {
  if (!node) return 0;
  if (node.type === 'text') {
    const text = node.text || '';
    if (!text) return 0;
    selectFontForInline(doc, {}, false, false, BASE_PT);
    return doc.widthOfString(text);
  }
  if (node.type !== 'element') return 0;
  const styles = mergeStyles(node);
  const padding = styleNumber(styles, 'padding', 0);
  const padL = styleNumber(styles, 'padding-left', padding);
  const padR = styleNumber(styles, 'padding-right', padding);
  const borderWidth = styleNumber(styles, 'border-width', 0);
  const borderL = styleNumber(styles, 'border-left-width', borderWidth);
  const borderR = styleNumber(styles, 'border-right-width', borderWidth);
  const lines = collectLineRuns(node, styles, isInlineDisplay, mergeStyles);
  let maxWidth = 0;
  for (const line of lines) {
    maxWidth = Math.max(maxWidth, measureLineWidth(line, doc));
  }
  const widthEps = 1;
  return maxWidth + padL + padR + borderL + borderR + widthEps;
}

function parseFlexGrow(styles) {
  const grow = styles ? styles['flex-grow'] : null;
  if (grow != null) {
    const num = parseFloat(grow);
    if (Number.isFinite(num)) return num;
  }
  const flex = styles ? styles.flex : null;
  if (flex) {
    const first = String(flex).trim().split(/\s+/)[0];
    const num = parseFloat(first);
    if (Number.isFinite(num)) return num;
  }
  return 0;
}

async function renderFlexRow(children, ctx, { startX, startY, width, gap, rowGap, bottomMargin, justify, wrap }) {
  const { doc } = ctx;
  const measureOnly = !!ctx?.measureOnly;
  const debugInline = process.env.HTML_TO_PDF_DEBUG === '1';
  if (!children.length) return 0;
  const baseGap = Number.isFinite(gap) ? gap : 0;
  const rowSpace = Number.isFinite(rowGap) ? rowGap : baseGap;
  const count = children.length;
  const available = Math.max(0, width - baseGap * Math.max(0, count - 1));
  const isInlineDisplay = ctx._isInlineDisplay;
  const items = children.map((child) => {
    const childStyles = child.styles || {};
    const basis = styleNumber(childStyles, 'flex-basis', null, { percentBase: width });
    const explicitWidth = styleNumber(childStyles, 'width', null, { percentBase: width });
    const baseWidth = basis ?? explicitWidth ?? estimateNodeWidth(child, doc, isInlineDisplay);
    const grow = parseFlexGrow(childStyles);
    return { child, baseWidth: Math.max(0, baseWidth || 0), grow, hasExplicit: basis != null || explicitWidth != null };
  });

  let totalBase = items.reduce((sum, item) => sum + item.baseWidth, 0);
  const totalGrow = items.reduce((sum, item) => sum + (item.grow || 0), 0);
  let widths = items.map((item) => item.baseWidth);

  const justifyValue = String(justify || 'flex-start').toLowerCase();
  const canEven = ['space-between', 'space-around', 'space-evenly'].includes(justifyValue);
  const equalWidth = count ? available / count : 0;
  const allAuto = items.every((item) => !item.hasExplicit && (!item.grow || item.grow === 0));
  if (canEven && allAuto && equalWidth > 0 && items.every((item) => item.baseWidth <= equalWidth)) {
    widths = items.map(() => equalWidth);
    totalBase = available;
  }

  // Lazy require to break circular dependency (renderFlexRow → renderNode)
  const { renderNode } = require('./render-node');

  if (wrap && String(wrap).toLowerCase() !== 'nowrap') {
    let maxY = startY;
    let rowY = startY;
    let rowH = 0;
    let x = startX;
    for (let i = 0; i < count; i++) {
      const child = children[i];
      let childWidth = Math.max(0, widths[i] || 0);
      if (childWidth > width) childWidth = width;
      if (x > startX && x + childWidth > startX + width) {
        rowY += rowH + rowSpace;
        x = startX;
        rowH = 0;
      }
      const right = doc.page.width - (x + childWidth);
      const childLayout = new Layout(doc, {
        margins: { left: x, right, top: rowY, bottom: bottomMargin },
        measureOnly,
      });
      childLayout.atStartOfPage = false;
      await renderNode(child, { doc, layout: childLayout, options: ctx.options, measureOnly });
      const childHeight = childLayout.y - rowY;
      if (debugInline && child?.tag === 'div') {
        console.log('[flex-item]', {
          tag: child.tag,
          class: child.attrs?.class || '',
          childHeight,
          rowY,
          x,
          childWidth,
          containerWidth: width,
        });
      }
      rowH = Math.max(rowH, childHeight);
      maxY = Math.max(maxY, rowY + rowH);
      x += childWidth + baseGap;
    }
    return maxY - startY;
  }

  if (totalGrow > 0 && available > totalBase) {
    const extra = available - totalBase;
    widths = items.map((item) => item.baseWidth + extra * (item.grow / totalGrow));
    totalBase = available;
  } else if (totalBase > available && totalBase > 0) {
    const scale = available / totalBase;
    widths = widths.map((w) => w * scale);
    totalBase = available;
  }

  if (widths.every((w) => w <= 0)) {
    const fallback = count ? available / count : 0;
    widths = widths.map(() => fallback);
    totalBase = available;
  }

  const baseTotal = totalBase + baseGap * Math.max(0, count - 1);
  const remaining = Math.max(0, width - baseTotal);
  let offset = 0;
  let actualGap = baseGap;
  if (justifyValue === 'flex-end' || justifyValue === 'end') {
    offset = remaining;
  } else if (justifyValue === 'center') {
    offset = remaining / 2;
  } else if (justifyValue === 'space-between') {
    if (count > 1) actualGap = baseGap + remaining / (count - 1);
  } else if (justifyValue === 'space-around') {
    if (count > 0) {
      const add = remaining / count;
      actualGap = baseGap + add;
      offset = actualGap / 2;
    }
  } else if (justifyValue === 'space-evenly') {
    if (count > 0) {
      const add = remaining / (count + 1);
      actualGap = baseGap + add;
      offset = actualGap;
    }
  }

  let maxHeight = 0;
  let x = startX + offset;
  for (let i = 0; i < count; i++) {
    const child = children[i];
    const childWidth = Math.max(0, widths[i] || 0);
    const right = doc.page.width - (x + childWidth);
    const childLayout = new Layout(doc, {
      margins: { left: x, right, top: startY, bottom: bottomMargin },
      measureOnly,
    });
    childLayout.atStartOfPage = false;
    await renderNode(child, { doc, layout: childLayout, options: ctx.options, measureOnly });
    maxHeight = Math.max(maxHeight, childLayout.y - startY);
    x += childWidth + actualGap;
  }
  return maxHeight;
}

module.exports = { renderFlexRow, parseFlexGrow, estimateNodeWidth, measureLineWidth };
