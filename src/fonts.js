const fs = require('fs');
const path = require('path');
const os = require('os');
let fontkit = null;
try {
  // fontkit is a pdfkit dependency; used for basic font validation.
  fontkit = require('fontkit');
} catch {}

const FONT_EXTS = new Set(['.ttf', '.otf']);
const STYLE_TOKENS = /(bold|black|heavy|demi|italic|oblique|regular|medium|light)/g;

let cachedFonts = null;
let cachedDirsKey = null;
const supportCache = new Map();

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
  } catch {
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
  } catch {
    ok = false;
  }
  supportCache.set(filePath, ok);
  return ok;
}

function pickFont(fonts, families, { bold = false, italic = false, allowFallback = true } = {}) {
  if (!fonts.length) return null;
  const familyNorms = families.map(normalizeName);
  let best = null;
  let bestScore = -Infinity;

  for (const font of fonts) {
    if (!isFontSupported(font.path)) continue;
    for (let i = 0; i < familyNorms.length; i++) {
      const fam = familyNorms[i];
      if (!fam || (!font.nameNorm.includes(fam) && !font.familyNorm.includes(fam))) continue;
      let score = 100 - i * 5;
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

module.exports = { resolveSystemFonts, normalizeName };
