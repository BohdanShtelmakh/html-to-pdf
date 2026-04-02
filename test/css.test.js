const assert = require('assert');
const { renderPdfFromHtml } = require('../src/index.js');
const { assertBuffer } = require('./helpers');

async function run() {
  // CSS specificity: class overrides tag
  const specificity = await renderPdfFromHtml(`
    <style>
      p { color: red; }
      .blue { color: blue; }
    </style>
    <p class="blue">Should be blue</p>
  `);
  assertBuffer(specificity, 'specificity');

  // CSS variables
  const cssVars = await renderPdfFromHtml(`
    <style>
      :root { --main-color: #333; --size: 16px; }
      p { color: var(--main-color); font-size: var(--size); }
    </style>
    <p>Styled with variables</p>
  `);
  assertBuffer(cssVars, 'CSS variables');

  // CSS variable with fallback
  const varFallback = await renderPdfFromHtml(`
    <style>
      p { color: var(--undefined-var, #ff0000); }
    </style>
    <p>Red fallback</p>
  `);
  assertBuffer(varFallback, 'CSS variable fallback');

  // Shorthand expansion: margin
  const marginShorthand = await renderPdfFromHtml(`
    <style>
      .box { margin: 10px 20px 30px 40px; }
    </style>
    <div class="box"><p>Margin box</p></div>
  `);
  assertBuffer(marginShorthand, 'margin shorthand');

  // Shorthand expansion: padding
  const paddingShorthand = await renderPdfFromHtml(`
    <style>
      .box { padding: 10px 20px; }
    </style>
    <div class="box"><p>Padding box</p></div>
  `);
  assertBuffer(paddingShorthand, 'padding shorthand');

  // Shorthand expansion: border
  const borderShorthand = await renderPdfFromHtml(`
    <style>
      .box { border: 2px solid #000; }
    </style>
    <div class="box"><p>Bordered</p></div>
  `);
  assertBuffer(borderShorthand, 'border shorthand');

  // Shorthand expansion: font
  const fontShorthand = await renderPdfFromHtml(`
    <style>
      p { font: bold 14px/1.5 Helvetica, sans-serif; }
    </style>
    <p>Font shorthand</p>
  `);
  assertBuffer(fontShorthand, 'font shorthand');

  // !important overrides
  const important = await renderPdfFromHtml(`
    <style>
      .red { color: red !important; }
      .blue { color: blue; }
    </style>
    <p class="red blue">Should be red</p>
  `);
  assertBuffer(important, '!important');

  // Inline style overrides stylesheet
  const inlineOverride = await renderPdfFromHtml(`
    <style>
      p { color: red; }
    </style>
    <p style="color: blue;">Should be blue</p>
  `);
  assertBuffer(inlineOverride, 'inline style override');

  // CSS units: em, rem, pt, px
  const units = await renderPdfFromHtml(`
    <style>
      .em { font-size: 2em; }
      .rem { font-size: 1.5rem; }
      .pt { font-size: 14pt; }
      .px { font-size: 18px; }
    </style>
    <p class="em">Em</p>
    <p class="rem">Rem</p>
    <p class="pt">Pt</p>
    <p class="px">Px</p>
  `);
  assertBuffer(units, 'CSS units');

  // Inheritance: color inherits, background does not
  const inheritance = await renderPdfFromHtml(`
    <div style="color: red; background-color: yellow;">
      <p>Should inherit red color but not yellow bg</p>
    </div>
  `);
  assertBuffer(inheritance, 'CSS inheritance');

  // display: none hides element
  const displayNone = await renderPdfFromHtml(`
    <p>Visible</p>
    <p style="display: none;">Hidden</p>
    <p>Also visible</p>
  `);
  assertBuffer(displayNone, 'display: none');

  // Heading default sizes
  const headings = await renderPdfFromHtml(`
    <h1>H1</h1><h2>H2</h2><h3>H3</h3><h4>H4</h4><h5>H5</h5><h6>H6</h6>
  `);
  assertBuffer(headings, 'headings');

  // Color parsing: hex, rgb, rgba, named
  const colors = await renderPdfFromHtml(`
    <style>
      .hex3 { color: #f00; }
      .hex6 { color: #00ff00; }
      .rgb { color: rgb(0, 0, 255); }
      .rgba { color: rgba(255, 0, 0, 0.5); }
      .named { color: gray; }
    </style>
    <p class="hex3">Hex3</p>
    <p class="hex6">Hex6</p>
    <p class="rgb">RGB</p>
    <p class="rgba">RGBA</p>
    <p class="named">Named</p>
  `);
  assertBuffer(colors, 'color parsing');
}

module.exports = { name: 'css', run };
