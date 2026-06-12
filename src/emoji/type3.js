// Type 3 color-emoji font emitter for PDFKit.
//
// This builds PDF Type 3 fonts whose glyph procedures draw the emoji bitmap as
// an image XObject — the same mechanism Chromium/Skia and LibreOffice use. The
// result is real, selectable, searchable text (via ToUnicode), not per-emoji
// inline images.
//
// Currently implements the sbix path (Apple Color Emoji). COLRv0 vector layers
// are a planned follow-up; register() returns null for unsupported formats so
// callers transparently fall back to plain-text rendering.

let PNG = null;
try {
  PNG = require('png-js'); // ships with pdfkit
} catch {
  PNG = null;
}

const DEBUG = () => process.env.HTML_TO_PDF_DEBUG_EMOJI === '1';

const GLYPH_UNITS = 1000; // Type3 glyph space; FontMatrix scales by 1/1000
const FIRST_CODE = 33; // first usable single-byte code per subfont
const LAST_CODE = 255; // 33..255 -> 223 glyphs per Type3 subfont instance
const STRIKE = 128; // sbix strike size to pull (px); PDF scales it to 1em

function toUtf16Hex(str) {
  // UTF-16BE hex of the full grapheme (handles astral + ZWJ sequences).
  let out = '';
  for (let i = 0; i < str.length; i++) {
    out += str.charCodeAt(i).toString(16).padStart(4, '0');
  }
  return out.toUpperCase();
}

class EmojiType3Registry {
  constructor(doc, resolved) {
    this.doc = doc;
    this.font = resolved.font;
    this.format = resolved.format;
    this.upem = resolved.font.unitsPerEm || 1000;
    this.subfonts = [];
    this.glyphCache = new Map(); // glyphId -> { resName, code, advanceRatio }
    this.graphemeCache = new Map(); // grapheme string -> info | null
    // sbix glyphs are bitmaps drawn in a 1000-unit box; COLRv0 glyphs are
    // vector paths in the font's own em units. The Type3 FontMatrix uses `em`.
    this.em = this.format === 'colrv0' ? this.upem : GLYPH_UNITS;
    this.bbox = resolved.font.bbox || null;
    this.enabled = (this.format === 'sbix' && !!PNG) || this.format === 'colrv0';
    if (DEBUG() && !this.enabled) {
      console.warn('[emoji] Type3 registry disabled (format=' + this.format + ', png=' + !!PNG + ')');
    }
  }

  _newSubfont() {
    const sub = {
      resName: 'Emoji' + this.subfonts.length,
      fontRef: this.doc.ref({}),
      toUnicodeRef: this.doc.ref({}),
      charProcs: {}, // name -> charProc ref
      xobjects: {}, // name -> image ref
      differences: [FIRST_CODE], // [firstCode, /name, /name, ...]
      widths: [], // indexed from FIRST_CODE
      toUni: [], // { code, hex }
      nextCode: FIRST_CODE,
    };
    this.subfonts.push(sub);
    return sub;
  }

  _currentSubfont() {
    const last = this.subfonts[this.subfonts.length - 1];
    if (last && last.nextCode <= LAST_CODE) return last;
    return this._newSubfont();
  }

  // Build the RGB + SMask image XObjects for one sbix glyph; returns the image ref.
  // Async because png-js inflates the PNG with zlib's async API.
  async _emitSbixImage(glyph) {
    const image = glyph.getImageForSize(STRIKE);
    if (!image || !image.data) return null;
    const png = new PNG(image.data);
    const w = png.width;
    const h = png.height;
    const pixels = await new Promise((resolve) => png.decode((px) => resolve(px)));
    if (!pixels) return null;

    const rgb = Buffer.alloc(w * h * 3);
    const alpha = Buffer.alloc(w * h);
    for (let i = 0, p = 0, a = 0; i < pixels.length; i += 4) {
      rgb[p++] = pixels[i];
      rgb[p++] = pixels[i + 1];
      rgb[p++] = pixels[i + 2];
      alpha[a++] = pixels[i + 3];
    }

    const smaskRef = this.doc.ref({
      Type: 'XObject',
      Subtype: 'Image',
      Width: w,
      Height: h,
      ColorSpace: 'DeviceGray',
      BitsPerComponent: 8,
    });
    smaskRef.end(alpha); // PDFKit applies FlateDecode

    const imgRef = this.doc.ref({
      Type: 'XObject',
      Subtype: 'Image',
      Width: w,
      Height: h,
      ColorSpace: 'DeviceRGB',
      BitsPerComponent: 8,
      SMask: smaskRef,
    });
    imgRef.end(rgb);
    return imgRef;
  }

