const assert = require('assert');
const { renderPdfFromHtml } = require('../src/index.js');
const { assertBuffer, pageCount } = require('./helpers');

async function run() {
  // Flex row layout
  const flexRow = await renderPdfFromHtml(`
    <div style="display: flex; gap: 10px;">
      <div style="flex: 1;">Left</div>
      <div style="flex: 1;">Right</div>
    </div>
  `);
  assertBuffer(flexRow, 'flex row');

  // Flex column layout
  const flexCol = await renderPdfFromHtml(`
    <div style="display: flex; flex-direction: column;">
      <div>Top</div>
      <div>Bottom</div>
    </div>
  `);
  assertBuffer(flexCol, 'flex column');

  // Flex with justify-content
  const flexJustify = await renderPdfFromHtml(`
    <div style="display: flex; justify-content: space-between;">
      <div>Left</div>
      <div>Right</div>
    </div>
  `);
  assertBuffer(flexJustify, 'flex justify-content');

  // Flex wrap
  const flexWrap = await renderPdfFromHtml(`
    <div style="display: flex; flex-wrap: wrap; width: 200px;">
      <div style="width: 150px;">A</div>
      <div style="width: 150px;">B</div>
    </div>
  `);
  assertBuffer(flexWrap, 'flex wrap');

  // Explicit div heights are respected in flex containers
  const explicitDivHeights = await renderPdfFromHtml(`
    <div style="border:1px solid #000;display:flex;height:400px;margin-bottom:10px">
      <p>test 1</p>
    </div>
    <div style="border:1px solid #000;display:flex;height:200px;">
      <p>test 2</p>
    </div>
  `);
  assertBuffer(explicitDivHeights, 'explicit div heights');

  // Framed flex containers use flex measurement for background/border height
  const framedFlexRow = await renderPdfFromHtml(`
    <div style="display:flex;background:#f3e8ff;border:1px solid #6b21a8;padding:12px 20px;margin-bottom:20px">
      <div><b>STUDENT NAME</b><span>Benjamin J. Thompson</span></div>
      <div><b>ADMISSION NO</b><span>ADM-2022-450</span></div>
      <div><b>GRADE / CLASS</b><span>Grade 8 - Alpha</span></div>
    </div>
    <h3>Particulars</h3>
  `);
  assertBuffer(framedFlexRow, 'framed flex row');

  // Grid layout
  const grid = await renderPdfFromHtml(`
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
      <div>Cell 1</div>
      <div>Cell 2</div>
      <div>Cell 3</div>
      <div>Cell 4</div>
    </div>
  `);
  assertBuffer(grid, 'grid layout');

  // Grid with repeat
  const gridRepeat = await renderPdfFromHtml(`
    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px;">
      <div>A</div><div>B</div><div>C</div>
    </div>
  `);
  assertBuffer(gridRepeat, 'grid repeat');

  // Grid with column span
  const gridSpan = await renderPdfFromHtml(`
    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr;">
      <div style="grid-column: span 2;">Wide</div>
      <div>Narrow</div>
    </div>
  `);
  assertBuffer(gridSpan, 'grid column span');

  // Nested flex in grid
  const nested = await renderPdfFromHtml(`
    <div style="display: grid; grid-template-columns: 1fr 1fr;">
      <div style="display: flex; gap: 5px;">
        <span>A</span><span>B</span>
      </div>
      <div>C</div>
    </div>
  `);
  assertBuffer(nested, 'nested flex in grid');

  // Empty flex doesn't crash
  const emptyFlex = await renderPdfFromHtml('<div style="display: flex;"></div>');
  assertBuffer(emptyFlex, 'empty flex');

  // Empty grid doesn't crash
  const emptyGrid = await renderPdfFromHtml('<div style="display: grid; grid-template-columns: 1fr 1fr;"></div>');
  assertBuffer(emptyGrid, 'empty grid');
}

module.exports = { name: 'layout', run };
