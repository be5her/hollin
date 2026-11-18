/**
 * `node course/scripts/serve.mjs [port]`: the course on http://localhost:5050 for looking at a change,
 * with nothing to install. It serves `public/` as Firebase Hosting does (every unknown path gets
 * index.html) but has no Firebase behind it: `/__/firebase/init.json` answers 404, so the page offers
 * no sign-in and keeps progress in the browser. To try signing in locally, use
 * `npx firebase-tools emulators:start --only hosting` instead.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const port = Number(process.argv[2] ?? process.env.PORT ?? 5050);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.ico': 'image/x-icon' };

createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (url.pathname.startsWith('/__/')) {
    response.writeHead(404, { 'content-type': 'text/plain' }).end('No Firebase behind this server.');
    return;
  }
  let file = path.join(root, path.normalize(decodeURIComponent(url.pathname)));
  if (!file.startsWith(root)) {
    response.writeHead(403).end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = path.join(root, 'index.html');
  response.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  createReadStream(file).pipe(response);
}).listen(port, '127.0.0.1', () => console.log(`The course is on http://localhost:${port}`));
