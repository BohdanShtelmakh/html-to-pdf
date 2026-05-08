const assert = require('assert');
const { renderPdfFromHtml } = require('../src/index.js');
const { assertBuffer, pageCount } = require('./helpers');

async function run() {
  // Basic table renders
  const basic = await renderPdfFromHtml(`
    <table>
      <thead><tr><th>Name</th><th>Value</th></tr></thead>
      <tbody>
        <tr><td>A</td><td>1</td></tr>
        <tr><td>B</td><td>2</td></tr>
      </tbody>
    </table>
  `);
  assertBuffer(basic, 'basic table');

  // Table with colspan
  const colspan = await renderPdfFromHtml(`
    <table>
      <tr><td colspan="2">Spanning</td></tr>
      <tr><td>Left</td><td>Right</td></tr>
    </table>
  `);
  assertBuffer(colspan, 'colspan table');

  // Table with styled cells
  const styled = await renderPdfFromHtml(`
    <table style="border: 1px solid #ccc;">
      <tr style="background-color: #f0f0f0;">
        <th style="padding: 8px; text-align: left;">Header</th>
      </tr>
      <tr>
        <td style="padding: 8px; color: red;">Data</td>
      </tr>
    </table>
  `);
  assertBuffer(styled, 'styled table');

  // Empty table doesn't crash
  const empty = await renderPdfFromHtml('<table></table>');
  assertBuffer(empty, 'empty table');

  // Table with tfoot
  const withFoot = await renderPdfFromHtml(`
    <table>
      <thead><tr><th>Item</th><th>Price</th></tr></thead>
      <tbody><tr><td>Widget</td><td>$10</td></tr></tbody>
      <tfoot><tr><td>Total</td><td>$10</td></tr></tfoot>
    </table>
  `);
  assertBuffer(withFoot, 'table with tfoot');

  // Constrained multi-column tables keep readable column widths
  const constrained = await renderPdfFromHtml(`
    <div style="width: 260px;">
      <table>
        <thead>
          <tr><th>Risk</th><th>Impact</th><th>Probability</th><th>Mitigation</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>Operational Risk</td>
            <td>Medium</td>
            <td>45%</td>
            <td>Monitor weekly and document fallback plan.</td>
          </tr>
        </tbody>
      </table>
    </div>
  `);
  assertBuffer(constrained, 'constrained table');

  // Nested tables render as block content inside cells instead of flattened text
  const nested = await renderPdfFromHtml(`
    <table>
      <tr>
        <td>
          North America
          <table>
            <tr><td>ARR</td><td>$1.1M</td></tr>
            <tr><td>NPS</td><td>71</td></tr>
          </table>
        </td>
      </tr>
    </table>
  `);
  assertBuffer(nested, 'nested table in cell');

  const { _tableInternals } = require('../src/components/table.js');

  // Table column hints from CSS and HTML width attributes are honored.
  const fixedWidths = _tableInternals.distributeColumnWidths([40, 180, 60], [20, 80, 30], 330, [60, null, 90]);
  assert.ok(fixedWidths[0] >= 59 && fixedWidths[0] <= 61, 'first fixed table column width is preserved');
  assert.ok(fixedWidths[2] >= 89 && fixedWidths[2] <= 91, 'third fixed table column width is preserved');

  const readableWidths = _tableInternals.distributeColumnWidths([36, 168, 96], [90, 44, 44], 300, [36, 168, 96]);
  assert.ok(readableWidths[0] >= 89, 'narrow explicit table width is raised to readable minimum');
  assert.ok(readableWidths[1] < 168, 'wide explicit table width gives space back when another column needs it');

  // Browser-default whitespace collapses indentation/newlines, while <br> remains a forced break.
  const whitespaceCell = {
    type: 'element',
    tag: 'td',
    children: [{ type: 'text', text: '\n\n\nWithout New Line' }],
  };
  assert.strictEqual(
    _tableInternals.cellPlainText(whitespaceCell, {}),
    'Without New Line',
    'table cell text collapses source indentation whitespace'
  );

  const breakCell = {
    type: 'element',
    tag: 'td',
    children: [
      { type: 'text', text: 'Line 1' },
      { type: 'element', tag: 'br', children: [] },
      { type: 'text', text: 'Line 2' },
    ],
  };
  assert.strictEqual(
    _tableInternals.cellPlainText(breakCell, {}),
    'Line 1\nLine 2',
    'br in table cells creates a forced line break'
  );

  const widthStyles = { width: '70px', 'min-width': '50px' };
  assert.ok(_tableInternals.cellExplicitWidth({ styles: widthStyles }, 500, 12) > 52, 'css width is parsed');
  assert.ok(_tableInternals.cellMinWidth({ styles: widthStyles }, 500, 12) > 37, 'css min-width is parsed');

  const htmlWidth = _tableInternals.cellExplicitWidth({ attrs: { width: '8%' }, styles: {} }, 500, 12);
  assert.ok(htmlWidth >= 39 && htmlWidth <= 41, 'html width attribute percent is parsed');

  const widthStyled = await renderPdfFromHtml(`
    <table>
      <tr>
        <th width="6%">Product</th>
        <th width="28%">HSN/SAC</th>
        <th style="min-width: 50px; white-space: nowrap;">Batch</th>
      </tr>
      <tr>
        <td>


          Without New Line
        </td>
        <td>30049099</td>
        <td>PX-24H562A</td>
      </tr>
      <tr>
        <td>Line 1<br/>Line 2</td>
        <td>30041030</td>
        <td>AMC-2457C</td>
      </tr>
    </table>
  `);
  assertBuffer(widthStyled, 'table width attributes and whitespace');
}

module.exports = { name: 'tables', run };
