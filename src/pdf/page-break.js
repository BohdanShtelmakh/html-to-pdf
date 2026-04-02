const { Layout } = require('./layout');

function applyPageBreakAfter(styles, ctx, node) {
  if (!styles || ctx?.measureOnly) return;
  const value = String(styles['page-break-after'] || '')
    .trim()
    .toLowerCase();
  const isLast = !!node?._isLastInParent;
  const parentTag = String(node?._parentTag || '').toLowerCase();
  if (value === 'always' && !(isLast && (parentTag === 'body' || parentTag === 'root'))) {
    ctx.layout.doc.addPage();
    ctx.layout.x = ctx.layout.marginLeft;
    ctx.layout.y = ctx.layout.marginTop;
    ctx.layout.pendingBottomMargin = 0;
    ctx.layout.atStartOfPage = true;
  }
}

function applyPageBreakBefore(styles, ctx) {
  if (!styles || ctx?.measureOnly) return;
  const before = String(styles['break-before'] || styles['page-break-before'] || '')
    .trim()
    .toLowerCase();
  const shouldBreak = ['always', 'page', 'left', 'right'].includes(before);
  if (!shouldBreak) return;
  if (ctx.layout.atStartOfPage) return;
  ctx.layout.doc.addPage();
  ctx.layout.x = ctx.layout.marginLeft;
  ctx.layout.y = ctx.layout.marginTop;
  ctx.layout.pendingBottomMargin = 0;
  ctx.layout.atStartOfPage = true;
}

function shouldAvoidBreakInside(styles = {}) {
  const value = String(styles['break-inside'] || styles['page-break-inside'] || '')
    .trim()
    .toLowerCase();
  return value === 'avoid' || value === 'avoid-page';
}

function maybeApplyBreakInsideAvoid(node, styles, ctx) {
  if (!node || !styles || !ctx || ctx.measureOnly || ctx.avoidMeasure) return;
  const tag = String(node.tag || '').toLowerCase();
  if (!shouldAvoidBreakInside(styles)) return;
  if (tag === 'root' || tag === 'body') return;
  const display = String(styles.display || '').toLowerCase();
  if (display === 'inline' || display === 'inline-block' || display === 'none') return;

  const { doc, layout } = ctx;
  const available = doc.page.height - layout.marginBottom - layout.y;
  const fullPage = doc.page.height - layout.marginTop - layout.marginBottom;
  if (available <= 0) return;

  const measureLayout = new Layout(doc, {
    margins: {
      left: layout.x,
      right: doc.page.width - (layout.x + layout.contentWidth()),
      top: layout.y,
      bottom: layout.marginBottom,
    },
    measureOnly: true,
  });
  measureLayout.atStartOfPage = layout.atStartOfPage;
  measureLayout.pendingBottomMargin = layout.pendingBottomMargin;

  // Lazy require to break circular dependency (renderNode → page-break → renderNode)
  const { renderNode } = require('./render-node');
  return renderNode(node, { ...ctx, layout: measureLayout, measureOnly: true, avoidMeasure: true }).then(() => {
    const estimated = Math.max(0, measureLayout.y - layout.y);
    if (estimated <= available) return;
    if (estimated > fullPage) return;
    layout.doc.addPage();
    layout.x = layout.marginLeft;
    layout.y = layout.marginTop;
    layout.pendingBottomMargin = 0;
    layout.atStartOfPage = true;
  });
}

function registerAnchorDestination(node, ctx) {
  if (!node || !ctx || ctx.measureOnly) return;
  if (ctx.options?.enableInternalAnchors === false) return;
  const id = node?.attrs?.id ? String(node.attrs.id).trim() : '';
  if (!id) return;
  if (typeof ctx.doc.addNamedDestination !== 'function') return;
  const seen = ctx.runtime?.namedDestinations;
  if (seen && seen.has(id)) return;
  try {
    ctx.doc.addNamedDestination(id, 'XYZ', null, ctx.layout.y, null);
    if (seen) seen.add(id);
  } catch (err) {
    if (process.env.HTML_TO_PDF_DEBUG === '1') console.warn('[anchor-dest] failed for id=' + id, err.message || err);
  }
}

module.exports = {
  applyPageBreakAfter,
  applyPageBreakBefore,
  shouldAvoidBreakInside,
  maybeApplyBreakInsideAvoid,
  registerAnchorDestination,
};
