import { checkPassword, gateConfigured, isAuthed, makeToken, sessionCookie, sha256Hex } from './auth.mjs';
import { dataKeyConfigured, dataKeyProblem } from './crypto.mjs';
import { createRepo } from './store.mjs';
import { COLLECTIONS, DEFAULT_SETTINGS, ValidationError, sanitize, sanitizeSettings } from './schema.mjs';

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const ID_RE = /^[\w-]{1,64}$/;

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
const fail = (status, error) => json({ error }, status);

export function createHandler({ env, blobs }) {
  const repo = createRepo(env, blobs);

  const audit = (action, detail = '') =>
    repo.write(`audit/${new Date().toISOString()}-${crypto.randomUUID().slice(0, 8)}`, { at: new Date().toISOString(), action, detail: String(detail).slice(0, 200) });

  async function login(req, ctx) {
    const ipHash = await sha256Hex(ctx?.ip || req.headers.get('x-nf-client-connection-ip') || 'unknown');
    const key = `auth/${ipHash}`;
    const state = (await repo.read(key)) || { count: 0, since: 0 };
    const now = Date.now();
    if (state.count >= MAX_ATTEMPTS && now - state.since < LOCKOUT_MS) {
      return fail(429, 'Too many incorrect attempts. Please wait 15 minutes and try again.');
    }
    const body = await req.json().catch(() => ({}));
    if (!(await checkPassword(env, body.password))) {
      const fresh = state.count >= MAX_ATTEMPTS && now - state.since >= LOCKOUT_MS;
      await repo.write(key, { count: fresh ? 1 : state.count + 1, since: fresh || !state.count ? now : state.since });
      await audit('login-failed');
      return fail(401, 'That password is not correct.');
    }
    await repo.remove(key);
    await audit('login');
    const secure = new URL(req.url).protocol === 'https:';
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie(env, await makeToken(env), secure) });
  }

  return async function handle(req, ctx) {
    if (!gateConfigured(env) || !dataKeyConfigured(env)) {
      const problems = [];
      if (!env.APP_PASSWORD || env.APP_PASSWORD.length < 8) problems.push('APP_PASSWORD (missing, or shorter than 8 characters)');
      if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) problems.push('SESSION_SECRET (missing, or shorter than 32 characters)');
      if (!dataKeyConfigured(env)) problems.push(dataKeyProblem(env));
      return fail(503, `The application is not configured. Check these variables in Netlify, then redeploy: ${problems.join('; ')}.`);
    }
    const url = new URL(req.url);
    const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
    const [resource, id] = parts;
    const method = req.method;

    try {
      if (method !== 'GET' && method !== 'HEAD') {
        // CSRF defence in depth on top of the SameSite=Strict cookie.
        const origin = req.headers.get('origin');
        if (origin && new URL(origin).host !== url.host) return fail(403, 'Cross-origin request blocked');
        if (req.headers.get('x-requested-with') !== 'aimsir') return fail(403, 'Missing request header');
      }

      if (resource === 'login' && method === 'POST') return await login(req, ctx);
      if (resource === 'logout' && method === 'POST') {
        return json({ ok: true }, 200, { 'set-cookie': sessionCookie(env, '', new URL(req.url).protocol === 'https:') });
      }
      if (!(await isAuthed(env, req))) return fail(401, 'Please sign in.');
      if (resource === 'session') return json({ ok: true });

      if (resource === 'settings') {
        if (method === 'GET') return json((await repo.read('settings/main')) || DEFAULT_SETTINGS);
        if (method === 'PUT') {
          const s = sanitizeSettings(await req.json().catch(() => null));
          await repo.write('settings/main', s);
          await audit('settings-updated');
          return json(s);
        }
      }

      if (resource === 'audit') {
        if (method === 'GET') {
          const rows = (await repo.list('audit/')).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 100);
          return json(rows);
        }
        if (method === 'POST') {
          const b = await req.json().catch(() => ({}));
          await audit(String(b.action || 'event').slice(0, 40), b.detail);
          return json({ ok: true });
        }
      }

      if (resource === 'backup' && method === 'GET') {
        await audit('backup-downloaded');
        const data = { exportedAt: new Date().toISOString(), settings: (await repo.read('settings/main')) || DEFAULT_SETTINGS };
        for (const c of COLLECTIONS) data[c] = await repo.list(`${c}/`);
        return json(data);
      }

      if (COLLECTIONS.includes(resource)) {
        if (!id && method === 'GET') return json(await repo.list(`${resource}/`));
        if (!id && method === 'POST') {
          const now = new Date().toISOString();
          const rec = { ...sanitize(resource, await req.json().catch(() => null)), id: crypto.randomUUID(), createdAt: now, updatedAt: now };
          await repo.write(`${resource}/${rec.id}`, rec);
          await audit('created', `${resource}/${rec.id}`);
          return json(rec, 201);
        }
        if (id && !ID_RE.test(id)) return fail(400, 'Invalid id');
        const key = `${resource}/${id}`;
        if (id && method === 'GET') {
          const rec = await repo.read(key);
          return rec ? json(rec) : fail(404, 'Not found');
        }
        if (id && method === 'PUT') {
          const existing = await repo.read(key);
          if (!existing) return fail(404, 'Not found');
          const body = await req.json().catch(() => null);
          if (body?.updatedAt !== existing.updatedAt) return fail(409, 'This record was changed by someone else. Reload it and try again.');
          const rec = { ...sanitize(resource, body), id, createdAt: existing.createdAt, updatedAt: new Date().toISOString() };
          await repo.write(key, rec);
          await audit('updated', key);
          return json(rec);
        }
        if (id && method === 'DELETE') {
          if (!(await repo.read(key))) return fail(404, 'Not found');
          await repo.remove(key);
          if (resource === 'mentors') {
            for (const p of await repo.list('participants/')) {
              if (p.mentorId === id) await repo.write(`participants/${p.id}`, { ...p, mentorId: '', updatedAt: new Date().toISOString() });
            }
          }
          await audit('deleted', key);
          return json({ ok: true });
        }
      }
      return fail(404, 'Not found');
    } catch (e) {
      if (e instanceof ValidationError) return fail(400, e.message);
      console.error('API error:', e?.message);
      return fail(500, 'Something went wrong. Please try again.');
    }
  };
}
