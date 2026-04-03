const templates = require('./templates');

const ITERATIONS = 15;
const WARMUP = 2;

function stats(times) {
  const sorted = [...times].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const avg = sum / sorted.length;
  const median = sorted[Math.floor(sorted.length / 2)];
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  return { avg, median, min, max, p95 };
}

function formatMs(ms) {
  return ms < 1000 ? ms.toFixed(1) + 'ms' : (ms / 1000).toFixed(2) + 's';
}

function pad(str, len) {
  return String(str).padEnd(len);
}

function padL(str, len) {
  return String(str).padStart(len);
}

async function benchLite(html) {
  const { renderPdfFromHtml } = require('../src/index.js');
  for (let i = 0; i < WARMUP; i++) await renderPdfFromHtml(html);
  const times = [];
  let size = 0;
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    const buf = await renderPdfFromHtml(html);
    times.push(performance.now() - start);
    if (i === 0) size = buf.length;
  }
  return { times, size };
}

async function benchPuppeteer(html, browser) {
  for (let i = 0; i < WARMUP; i++) {
    const p = await browser.newPage();
    await p.setContent(html, { waitUntil: 'load' });
    await p.pdf({ format: 'A4' });
    await p.close();
  }
  const times = [];
  let size = 0;
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    const buf = await page.pdf({ format: 'A4' });
    await page.close();
    times.push(performance.now() - start);
    if (i === 0) size = buf.length;
  }
  return { times, size };
}

async function main() {
  let puppeteer, browser;
  try {
    puppeteer = require('puppeteer');
    browser = await puppeteer.launch({ headless: true });
  } catch {}

  const cases = Object.entries(templates);
  const results = [];

  console.log(`\nBenchmark: ${ITERATIONS} iterations, ${WARMUP} warmup\n`);
  console.log('Running...\n');

  for (const [key, { name, html: htmlFn }] of cases) {
    const html = htmlFn();
    process.stdout.write(`  ${name}...`);

    const lite = await benchLite(html);
    const pup = browser ? await benchPuppeteer(html, browser) : null;

    results.push({ name, lite, pup });
    process.stdout.write(' done\n');
  }

  if (browser) await browser.close();

  // Print results table
  console.log('\n' + '='.repeat(95));
  console.log(
    pad('Template', 38) +
    padL('html-pdf-lite', 14) +
    padL('Puppeteer', 14) +
    padL('Speedup', 10) +
    padL('Size (lite)', 12) +
    padL('Size (pup)', 12)
  );
  console.log('-'.repeat(95));

  let totalLite = 0;
  let totalPup = 0;

  for (const { name, lite, pup } of results) {
    const liteAvg = stats(lite.times).avg;
    totalLite += liteAvg;
    const pupAvg = pup ? stats(pup.times).avg : null;
    if (pupAvg) totalPup += pupAvg;
    const speedup = pupAvg ? (pupAvg / liteAvg).toFixed(1) + 'x' : '-';
    const liteSize = (lite.size / 1024).toFixed(1) + ' KB';
    const pupSize = pup ? (pup.size / 1024).toFixed(1) + ' KB' : '-';

    console.log(
      pad(name, 38) +
      padL(formatMs(liteAvg), 14) +
      padL(pup ? formatMs(pupAvg) : '(skipped)', 14) +
      padL(speedup, 10) +
      padL(liteSize, 12) +
      padL(pupSize, 12)
    );
  }

  console.log('-'.repeat(95));
  const avgSpeedup = totalPup > 0 ? (totalPup / totalLite).toFixed(1) + 'x' : '-';
  console.log(
    pad('AVERAGE', 38) +
    padL(formatMs(totalLite / results.length), 14) +
    padL(totalPup > 0 ? formatMs(totalPup / results.length) : '-', 14) +
    padL(avgSpeedup, 10)
  );
  console.log('='.repeat(95));

  // Cold start comparison
  console.log('\nCold start (require/launch + first render):');
  {
    const html = templates.invoice.html();
    const startLite = performance.now();
    const { renderPdfFromHtml } = require('../src/index.js');
    await renderPdfFromHtml(html);
    const liteCold = performance.now() - startLite;
    console.log(`  html-pdf-lite: ${formatMs(liteCold)}`);

    if (puppeteer) {
      const startPup = performance.now();
      const b = await puppeteer.launch({ headless: true });
      const p = await b.newPage();
      await p.setContent(html, { waitUntil: 'load' });
      await p.pdf({ format: 'A4' });
      await p.close();
      await b.close();
      const pupCold = performance.now() - startPup;
      console.log(`  puppeteer:     ${formatMs(pupCold)}`);
      console.log(`  => ${(pupCold / liteCold).toFixed(1)}x faster cold start`);
    }
  }

  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
