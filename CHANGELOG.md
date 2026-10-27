# Changelog

## 1.4.0

### Features

- Add `pageSize` (PDFKit size name or `[width, height]` in points) and `orientation` options. Pages were always A4.
- Support `pageSize: [width, 'auto']` to shrink the last page to its content.
- Add A4, US Letter, auto-height and orientation controls to the playground.

### Fixes

- Keep auto-height pages at least 1 pt tall for empty content with zero margins.

### Compatibility Notes

The default is still A4 portrait, so existing output is unchanged.

## 1.3.0

### Rendering Improvements

- Fix mixed-style wrapping and explicit line-break handling in the reviewed document fixtures.
- Use font metrics consistently for normal line height and share explicit CSS leading above and below glyphs.
- Include trailing child margins when measuring framed blocks; preserve paragraph spacing and horizontal padding on continuation pages.
- Respect cell vertical alignment and include borders in table dimensions.
- Derive nested-table widths from intrinsic content instead of equal parent-column shares.
- Correct content-box sizing and avoid applying percentage widths twice to allocated flex items.
- Prevent empty leading pages and double-counted row height for the reviewed oversized rows and nested-table pagination cases.
- Draw unfilled frame and cell-border fragments on continuation pages without a top border crossing continued text.
- Avoid repeating body top padding after explicit page breaks.

### Compatibility Notes

The public rendering API, exports and TypeScript signatures are unchanged.
Generated PDFs can differ from 1.2.x in wrapping, spacing, cell alignment, column
widths, row heights and pagination. Templates using workarounds for old behavior
should be visually reviewed before upgrading in production.

Tables now default to zero top/bottom margin, and cells default to middle vertical
alignment. Declare explicit margins and `vertical-align: top` where required.
There is no byte-identical output or pixel-perfect Chromium compatibility guarantee.

### Verification And Scope

- Repository tests cover 8 standard examples and 3 pagination stress fixtures.
- Chromium comparisons check content, page counts, selected column proportions,
  invoice amount alignment, two frame heights and the text-to-frame gap.
- The reviewed stress fixtures have 3, 2 and 3 pages respectively in both engines.
- Test fixtures, benchmark tools and the playground are excluded from the npm package.
- README benchmarks were rerun on October 13, 2026 using the code prepared for 1.3.0 at `ddc6581`; raw package metadata remains 1.2.4 until the release version bump.

Multi-page colored backgrounds, oversized rowspans and complex mixed-content
fragmentation remain outside the reviewed coverage. Very large fragmented rows
and unfilled frames temporarily buffer pages and can increase memory use.
