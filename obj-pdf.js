const fs = require('fs');
const PDFDocument = require('pdfkit');
const { Layout } = require('./pdf/layout');
const { renderNode } = require('./pdf/render-node');

async function makePdf(json, outputPath = 'output.pdf', options = {}) {

  
  const doc = new PDFDocument({
    autoFirstPage: true,
    size: 'A4',
    margins: options.margins || { top: '8mm', bottom: '8mm', left: '8mm', right: '8mm' },
  });
  doc.pipe(fs.createWriteStream(outputPath));

  const layout = new Layout(doc, { margins: doc.page.margins });
  await renderNode(json, { doc, layout });

  doc.end();
  return outputPath;
}

module.exports = { makePdf };
