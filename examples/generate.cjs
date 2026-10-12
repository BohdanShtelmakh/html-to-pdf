const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { renderPdfFromHtml } = require('../src');

async function main() {
  // Check tooling before overwriting any output.
  execFileSync('pdftoppm', ['-v'], { stdio: 'ignore' });
  if (process.platform === 'darwin') {
    for (const font of ['Arial.ttf', 'Arial Bold.ttf']) fs.accessSync(path.join('/System/Library/Fonts/Supplemental', font));
  }
  const output = path.join(__dirname, 'output');
  fs.mkdirSync(output, { recursive: true });
  const cacheDirectory = process.platform === 'darwin' ? fs.mkdtempSync(path.join(os.tmpdir(), 'html-pdf-lite-fontconfig-')) : null;
  const rasterEnv = cacheDirectory ? {
    ...process.env,
    FONTCONFIG_FILE: path.join(__dirname, 'fontconfig-macos.conf'),
    XDG_CACHE_HOME: cacheDirectory,
  } : process.env;
  const manifest = { packageVersion: require('../package.json').version, node: process.version, fontPolicy: 'PDF standard Helvetica; system and emoji resolution disabled', rasterFontPolicy: cacheDirectory ? 'Helvetica substituted with single-face Arial files for macOS Poppler previews only' : 'System Poppler font substitution', rasterDpi: 96, examples: [] };
  try {
    for (const name of ['invoice', 'report', 'long-table']) {
      const html = fs.readFileSync(path.join(__dirname, name + '.html'), 'utf8');
      const pdf = await renderPdfFromHtml(html, { autoResolveFonts: false, autoResolveEmojiFont: false, autoDownloadEmojiFont: false, allowScripts: false, fetchExternalCss: false });
      const pdfPath = path.join(output, name + '.pdf');
      fs.writeFileSync(pdfPath, pdf);
      // Remove only this example's prior previews, including surplus old pages.
      for (const file of fs.readdirSync(output)) {
        if (new RegExp(`^${name}-page-\\d+\\.png$`).test(file)) fs.unlinkSync(path.join(output, file));
      }
      execFileSync('pdftoppm', ['-r', '96', '-png', pdfPath, path.join(output, name + '-page')], { stdio: ['ignore', 'ignore', 'inherit'], env: rasterEnv });
      const pages = fs.readdirSync(output).filter(file => new RegExp(`^${name}-page-\\d+\\.png$`).test(file)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      if (!pages.length) throw new Error(`No previews generated for ${name}`);
      manifest.examples.push({ name, bytes: pdf.length, pages });
      console.log(`${name}: ${pages.length} pages, ${pdf.length} bytes`);
    }
    fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  } finally {
    if (cacheDirectory) fs.rmSync(cacheDirectory, { recursive: true, force: true });
  }
}
main().catch(error => { console.error('Example generation failed:', error.message); process.exitCode = 1; });
