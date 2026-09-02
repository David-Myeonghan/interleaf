// Serves test/fixture-site.
//
// python -m http.server handles one request at a time, so several browser tabs
// deadlock each other and a page sits in "loading" forever - which looked like a
// hung capture. This serves concurrently.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../test/fixture-site/', import.meta.url));
const PORT = Number(process.env.FIXTURE_PORT ?? 8777);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

http.createServer((req, res) => {
  const requested = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const file = path.join(ROOT, requested === '/' ? 'index.html' : requested);
  // Never serve outside the fixture directory.
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  fs.readFile(file, (err, body) => {
    if (err) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    }).end(body);
  });
}).listen(PORT, '127.0.0.1', () => console.log(`fixture server on ${PORT}`));
