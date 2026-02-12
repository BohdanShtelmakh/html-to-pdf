# html-to-pdf

[![NPM Version](https://img.shields.io/npm/v/%40bohard%2Fhtml-to-pdf)](https://www.npmjs.com/package/@bohard/html-to-pdf)
[![NPM Downloads](https://img.shields.io/npm/dw/%40bohard%2Fhtml-to-pdf)](https://www.npmjs.com/package/@bohard/html-to-pdf)
[![License](https://img.shields.io/npm/l/%40bohard%2Fhtml-to-pdf)](https://github.com/BohdanShtelmakh/html-to-pdf/blob/main/LICENSE)

Generate a PDF from HTML using a lightweight HTML/CSS parser and PDFKit.
Designed for backend use cases like invoices, reports, and server-side PDF generation where Chromium is too heavy.

## Install

```bash
npm install @bohard/html-to-pdf
```

## Usage

```js
const fs = require('fs');
const { renderPdfFromHtml } = require('@bohard/html-to-pdf');

async function run() {
  const html = '<html><body><h1>Hello</h1></body></html>';
  const pdfBuffer = await renderPdfFromHtml(html, {
    rootSelector: 'body',
    fetchExternalCss: false,
    loadTimeoutMs: 3000,
    externalCssTimeoutMs: 5000,
    imgLoadTimeoutMs: 3000,
    allowScripts: false,
    ignoreInvalidImages: true,
    autoResolveFonts: true,
    fonts: {
      Helvetica: {
        regular: '/path/to/Helvetica-Regular.ttf',
        bold: '/path/to/Helvetica-Bold.ttf'
      }
    }
  });

  fs.writeFileSync('output.pdf', pdfBuffer);
}

run();
```

## 🚀 Why this exists

Chrome-based tools like Puppeteer or Playwright are slow for backend PDF generation:
- 2–4 seconds per PDF
- Huge memory usage
- Cold starts in serverless

**@bohard/html-to-pdf** is built for speed-first PDF generation.

Typical performance:

| Engine | Typical Time |
|:------ |------------:|
| Puppeteer | 2–4s |
| @bohard/html-to-pdf | **200–400ms** |

This makes it perfect for:
- APIs
- Invoices & reports
- Serverless (Lambda, Vercel, etc)
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

Use this.

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

## Limitations

- Not a full Chromium renderer
- Partial support for complex CSS layouts (flex/grid)
- SVG rendering is raster-based and slower for large SVGs

## 💛 Support

This project is free and open-source.

If it helped you, you can support development:
- 🇺🇦 / 🌍 Monobank jar: https://send.monobank.ua/jar/3WznEHehpC

Monobank jar accepts international cards (Apple Pay / Google Pay).
A small processing fee may apply for non-Ukrainian cards.

## License

MIT
