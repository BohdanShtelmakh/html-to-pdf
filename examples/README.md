# Document Examples

These fictional templates use fixed data and no external resources.
They demonstrate supported document layouts, not browser-identical rendering.

| Example | HTML | PDF | First-page preview |
| --- | --- | --- | --- |
| Invoice | [Source](invoice.html) | [PDF](output/invoice.pdf) | [PNG](output/invoice-page-1.png) |
| Report | [Source](report.html) | [PDF](output/report.pdf) | [PNG](output/report-page-1.png) |
| 50-row register | [Source](long-table.html) | [PDF](output/long-table.pdf) | [PNG](output/long-table-page-1.png) |

The register spans three pages; inspect [page 2](output/long-table-page-2.png)
and [page 3](output/long-table-page-3.png) for repeated headers and the final row.

## Reproduce

From the repository root, install dependencies with `npm ci` and install Poppler
(`brew install poppler` on macOS, `sudo apt-get install poppler-utils` on Ubuntu).
Then run:

```sh
npm run examples
```

This renders through the local package and rasterizes every PDF page at 96 DPI.
Output is saved in `examples/output/`; `manifest.json` records the renderer version,
Node version, font policy and page filenames. The script fails if Poppler is not
available. No extra npm dependencies are required.

System font and emoji resolution are disabled; templates use PDF standard
Helvetica. Data and layout inputs are fixed, but PDF metadata, Poppler versions
and raster font substitution can still differ between environments. These files
are **not approved regression-test baselines** or byte-identical PDF guarantees.

## Current Layout Caveats

The examples use block elements for address/total lines and grid for framed
columns. Initial review exposed differences with `<br>` in generic blocks,
mixed-style inline text wrapping, and frames nested in flex columns. Those
cases must be tested separately rather than accepted as correct visual baselines.
Bold text also needs dedicated checking in the standard-font configuration.
The `<br>` table-cell and header cases here remain useful checks.

`examples/` is excluded from npm publication by the package's `files` allowlist
and `.npmignore`; generated PDFs and PNGs belong only to the repository.
