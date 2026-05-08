const fs = require('fs');
const path = require('path');
const os = require('os');
let fontkit = null;
try {
  // fontkit is a pdfkit dependency; used for basic font validation.
  fontkit = require('fontkit');
} catch {
  // fontkit is optional; font validation is skipped when unavailable
}

const FONT_EXTS = new Set(['.ttf', '.otf']);
const STYLE_TOKENS = /(bold|black|heavy|demi|italic|oblique|regular|medium|light)/g;

let cachedFonts = null;
let cachedDirsKey = null;
const supportCache = new Map();
const glyphSupportCache = new Map();
const fallbackFontCache = new Map();

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function classifyFont(filePath) {
  const base = path.basename(filePath, path.extname(filePath));
  const lower = base.toLowerCase();
  const familyGuess = normalizeName(base.replace(STYLE_TOKENS, ''));
  return {
    path: filePath,
    nameNorm: normalizeName(base),
    familyNorm: familyGuess,
    isBold: /(bold|black|heavy|demi)/.test(lower),
    isItalic: /(italic|oblique)/.test(lower),
  };
}

function getSystemFontDirs() {
  const home = os.homedir();
  switch (process.platform) {
    case 'darwin':
      return ['/System/Library/Fonts', '/Library/Fonts', path.join(home, 'Library/Fonts')];
    case 'win32':
      return ['C:\\Windows\\Fonts'];
    default:
      return [
        '/usr/share/fonts',
        '/usr/local/share/fonts',
        path.join(home, '.fonts'),
        path.join(home, '.local/share/fonts'),
      ];
  }
}

function walkFonts(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (process.env.HTML_TO_PDF_DEBUG_FONTS === '1') console.warn('[fonts] readdir failed:', dir, err.message || err);
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      walkFonts(full, out);
      continue;
    }
    if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (FONT_EXTS.has(ext)) out.push(classifyFont(full));
    }
  }
}

function collectSystemFonts() {
  const dirs = getSystemFontDirs().filter((d) => !!d);
  const key = dirs.join('|');
  if (cachedFonts && cachedDirsKey === key) return cachedFonts;
  const fonts = [];
  for (const dir of dirs) {
    walkFonts(dir, fonts);
  }
  cachedFonts = fonts;
  cachedDirsKey = key;
  return fonts;
}

function isFontSupported(filePath) {
  if (!fontkit) return true;
  if (supportCache.has(filePath)) return supportCache.get(filePath);
  let ok = false;
  try {
    const font = fontkit.openSync(filePath);
    ok = !!font && typeof font.createSubset === 'function';
  } catch (err) {
    if (process.env.HTML_TO_PDF_DEBUG_FONTS === '1') console.warn('[fonts] openSync failed:', filePath, err.message || err);
    ok = false;
  }
  supportCache.set(filePath, ok);
  return ok;
}

function fontSupportsText(filePath, text) {
  if (!fontkit || !filePath) return true;
  const chars = Array.from(String(text || '')).filter((ch) => ch && ch.codePointAt(0) > 127);
  if (!chars.length) return true;
  const key = `${filePath}|${chars.join('')}`;
  if (glyphSupportCache.has(key)) return glyphSupportCache.get(key);

  let ok = false;
  try {
    const font = fontkit.openSync(filePath);
    ok = chars.every((ch) => {
      const glyph = font.glyphForCodePoint(ch.codePointAt(0));
      return !!glyph && glyph.id > 0;
    });
  } catch (err) {
    if (process.env.HTML_TO_PDF_DEBUG_FONTS === '1') console.warn('[fonts] glyph check failed:', filePath, err.message || err);
    ok = false;
  }

  glyphSupportCache.set(key, ok);
  return ok;
}

