// Server-side client for the Supabase Auth admin API. It needs a secret key
// (SUPABASE_SECRET_KEY, or the legacy SUPABASE_SERVICE_ROLE_KEY) that lives only
// in Netlify's environment: it is never sent to the browser or written to storage.
export class AdminError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export const secretKey = (env) => env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '';
export const adminConfigured = (env) => /^https:\/\/[^/\s]+$/.test(env.SUPABASE_URL || '') && !!secretKey(env);
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createSupabaseAdmin(env, fetchImpl = fetch) {
  const key = secretKey(env);
  const base = `${env.SUPABASE_URL}/auth/v1/admin`;

  async function call(method, path, body) {
    const headers = { apikey: key, 'content-type': 'application/json' };
    if (key.startsWith('eyJ')) headers.authorization = `Bearer ${key}`; // legacy JWT-style keys only
    let res;
    try {
      res = await fetchImpl(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(8000) });
    } catch {
      throw new AdminError(502, 'Could not reach Supabase. Please try again.');
    }
    const data = await res.json().catch(() => ({}));
    if (res.ok) return data;
    if (res.status === 401 || res.status === 403) throw new AdminError(502, 'Supabase rejected the admin key. Check SUPABASE_SECRET_KEY in Netlify.');
    if (res.status >= 500) throw new AdminError(502, 'Supabase is having trouble. Please try again.');
    throw new AdminError(res.status === 404 ? 404 : 400, String(data.msg || data.message || data.error_description || 'Supabase could not complete that.').slice(0, 200));
  }

  const checkId = (id) => { if (!UUID_RE.test(id || '')) throw new AdminError(400, 'Invalid user id'); return id; };

  return {
    async listUsers(perPage = 200, maxPages = 5) {
      const out = [];
      for (let page = 1; page <= maxPages; page++) {
        const d = await call('GET', `/users?page=${page}&per_page=${perPage}`);
        const batch = Array.isArray(d) ? d : d.users || [];
        out.push(...batch);
        if (batch.length < perPage) break;
      }
      return out;
    },
    ping: () => call('GET', '/users?page=1&per_page=1'),
    getUser: (id) => call('GET', `/users/${checkId(id)}`),
    createUser: (email, password) => call('POST', '/users', { email, password, email_confirm: true }),
    setPassword: (id, password) => call('PUT', `/users/${checkId(id)}`, { password }),
    setBanned: (id, banned) => call('PUT', `/users/${checkId(id)}`, { ban_duration: banned ? '876000h' : 'none' }),
    deleteUser: (id) => call('DELETE', `/users/${checkId(id)}`),
  };
}
