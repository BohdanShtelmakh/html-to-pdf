const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const generatePDF = async (file, output = 'output_pup.pdf') => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  // Resolve the path to sample2.html
  const htmlPath = path.resolve(__dirname, file);
  const htmlContent = fs.readFileSync(htmlPath, 'utf8');

  await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

  // Generate PDF
  await page.pdf({
    path: output,
    format: 'A4',
    printBackground: true,
  });

  await browser.close();
};

module.exports = { generatePDF };
