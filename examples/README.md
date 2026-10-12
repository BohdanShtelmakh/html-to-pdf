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
register) for omissions or duplication, expected page counts, exact row order
and distribution, repeated headers, and explicit break destinations. A mismatch
sets a nonzero exit status and is recorded in the manifest. This is not a full
visual correctness test. It never updates or approves regression baselines. Chromium embeds system
fonts; Lite uses standard Helvetica, so pixel equality is not expected.

Local review of the current source (package version 1.2.4) with Chrome 148 found:

| Example | Lite / Chromium pages | Review |
| --- | --- | --- |
| Invoice | 1 / 1 | No visible text collisions; widths and vertical spacing are closer. Single-line cell vertical alignment still differs. |
| Report | 1 / 1 | KPI padding and native paragraph/heading leading are corrected; small font and spacing differences remain. |
| Register | 3 / 3 | All 50 accounts occur once, headers repeat, and both engines now produce page ranges 1-19, 20-40, 41-50. |

The three diagnosed issues are covered by `test/box-model.test.js`: anonymous
inline groups inherit typography, not the parent's box styles; explicit flex
widths include content-box padding/borders but do not expand border-box widths;
and mixed-style lines apply CSS line-height once. Invoice/report previews were
regenerated and visually checked, without approving pixel-perfect baselines.
Native heading/paragraph and table leading are also covered by
`test/typography-metrics.test.js`: PDFKit font metrics are not counted twice,
explicit line-height is respected, empty cell lines reserve full height, and
tables have no implicit 1em margin. Normal line height uses the selected native
font's metrics. This can change page breaks compared with earlier package output.
Matching row ranges in these fixtures is not a browser-parity guarantee: font
substitution, default cell vertical alignment and unsupported CSS still differ.
Do not describe the renderer as generally pixel-identical to Chromium.

### Regression Matrix

`comparison-cases.cjs` contains the three document examples plus five small
cases: sans/serif font variants, a long unbroken word, mixed-style wrapping,
nested tables and a forced page break with a framed final block. All fixtures
have fixed data and no external resources. On macOS, the preview-only Fontconfig
also maps standard Times fonts to Times New Roman to avoid unrelated font fallback.

`npm test` exercises the same eight fixtures without Chromium or Poppler.
`test/comparison-regressions.test.js` observes actual PDFKit glyph emission and
page additions to validate content and pagination. Validator tests explicitly
reject shifted/duplicated rows, missing repeated headers and extra blank pages.
The register's reviewed ranges are pinned to 1-19, 20-40 and 41-50; changes in
font/browser versions or template geometry require review, not automatic rebaselining.

The new matrix passed content/page checks locally in both engines. The comparison
also checks nested-table column proportions automatically: it captures
Lite cell rectangles and Chromium cell widths at a 730px content viewport,
normalizes each pair to its total width, and fails above a 0.008 difference in
column share. This is a focused geometry check, not a general pixel-diff baseline.
Nested cells now derive intrinsic widths from their nested columns rather than
assuming equal shares of the available parent width.

Visual review still shows spacing, column-width and font-metric differences. Outer text labels
in nested cells now preserve inherited font size, family and weight; regression
tests also check explicit descendant overrides. These outputs are not accepted
as pixel-identical visual baselines. Dedicated stress fixtures cover oversized
rows, nested-table pagination and an unfilled frame crossing page boundaries;
they do not establish general browser-compatible fragmentation.

### Geometry And Stress Checks

`npm run examples:compare` also compares invoice amount centers relative to the
two description lines (1.5pt tolerance), the long-word and mixed-style frame
heights (3px tolerance), and the text-to-frame gap after the long-word block
(1.5pt tolerance). These are explicit geometry tolerances, not pixel equality.
The text-to-frame gap now differs by approximately 0.93pt and passes the unchanged
1.5pt tolerance. Glyph centering excludes the font's internal leading while line
advance retains it. Amount alignment and both frame-height checks also pass.

Run `npm run examples:stress` separately for an oversized table row, a paginated
nested table and a multi-page framed block. Outputs go to
`tmp/pdf-stress-comparison`, not the regular comparison directory. The command
returns a failure for missing markers, empty pages, page-count differences from
Chromium or missing Lite frame fragments. It does not approve those outputs.

The reviewed fixtures now match Chromium's page counts: 2 for the oversized row,
3 for the nested table and 3 for the framed block, with no empty first page or
missing frame fragments. Tests check the following paragraph, a companion cell
on the first page, text within page margins, and two tall cells sharing the same
continuation pages. Page buffering is scoped to a fragmented row or unfilled
frame so previous pages can be decorated before they are flushed.

Colored backgrounds spanning pages, oversized rowspans and complex mixed-content
fragmentation are not covered by these fixtures. No pixel-identical baseline is
claimed for the stress outputs.
