function invoiceHtml() {
  const rows = Array.from({ length: 15 }, (_, i) => {
    const name = `Product Item ${i + 1}`;
    const qty = Math.floor(Math.random() * 10) + 1;
    const price = (Math.random() * 100 + 5).toFixed(2);
    const total = (qty * parseFloat(price)).toFixed(2);
    return `<tr>
      <td style="padding: 8px; border-bottom: 1px solid #eee;">${name}</td>
      <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: center;">${qty}</td>
      <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;">$${price}</td>
      <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;">$${total}</td>
    </tr>`;
  }).join('\n');

  return `
    <html>
    <head>
      <style>
        body { font-family: Helvetica, Arial, sans-serif; color: #333; margin: 0; padding: 40px; }
        .header { display: flex; justify-content: space-between; margin-bottom: 40px; }
        .company { font-size: 24px; font-weight: bold; color: #2c3e50; }
        .invoice-info { text-align: right; font-size: 12px; color: #777; }
        .addresses { display: flex; justify-content: space-between; margin-bottom: 30px; }
        .address { font-size: 12px; line-height: 1.6; }
        .address strong { display: block; font-size: 14px; margin-bottom: 4px; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
        thead th { background-color: #2c3e50; color: white; padding: 10px 8px; text-align: left; font-size: 12px; }
        thead th:nth-child(2), thead th:nth-child(3), thead th:nth-child(4) { text-align: right; }
        thead th:nth-child(2) { text-align: center; }
        tbody td { font-size: 12px; }
        .totals { display: flex; justify-content: flex-end; }
        .totals-box { width: 250px; }
        .totals-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 13px; }
        .totals-row.total { border-top: 2px solid #2c3e50; font-weight: bold; font-size: 16px; padding-top: 10px; }
        .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee; font-size: 11px; color: #999; text-align: center; }
        .badge { display: inline-block; background: #27ae60; color: white; padding: 2px 8px; border-radius: 4px; font-size: 11px; }
      </style>
    </head>
    <body>
      <div class="header">
        <div>
          <div class="company">ACME Corp</div>
          <div style="font-size: 12px; color: #777;">Premium Solutions Provider</div>
        </div>
        <div class="invoice-info">
          <div style="font-size: 20px; font-weight: bold;">INVOICE</div>
          <div>#INV-2024-0042</div>
          <div>Date: 2024-03-15</div>
          <div>Due: 2024-04-15</div>
          <div><span class="badge">UNPAID</span></div>
        </div>
      </div>

      <div class="addresses">
        <div class="address">
          <strong>Bill To:</strong>
          John Smith<br/>
          Smith Industries LLC<br/>
          123 Business Avenue<br/>
          Suite 456<br/>
          New York, NY 10001
        </div>
        <div class="address" style="text-align: right;">
          <strong>Ship To:</strong>
          Warehouse District<br/>
          789 Industrial Blvd<br/>
          Building C, Dock 12<br/>
          Newark, NJ 07102
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Description</th>
            <th>Qty</th>
            <th>Unit Price</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>

      <div class="totals">
        <div class="totals-box">
          <div class="totals-row"><span>Subtotal</span><span>$1,247.50</span></div>
          <div class="totals-row"><span>Tax (8.5%)</span><span>$106.04</span></div>
          <div class="totals-row"><span>Shipping</span><span>$15.00</span></div>
          <div class="totals-row total"><span>Total</span><span>$1,368.54</span></div>
        </div>
      </div>

      <div class="footer">
        <p>Thank you for your business! Payment is due within 30 days.</p>
        <p>ACME Corp | 555 Main Street, San Francisco, CA 94105 | billing@acme.example.com</p>
      </div>
    </body>
    </html>
  `;
}

function simpleHtml() {
  return `<html><body><h1>Hello World</h1><p>This is a simple PDF.</p></body></html>`;
}

function reportHtml() {
  const sections = Array.from({ length: 8 }, (_, i) => {
    const paragraphs = Array.from({ length: 3 }, (_, j) =>
      `<p>Section ${i + 1}, paragraph ${j + 1}: Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.</p>`
    ).join('\n');
    return `<h2>Section ${i + 1}: Analysis</h2>\n${paragraphs}`;
  }).join('\n');

  return `
    <html><head><style>
      body { font-family: Helvetica, sans-serif; padding: 40px; color: #333; }
      h1 { color: #2c3e50; border-bottom: 2px solid #2c3e50; padding-bottom: 10px; }
      h2 { color: #34495e; margin-top: 20px; }
      p { line-height: 1.6; margin-bottom: 10px; }
    </style></head>
    <body>
      <h1>Quarterly Report Q4 2024</h1>
      ${sections}
    </body></html>
  `;
}