function findFallbackFontForText(text, { bold = false, italic = false } = {}) {
  const chars = Array.from(String(text || '')).filter((ch) => ch && ch.codePointAt(0) > 127);
  if (!chars.length) return null;
  const key = `${chars.join('')}|${bold ? 'b' : 'n'}${italic ? 'i' : 'n'}`;
  if (fallbackFontCache.has(key)) return fallbackFontCache.get(key);

  const fonts = collectSystemFonts();
  const supported = fonts.filter((font) => {
    if (/lastresort/i.test(font.nameNorm) || /lastresort/i.test(font.familyNorm)) return false;
    return isFontSupported(font.path) && fontSupportsText(font.path, chars.join(''));
  });
  if (!supported.length) {
    fallbackFontCache.set(key, null);
    return null;
  }

  const preferredNames = /(noto|sfns|sfcompact|geneva|arial|dejavu|liberation|segoe|sans)/i;
  let best = null;
  let bestScore = -Infinity;
  for (const font of supported) {
    let score = 0;
    if (preferredNames.test(font.nameNorm) || preferredNames.test(font.familyNorm)) score += 20;
    score += bold ? (font.isBold ? 8 : -2) : font.isBold ? -4 : 4;
    score += italic ? (font.isItalic ? 8 : -2) : font.isItalic ? -4 : 4;
    if (score > bestScore) {
      bestScore = score;
      best = font;
    }
  }

  const out = best?.path || supported[0]?.path || null;
  fallbackFontCache.set(key, out);
  return out;
}

function pickFont(fonts, families, { bold = false, italic = false, allowFallback = true } = {}) {
  if (!fonts.length) return null;
  const familyNorms = families.map(normalizeName);
  let best = null;
  let bestScore = -Infinity;
  const debug = process.env.HTML_TO_PDF_DEBUG_FONTS === '1';

  for (const font of fonts) {
    if (!isFontSupported(font.path)) continue;
    for (let i = 0; i < familyNorms.length; i++) {
      const fam = familyNorms[i];
      if (!fam || (!font.nameNorm.includes(fam) && !font.familyNorm.includes(fam))) continue;
      const exactMatch = font.nameNorm === fam || font.familyNorm === fam;
      const isNarrow = /narrow|condensed/.test(font.nameNorm);
      let score = 100 - i * 5;
      if (exactMatch) score += 15;
      if (isNarrow) score -= 8;
      score += bold ? (font.isBold ? 20 : -20) : font.isBold ? -10 : 5;
      score += italic ? (font.isItalic ? 20 : -20) : font.isItalic ? -10 : 5;
      if (bold && italic && font.isBold && font.isItalic) score += 10;
      if (!bold && !italic && !font.isBold && !font.isItalic) score += 5;
      if (score > bestScore) {
        bestScore = score;
        best = font;
      }
    }
  }

  if (best) return best.path;

  if (allowFallback) {
    for (const font of fonts) {
      if (!isFontSupported(font.path)) continue;
      if (bold && italic && font.isBold && font.isItalic) return font.path;
      if (bold && !italic && font.isBold) return font.path;
      if (!bold && italic && font.isItalic) return font.path;
      if (!bold && !italic && !font.isBold && !font.isItalic) return font.path;
    }
    return fonts[0]?.path || null;
  }

  return null;
}

function buildFamilyMap(fonts, familyNames) {
  const out = {};
  for (const family of familyNames) {
    const key = normalizeName(family);
    if (!key || out[key]) continue;
    const regular = pickFont(fonts, [family], { bold: false, italic: false, allowFallback: false });
    const bold = pickFont(fonts, [family], { bold: true, italic: false, allowFallback: false });
    const italic = pickFont(fonts, [family], { bold: false, italic: true, allowFallback: false });
    const boldItalic = pickFont(fonts, [family], { bold: true, italic: true, allowFallback: false });
    if (regular || bold || italic || boldItalic) {
      out[key] = { regular, bold, italic, boldItalic };
    }
  }
  return out;
}

function resolveSystemFonts(familyNames = []) {
  const fonts = collectSystemFonts();
  if (!fonts.length) return { familyMap: {} };

  const resolvedFamilies = buildFamilyMap(fonts, familyNames);

  if (process.env.HTML_TO_PDF_DEBUG_FONTS === '1') {
    const missing = familyNames.filter((f) => !resolvedFamilies[normalizeName(f)]);
    if (missing.length) {
      console.log('[font-missing-families]', missing);
    }
  }
  return { familyMap: resolvedFamilies };
}

module.exports = { resolveSystemFonts, normalizeName, fontSupportsText, findFallbackFontForText };
