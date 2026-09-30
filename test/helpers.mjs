import { createHandler } from '../netlify/lib/api.mjs';

export const ENV = {
  APP_PASSWORD: 'correct horse battery',
  SESSION_SECRET: 'x'.repeat(40),
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
};

export function memoryBlobs() {
  const m = new Map();
  return {
    m,
    async get(k) { return m.has(k) ? JSON.parse(m.get(k)) : null; },
    async setJSON(k, v) { m.set(k, JSON.stringify(v)); },
    async delete(k) { m.delete(k); },
    async list({ prefix = '' } = {}) { return { blobs: [...m.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }; },
  };
}

export function makeClient(env = ENV) {
  const blobs = memoryBlobs();
  const handle = createHandler({ env, blobs });
  let cookie = '';
  const call = async (method, path, body, extra = {}) => {
    const headers = { 'x-requested-with': 'aimsir', 'content-type': 'application/json', ...extra };
    if (cookie) headers.cookie = cookie;
    const res = await handle(new Request('https://x.test' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), { ip: '1.2.3.4' });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return { status: res.status, body: await res.json() };
  };
  return { call, blobs, login: () => call('POST', '/api/login', { password: env.APP_PASSWORD }), clearCookie: () => { cookie = ''; } };
}
