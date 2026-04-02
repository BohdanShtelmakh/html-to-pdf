/**
 * Draw a box with optional background, per-side borders, and border-radius.
 *
 * @param {PDFDocument} doc  PDFKit document instance.
 * @param {number} x        Left edge.
 * @param {number} y        Top edge.
 * @param {number} w        Total width.
 * @param {number} h        Total height.
 * @param {Object} opts
 * @param {string|null}  opts.bg      Background fill colour (null = no fill).
 * @param {{width:number,color:string|null}} opts.borderTop
 * @param {{width:number,color:string|null}} opts.borderRight
 * @param {{width:number,color:string|null}} opts.borderBottom
 * @param {{width:number,color:string|null}} opts.borderLeft
 * @param {number} opts.radius  Border-radius in points (0 = sharp corners).
 */
function drawBox(doc, x, y, w, h, { bg, borderTop, borderRight, borderBottom, borderLeft, radius }) {
  if (w <= 0 || h <= 0) return;

  const bTop = borderTop || { width: 0, color: null };
  const bRight = borderRight || { width: 0, color: null };
  const bBottom = borderBottom || { width: 0, color: null };
  const bLeft = borderLeft || { width: 0, color: null };
  const r = radius || 0;

  const anyBorderWidth = bTop.width || bRight.width || bBottom.width || bLeft.width;
  const uniformWidth =
    bTop.width === bRight.width && bTop.width === bBottom.width && bTop.width === bLeft.width;
  const uniformColor =
    bTop.color === bRight.color && bTop.color === bBottom.color && bTop.color === bLeft.color;
  const useRounded = r > 0 && (bg || anyBorderWidth);

  if (useRounded) {
    const rr = Math.min(r, w / 2, h / 2);
    if (bg) {
      doc.save().roundedRect(x, y, w, h, rr).fill(bg).restore();
    }
    const strokeWidth = uniformWidth ? bTop.width : anyBorderWidth;
    const strokeColor = uniformColor ? bTop.color : bTop.color || bRight.color || bBottom.color || bLeft.color;
    if (strokeWidth) {
      const inset = Math.max(0, strokeWidth / 2);
      const insetW = Math.max(0, w - strokeWidth);
      const insetH = Math.max(0, h - strokeWidth);
      const insetR = Math.max(0, rr - inset);
      doc
        .save()
        .lineWidth(strokeWidth)
        .strokeColor(strokeColor || '#333333')
        .roundedRect(x + inset, y + inset, insetW, insetH, insetR)
        .stroke()
        .restore();
    }
  } else {
    if (bg) {
      doc.save().rect(x, y, w, h).fill(bg).restore();
    }
    if (bTop.width) {
      doc.save().rect(x, y, w, bTop.width).fill(bTop.color || '#333333').restore();
    }
    if (bRight.width) {
      doc.save().rect(x + w - bRight.width, y, bRight.width, h).fill(bRight.color || '#333333').restore();
    }
    if (bBottom.width) {
      doc.save().rect(x, y + h - bBottom.width, w, bBottom.width).fill(bBottom.color || '#333333').restore();
    }
    if (bLeft.width) {
      doc.save().rect(x, y, bLeft.width, h).fill(bLeft.color || '#333333').restore();
    }
  }
}

module.exports = { drawBox };
