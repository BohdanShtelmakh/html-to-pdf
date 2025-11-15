const fs = require('fs');
const PDFDocument = require('pdfkit');
const { Layout } = require('./pdf/layout');
const { renderNode } = require('./pdf/render-node');

async function makePdf(json, outputPath = 'output.pdf') {
  const doc = new PDFDocument({
    autoFirstPage: true,
    size: 'A4',
    margins: { top: '10mm', bottom: '10mm', left: '5mm', right: '5mm' },
  });
  doc.pipe(fs.createWriteStream(outputPath));

  const layout = new Layout(doc, { margins: doc.page.margins });
  await renderNode(json, { doc, layout });

  doc.end();
  return outputPath;
}

module.exports = { makePdf };
