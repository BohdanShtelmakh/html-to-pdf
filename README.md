# html-to-pdf

![NPM Version](https://img.shields.io/npm/v/%40bohard%2Fhtml-to-pdf)
![NPM Downloads](https://img.shields.io/npm/dw/%40bohard%2Fhtml-to-pdf)
![License](https://img.shields.io/npm/l/%40bohard%2Fhtml-to-pdf)

Generate a PDF from HTML using a lightweight HTML/CSS parser and PDFKit.

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
    allowScripts: false,
    fonts: {
      sansRegular: '/path/to/Arial.ttf',
      sansBold: '/path/to/Arial Bold.ttf'
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
- `allowScripts`: execute scripts in HTML (default: `false`, unsafe)
- `fonts`: optional font paths used to match browser metrics
  - `sansRegular`, `sansBold`, `sansItalic`, `sansBoldItalic`
  - `serifRegular`, `serifBold`, `serifItalic`, `serifBoldItalic`

## Security

Do not run untrusted HTML. If you enable `allowScripts`, embedded scripts execute in your process. Always review or sanitize HTML before rendering.

## Notes

Script execution is optional via `allowScripts`, but rendering is not a full browser engine and may differ from Chromium. Expect occasional layout or styling mismatches.

## Smoke Test

```bash
npm test
```

## Fonts

You can supply custom font paths via the `fonts` option:

- `sansRegular`, `sansBold`, `sansItalic`, `sansBoldItalic`
- `serifRegular`, `serifBold`, `serifItalic`, `serifBoldItalic`

## License

MIT
