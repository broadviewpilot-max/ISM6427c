export const SECRET = 'sb_secret_TESTONLY_not_real';
export const PW = 'a-long-password-1';

// A stand-in for Supabase Auth, including its admin API.
export function fakeSupabase(seed = {}) {
  const users = new Map(); // id -> { id, email, password, banned }
  const byEmail = (e) => [...users.values()].find((u) => u.email === e);
  const add = (email, password = PW) => { const u = { id: crypto.randomUUID(), email, password, banned: false, created_at: '2026-01-01T00:00:00Z' }; users.set(u.id, u); return u; };
  for (const e of Object.keys(seed)) add(e, seed[e]);
  const res = (status, body) => new Response(JSON.stringify(body ?? {}), { status });
  const fn = async (url, init = {}) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) : {};
    const p = u.pathname;
    if (p === '/auth/v1/health') return res(200, { ok: true });
    if (p === '/auth/v1/token') {
      const user = byEmail(body.email);
      return user && user.password === body.password && !user.banned ? res(200, { user: { id: user.id, email: user.email } }) : res(400, { error: 'invalid_grant' });
    }
    if (!p.startsWith('/auth/v1/admin/')) return res(404);
    if (init.headers?.apikey !== SECRET) return res(401, { msg: 'bad key' });
    const m = p.match(/^\/auth\/v1\/admin\/users(?:\/([^/]+))?$/);
    if (!m) return res(404);
    const target = m[1] && users.get(m[1]);
    if (init.method === 'GET' && !m[1]) return res(200, { users: [...users.values()].map(({ password, ...rest }) => rest) });
    if (init.method === 'GET') return target ? res(200, { id: target.id, email: target.email }) : res(404, { msg: 'not found' });
    if (init.method === 'POST') {
      if (byEmail(body.email)) return res(422, { msg: 'A user with this email address has already been registered' });
      return res(200, { id: add(body.email, body.password).id, email: body.email });
    }
    if (!target) return res(404, { msg: 'not found' });
    if (init.method === 'PUT') { if (body.password) target.password = body.password; if (body.ban_duration) target.banned = body.ban_duration !== 'none'; return res(200, { id: target.id }); }
    if (init.method === 'DELETE') { users.delete(target.id); return res(200, {}); }
    return res(405);
  };
  fn.users = users; fn.add = add; fn.byEmail = byEmail;
  return fn;
}

