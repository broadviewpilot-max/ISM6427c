// Local development server that mirrors production: same gate, same API code,
// records stored (still encrypted) as files in ./.data. Run with: npm run dev
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHandler } from '../netlify/lib/api.mjs';
import { gateConfigured, isAuthed } from '../netlify/lib/auth.mjs';

const env = {
  APP_PASSWORD: process.env.APP_PASSWORD || 'local-dev-password',
  SESSION_SECRET: process.env.SESSION_SECRET || 'local-dev-secret-local-dev-secret-0000',
  DATA_ENCRYPTION_KEY: process.env.DATA_ENCRYPTION_KEY || Buffer.alloc(32, 1).toString('base64'),
};
const root = path.resolve('public');
const dataDir = path.resolve('.data');
await fs.mkdir(dataDir, { recursive: true });
const file = (k) => path.join(dataDir, encodeURIComponent(k) + '.json');
const blobs = {
  async get(k) { try { return JSON.parse(await fs.readFile(file(k), 'utf8')); } catch { return null; } },
  async setJSON(k, v) { await fs.writeFile(file(k), JSON.stringify(v)); },
  async delete(k) { await fs.rm(file(k), { force: true }); },
  async list({ prefix = '' } = {}) {
    const names = (await fs.readdir(dataDir)).map((n) => decodeURIComponent(n.replace(/\.json$/, '')));
    return { blobs: names.filter((k) => k.startsWith(prefix)).map((key) => ({ key })) };
  },
};
const handle = createHandler({ env, blobs });
const PUBLIC = new Set(['/login.html', '/login.js', '/theme.js', '/styles.css', '/favicon.svg', '/robots.txt']);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.txt': 'text/plain' };

http.createServer(async (nreq, nres) => {
  const chunks = [];
  for await (const c of nreq) chunks.push(c);
  const url = new URL(nreq.url, `http://${nreq.headers.host}`);
  const req = new Request(url, { method: nreq.method, headers: nreq.headers, body: ['GET', 'HEAD'].includes(nreq.method) ? undefined : Buffer.concat(chunks) });
  const send = async (res) => {
    const headers = {};
    res.headers.forEach((v, k) => (headers[k] = v));
    const sc = res.headers.getSetCookie?.();
    if (sc?.length) headers['set-cookie'] = sc;
    nres.writeHead(res.status, headers);
    nres.end(Buffer.from(await res.arrayBuffer()));
  };
  if (url.pathname.startsWith('/api/')) return send(await handle(req, { ip: '127.0.0.1' }));
  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  if (!PUBLIC.has(p) && !(gateConfigured(env) && (await isAuthed(env, req)))) return send(new Response(null, { status: 302, headers: { location: '/login.html' } }));
  try {
    const abs = path.join(root, path.normalize(p));
    if (!abs.startsWith(root)) throw new Error('outside root');
    return send(new Response(await fs.readFile(abs), { headers: { 'content-type': TYPES[path.extname(abs)] || 'application/octet-stream', 'cache-control': 'no-store' } }));
  } catch {
    return send(new Response('Not found', { status: 404 }));
  }
}).listen(process.env.PORT || 8888, () => console.log(`Aimsir dev server on http://localhost:${process.env.PORT || 8888}`));
