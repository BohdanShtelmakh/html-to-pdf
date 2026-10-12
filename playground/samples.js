const base = `@page { size: A4; margin: 32px; } body { font-family: Helvetica; color: #20252b; font-size: 14px; } h1 { color: #176b54; } table { width: 100%; border-collapse: collapse; } th { background: #176b54; color: white; } th, td { padding: 10px; border: 1px solid #d3dce0; }`;
const wrap = (css, body) => `<!doctype html>\n<html><head><style>\n${base}\n${css}\n</style></head><body>\n${body}\n</body></html>`;
export const samples = {
  Invoice: wrap('.header { display: flex; justify-content: space-between; margin-bottom: 24px; } .total { text-align: right; margin-top: 20px; }', `<div class="header"><div><h1>Northwind Studio</h1><p>Invoice INV-0042</p></div><p>October 12, 2026</p></div>
<p><strong>Bill to:</strong> Acme Corporation<br>123 Market Street</p>
<table><thead><tr><th>Description</th><th>Qty</th><th>Amount</th></tr></thead><tbody>
<tr><td>Design consultation</td><td>2</td><td>$300.00</td></tr>
<tr><td>Implementation and review</td><td>1</td><td>$450.00</td></tr>
</tbody></table><p class="total"><strong>Total: $750.00</strong></p>`),
  Report: wrap('.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; } .metric { padding: 18px; background: #edf5f2; border: 1px solid #b8d4cb; }', `<h1>Quarterly Report</h1><p>Q4 / Operations</p><div class="grid"><div class="metric"><h2>Revenue</h2><p>$2.48M</p></div><div class="metric"><h2>Retention</h2><p>94%</p></div></div><h2>Summary</h2><p>Customer renewals remained strong. The next quarter focuses on delivery capacity and operational efficiency.</p>`),
  'Long table': wrap('', `<h1>Account Register</h1><table><thead><tr><th>#</th><th>Account</th><th>Status</th></tr></thead><tbody>${Array.from({ length: 60 }, (_, i) => `<tr><td>${i + 1}</td><td>Customer ${i + 1}</td><td>${i % 3 ? 'Active' : 'Pending'}</td></tr>`).join('\n')}</tbody></table>`),
};
