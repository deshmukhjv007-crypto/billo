/* Test-only: serves app/ and a fake Firestore (test/fake-sync.js) over HTTP + SSE, so two
   real browsers can sync with each other.  node test/fake-sync-server.js [port] */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { FakeServer } = require('./fake-sync');

const PORT = Number(process.argv[2] || 8790);
const APP = path.join(__dirname, '..', 'app');
const server = FakeServer();
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.txt': 'text/plain' };

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/sub') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    const off = server.subscribe(u.searchParams.get('uid'), u.searchParams.get('trip'), msg => {
      const m = msg.error ? { error: { message: msg.error.message, code: msg.error.code } } : msg;
      res.write('data: ' + JSON.stringify(m) + '\n\n');
    });
    req.on('close', off);
    return;
  }
  if (u.pathname.startsWith('/api/')) {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      const m = u.pathname.slice(5);
      const b = body ? JSON.parse(body) : {};
      let out;
      try {
        const result = m === 'signIn' ? server.signIn() : server[m](b.uid, ...(b.args || []));
        out = { result: result === undefined ? null : result };
      } catch (e) { out = { error: { message: e.message, code: e.code || 'unknown' } }; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out));
    });
    return;
  }
  if (u.pathname === '/__state') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(server._trips)); return; }
  const file = path.join(APP, decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname));
  if (!file.startsWith(APP) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log('fake sync server on ' + PORT));
