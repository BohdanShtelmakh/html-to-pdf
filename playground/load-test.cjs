const assert = require('node:assert/strict');
const fs = require('fs');
async function main() {
  const url = process.env.PLAYGROUND_URL || 'http://127.0.0.1:4173';
  const parsed = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(parsed.hostname)) throw new Error('This test only targets loopback');
  const { samples } = await import('data:text/javascript;base64,' + fs.readFileSync(require.resolve('./samples.js')).toString('base64'));
  async function request(html) {
    const start = performance.now();
    const response = await fetch(`${url}/render`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ html }), signal: AbortSignal.timeout(20000) });
    const buffer = Buffer.from(await response.arrayBuffer());
    if (response.status === 200) assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
    return { status: response.status, elapsedMs: Math.round(performance.now() - start), rendererRssMb: Number(response.headers.get('x-render-rss-mb')) };
  }
  const results = [];
  for (let i = 0; i < 10; i++) {
    for (const [name, html] of Object.entries(samples)) {
      const result = await request(html);
      assert.equal(result.status, 200, `${name} failed`);
      results.push({ name, ...result });
    }
  }
  const burst = await Promise.all(Array.from({ length: 8 }, () => request(samples['Long table'])));
  assert.ok(burst.some(r => r.status === 200));
  assert.ok(burst.some(r => r.status === 429));
  assert.ok(burst.every(r => [200, 429].includes(r.status)));
  assert.equal((await request(samples.Invoice)).status, 200, 'Service must recover after burst');
  console.log(JSON.stringify({ sequentialRequests: results.length, maxRendererRssMb: Math.max(...results.map(r => r.rendererRssMb)), maxElapsedMs: Math.max(...results.map(r => r.elapsedMs)), burst, results }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
