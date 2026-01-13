# html-to-pdf

Generate a PDF from HTML using a lightweight HTML/CSS parser and PDFKit.

## Install

```bash
npm install html-to-pdf
```

## Usage

```js
const fs = require('fs');
const { renderPdfFromHtml } = require('html-to-pdf');

async function run() {
  const html = '<html><body><h1>Hello</h1></body></html>';
  const pdfBuffer = await renderPdfFromHtml(html, {
    outputPath: 'output.pdf',
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

## API

### renderPdfFromHtml(html, options)

Returns a `Buffer` containing the PDF contents. Also writes to disk when `outputPath` is provided.

Options:
- `outputPath`: where to write the PDF (optional)
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

## Fonts

You can supply custom font paths via the `fonts` option:

- `sansRegular`, `sansBold`, `sansItalic`, `sansBoldItalic`
- `serifRegular`, `serifBold`, `serifItalic`, `serifBoldItalic`

## License

MIT
