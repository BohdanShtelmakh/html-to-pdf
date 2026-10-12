const http = require('http');
const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');

function createServer() {
  let busy = false;
  const files = new Set(['index.html', 'app.js', 'style.css', 'samples.js']);
  return http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const fail = (code, message) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: message }));
    };
    if (![`127.0.0.1:${req.socket.localPort}`, `localhost:${req.socket.localPort}`].includes(req.headers.host)) {
      return fail(403, 'Only loopback hosts are allowed');
    }
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (req.method === 'GET' && pathname === '/docs/hero.png') {
      res.setHeader('Content-Type', 'image/png');
      res.end(fs.readFileSync(path.join(__dirname, '../docs/hero.png')));
      return;
    }
    if (req.method === 'GET' && (pathname === '/' || files.has(pathname.slice(1)))) {
      const filename = pathname === '/' ? 'index.html' : pathname.slice(1);
      res.setHeader('Content-Type', filename.endsWith('.html') ? 'text/html' : filename.endsWith('.css') ? 'text/css' : 'text/javascript');
      res.end(fs.readFileSync(path.join(__dirname, filename)));
      return;
    }
    if (pathname !== '/render') return fail(404, 'Not found');
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return fail(405, 'POST required'); }
    const origin = req.headers.origin;
    if (origin && origin !== `http://${req.headers.host}`) return fail(403, 'Cross-origin requests are not allowed');
    if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return fail(415, 'JSON required');
    if (busy) return fail(429, 'A render is already running. Try again shortly.');
    busy = true;
    let worker;
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 128 * 1024) { fail(413, 'HTML exceeds the 128 KB request limit'); return; }
        chunks.push(chunk);
      }
      let input;
      try { input = JSON.parse(Buffer.concat(chunks).toString()); } catch { return fail(400, 'Invalid JSON'); }
      if (!input || typeof input.html !== 'string' || !input.html.trim()) return fail(422, 'Provide non-empty HTML');
      const result = await new Promise((resolve, reject) => {
        worker = fork(path.join(__dirname, 'worker.cjs'), [], {
          execArgv: ['--max-old-space-size=128'], stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        });
        const timer = setTimeout(() => { worker.kill('SIGKILL'); reject(Object.assign(new Error('Render exceeded 10 seconds'), { status: 504 })); }, 10000);
        const finish = (callback, value) => { clearTimeout(timer); callback(value); };
        worker.once('message', message => finish(resolve, message));
        worker.once('error', error => finish(reject, error));
        worker.once('exit', () => finish(reject, new Error('Renderer exited without a result')));
        worker.send({ html: input.html });
      });
      if (result.error) return fail(result.status || 500, result.error);
      const pdf = Buffer.from(result.pdf, 'base64');
      if (pdf.length > 5 * 1024 * 1024) return fail(413, 'PDF exceeds 5 MB');
      res.writeHead(200, {
        'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="playground.pdf"',
        'X-Render-Ms': String(result.ms), 'X-Render-Rss-Mb': String(result.rssMb),
      });
      res.end(pdf);
    } catch (error) {
      if (!res.writableEnded) fail(error.status || 500, error.status ? error.message : 'PDF generation failed');
    } finally {
      if (worker) worker.kill();
      busy = false;
    }
  });
}
if (require.main === module) {
  const server = createServer();
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  const host = process.env.PLAYGROUND_CONTAINER === '1' ? '0.0.0.0' : '127.0.0.1';
  server.listen(Number(process.env.PORT || 4173), host, () => console.log(`Playground: http://127.0.0.1:${server.address().port}`));
}
module.exports = { createServer };
