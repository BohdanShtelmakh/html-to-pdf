const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');
const puppeteer = require('puppeteer');
const PDFDocument = require('pdfkit');
const { renderPdfFromHtml } = require('../src');
const { loadComparisonCases, loadStressCases } = require('./comparison-cases.cjs');
const { wordCenter, invoiceOffsets, compareGeometry } = require('./comparison-geometry.cjs');
const { rowsByPage, validateResult } = require('./comparison-checks.cjs');

async function main() {
  for (const command of ['pdftoppm', 'pdftotext', 'pdfinfo']) execFileSync(command, ['-v'], { stdio: 'ignore' });
  if (process.platform === 'darwin') {
    for (const font of ['Arial.ttf', 'Arial Bold.ttf', 'Arial Italic.ttf', 'Times New Roman.ttf', 'Times New Roman Bold.ttf']) {
      fs.accessSync(path.join('/System/Library/Fonts/Supplemental', font));
    }
  }
  const stress = process.argv.includes('--stress');
  const output = path.join(__dirname, stress ? '../tmp/pdf-stress-comparison' : '../tmp/pdf-comparison');
  fs.mkdirSync(output, { recursive: true });
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'html-pdf-comparison-'));
  const env = process.platform === 'darwin'
    ? { ...process.env, FONTCONFIG_FILE: path.join(__dirname, 'fontconfig-macos.conf'), XDG_CACHE_HOME: cache }
    : process.env;
  let browser;
  const manifest = {
    packageVersion: require('../package.json').version,
    node: process.version, platform: process.platform,
    puppeteer: require('puppeteer/package.json').version,
    poppler: spawnSync('pdftoppm', ['-v'], { encoding: 'utf8' }).stderr.trim(),
    rasterDpi: 96, approvedBaseline: false,
    fontPolicy: 'Lite uses standard PDF fonts; Chromium uses system CSS fonts. macOS Poppler substitutes Arial for Helvetica and Times New Roman for Times.',
    examples: [],
  };
  try {
    browser = await puppeteer.launch({ headless: true });
    manifest.chromium = await browser.version();
    for (const spec of stress ? loadStressCases() : loadComparisonCases()) {
      const { name, html, markers } = spec;
      const page = await browser.newPage();
      let chromiumPdf;
      let chromiumColumns;
      let chromiumFrame;
      try {
        await page.setViewport({ width: 730, height: 1000 });
        await page.setJavaScriptEnabled(false);
        await page.setContent(html, { waitUntil: 'load' });
        await page.evaluate(() => document.fonts.ready);
        if (['long-words', 'mixed-style'].includes(name)) chromiumFrame = await page.evaluate(() => {
          const frame = document.querySelector('body > div');
          const bounds = frame.getBoundingClientRect();
          return [bounds.height, bounds.bottom];
        });
        if (name === 'nested-tables') chromiumColumns = await page.evaluate(() =>
          [...document.querySelectorAll('table')].map(table => {
            const widths = [...table.rows[0].cells].map(cell => cell.getBoundingClientRect().width);
            const total = widths.reduce((sum, width) => sum + width, 0);
            return widths.map(width => width / total);
          }));
        chromiumPdf = await page.pdf({ format: 'A4', preferCSSPageSize: true, printBackground: true });
      } finally {
        await page.close();
      }
      const rectangles = [];
      const originalRect = PDFDocument.prototype.rect;
      if (chromiumColumns || chromiumFrame || name === 'stress-framed-block') PDFDocument.prototype.rect = function (x, y, width, height) {
        const range = this.bufferedPageRange();
        rectangles.push({ x, y, width, height, page: range.start + this._pageBuffer.indexOf(this.page) + 1 });
        return originalRect.call(this, x, y, width, height);
      };
      let litePdf;
      try { litePdf = await renderPdfFromHtml(html, {
        autoResolveFonts: false, autoResolveEmojiFont: false, autoDownloadEmojiFont: false,
        allowScripts: false, fetchExternalCss: false,
      }); } finally { PDFDocument.prototype.rect = originalRect; }
      const example = { name, htmlSha256: crypto.createHash('sha256').update(html).digest('hex'),
        expected: { pages: spec.expectedPages, rowsByPage: spec.expectedRowsByPage, pageMarkers: spec.pageMarkers }, engines: {} };
      if (chromiumFrame) {
        if (!rectangles.length) throw new Error(`Missing frame geometry: ${name}`);
        const height = (Math.max(...rectangles.map(rect => rect.y + rect.height)) - Math.min(...rectangles.map(rect => rect.y))) / 0.75;
        example.frameGeometry = compareGeometry([height], [chromiumFrame[0]], 3);
        if (!example.frameGeometry.passed) { console.error(`${name}: frame height differs`); process.exitCode = 1; }
      }
      const bbox = {};
      if (chromiumColumns) {
        if (rectangles.length !== 10) throw new Error('Nested-table geometry capture changed; review required');
        const liteColumns = [[0, 5], [1, 2], [6, 7]].map(indices => {
          const widths = indices.map(index => rectangles[index].width);
          return widths.map(width => width / widths.reduce((sum, value) => sum + value, 0));
        });
        const maxDifference = Math.max(...liteColumns.flatMap((columns, table) =>
          columns.map((share, col) => Math.abs(share - chromiumColumns[table][col]))));
        example.columnGeometry = { lite: liteColumns, chromium: chromiumColumns, maxDifference, tolerance: 0.008 };
        if (maxDifference > 0.008) {
          console.error('Nested-table column proportions differ beyond the reviewed tolerance');
          process.exitCode = 1;
        }
      }
      for (const [engine, pdf] of Object.entries({ lite: litePdf, chromium: chromiumPdf })) {
        const directory = path.join(output, engine);
        fs.mkdirSync(directory, { recursive: true });
        const filename = path.join(directory, `${name}.pdf`);
        fs.writeFileSync(filename, pdf);
        for (const file of fs.readdirSync(directory)) {
          if (new RegExp(`^${name}-page-\\d+\\.png$`).test(file)) fs.unlinkSync(path.join(directory, file));
        }
        execFileSync('pdftoppm', ['-r', '96', '-png', filename, path.join(directory, `${name}-page`)], { env, stdio: 'inherit' });
        const text = execFileSync('pdftotext', ['-layout', filename, '-'], { encoding: 'utf8', env });
        fs.writeFileSync(path.join(directory, `${name}.txt`), text);
        if (name === 'invoice' || name === 'long-words') bbox[engine] = execFileSync('pdftotext', ['-bbox', filename, '-'], { encoding: 'utf8', env });
        const info = execFileSync('pdfinfo', [filename], { encoding: 'utf8', env });
        const pages = Number(info.match(/^Pages:\s+(\d+)/m)?.[1]);
        if (!pages) throw new Error(`Cannot read page count: ${name}/${engine}`);
        const compact = text.replace(/\s+/g, '');
        const missingMarkers = markers.filter(marker => !compact.includes(marker.replace(/\s+/g, '')));
        const unexpectedMarkerCounts = markers.map(marker => ({
          marker, count: compact.split(marker.replace(/\s+/g, '')).length - 1,
        })).filter(entry => entry.count !== 1);
        const previews = fs.readdirSync(directory).filter(file => new RegExp(`^${name}-page-\\d+\\.png$`).test(file));
        if (previews.length !== pages) throw new Error(`Missing page previews: ${name}/${engine}`);
        const issues = validateResult(spec, { text, pages });
        if (stress) {
          const pageText = text.split('\f');
          for (let index = 0; index < pages; index++) {
            if (!(pageText[index] || '').trim()) issues.push(`Empty page ${index + 1}`);
          }
          if (engine === 'lite' && name === 'stress-framed-block') {
            for (let index = 1; index <= pages; index++) {
              if (!rectangles.some(rect => rect.page === index)) issues.push(`Missing frame on page ${index}`);
            }
          }
        }
        example.engines[engine] = { pages, bytes: pdf.length, missingMarkers, unexpectedMarkerCounts,
          rowsByPage: spec.expectedRowsByPage ? rowsByPage(text, pages) : undefined, issues };
        if (issues.length) {
          console.error(`${name}/${engine}:`, issues);
          process.exitCode = 1;
        }
      }
      if (name === 'invoice') {
        example.amountGeometry = compareGeometry(invoiceOffsets(bbox.lite), invoiceOffsets(bbox.chromium), 1.5);
        if (!example.amountGeometry.passed) { console.error('invoice: amount alignment differs'); process.exitCode = 1; }
      }
      if (name === 'long-words') {
        const liteBottom = Math.max(...rectangles.map(rect => rect.y + rect.height));
        const chromiumBottom = (chromiumFrame[1] + 32) * 0.75;
        example.afterFrameGeometry = compareGeometry([wordCenter(bbox.lite, 'No') - liteBottom],
          [wordCenter(bbox.chromium, 'No') - chromiumBottom], 1.5);
        if (!example.afterFrameGeometry.passed) { console.error('long-words: text after frame differs'); process.exitCode = 1; }
      }
      if (stress && example.engines.lite.pages !== example.engines.chromium.pages) {
        example.engines.lite.issues.push(`Page count differs from Chromium (${example.engines.chromium.pages})`);
        process.exitCode = 1;
      }
      manifest.examples.push(example);
      console.log(`${name}: lite ${example.engines.lite.pages} pages; Chromium ${example.engines.chromium.pages} pages`);
    }
    fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    console.log(`Comparison artifacts: ${output}`);
  } finally {
    try { if (browser) await browser.close(); }
    finally { fs.rmSync(cache, { recursive: true, force: true }); }
  }
}

main().catch(error => { console.error('Comparison failed:', error.message); process.exitCode = 1; });