function receiptHtml() {
  const items = Array.from({ length: 5 }, (_, i) => {
    const price = (Math.random() * 20 + 2).toFixed(2);
    return `<tr>
      <td style="padding: 4px 0; border-bottom: 1px solid #eee;">Item ${i + 1}</td>
      <td style="padding: 4px 0; border-bottom: 1px solid #eee; text-align: right;">$${price}</td>
    </tr>`;
  }).join('\n');

  return `
    <html><head><style>
      body { font-family: monospace; padding: 20px; max-width: 300px; margin: 0 auto; }
      h2 { text-align: center; margin-bottom: 5px; }
      .info { text-align: center; font-size: 10px; color: #666; margin-bottom: 15px; }
      table { width: 100%; border-collapse: collapse; }
      .total { font-weight: bold; border-top: 2px solid #000; }
      .footer { text-align: center; margin-top: 20px; font-size: 10px; color: #999; }
    </style></head>
    <body>
      <h2>COFFEE SHOP</h2>
      <div class="info">123 Main St | (555) 123-4567</div>
      <table>
        ${items}
        <tr class="total">
          <td style="padding-top: 8px;">Total</td>
          <td style="padding-top: 8px; text-align: right;">$42.50</td>
        </tr>
      </table>
      <div class="footer">Thank you for your visit!</div>
    </body></html>
  `;
}

function styledHtml() {
  return `
    <html><head><style>
      body { font-family: Helvetica, sans-serif; padding: 30px; }
      .card { border: 1px solid #ddd; border-radius: 8px; padding: 20px; margin-bottom: 15px; background: #fafafa; }
      .card h3 { margin-top: 0; color: #2c3e50; }
      .card p { color: #555; line-height: 1.5; }
      .badge { display: inline-block; background: #3498db; color: white; padding: 2px 8px; border-radius: 4px; font-size: 11px; }
      .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
      .flex-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
      blockquote { border-left: 3px solid #3498db; padding: 10px 15px; background: #f0f8ff; margin: 15px 0; }
    </style></head>
    <body>
      <h1>Feature Overview</h1>
      <div class="flex-row">
        <span>Version 2.0</span>
        <span class="badge">NEW</span>
      </div>
      <div class="grid">
        <div class="card">
          <h3>Layout</h3>
          <p>Supports flexbox and CSS grid with gap, alignment, and wrapping.</p>
        </div>
        <div class="card">
          <h3>Typography</h3>
          <p>Full font support with bold, italic, and custom font families.</p>
        </div>
        <div class="card">
          <h3>Tables</h3>
          <p>Styled tables with colspan, borders, and background colors.</p>
        </div>
        <div class="card">
          <h3>Images</h3>
          <p>PNG, JPEG, SVG support with data URIs and remote loading.</p>
        </div>
      </div>
      <blockquote>
        <strong>Note:</strong> This engine is designed for speed, not pixel-perfect Chrome compatibility.
      </blockquote>
      <h2>Lists</h2>
      <ul>
        <li>Page breaks with break-before and break-inside: avoid</li>
        <li>Internal PDF links with anchor destinations</li>
        <li>CSS variables with var() and fallbacks</li>
      </ul>
    </body></html>
  `;
}

function largeTableHtml() {
  const rows = Array.from({ length: 50 }, (_, i) => {
    const cols = Array.from({ length: 6 }, (_, j) =>
      `<td style="padding: 6px; border-bottom: 1px solid #eee; font-size: 11px;">${
        j === 0 ? `Row ${i + 1}` : (Math.random() * 1000).toFixed(2)
      }</td>`
    ).join('');
    return `<tr>${cols}</tr>`;
  }).join('\n');

  const headers = ['ID', 'Value A', 'Value B', 'Value C', 'Value D', 'Total'].map(h =>
    `<th style="padding: 8px; background: #34495e; color: white; font-size: 11px; text-align: left;">${h}</th>`
  ).join('');

  return `
    <html><head><style>
      body { font-family: Helvetica, sans-serif; padding: 30px; }
      table { width: 100%; border-collapse: collapse; }
      h1 { font-size: 18px; color: #2c3e50; }
    </style></head>
    <body>
      <h1>Data Export — 50 Rows</h1>
      <table>
        <thead><tr>${headers}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </body></html>
  `;
}

module.exports = {
  simple: { name: 'Simple (h1 + p)', html: simpleHtml },
  invoice: { name: 'Invoice (flex + table + styled)', html: invoiceHtml },
  report: { name: 'Report (8 sections, text-heavy)', html: reportHtml },
  receipt: { name: 'Receipt (small table)', html: receiptHtml },
  styled: { name: 'Styled (grid + cards + blockquote)', html: styledHtml },
  largeTable: { name: 'Large table (50 rows × 6 cols)', html: largeTableHtml },
};
