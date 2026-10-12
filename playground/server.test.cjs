const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('./server.cjs');
let server;
let url;
before(async () => {
  server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise(resolve => server.close(resolve)));
function render(html, headers = {}) {
  return fetch(`${url}/render`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ html }) });
}
test('renders PDF through the actual package', async () => {
  const response = await render('<h1>Invoice</h1><p><strong>Total:</strong> $100</p>');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/pdf');
  assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
  assert.ok(Number(response.headers.get('x-render-rss-mb')) > 0);
});
test('rejects invalid input', async () => {
  assert.equal((await render('')).status, 422);
  assert.equal((await render('x'.repeat(130 * 1024))).status, 413);
});
test('blocks scripts and local/remote images', async () => {
  for (const html of ['<script>alert(1)</script>', '<img src="/etc/passwd">', '<img src="http://127.0.0.1/private">', '<svg></svg>']) {
    assert.equal((await render(html)).status, 422);
  }
});
test('rejects requests from another origin', async () => {
  assert.equal((await render('<p>Hello</p>', { Origin: 'https://example.com' })).status, 403);
  const hostStatus = await new Promise((resolve, reject) => {
    const request = require('http').get(url, { headers: { Host: 'example.com' } }, response => {
      response.resume();
      resolve(response.statusCode);
    });
    request.on('error', reject);
  });
  assert.equal(hostStatus, 403);
});
test('serves editor and image but not arbitrary files', async () => {
  assert.equal((await fetch(url)).status, 200);
  assert.equal((await fetch(`${url}/docs/hero.png`)).status, 200);
  assert.equal((await fetch(`${url}/package.json`)).status, 404);
});
