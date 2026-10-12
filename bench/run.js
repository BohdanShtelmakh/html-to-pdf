const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const templates = require('./templates');
const ITERATIONS = 15, WARMUP = 2, COLD_ITERATIONS = 7;
function stats(times) {
  const sorted = [...times].sort((a, b) => a - b);
  return { median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.ceil(sorted.length * 0.95) - 1], min: sorted[0], max: sorted[sorted.length - 1] };
}
function run(engine, mode, html) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const child = spawn(process.execPath, [path.join(__dirname, 'worker.js'), engine, mode], { stdio: ['pipe', 'pipe', 'inherit'] });
    let output = '', result;
    child.stdout.on('data', chunk => {
      output += chunk;
      if (!result && output.includes('\n')) {
        try { result = { ...JSON.parse(output.slice(0, output.indexOf('\n'))), processToPdfMs: performance.now() - start }; }
        catch (error) { reject(error); }
      }
    });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`${engine} benchmark timed out`)); }, 120000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); if (code !== 0 || !result) reject(new Error(`${engine} benchmark failed (exit ${code})`)); else resolve(result); });
    child.stdin.end(JSON.stringify({ html, iterations: ITERATIONS, warmup: WARMUP }));
  });
}
async function main() {
  let seed = 12345, cases;
  const random = Math.random;
  try {
    Math.random = () => ((seed = seed * 16807 % 2147483647) - 1) / 2147483646;
    cases = Object.entries(templates).map(([key, template]) => ({ key, name: template.name, html: template.html() }));
  } finally { Math.random = random; }
  const results = [];
  for (let i = 0; i < cases.length; i++) {
    const { key, name, html } = cases[i];
    const row = { key, name };
    for (const engine of i % 2 ? ['puppeteer', 'lite'] : ['lite', 'puppeteer']) {
      const result = await run(engine, 'warm', html);
      row[engine] = { ...stats(result.times), times: result.times, bytes: result.bytes };
    }
    results.push(row);
    console.log(`${name}: lite ${row.lite.median.toFixed(1)} ms / Puppeteer ${row.puppeteer.median.toFixed(1)} ms`);
  }
  const cold = { lite: [], puppeteer: [] }, processCold = { lite: [], puppeteer: [] };
  for (let i = 0; i < COLD_ITERATIONS; i++) {
    for (const engine of i % 2 ? ['puppeteer', 'lite'] : ['lite', 'puppeteer']) {
      const result = await run(engine, 'cold', cases.find(c => c.key === 'invoice').html);
      cold[engine].push(result.times[0]);
      processCold[engine].push(result.processToPdfMs);
    }
  }
  const report = {
    environment: { date: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0].model, package: require('../package.json').version, puppeteer: require('puppeteer/package.json').version },
    methodology: { iterations: ITERATIONS, warmup: WARMUP, coldIterations: COLD_ITERATIONS, seed: 12345, page: 'A4, 32pt margins, backgrounds enabled', warm: 'Separate worker per template/engine. Lite default font resolution. Puppeteer reuses browser, creates/closes page per iteration. Through PDF buffer and page cleanup.', cold: 'Fresh Node process each iteration, before require through first invoice PDF buffer. Browser startup included, shutdown excluded. OS filesystem/font caches not cleared.', processCold: 'Spawn through first result, including Node startup and IPC, excluding shutdown.', fidelity: 'Same HTML but not pixel-identical output; font embedding/layout affect size and speed.' },
    results,
    cold: Object.fromEntries(Object.entries(cold).map(([engine, times]) => [engine, { ...stats(times), times }])),
    processCold: Object.fromEntries(Object.entries(processCold).map(([engine, times]) => [engine, { ...stats(times), times }])),
  };
  fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('Cold require-to-PDF medians:', report.cold);
  console.log('Saved bench/results.json');
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { stats, run };