  // Build a vector CharProc for a COLRv0 glyph: paint each colored layer's
  // outline bottom-to-top. Glyph paths are in font (em) units, same space the
  // FontMatrix scales, so coordinates are emitted raw. Returns the content
  // string, or null if the glyph has no usable color layers.
  _buildColrCharProc(glyph, widthUnits) {
    const layers = glyph.layers;
    if (!layers || !layers.length) return null;
    let body = `${widthUnits} 0 d0\n`;
    for (const layer of layers) {
      const lg = layer.glyph;
      const path = lg && lg.path;
      if (!path || !path.commands || !path.commands.length) continue;
      const col = layer.color || {};
      const r = ((col.red || 0) / 255).toFixed(4);
      const g = ((col.green || 0) / 255).toFixed(4);
      const b = ((col.blue || 0) / 255).toFixed(4);
      body += `q\n${r} ${g} ${b} rg\n${pathCommandsToPdf(path.commands)}f\nQ\n`;
    }
    return body;
  }

  /**
   * Decode + embed a grapheme's glyph ahead of rendering (async). Idempotent:
   * repeated graphemes / glyphs reuse the same image XObject. Call this for
   * every distinct emoji in the document before rendering, then use the
   * synchronous lookup() in the draw path.
   * @returns {Promise<info|null>}
   */
  async prepare(grapheme) {
    if (!this.enabled) return null;
    if (this.graphemeCache.has(grapheme)) return this.graphemeCache.get(grapheme);

    let glyph, glyphId, advanceRatio;
    try {
      const run = this.font.layout(grapheme);
      glyph = run.glyphs[0];
      if (!glyph) { this.graphemeCache.set(grapheme, null); return null; }
      glyphId = glyph.id;
      const adv = run.positions[0] ? run.positions[0].xAdvance : glyph.advanceWidth;
      advanceRatio = (adv || this.upem) / this.upem;
    } catch (err) {
      if (DEBUG()) console.warn('[emoji] layout failed for grapheme', err.message || err);
      this.graphemeCache.set(grapheme, null);
      return null;
    }
    if (glyphId === 0) { this.graphemeCache.set(grapheme, null); return null; }

    // Same glyph reached via a different grapheme -> reuse its embedding.
    const byGlyph = this.glyphCache.get(glyphId);
    if (byGlyph) { this.graphemeCache.set(grapheme, byGlyph); return byGlyph; }

    const widthUnits = Math.round(advanceRatio * this.em);

    // Build the glyph's CharProc content + any image resource it needs.
    let charProcBody = null;
    let imgRef = null;
    if (this.format === 'sbix') {
      try {
        imgRef = await this._emitSbixImage(glyph);
      } catch (err) {
        if (DEBUG()) console.warn('[emoji] sbix image emit failed', err.message || err);
      }
      if (!imgRef) { this.graphemeCache.set(grapheme, null); return null; }
    } else {
      try {
        charProcBody = this._buildColrCharProc(glyph, widthUnits);
      } catch (err) {
        if (DEBUG()) console.warn('[emoji] COLR emit failed', err.message || err);
      }
      if (!charProcBody) { this.graphemeCache.set(grapheme, null); return null; }
    }

    const sub = this._currentSubfont();
    const code = sub.nextCode++;
    const procName = 'g' + code;

    if (this.format === 'sbix') {
      const imgName = 'Im' + code;
      charProcBody =
        `${widthUnits} 0 d0\n` +
        `q\n${this.em} 0 0 ${this.em} 0 0 cm\n/${imgName} Do\nQ\n`;
      sub.xobjects[imgName] = imgRef;
    }

    const charProcRef = this.doc.ref({});
    charProcRef.end(Buffer.from(charProcBody, 'latin1'));

    sub.charProcs[procName] = charProcRef;
    sub.differences.push(procName);
    sub.widths.push(widthUnits);
    sub.toUni.push({ code, hex: toUtf16Hex(grapheme) });

    const info = { resName: sub.resName, code, advanceRatio };
    this.glyphCache.set(glyphId, info);
    this.graphemeCache.set(grapheme, info);
    return info;
  }

  /** Synchronous cache lookup for the draw path; null if not prepared/usable. */
  lookup(grapheme) {
    if (!this.enabled) return null;
    return this.graphemeCache.has(grapheme) ? this.graphemeCache.get(grapheme) : null;
  }

  // Find the subfont ref for a resName (for page registration).
  _subfontByName(resName) {
    return this.subfonts.find((s) => s.resName === resName) || null;
  }

