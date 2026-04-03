const assert = require('assert');
const { renderPdfFromHtml } = require('../src/index.js');
const { assertBuffer, pageCount } = require('./helpers');

async function run() {
  // flex-wrap with multiple rows
  const flexWrapRows = await renderPdfFromHtml(`
    <div style="display: flex; flex-wrap: wrap; width: 200px; gap: 5px;">
      <div style="width: 90px; background: #eee; padding: 5px;">A</div>
      <div style="width: 90px; background: #ddd; padding: 5px;">B</div>
      <div style="width: 90px; background: #ccc; padding: 5px;">C</div>
      <div style="width: 90px; background: #bbb; padding: 5px;">D</div>
    </div>
  `);
  assertBuffer(flexWrapRows, 'flex-wrap multiple rows');

  // justify-content: flex-end
  const flexEnd = await renderPdfFromHtml(`
    <div style="display: flex; justify-content: flex-end;">
      <div style="width: 100px;">Right</div>
    </div>
  `);
  assertBuffer(flexEnd, 'justify-content: flex-end');

  // justify-content: center
  const center = await renderPdfFromHtml(`
    <div style="display: flex; justify-content: center;">
      <div style="width: 100px;">Center</div>
    </div>
  `);
  assertBuffer(center, 'justify-content: center');

  // justify-content: space-around
  const spaceAround = await renderPdfFromHtml(`
    <div style="display: flex; justify-content: space-around;">
      <div>A</div><div>B</div><div>C</div>
    </div>
  `);
  assertBuffer(spaceAround, 'justify-content: space-around');

  // justify-content: space-evenly
  const spaceEvenly = await renderPdfFromHtml(`
    <div style="display: flex; justify-content: space-evenly;">
      <div>A</div><div>B</div><div>C</div>
    </div>
  `);
  assertBuffer(spaceEvenly, 'justify-content: space-evenly');

  // flex-grow distribution
  const flexGrow = await renderPdfFromHtml(`
    <div style="display: flex;">
      <div style="flex-grow: 1;">Small</div>
      <div style="flex-grow: 3;">Big</div>
    </div>
  `);
  assertBuffer(flexGrow, 'flex-grow distribution');

  // flex-basis
  const flexBasis = await renderPdfFromHtml(`
    <div style="display: flex;">
      <div style="flex-basis: 200px;">Fixed</div>
      <div style="flex: 1;">Flexible</div>
    </div>
  `);
  assertBuffer(flexBasis, 'flex-basis');

  // Grid with fixed + fr columns
  const gridMixed = await renderPdfFromHtml(`
    <div style="display: grid; grid-template-columns: 100px 1fr 2fr; gap: 10px;">
      <div>Fixed</div><div>1fr</div><div>2fr</div>
    </div>
  `);
  assertBuffer(gridMixed, 'grid mixed columns');

  // Grid with percentage columns
  const gridPercent = await renderPdfFromHtml(`
    <div style="display: grid; grid-template-columns: 50% 50%;">
      <div>Left</div><div>Right</div>
    </div>
  `);
  assertBuffer(gridPercent, 'grid percentage columns');

  // Grid align-items: stretch (default)
  const gridStretch = await renderPdfFromHtml(`
    <div style="display: grid; grid-template-columns: 1fr 1fr; align-items: stretch;">
      <div style="background: #eee;">Short</div>
      <div style="background: #ddd;">Tall<br/>content<br/>here</div>
    </div>
  `);
  assertBuffer(gridStretch, 'grid align-items stretch');

  // Margin collapsing between blocks
  const marginCollapse = await renderPdfFromHtml(`
    <div style="margin-bottom: 20px;"><p>First</p></div>
    <div style="margin-top: 30px;"><p>Second</p></div>
  `);
  assertBuffer(marginCollapse, 'margin collapsing');

  // Deeply nested layout
  const deepNested = await renderPdfFromHtml(`
    <div style="display: flex; gap: 10px;">
      <div style="flex: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 5px;">
        <div style="padding: 5px; background: #f0f0f0;">A</div>
        <div style="padding: 5px; background: #e0e0e0;">B</div>
      </div>
      <div style="flex: 1;">
        <div style="display: flex; flex-direction: column; gap: 5px;">
          <div style="padding: 5px; background: #d0d0d0;">C</div>
          <div style="padding: 5px; background: #c0c0c0;">D</div>
        </div>
      </div>
    </div>
  `);
  assertBuffer(deepNested, 'deeply nested layout');

  // Page break with break-inside: avoid on large content
  const fillerLines = Array.from({ length: 60 }, (_, i) => `<p>Line ${i + 1}</p>`).join('\n');
  const breakAvoid = await renderPdfFromHtml(`
    ${fillerLines}
    <div style="break-inside: avoid;">
      <p>This block should avoid breaking</p>
      <p>across pages if possible</p>
    </div>
  `);
  assertBuffer(breakAvoid, 'break-inside avoid');
  assert.ok(pageCount(breakAvoid) >= 2, 'break-inside avoid should create at least 2 pages');
}

module.exports = { name: 'layout-edge', run };
