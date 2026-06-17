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
  // "Uniform" only considers sides that are actually present (width > 0): all
  // present sides must share the same width and the same colour. When every
  // side is present this is the classic uniform-border case; when only some
  // sides are present (e.g. a single border-bottom) the borders are NOT
  // uniform and must be drawn per-side.
  const present = [bTop, bRight, bBottom, bLeft].filter((b) => b.width > 0);
  const allSidesPresent = present.length === 4;
  const uniformPresent =
    allSidesPresent &&
    present.every((b) => b.width === present[0].width && b.color === present[0].color);
  const useRounded = r > 0 && (bg || anyBorderWidth);

  if (useRounded) {
    const rr = Math.min(r, w / 2, h / 2);
    if (bg) {
      doc.save().roundedRect(x, y, w, h, rr).fill(bg).restore();
    }
    if (uniformPresent) {
      // Common case: all four borders identical — one clean rounded stroke.
      const strokeWidth = present[0].width;
      const inset = Math.max(0, strokeWidth / 2);
      const insetW = Math.max(0, w - strokeWidth);
      const insetH = Math.max(0, h - strokeWidth);
      const insetR = Math.max(0, rr - inset);
      doc
        .save()
        .lineWidth(strokeWidth)
        .strokeColor(present[0].color || '#333333')
        .roundedRect(x + inset, y + inset, insetW, insetH, insetR)
        .stroke()
        .restore();
    } else if (anyBorderWidth) {
      // Asymmetric borders with a radius: draw each present side as its own
      // stroked path, with a quarter-circle arc only at corners shared by two
      // present sides. Each side keeps its own width and colour.
      drawAsymmetricRoundedBorders(doc, x, y, w, h, rr, bTop, bRight, bBottom, bLeft);
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

/**
 * Draw asymmetric per-side borders inside a rounded rect.
 *
 * Each present side is stroked along its own centreline (inset by half its
 * width) keeping its own width and colour. A quarter-circle arc is drawn at a
 * corner only when BOTH adjacent sides are present; the arc is assigned to a
 * single owning side so it is drawn exactly once (top owns the top-left arc,
 * right owns the top-right, bottom owns the bottom-right, left owns the
 * bottom-left). Where an adjacent side is absent the edge simply ends square.
 *
 * @param {PDFDocument} doc
 * @param {number} x  @param {number} y  @param {number} w  @param {number} h
 * @param {number} rr  Clamped corner radius.
 * @param {{width:number,color:string|null}} bTop
 * @param {{width:number,color:string|null}} bRight
 * @param {{width:number,color:string|null}} bBottom
 * @param {{width:number,color:string|null}} bLeft
 */
function drawAsymmetricRoundedBorders(doc, x, y, w, h, rr, bTop, bRight, bBottom, bLeft) {
  const hasT = bTop.width > 0;
  const hasR = bRight.width > 0;
  const hasB = bBottom.width > 0;
  const hasL = bLeft.width > 0;

  // Outer corner centres for the arcs (on the outer rounded-rect path).
  const cTL = { x: x + rr, y: y + rr };
  const cTR = { x: x + w - rr, y: y + rr };
  const cBR = { x: x + w - rr, y: y + h - rr };
  const cBL = { x: x + rr, y: y + h - rr };

  const stroke = (side, build) => {
    if (side.width <= 0) return;
    doc.save().lineWidth(side.width).strokeColor(side.color || '#333333');
    build(Math.max(0, side.width / 2));
    doc.stroke().restore();
  };

  // Top edge: from after the top-left corner to before the top-right corner,
  // both insets accounting for the radius. Owns the top-left arc.
  stroke(bTop, (inset) => {
    const ty = y + inset;
    const startX = hasL ? cTL.x : x + inset;
    const endX = hasR ? cTR.x : x + w - inset;
    if (hasT && hasL) {
      // Top-left arc from left edge up to the start of the top run.
      doc.moveTo(x + inset, cTL.y);
      quarterArcImpl(doc, cTL.x, cTL.y, rr, inset, 'tl');
    } else {
      doc.moveTo(startX, ty);
    }
    doc.lineTo(endX, ty);
  });

  // Right edge: owns the top-right arc.
  stroke(bRight, (inset) => {
    const rx = x + w - inset;
    const startY = hasT ? cTR.y : y + inset;
    const endY = hasB ? cBR.y : y + h - inset;
    if (hasR && hasT) {
      doc.moveTo(cTR.x, y + inset);
      quarterArcImpl(doc, cTR.x, cTR.y, rr, inset, 'tr');
    } else {
      doc.moveTo(rx, startY);
    }
    doc.lineTo(rx, endY);
  });

  // Bottom edge: owns the bottom-right arc.
  stroke(bBottom, (inset) => {
    const by = y + h - inset;
    const startX = hasR ? cBR.x : x + w - inset;
    const endX = hasL ? cBL.x : x + inset;
    if (hasB && hasR) {
      doc.moveTo(x + w - inset, cBR.y);
      quarterArcImpl(doc, cBR.x, cBR.y, rr, inset, 'br');
    } else {
      doc.moveTo(startX, by);
    }
    doc.lineTo(endX, by);
  });

  // Left edge: owns the bottom-left arc.
  stroke(bLeft, (inset) => {
    const lx = x + inset;
    const startY = hasB ? cBL.y : y + h - inset;
    const endY = hasT ? cTL.y : y + inset;
    if (hasL && hasB) {
      doc.moveTo(cBL.x, y + h - inset);
      quarterArcImpl(doc, cBL.x, cBL.y, rr, inset, 'bl');
    } else {
      doc.moveTo(lx, startY);
    }
    doc.lineTo(lx, endY);
  });
}

/**
 * Append a quarter-circle arc to the current path using a cubic Bezier
 * approximation, traced along a circle of radius (radius - inset) centred at
 * (cx, cy). The arc connects the two straight runs meeting at one corner.
 *
 * @param {number} cx  @param {number} cy  Corner centre (on the outer path).
 * @param {number} radius  Outer corner radius.
 * @param {number} inset   Half the stroke width (centreline inset).
 * @param {('tl'|'tr'|'br'|'bl')} corner
 */
function quarterArcImpl(doc, cx, cy, radius, inset, corner) {
  const rad = Math.max(0, radius - inset);
  // Bezier control-point distance for a quarter circle.
  const k = 0.5522847498 * rad;
  if (corner === 'tl') {
    // from left edge (cx-rad, cy) up to top edge (cx, cy-rad)
    doc.bezierCurveTo(cx - rad, cy - k, cx - k, cy - rad, cx, cy - rad);
  } else if (corner === 'tr') {
    // from top edge (cx, cy-rad) to right edge (cx+rad, cy)
    doc.bezierCurveTo(cx + k, cy - rad, cx + rad, cy - k, cx + rad, cy);
  } else if (corner === 'br') {
    // from right edge (cx+rad, cy) to bottom edge (cx, cy+rad)
    doc.bezierCurveTo(cx + rad, cy + k, cx + k, cy + rad, cx, cy + rad);
  } else {
    // 'bl': from bottom edge (cx, cy+rad) to left edge (cx-rad, cy)
    doc.bezierCurveTo(cx - k, cy + rad, cx - rad, cy + k, cx - rad, cy);
  }
  return doc;
}

module.exports = { drawBox };
