const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const { parseHtmlToObject } = require('./read-html');
const { makePdf } = require('./obj-pdf');
const { generatePDF } = require('./puppeter-sample');

const TEST_DIR = path.join(__dirname, 'test-files');
const OUT_DIR = path.join(__dirname, 'test-output');
const OUT_MY = path.join(OUT_DIR, 'my');
const OUT_PUP = path.join(OUT_DIR, 'pup');

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function listHtmlFiles(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.html'))
    .map((e) => path.join(dir, e.name));
}

async function renderFile(filePath, outMy, outPup) {
  const html = fs.readFileSync(filePath, 'utf8');

  const startMy = performance.now();
  const memBeforeMy = process.memoryUsage().rss;
  const tree = await parseHtmlToObject(html, { fetchExternalCss: false, rootSelector: 'body' });
  await makePdf(tree, outMy);
  const myMs = performance.now() - startMy;
  const memAfterMy = process.memoryUsage().rss;

  const startPup = performance.now();
  const memBeforePup = process.memoryUsage().rss;
  await generatePDF(filePath, outPup);
  const pupMs = performance.now() - startPup;
  const memAfterPup = process.memoryUsage().rss;

  return {
    myMs,
    pupMs,
    totalMs: myMs + pupMs,
    myMem: memAfterMy - memBeforeMy,
    pupMem: memAfterPup - memBeforePup,
  };
}

async function main() {
  ensureDir(OUT_DIR);
  ensureDir(OUT_MY);
  ensureDir(OUT_PUP);

  const files = listHtmlFiles(TEST_DIR);
  if (!files.length) {
    console.error('No HTML files found in test-files/');
    process.exit(1);
  }

  const results = [];
  for (const file of files) {
    const base = path.basename(file, path.extname(file));
    const outMy = path.join(OUT_MY, `${base}.pdf`);
    const outPup = path.join(OUT_PUP, `${base}.pdf`);
    process.stdout.write(`Rendering ${base}... `);
    try {
      const res = await renderFile(file, outMy, outPup);
      results.push({
        file: base,
        ms: res.totalMs,
        myMs: res.myMs,
        pupMs: res.pupMs,
        myMem: res.myMem,
        pupMem: res.pupMem,
      });
      const parts = [];
      if (res.myMs != null) parts.push(`my: ${res.myMs.toFixed(1)} ms`);
      if (res.pupMs != null) parts.push(`pup: ${res.pupMs.toFixed(1)} ms`);
      if (res.myMem != null) parts.push(`my mem: ${(res.myMem / 1024 / 1024).toFixed(2)} MB`);
      if (res.pupMem != null) parts.push(`pup mem: ${(res.pupMem / 1024 / 1024).toFixed(2)} MB`);
      const extra = parts.length ? ` [${parts.join(', ')}]` : '';
      process.stdout.write(`done (${res.totalMs.toFixed(1)} ms)${extra}\n`);
    } catch (err) {
      process.stdout.write('failed\n');
      console.error(err.message || err);
    }
  }

  console.log('\nSummary:');
  results.forEach((r) => {
    const parts = [`total ${r.ms.toFixed(1)} ms`];
    if (r.myMs != null) parts.push(`my ${r.myMs.toFixed(1)} ms`);
    if (r.pupMs != null) parts.push(`pup ${r.pupMs.toFixed(1)} ms`);
    if (r.myMem != null) parts.push(`my mem ${(r.myMem / 1024 / 1024).toFixed(2)} MB`);
    if (r.pupMem != null) parts.push(`pup mem ${(r.pupMem / 1024 / 1024).toFixed(2)} MB`);
    console.log(`- ${r.file}: ${parts.join(', ')}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
