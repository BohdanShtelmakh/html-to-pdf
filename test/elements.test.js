const assert = require('assert');
const { renderPdfFromHtml } = require('../src/index.js');
const { assertBuffer } = require('./helpers');

async function run() {
  // Unordered list
  const ul = await renderPdfFromHtml(`
    <ul>
      <li>Item 1</li>
      <li>Item 2</li>
      <li>Item 3</li>
    </ul>
  `);
  assertBuffer(ul, 'unordered list');

  // Ordered list
  const ol = await renderPdfFromHtml(`
    <ol>
      <li>First</li>
      <li>Second</li>
      <li>Third</li>
    </ol>
  `);
  assertBuffer(ol, 'ordered list');

  // List with list-style-type: none
  const noStyle = await renderPdfFromHtml(`
    <ul style="list-style-type: none;">
      <li>No bullet</li>
    </ul>
  `);
  assertBuffer(noStyle, 'list-style-type: none');

  // Pre/code block
  const pre = await renderPdfFromHtml(`
    <pre>function hello() {
  return "world";
}</pre>
  `);
  assertBuffer(pre, 'pre block');

  // Inline code
  const code = await renderPdfFromHtml('<p>Use <code>npm install</code> to install</p>');
  assertBuffer(code, 'inline code');

  // Inline SVG
  const svg = await renderPdfFromHtml(`
    <svg width="100" height="100" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="40" fill="green" />
    </svg>
  `);
  assertBuffer(svg, 'inline SVG');

  // Inline spans with styling
  const spans = await renderPdfFromHtml(`
    <p>
      <span style="color: red;">Red</span>
      <span style="background-color: yellow; padding: 2px 4px;">Highlighted</span>
      <span style="text-decoration: underline;">Underlined</span>
    </p>
  `);
  assertBuffer(spans, 'styled spans');

  // Nested divs with padding and borders
  const nestedDivs = await renderPdfFromHtml(`
    <div style="padding: 10px; border: 1px solid #000;">
      <div style="padding: 5px; background-color: #eee;">
        <p>Nested content</p>
      </div>
    </div>
  `);
  assertBuffer(nestedDivs, 'nested divs');

  // Text decorations
  const decorations = await renderPdfFromHtml(`
    <p style="text-decoration: underline;">Underlined</p>
    <p style="text-decoration: line-through;">Strikethrough</p>
  `);
  assertBuffer(decorations, 'text decorations');

  // Border-radius
  const borderRadius = await renderPdfFromHtml(`
    <div style="border: 2px solid #333; border-radius: 8px; padding: 10px;">
      Rounded corners
    </div>
  `);
  assertBuffer(borderRadius, 'border-radius');

  // Header element
  const header = await renderPdfFromHtml(`
    <header style="padding: 10px; background-color: #f0f0f0;">
      <h1>Page Title</h1>
    </header>
  `);
  assertBuffer(header, 'header element');

  // Figure and figcaption
  const figure = await renderPdfFromHtml(`
    <figure>
      <svg width="50" height="50"><rect fill="red" width="50" height="50"/></svg>
      <figcaption>A red square</figcaption>
    </figure>
  `);
  assertBuffer(figure, 'figure with caption');
}

module.exports = { name: 'elements', run };
