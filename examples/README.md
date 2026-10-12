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

The report exercises mixed-style inline wrapping, explicit `<br>` breaks and
frames nested in percentage-width flex columns. These cases also have targeted
coordinate-based regression tests in `test/inline-layout.test.js`.
Standard-font bold/italic emission is covered by `test/fonts.test.js`.
On macOS, Poppler previews use a process-local Fontconfig configuration mapping
Helvetica to separate Arial font files: the default Helvetica TTC substitution
can rasterize bold as regular. This affects PNG previews only, not the generated
PDF or system configuration. The raster font policy is recorded in the manifest.
The `<br>` table-cell and header cases here remain useful checks.

`examples/` is excluded from npm publication by the package's `files` allowlist
and `.npmignore`; generated PDFs and PNGs belong only to the repository.

## Compare With Chromium

```sh
npm run examples:compare
```

Uses the existing Puppeteer dev dependency and Poppler. Both engines receive
unchanged HTML; Chromium respects CSS `@page` and prints backgrounds. PDFs,
96-DPI previews, extracted text and a version/source-hash manifest are saved
under ignored `tmp/pdf-comparison/{lite,chromium}/`. No server is contacted.
The command checks selected content markers (including every account in the
register) for omissions or duplication; this is not a full visual correctness
test. It never updates or approves regression baselines. Chromium embeds system
fonts; Lite uses standard Helvetica, so pixel equality is not expected.

Local review of the current source (package version 1.2.4) with Chrome 148 found:

| Example | Lite / Chromium pages | Review |
| --- | --- | --- |
| Invoice | 1 / 1 | No visible text collisions; address frame widths now match, while vertical spacing differs. |
| Report | 1 / 1 | Repeated KPI padding and excess mixed-style leading are fixed; default block spacing still differs. |
| Register | 3 / 3 | All 50 accounts occur once and headers repeat; Lite page ranges are 1-17, 18-36, 37-50 versus Chromium's 1-19, 20-40, 41-50. |

The three diagnosed issues are covered by `test/box-model.test.js`: anonymous
inline groups inherit typography, not the parent's box styles; explicit flex
widths include content-box padding/borders but do not expand border-box widths;
and mixed-style lines apply CSS line-height once. Invoice/report previews were
regenerated and visually checked, without approving pixel-perfect baselines.
Default block spacing and table pagination still depend on PDFKit font/line-height
metrics; a matching total page count alone does not establish browser parity.
