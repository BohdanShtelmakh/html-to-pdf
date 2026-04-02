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
}

module.exports = { name: 'tables', run };
