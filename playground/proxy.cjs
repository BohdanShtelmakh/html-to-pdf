const http = require('http');
// Fixed upstream only: the gateway cannot be used as a general-purpose proxy.
const server = http.createServer((req, res) => {
  const upstream = http.request({ hostname: 'playground', port: 4180, path: req.url, method: req.method, headers: req.headers, timeout: 15000 }, response => {
    res.writeHead(response.statusCode, response.headers);
    response.pipe(res);
  });
  upstream.on('timeout', () => upstream.destroy());
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Renderer unavailable' }));
  });
  req.on('aborted', () => upstream.destroy());
  req.pipe(upstream);
});
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.listen(4180, '0.0.0.0');
