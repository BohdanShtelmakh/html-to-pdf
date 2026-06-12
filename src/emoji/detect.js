// Emoji detection and segmentation.
//
// We split a string into alternating runs of plain text and emoji, where each
// emoji run is a single grapheme cluster (so ZWJ sequences like 👨‍👩‍👧, flags
// like 🇺🇦, and skin-tone modifiers like 👍🏽 stay intact as one unit).
//
// Grapheme segmentation uses Intl.Segmenter (Node 16+). Classification uses
// Unicode property escapes: a grapheme is "emoji" if it contains an
// Extended_Pictographic codepoint or a Regional_Indicator pair (flags).

let segmenter = null;
function getSegmenter() {
  if (segmenter) return segmenter;
  try {
    segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
  } catch {
    segmenter = null;
  }
  return segmenter;
}

// Extended_Pictographic covers emoji base characters; Regional_Indicator covers
// the A–Z pair that forms flags. Variation selectors / ZWJ / skin tones never
// appear alone — they ride along inside the grapheme, so we don't test them.
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;
const REGIONAL = /\p{Regional_Indicator}/u;

// A few pictographic codepoints are "text-default" and are normally rendered as
// plain glyphs unless followed by VS16 (U+FE0F). Treating them as emoji when
// they appear bare would hijack things like © ® ™ ‼ and digits-in-keycaps.
// We only treat such a base as emoji if it is explicitly emoji-presented (VS16)
// or part of a keycap / multi-codepoint cluster.
const TEXT_DEFAULT = new Set([
  0x23, 0x2a, // # *
  0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, // 0-9
  0xa9, 0xae, // © ®
  0x2122, // ™
  0x203c, 0x2049, // ‼ ⁉
]);

const VS16 = 0xfe0f;
const KEYCAP = 0x20e3; // combining enclosing keycap: 1️⃣ #️⃣ etc.

function isEmojiGrapheme(grapheme) {
  if (!grapheme) return false;
  if (REGIONAL.test(grapheme)) return true;
  // Keycap sequences ([0-9#*] + VS16 + U+20E3) — the base isn't pictographic,
  // so detect them by the enclosing-keycap combining mark.
  if (grapheme.indexOf(String.fromCodePoint(KEYCAP)) !== -1) return true;
  if (!PICTOGRAPHIC.test(grapheme)) return false;

  const cps = Array.from(grapheme, (ch) => ch.codePointAt(0));
  // Single text-default codepoint with no emoji presentation -> treat as text.
  if (cps.length === 1 && TEXT_DEFAULT.has(cps[0])) return false;
  // Text-default base requires VS16 to count as emoji.
  if (TEXT_DEFAULT.has(cps[0]) && !cps.includes(VS16)) return false;
  return true;
}

/**
 * Split text into runs: [{ text, isEmoji }]. Adjacent graphemes of the same
 * kind are merged, so plain text stays in big chunks and only emoji are peeled
 * out individually (each emoji run is exactly one grapheme cluster).
 *
 * @param {string} text
 * @returns {Array<{text: string, isEmoji: boolean}>}
 */
function splitEmojiRuns(text) {
  const str = String(text == null ? '' : text);
  if (!str) return [];

  const seg = getSegmenter();
  let graphemes;
  if (seg) {
    graphemes = Array.from(seg.segment(str), (s) => s.segment);
  } else {
    // Fallback: code-point split. Loses multi-codepoint clusters (ZWJ/flags),
    // but still renders simple single-codepoint emoji.
    graphemes = Array.from(str);
  }

  const runs = [];
  for (const g of graphemes) {
    const emoji = isEmojiGrapheme(g);
    const last = runs[runs.length - 1];
    if (emoji) {
      // Each emoji is its own run (one glyph in the color font).
      runs.push({ text: g, isEmoji: true });
    } else if (last && !last.isEmoji) {
      last.text += g;
    } else {
      runs.push({ text: g, isEmoji: false });
    }
  }
  return runs;
}

/** Quick check whether a string contains any emoji at all (cheap pre-filter). */
function hasEmoji(text) {
  const str = String(text == null ? '' : text);
  if (!str) return false;
  if (REGIONAL.test(str)) return true;
  if (!PICTOGRAPHIC.test(str)) return false;
  // Confirm via full segmentation to respect text-default rules.
  return splitEmojiRuns(str).some((r) => r.isEmoji);
}

module.exports = { splitEmojiRuns, hasEmoji, isEmojiGrapheme };
