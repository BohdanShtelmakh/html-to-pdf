async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const { html, iterations, warmup } = JSON.parse(input);
  const [engine, mode] = process.argv.slice(2);
  let browser;
  const start = performance.now();
  try {
    let render;
    if (engine === 'lite') {
      const { renderPdfFromHtml } = require('../src');
      render = () => renderPdfFromHtml(html, { margins: { top: 32, right: 32, bottom: 32, left: 32 } });
    } else {
      browser = await require('puppeteer').launch({ headless: true });
      render = async () => {
        const page = await browser.newPage();
        try {
          await page.setContent(html, { waitUntil: 'load' });
          await page.evaluate(() => document.fonts.ready);
          return await page.pdf({ format: 'A4', printBackground: true, margin: { top: `${32 / 72}in`, right: `${32 / 72}in`, bottom: `${32 / 72}in`, left: `${32 / 72}in` } });
        } finally { if (mode !== 'cold') await page.close(); }
      };
    }
    const times = [];
    let bytes;
    if (mode === 'cold') {
      const pdf = await render();
      times.push(performance.now() - start);
      bytes = pdf.length;
    } else {
      for (let i = 0; i < warmup; i++) await render();
      for (let i = 0; i < iterations; i++) {
        const tick = performance.now();
        const pdf = await render();
        times.push(performance.now() - tick);
        bytes = pdf.length;
      }
    }
    console.log(JSON.stringify({ times, bytes }));
  } finally { if (browser) await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