  /**
   * Draw an already-registered emoji at the current text position.
   * @param info  result of register()
   * @param x     user-space x (left edge), same coords as doc.text
   * @param yTop  user-space y of the top of the line (doc.y convention)
   * @param size  font size in pt
   * @param ascender  active font ascender (1000-unit em) for baseline alignment
   */
  draw(info, x, yTop, size, ascender) {
    const doc = this.doc;
    const sub = this._subfontByName(info.resName);
    if (!sub) return;
    // Register the font into the current page's resources (idempotent per page).
    doc.page.fonts[info.resName] = sub.fontRef;

    const dy = (ascender / 1000) * size;
    const yFlipped = doc.page.height - yTop - dy;
    const hex = info.code.toString(16).padStart(2, '0');

    doc.save();
    doc.transform(1, 0, 0, -1, 0, doc.page.height);
    doc.addContent('BT');
    doc.addContent(`1 0 0 1 ${x.toFixed(3)} ${yFlipped.toFixed(3)} Tm`);
    doc.addContent(`/${info.resName} ${size} Tf`);
    doc.addContent(`<${hex}> Tj`);
    doc.addContent('ET');
    doc.restore();
  }

  /** Advance width (pt) an emoji occupies at a given font size. */
  advanceWidth(info, size) {
    return info.advanceRatio * size;
  }

  /** Finalize all Type3 font dictionaries + ToUnicode streams. Call before doc.end(). */
  finalize() {
    for (const sub of this.subfonts) {
      const lastChar = FIRST_CODE + sub.widths.length - 1;

      const bfchars = sub.toUni.map((u) => `<${u.code.toString(16).padStart(2, '0')}> <${u.hex}>`).join('\n');
      const cmap =
        `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n` +
        `/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n` +
        `1 begincodespacerange <${FIRST_CODE.toString(16).padStart(2, '0')}> <ff> endcodespacerange\n` +
        `${sub.toUni.length} beginbfchar\n${bfchars}\nendbfchar\n` +
        `endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`;
      sub.toUnicodeRef.end(Buffer.from(cmap, 'latin1'));

      const em = this.em;
      const bbox =
        this.format === 'colrv0' && this.bbox
          ? [this.bbox.minX, this.bbox.minY, this.bbox.maxX, this.bbox.maxY]
          : [0, 0, em, em];

      sub.fontRef.data = {
        Type: 'Font',
        Subtype: 'Type3',
        FontBBox: bbox,
        FontMatrix: [1 / em, 0, 0, 1 / em, 0, 0],
        CharProcs: sub.charProcs,
        Encoding: { Type: 'Encoding', Differences: sub.differences },
        FirstChar: FIRST_CODE,
        LastChar: lastChar,
        Widths: sub.widths,
        Resources: { ProcSet: ['PDF', 'ImageC'], XObject: sub.xobjects },
        ToUnicode: sub.toUnicodeRef,
      };
      sub.fontRef.end();
    }
  }
}

// Convert fontkit path commands to PDF path operators (glyph space, y-up).
// Quadratic curves are promoted to cubic béziers (PDF has no quadratic op).
function pathCommandsToPdf(commands) {
  const f = (n) => {
    const r = Math.round(n * 100) / 100;
    return Object.is(r, -0) ? '0' : String(r);
  };
  let out = '';
  let cx = 0;
  let cy = 0;
  for (const { command, args } of commands) {
    if (command === 'moveTo') {
      cx = args[0]; cy = args[1];
      out += `${f(cx)} ${f(cy)} m\n`;
    } else if (command === 'lineTo') {
      cx = args[0]; cy = args[1];
      out += `${f(cx)} ${f(cy)} l\n`;
    } else if (command === 'bezierCurveTo') {
      out += `${f(args[0])} ${f(args[1])} ${f(args[2])} ${f(args[3])} ${f(args[4])} ${f(args[5])} c\n`;
      cx = args[4]; cy = args[5];
    } else if (command === 'quadraticCurveTo') {
      const [qx, qy, x, y] = args;
      const c1x = cx + (2 / 3) * (qx - cx);
      const c1y = cy + (2 / 3) * (qy - cy);
      const c2x = x + (2 / 3) * (qx - x);
      const c2y = y + (2 / 3) * (qy - y);
      out += `${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(x)} ${f(y)} c\n`;
      cx = x; cy = y;
    } else if (command === 'closePath') {
      out += 'h\n';
    }
  }
  return out;
}

function createEmojiRegistry(doc, resolved) {
  if (!resolved) return null;
  const reg = new EmojiType3Registry(doc, resolved);
  return reg.enabled ? reg : null;
}

module.exports = { createEmojiRegistry, EmojiType3Registry };
