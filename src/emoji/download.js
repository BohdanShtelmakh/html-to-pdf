const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// Opt-in only. This module performs a network download and is *never* required
// unless the caller passes `autoDownloadEmojiFont: true` (see ./resolve.js,
// which lazy-requires this file). Keeping the fetch code out of the default
// import path means the library has zero network behaviour by default.
//
// We pull Twemoji Mozilla, the COLR/CPAL (v0) colour-emoji build that Firefox
// ships. It is the one open-licensed colour font fontkit can actually decode
// into Type 3 glyphs (Apple's sbix and Noto's COLRv1/CBDT cannot be embedded).
//
// Licensing: the glyph artwork is Twemoji, CC-BY 4.0 (Twitter, now Twemoji
// maintainers); the COLR build tooling/font is MIT (mozilla/twemoji-colr).
// Redistribution is therefore permitted, which is why we can fetch and cache it.

const DEBUG = () => process.env.HTML_TO_PDF_DEBUG_EMOJI === '1';
function warn(...args) {
  if (DEBUG()) console.warn('[emoji]', ...args);
}

// Pinned to an immutable npm version on jsDelivr (never a moving "latest"): the
// bytes published for a given package version do not change, so the SHA-256
// below stays valid. Bumping the font means bumping VERSION, URL and
// EXPECTED_SHA256 together. (We use the woff2 the npm package ships; fontkit
// transparently decompresses it.)
const VERSION = '15.0.3';
const FONT_URL = `https://cdn.jsdelivr.net/npm/twemoji-colr-font@${VERSION}/twemoji.woff2`;

// SHA-256 of the exact bytes served by FONT_URL. Verified by downloading and
// hashing the file; a mismatch means it was tampered with or the CDN served
// something unexpected, so we refuse to use it.
const EXPECTED_SHA256 = '598b6867d47954acab46edd6a9773d734b844d221d3a95834da7442d5df64f98';

const FILENAME = `TwemojiMozilla-${VERSION}.woff2`;
const DOWNLOAD_TIMEOUT_MS = 15000;

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function cacheDirFor(cacheDir) {
  return cacheDir || path.join(os.tmpdir(), 'html-pdf-lite-fonts');
}

// Returns the cached path if a previously-downloaded file is present AND its
// hash still matches (guards against partial writes / on-disk corruption).
function readVerifiedCache(target) {
  try {
    if (!fs.existsSync(target)) return null;
    const bytes = fs.readFileSync(target);
    if (sha256(bytes) === EXPECTED_SHA256) return target;
    warn('cached font hash mismatch, will re-download:', target);
  } catch (err) {
    warn('cache read failed:', err.message || err);
  }
  return null;
}

/**
 * Resolve a local path to the COLRv0 Twemoji Mozilla font, downloading and
 * caching it on first use. Returns the filesystem path on success or null on
 * any failure (the caller — resolveEmojiFont — falls back gracefully).
 *
 * @param {string} [cacheDir] override for the cache directory
 * @returns {Promise<string|null>}
 */
async function downloadTwemoji(cacheDir) {
  const dir = cacheDirFor(cacheDir);
  const target = path.join(dir, FILENAME);

  // Fast path: serve a verified cache hit without any network access.
  const cached = readVerifiedCache(target);
  if (cached) return cached;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    fs.mkdirSync(dir, { recursive: true });

    const res = await fetch(FONT_URL, {
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!res.ok) {
      warn('download failed: HTTP', res.status, FONT_URL);
      return null;
    }

    const bytes = Buffer.from(await res.arrayBuffer());
    const actual = sha256(bytes);
    if (actual !== EXPECTED_SHA256) {
      // Integrity check failed: never write or use a font we can't trust.
      warn('integrity check failed:', { expected: EXPECTED_SHA256, actual });
      return null;
    }

    // Write atomically-ish: write to a temp name then rename, so a concurrent
    // reader never sees a half-written file at the final path.
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, bytes);
    fs.renameSync(tmp, target);
    warn('downloaded and cached Twemoji Mozilla', VERSION, '->', target);
    return target;
  } catch (err) {
    warn('download error:', err.message || err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { downloadTwemoji, VERSION, FONT_URL, EXPECTED_SHA256 };
