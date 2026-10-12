const { test } = require('node:test');
const assert = require('node:assert/strict');
const { stats, run } = require('./run');
test('statistics use sorted samples and nearest-rank p95', () => {
  const times = [9, 1, 5, 3, 7];
  assert.deepEqual(stats(times), { median: 5, p95: 9, min: 1, max: 9 });
  assert.deepEqual(times, [9, 1, 5, 3, 7]);
});
test('fresh worker returns a timed first PDF', async () => {
  const result = await run('lite', 'cold', '<h1>Benchmark</h1>');
  assert.equal(result.times.length, 1);
  assert.ok(result.times[0] > 0);
  assert.ok(result.processToPdfMs >= result.times[0]);
  assert.ok(result.bytes > 100);
});
test('worker failure is reported instead of a skipped benchmark', async () => {
  await assert.rejects(run('lite', 'cold', null), /benchmark failed/);
});
