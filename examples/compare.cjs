const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');
const puppeteer = require('puppeteer');
const { renderPdfFromHtml } = require('../src');
const { loadComparisonCases } = require('./comparison-cases.cjs');
const { rowsByPage, validateResult } = require('./comparison-checks.cjs');

async function main() {
  for (const command of ['pdftoppm', 'pdftotext', 'pdfinfo']) execFileSync(command, ['-v'], { stdio: 'ignore' });
  if (process.platform === 'darwin') {
    for (const font of ['Arial.ttf', 'Arial Bold.ttf', 'Arial Italic.ttf', 'Times New Roman.ttf', 'Times New Roman Bold.ttf']) {
      fs.accessSync(path.join('/System/Library/Fonts/Supplemental', font));
    }
  }
  const output = path.join(__dirname, '../tmp/pdf-comparison');
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
    for (const spec of loadComparisonCases()) {
      const { name, html, markers } = spec;
      const page = await browser.newPage();
      let chromiumPdf;
      try {
        await page.setJavaScriptEnabled(false);
        await page.setContent(html, { waitUntil: 'load' });
        await page.evaluate(() => document.fonts.ready);
        chromiumPdf = await page.pdf({ format: 'A4', preferCSSPageSize: true, printBackground: true });
      } finally {
        await page.close();
      }
      const litePdf = await renderPdfFromHtml(html, {
        autoResolveFonts: false, autoResolveEmojiFont: false, autoDownloadEmojiFont: false,
        allowScripts: false, fetchExternalCss: false,
      });
      const example = { name, htmlSha256: crypto.createHash('sha256').update(html).digest('hex'),
        expected: { pages: spec.expectedPages, rowsByPage: spec.expectedRowsByPage, pageMarkers: spec.pageMarkers }, engines: {} };
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
        example.engines[engine] = { pages, bytes: pdf.length, missingMarkers, unexpectedMarkerCounts,
          rowsByPage: spec.expectedRowsByPage ? rowsByPage(text, pages) : undefined, issues };
        if (issues.length) {
          console.error(`${name}/${engine}:`, issues);
          process.exitCode = 1;
        }
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
