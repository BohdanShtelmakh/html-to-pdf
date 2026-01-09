class Layout {
  constructor(doc, { margin = 0, margins: explicit = {} } = {}) {
    this.doc = doc;
    this.marginLeft = explicit.left ?? margin;
    this.marginRight = explicit.right ?? margin;
    this.marginTop = explicit.top ?? margin;
    this.marginBottom = explicit.bottom ?? margin;

    this.contentWidth = () => this.doc.page.width - this.marginLeft - this.marginRight;
    this.x = this.marginLeft;
    this.y = this.marginTop;

    this.pendingBottomMargin = 0;
    this.atStartOfPage = true;
  }

  ensureSpace(h) {
    const bottom = this.doc.page.height - this.marginBottom;
    if (this.y + h <= bottom) return;
    this.doc.addPage();
    this.x = this.marginLeft;
    this.y = this.marginTop;
    this.pendingBottomMargin = 0;
    this.atStartOfPage = true;
  }

  cursorToNextLine(h = 6) {
    this.y += h;
  }

  newBlock(mt = 0, mb = 0) {
    const topToApply = this.atStartOfPage ? Math.max(0, mt - this.marginTop) : Math.max(mt, this.pendingBottomMargin);
    this.y += topToApply;
    this.atStartOfPage = false;
    this.pendingBottomMargin = 0;
    return () => {
      this.pendingBottomMargin = mb;
    };
  }
}

module.exports = { Layout };
