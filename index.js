const fs = require('fs');
const path = require('path');
const { parseHtmlToObject } = require('./read-html');
const { makePdf } = require('./obj-pdf');
const { generatePDF } = require('./puppeter-sample');

async function main() {
  const [input = 'sample3.html', manualOutput = `output_${Date.now()}.pdf`, browserOutput = 'output_pup.pdf'] =
    process.argv.slice(2);
  const absoluteInput = path.resolve(process.cwd(), input);
  if (!fs.existsSync(absoluteInput)) {
    throw new Error(`Input HTML not found: ${absoluteInput}`);
  }

  const html = fs.readFileSync(absoluteInput, 'utf8');

  console.time('PDF Generation Time');
  const tree = await parseHtmlToObject(html, {
    fetchExternalCss: false,
    rootSelector: 'body',
  });
  await makePdf(tree, path.resolve(process.cwd(), manualOutput));
  console.timeEnd('PDF Generation Time');

  console.time('PDF Generation Time puppeteer');
  await generatePDF(input, path.resolve(process.cwd(), browserOutput));
  console.timeEnd('PDF Generation Time puppeteer');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
