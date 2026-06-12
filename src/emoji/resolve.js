const fs = require('fs');
const os = require('os');
const path = require('path');

let fontkit = null;
try {
  fontkit = require('fontkit');
} catch {
  // fontkit ships with pdfkit; if absent, color emoji is silently disabled.
}

const DEBUG = () => process.env.HTML_TO_PDF_DEBUG_EMOJI === '1';

/**
 * Inspect an opened fontkit font and decide whether we can emit Type 3 glyphs
 * from it. We only support the two formats fontkit can actually decode:
 *   - sbix   (Apple Color Emoji)            -> embedded PNG bitmaps
 *   - COLRv0 (Segoe UI Emoji, Twemoji)      -> layered solid-color vectors
 * Everything else (COLRv1, CBDT/CBLC, SVG-in-OT) is rejected because fontkit
 * cannot read it — embedding it would yield blank glyphs.
 *
 * @returns {'sbix'|'colrv0'|null}
 */
function detectColorFormat(font) {
  if (!font) return null;
  const tables = (font.directory && font.directory.tables) || {};
  if (tables.sbix || font.sbix) return 'sbix';
  const hasColr = !!(tables.COLR || font.COLR);
  const hasCpal = !!(tables.CPAL || font.CPAL);
  // COLR requires CPAL; without a palette the spec says ignore COLR.
  if (hasColr && hasCpal) {
    const version = font.COLR && typeof font.COLR.version === 'number' ? font.COLR.version : 0;
    if (version === 0) return 'colrv0';
    if (DEBUG()) console.warn('[emoji] COLR v' + version + ' is not supported (only v0)');
    return null;
  }
  if (DEBUG() && (tables.CBDT || tables.CBLC || tables['SVG '])) {
    console.warn('[emoji] CBDT/CBLC/SVG color tables are not supported by fontkit');
  }
  return null;
}

function openFontFile(filePath) {
  if (!fontkit || !filePath) return null;
  let font;
  try {
    font = fontkit.openSync(filePath);
  } catch (err) {
    if (DEBUG()) console.warn('[emoji] openSync failed for', filePath, err.message || err);
    return null;
  }
  // A .ttc collection exposes .fonts; pick the first member that has a color table.
  const candidates = font && Array.isArray(font.fonts) ? font.fonts : [font];
  for (const candidate of candidates) {
    const format = detectColorFormat(candidate);
    if (format) return { path: filePath, format, font: candidate };
  }
  if (DEBUG()) console.warn('[emoji] no supported color table in', filePath);
  return null;
}

// Known system color-emoji fonts that fontkit CAN decode. Linux's default
// Noto Color Emoji is intentionally absent: modern builds are COLRv1/CBDT,
// which fontkit cannot read, so auto-resolve yields nothing there by design.
function systemEmojiCandidates() {
  const home = os.homedir();
  switch (process.platform) {
    case 'darwin':
      return ['/System/Library/Fonts/Apple Color Emoji.ttc'];
    case 'win32':
      return ['C:\\Windows\\Fonts\\seguiemj.ttf'];
    default:
      // A few COLRv0 builds occasionally present on Linux; Noto is skipped.
      return [
        '/usr/share/fonts/truetype/twemoji/TwemojiMozilla.ttf',
        path.join(home, '.fonts/TwemojiMozilla.ttf'),
        path.join(home, '.local/share/fonts/TwemojiMozilla.ttf'),
      ];
  }
}

/**
 * Resolve a color-emoji font following the three-tier policy:
 *   1. options.emojiFont            — explicit path (caller's responsibility)
 *   2. options.autoResolveEmojiFont — known system font (Apple / Segoe)
 *   3. options.autoDownloadEmojiFont— opt-in download of open Twemoji (COLRv0)
 * Returns { path, format, font } or null when no usable font is found.
 *
 * Tier 3 is delegated to ./download (lazy-required) so the network code never
 * loads unless explicitly enabled.
 */
async function resolveEmojiFont(options = {}) {
  if (!fontkit) return null;

  if (options.emojiFont) {
    const resolved = openFontFile(options.emojiFont);
    if (resolved) return resolved;
    if (DEBUG()) console.warn('[emoji] explicit emojiFont unusable:', options.emojiFont);
  }

  if (options.autoResolveEmojiFont !== false) {
    for (const candidate of systemEmojiCandidates()) {
      if (!fs.existsSync(candidate)) continue;
      const resolved = openFontFile(candidate);
      if (resolved) return resolved;
    }
  }

  if (options.autoDownloadEmojiFont === true) {
    try {
      const { downloadTwemoji } = require('./download');
      const downloadedPath = await downloadTwemoji(options.emojiFontCacheDir);
      if (downloadedPath) {
        const resolved = openFontFile(downloadedPath);
        if (resolved) return resolved;
      }
    } catch (err) {
      if (DEBUG()) console.warn('[emoji] auto-download failed:', err.message || err);
    }
  }

  return null;
}

module.exports = { resolveEmojiFont, detectColorFormat, openFontFile };
