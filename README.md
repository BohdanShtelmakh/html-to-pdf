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
- `outputPath`: where to write the PDF (default: `output.pdf` in `cwd`)
- `rootSelector`: CSS selector for the render root (default: `body`)
- `fetchExternalCss`: boolean (default: `false`)
- `fonts`: optional font paths used to match browser metrics
  - `sansRegular`, `sansBold`, `sansItalic`, `sansBoldItalic`
  - `serifRegular`, `serifBold`, `serifItalic`, `serifBoldItalic`

## Fonts

You can supply custom font paths via the `fonts` option:

- `sansRegular`, `sansBold`, `sansItalic`, `sansBoldItalic`
- `serifRegular`, `serifBold`, `serifItalic`, `serifBoldItalic`

## License

MIT
