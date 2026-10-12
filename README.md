# html-pdf-lite

[![CI](https://github.com/BohdanShtelmakh/html-to-pdf/actions/workflows/ci.yml/badge.svg)](https://github.com/BohdanShtelmakh/html-to-pdf/actions/workflows/ci.yml)
[![NPM Version](https://img.shields.io/npm/v/html-pdf-lite)](https://www.npmjs.com/package/html-pdf-lite)
[![NPM Downloads](https://img.shields.io/npm/dw/html-pdf-lite)](https://www.npmjs.com/package/html-pdf-lite)
[![npm package size](https://img.shields.io/npm/unpacked-size/html-pdf-lite)](https://www.npmjs.com/package/html-pdf-lite)
[![License](https://img.shields.io/npm/l/html-pdf-lite)](https://github.com/BohdanShtelmakh/html-to-pdf/blob/main/LICENSE)

**HTML + CSS to PDF for Node.js, without Chromium.** Render document templates directly to a PDF `Buffer` using PDFKit, without rewriting them as PDFMake document definitions.

Built for controlled invoice, receipt, and report templates. This is a document renderer with partial CSS support, not a browser replacement. Use Puppeteer when matching arbitrary web pages is the priority.

**[Try the Playground](https://pdf-api.bohdanlab.dpdns.org)** — edit HTML/CSS,
preview the generated PDF, and download it. Includes invoice, report, and long-table examples.
The public demo accepts text and embedded CSS only; images, SVG, scripts, and
external resources are disabled. These demo restrictions do not apply to the full package.

![Invoice rendered by html-pdf-lite, with tables and color emoji](https://raw.githubusercontent.com/BohdanShtelmakh/html-to-pdf/main/docs/hero.png)

<sub>An invoice produced from plain HTML — dark header, striped rows, `colspan` totals, and real color emoji as selectable text. No browser involved.</sub>

## Why html-pdf-lite

- **No headless browser** — no Chromium process or download. SVG rasterization uses the native `@resvg/resvg-js` dependency.
- **Direct HTML/CSS input** — inline styles and embedded stylesheets, without a separate PDF document-definition API.
- **PDF buffers** — return a response, store a file, or attach a document to an email.
- 😀 **Native color emoji** — embedded as real PDF Type 3 fonts (like Chromium), searchable/selectable, not images.
- 🧾 **Made for documents** — tables (`colspan`/`rowspan`, repeating headers), flexbox, grid, page breaks, links, SVG, custom fonts.
- 🟦 **TypeScript types** included · zero config to start.

## Install

```bash
npm install html-pdf-lite
```

## Quick start

```js
const fs = require('fs');
const { renderPdfFromHtml } = require('html-pdf-lite');

const pdf = await renderPdfFromHtml('<h1>Hello 👋</h1><p>Invoice ready ✅</p>');
fs.writeFileSync('out.pdf', pdf); // pdf is a Buffer
```

See the [full options](#api) for fonts, margins, emoji, external CSS, and more.
Emoji coverage depends on the available font; deployment environments may need
an explicitly supplied font.

## html-pdf-lite vs the alternatives

|                             |        html-pdf-lite        | Puppeteer / Playwright |  wkhtmltopdf  | pdfmake / jsPDF |
| :-------------------------- | :-------------------------: | :--------------------: | :-----------: | :-------------: |
| Renders HTML + CSS          |             ✅              |           ✅           |      ✅       |  ❌ (own API)   |
| No headless browser         |             ✅              |           ❌           |      ❌       |       ✅        |
| Install footprint           | **~30 MB** (self-contained) | ~170 MB+ (+ Chromium)  | ~50 MB native |      small      |
| Deployment considerations   | Native SVG dependency + fonts | Browser binary + fonts | Native binary | Fonts |
| Color emoji                 |             ✅              |           ✅           |      ⚠️       |       ❌        |
| Full Chrome CSS fidelity    |             ❌              |           ✅           |      ⚠️       |       n/a       |

Choose html-pdf-lite when you control the HTML (invoices, reports, tickets) and want speed + small footprint. Choose Puppeteer when you need pixel-perfect fidelity for arbitrary web pages.

`html-to-pdfmake` is another option for converting HTML into PDFMake definitions.
It overlaps with this package, but is not the same layout engine. Compare your
own templates: stylesheet-driven flex/grid layouts may require adapting them to
PDFMake columns and styles. Neither library guarantees browser CSS fidelity.

## What's new in 1.2.0

- 😀 **Native color emoji** (sbix / COLRv0) via PDF Type 3 fonts — searchable text, optional auto-download
- 📊 **Table `rowspan`** + `<thead>` that repeats on every page
- 📐 **Explicit block `width`** + `margin: auto` centering (e.g. `width: 200mm; margin: 0 auto`)
- ➗ **`<sub>` / `<sup>`**, `<hr>`, and percentage padding/margin
- 🎨 Correct asymmetric borders with `border-radius`
- 🚀 **Much faster** — big cut in parse time and memoized layout for deeply nested flex/grid

## Benchmarks

Measured October 12, 2026 on Apple M5 / macOS arm64, Node 24.21.0,
html-pdf-lite 1.2.4 and Puppeteer 24.43.1. Values below are medians:

| Template               | html-pdf-lite | Puppeteer |  Speedup |        PDF Size |
| :--------------------- | ------------: | --------: | -------: | --------------: |
| Simple (h1 + p)        |         2.1ms |    82.2ms |    38.7x | 1.4 KiB vs 16.9 KiB |
| Invoice (flex + table) |        22.3ms |    86.4ms |     3.9x | 37.7 KiB vs 84.6 KiB |
| Report (text-heavy)    |        14.9ms |    82.0ms |     5.5x | 15.5 KiB vs 32.0 KiB |
| Receipt (small table)  |         4.3ms |    83.1ms |    19.3x | 1.8 KiB vs 29.2 KiB |
| Styled (grid + cards)  |        13.4ms |    82.9ms |     6.2x | 15.5 KiB vs 41.2 KiB |
| Large table (50×6)     |        28.8ms |    89.4ms |     3.1x | 18.2 KiB vs 118.1 KiB |

Warm methodology: 2 warmup renders followed by 15 measured renders in a separate
worker for each template/engine. Puppeteer reuses one browser but creates and
closes a page for each render; that lifecycle is included in its time. This is
not a comparison against a reused-page Puppeteer pool. Both engines receive the
same seeded HTML, A4 pages and 32pt margins; Chromium backgrounds are enabled.
html-pdf-lite uses its default font resolution.

| Invoice cold start (7 fresh Node processes per engine) | html-pdf-lite | Puppeteer |
| :---------------------------------------------------- | ------------: | --------: |
| Module load through first PDF buffer                  |       217.5ms |   434.9ms |
| Node spawn through first result (includes IPC)         |       241.2ms |   459.8ms |

Browser launch is included in cold measurements; browser shutdown is excluded.
Fresh processes reset module/font caches in the application, **not** OS disk
caches. These are local process-start measurements, not serverless deployment
measurements. The module-load-to-PDF median was approximately **2.0x faster**
for this invoice on this machine.

These PDFs are not pixel-identical: layout, font embedding and feature coverage
affect speed and size. Neither the timing ratios nor smaller files establish
equivalent rendering quality. Results vary with hardware, fonts and templates.

Run `npm ci` then `npm run bench` to reproduce. The script fails if Chromium
cannot launch rather than silently skipping it. [Raw samples and methodology](bench/results.json)
include median, min, max and nearest-rank p95 (with these small samples, p95 is
the maximum). Run `node --test bench/run.test.js` to check the benchmark harness.

Typical use cases:

- APIs
- Invoices & reports
- Server deployments where native dependency and font availability are verified
- High-volume PDF generation

## ⚠️ Not a full Chrome renderer

This engine focuses on speed and stability, not 100% Chrome CSS compatibility.

If you need:

- perfect flexbox
- advanced CSS grid
- bleeding-edge browser features

Use Puppeteer.

If you need:

- fast
- stable
- backend-grade PDFs

Evaluate this package with your document templates and deployment environment.

## API

### renderPdfFromHtml(html, options)

Returns a `Buffer` containing the PDF contents.

Options:

- `rootSelector`: CSS selector for the render root (default: `body`)
- `fetchExternalCss`: boolean (default: `false`)
- `loadTimeoutMs`: max wait for external resources (default: `3000`)
- `externalCssTimeoutMs`: HTTP timeout for external CSS (default: `5000`)
- `imgLoadTimeoutMs`: HTTP timeout for loading remote images (default: `3000`)
- `imgLoadTimeout`: alias for `imgLoadTimeoutMs`
- `enableInternalAnchors`: allow `href="#id"` links to jump to named destinations (default: `true`)
- `allowScripts`: execute scripts in HTML (default: `false`, unsafe)
- `ignoreInvalidImages`: skip images PDFKit cannot decode (default: `false`)
- `autoResolveFonts`: search system font directories and match `font-family` names (default: `true`)
- `margins`: override PDF page margins (points, all optional)
- `svgScale`: raster scale for inline SVGs (default: `2`)
- `svgDpi`: raster DPI for inline SVGs (default: `72`)
- SVG images are rasterized via `@resvg/resvg-js`.
- `fonts`: optional font paths used to match browser metrics (per-family overrides)
  - `fonts.Helvetica = "/path/to/Helvetica-Regular.ttf"` (uses the same file for all variants)
  - `fonts.Helvetica = { regular, bold, italic, boldItalic }` (variant-specific files)

## Security

Do not run untrusted HTML. If you enable `allowScripts`, embedded scripts execute in your process. Always review or sanitize HTML before rendering.

## Notes

Script execution is optional via `allowScripts`, but rendering is not a full browser engine and may differ from Chromium. Expect occasional layout or styling mismatches.
If something doesn't render correctly, please open an issue and attach a minimal HTML example.

## Smoke Test

```bash
npm test
```

## Fonts

You can supply custom font paths via the `fonts` option (per-family mapping).

- Glyph coverage depends on the font files you provide. Emoji, CJK, and other Unicode characters require fonts that include those glyphs.

## Color emoji

Color emoji are rendered as native PDF **Type 3** fonts — the same mechanism Chromium uses — so the result is real, **searchable/selectable text**, not loose images or per-emoji SVG. COLRv0 fonts (Segoe UI Emoji, Twemoji) embed as crisp **vector** glyphs; sbix fonts (Apple Color Emoji) embed each glyph's bitmap inside the Type 3 glyph (exactly as Chromium does for Apple emoji).

Options:

- `emojiFont`: path to a color-emoji font (sbix or COLRv0) to use.
- `autoResolveEmojiFont`: use a known system emoji font (Apple Color Emoji on macOS, Segoe UI Emoji on Windows) when no `emojiFont` is given (default: `true`).
- `autoDownloadEmojiFont`: opt-in — download an openly-licensed Twemoji (COLRv0) font when none is available locally (default: `false`).
- `emojiFontCacheDir`: override the cache directory for the auto-downloaded font.

```js
const pdfBuffer = await renderPdfFromHtml('<p>Hello 😁 world</p>', {
  // Use a specific color-emoji font:
  emojiFont: '/path/to/AppleColorEmoji.ttc',
  // ...or let it find a system font (default), and/or fall back to a download:
  autoResolveEmojiFont: true,
  autoDownloadEmojiFont: true,
  emojiFontCacheDir: '/tmp/emoji-fonts',
});
```

### Supported font formats

Only the formats the underlying engine (`fontkit`) can actually decode are supported:

| Format          | Example fonts           | Supported |
| :-------------- | :---------------------- | :-------: |
| sbix            | Apple Color Emoji       |    ✅     |
| COLRv0          | Segoe UI Emoji, Twemoji |    ✅     |
| COLRv1          | modern Noto Color Emoji |    ❌     |
| CBDT/CBLC       | older Noto Color Emoji  |    ❌     |
| SVG-in-OpenType | various                 |    ❌     |

### Linux / serverless caveat

On a bare Linux server there is usually **no `fontkit`-readable color-emoji font** (the default Noto Color Emoji is COLRv1). To get color emoji there you must either supply `emojiFont` pointing at an sbix/COLRv0 font, or enable `autoDownloadEmojiFont` to fetch Twemoji. If no usable font is found, emoji simply fall back to the regular text font.

> ⚠️ Apple Color Emoji and Segoe UI Emoji are **proprietary** and are **never bundled** with this library. If you point `emojiFont` at such a font on your own server, ensuring you have the right to use it is your responsibility. Only the `autoDownloadEmojiFont` path fetches an openly-licensed font (Twemoji).

## Limitations

- Not a full Chromium renderer
- Partial support for complex CSS layouts (flex/grid)
- SVG rendering is raster-based and slower for large SVGs
- Font availability affects glyph coverage, weight, metrics and line wrapping
- Long flex/grid containers and nested framed content can differ from browser pagination
- Stylesheet support is selective; advanced layout, media rules and effects are not guaranteed
- Serverless compatibility must be verified for your platform, native SVG binary and fonts

## Pagination Support

- Supports `page-break-before: always` and `break-before: page|always|left|right`
- Supports `break-inside: avoid` and `page-break-inside: avoid` for block containers
- Existing `page-break-after: always` support remains
- Full CSS fragmentation parity with browsers is not guaranteed

## Links In PDF

- `<a href="https://...">`, `<a href="http://...">`, `<a href="mailto:...">`, and `<a href="tel:...">` are exported as clickable PDF links
- `<a href="#section-id">` creates internal `GoTo` links when a matching `id="section-id"` destination exists
- Internal anchors are controlled by `enableInternalAnchors` (default `true`)

## 💛 Support

This project is free and open-source.

If it helped you, you can support development:

- 🇺🇦 / 🌍 Monobank jar: https://send.monobank.ua/jar/3WznEHehpC

Monobank jar accepts international cards (Apple Pay / Google Pay).
A small processing fee may apply for non-Ukrainian cards.

## License

MIT
