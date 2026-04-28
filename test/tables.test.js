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
}

module.exports = { name: 'tables', run };
