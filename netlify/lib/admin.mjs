// Administration API (/api/admin/*). Every route here is administrator-only; the
// caller (api.mjs) checks that before anything in this file runs.
import { emailLoginConfigured, gateConfigured, userKey } from './auth.mjs';
import { dataKeyConfigured } from './crypto.mjs';
import { COLLECTIONS, ValidationError, sanitizeNewUser, sanitizeUserUpdate, validatePassword } from './schema.mjs';
import { ROLES, adminEmails, effectiveRole, lockedAdmin } from './roles.mjs';
import { AdminError, UUID_RE, adminConfigured, createSupabaseAdmin } from './supabase-admin.mjs';

const NEEDS_KEY = 'User management needs the Supabase secret key. Add SUPABASE_SECRET_KEY in Netlify (see the README), then redeploy.';
const DAY = 24 * 3600 * 1000;

export function createAdmin({ env, repo, fetchImpl = fetch, audit, json, fail }) {
  const sb = adminConfigured(env) ? createSupabaseAdmin(env, fetchImpl) : null;
  const timed = async (fn) => {
    const t0 = Date.now();
    try { return { ms: Date.now() - t0, ...(await fn()) }; } catch (e) { return { ms: Date.now() - t0, status: 'fail', detail: String(e?.message || 'Failed').slice(0, 160) }; }
  };

  // ---- Users ---------------------------------------------------------------
  const rowFor = (profile, sbUser) => {
    const email = (profile?.email || sbUser?.email || '').toLowerCase();
    return {
      id: profile?.supabaseId || sbUser?.id,
      email,
      displayName: profile?.displayName || '',
      jobTitle: profile?.jobTitle || '',
      role: effectiveRole(env, { ...profile, email }),
      roleLocked: lockedAdmin(env, email),
      disabled: !!profile?.disabled,
      signedInBefore: !!profile?.lastLoginAt,
      lastLoginAt: profile?.lastLoginAt || sbUser?.last_sign_in_at || '',
      createdAt: profile?.createdAt || sbUser?.created_at || '',
      removedInSupabase: !!sb && !!profile && !sbUser,
    };
  };

  async function listUsers() {
    const profiles = (await repo.list('profiles/')).filter((p) => p.supabaseId);
    let sbUsers = null;
    let warning = '';
    if (sb) {
      try { sbUsers = await sb.listUsers(); } catch (e) { warning = `${e.message} Showing only people who have signed in.`; }
    }
    const byId = new Map(profiles.map((p) => [p.supabaseId, p]));
    const rows = sbUsers ? sbUsers.map((u) => rowFor(byId.get(u.id), u)) : profiles.map((p) => rowFor(p));
    if (sbUsers) {
      const seen = new Set(sbUsers.map((u) => u.id));
      for (const p of profiles) if (!seen.has(p.supabaseId)) rows.push(rowFor(p));
    }
    rows.sort((a, b) => a.email.localeCompare(b.email));
    return { users: rows, userManagement: !!sb, warning };
  }

  // The person being acted on: their stored profile, or (when the admin key is set) a
  // fresh one built from their Supabase account.
  async function target(id, me) {
    if (!UUID_RE.test(id || '')) throw new AdminError(400, 'Invalid user id');
    if (id === me.profile.supabaseId) throw new AdminError(400, 'You cannot change your own role or status. Ask another administrator.');
    const key = `profiles/${await userKey(id)}`;
    let profile = await repo.read(key);
    if (!profile) {
      if (!sb) throw new AdminError(404, 'That person has not signed in yet, so there is nothing to change.');
      const u = await sb.getUser(id);
      const now = new Date().toISOString();
      profile = { email: (u.email || '').toLowerCase(), supabaseId: id, role: 'user', displayName: '', jobTitle: '', phone: '', createdAt: now, updatedAt: now };
    }
    return { key, profile };
  }

  // ---- Health & overview -----------------------------------------------------
  async function services() {
    const storage = timed(async () => {
      const probe = { at: new Date().toISOString(), n: crypto.randomUUID() };
      await repo.write('health/ping', probe);
      const back = await repo.read('health/ping');
      await repo.remove('health/ping');
      return back?.n === probe.n ? { status: 'ok', detail: 'Wrote, read back and decrypted a test record' } : { status: 'fail', detail: 'Read-back did not match' };
    });
    const auth = emailLoginConfigured(env)
      ? timed(async () => {
          const res = await fetchImpl(`${env.SUPABASE_URL}/auth/v1/health`, { headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY }, signal: AbortSignal.timeout(6000) });
          return res.ok ? { status: 'ok', detail: 'Supabase Auth is reachable' } : { status: 'fail', detail: `Supabase Auth answered HTTP ${res.status}` };
        })
      : Promise.resolve({ status: 'off', ms: 0, detail: 'Email sign-in is not configured' });
    const admin = sb
      ? timed(async () => { await sb.ping(); return { status: 'ok', detail: 'The admin key works' }; })
      : Promise.resolve({ status: 'off', ms: 0, detail: 'No admin key set (user management is limited)' });
    const [s, a, m] = await Promise.all([storage, auth, admin]);
    return [
      { name: 'Database (Netlify Blobs, encrypted)', ...s },
      { name: 'Supabase Auth (email sign-in)', ...a },
      { name: 'Supabase admin key', ...m },
    ];
  }

  const configChecks = () => [
    { name: 'Board password (APP_PASSWORD, SESSION_SECRET)', ok: gateConfigured(env) },
    { name: 'Data encryption key (DATA_ENCRYPTION_KEY)', ok: dataKeyConfigured(env) },
    { name: 'Email sign-in (SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)', ok: emailLoginConfigured(env) },
    { name: 'User management (SUPABASE_SECRET_KEY)', ok: !!sb },
    { name: 'Administrators named in ADMIN_EMAILS', ok: adminEmails(env).length > 0, note: `${adminEmails(env).length} address(es)` },
    { name: 'Sign-in limited to ALLOWED_EMAILS', ok: String(env.ALLOWED_EMAILS || '').trim() !== '', note: 'Optional extra lock', optional: true },
  ];

  async function overview() {
    const [svc, profiles, audits, ...counts] = await Promise.all([
      services(),
      repo.list('profiles/'),
      repo.listRecent('audit/', 400),
      ...COLLECTIONS.map((c) => repo.count(`${c}/`)),
    ]);
    const since = Date.now() - DAY;
    const recent = audits.filter((r) => Date.parse(r.at) >= since);
    const n = (...actions) => recent.filter((r) => actions.includes(r.action)).length;
    const roles = Object.fromEntries(ROLES.map((r) => [r, 0]));
    let disabled = 0;
    for (const p of profiles) { roles[effectiveRole(env, p)]++; if (p.disabled) disabled++; }
    const ref = /^https:\/\/([a-z0-9]+)\.supabase\.co$/.exec(env.SUPABASE_URL || '')?.[1];
    return {
      services: svc,
      config: configChecks(),
      records: Object.fromEntries(COLLECTIONS.map((c, i) => [c, counts[i]])),
      people: { signedIn: profiles.length, disabled, roles },
      activity: { signIns24h: n('login', 'login-email'), failedSignIns24h: n('login-failed', 'login-email-failed'), changes24h: n('created', 'updated', 'deleted'), admin24h: n('role-changed', 'user-created', 'user-deleted', 'user-disabled', 'user-enabled', 'password-set') },
      lastBackup: audits.find((r) => r.action === 'backup-downloaded')?.at || '',
      links: ref ? { supabase: `https://supabase.com/dashboard/project/${ref}` } : {},
    };
  }

  // ---- Router ----------------------------------------------------------------
  return async function handle(req, { me, parts, method, by }) {
    const [section, id, action] = parts;
    try {
      if (section === 'overview' && method === 'GET') return json(await overview());

      if (section === 'users') {
        if (!id && method === 'GET') return json(await listUsers());

        if (!id && method === 'POST') {
          if (!sb) return fail(409, NEEDS_KEY);
          const input = sanitizeNewUser(await req.json().catch(() => null));
          const created = await sb.createUser(input.email, input.password);
          const now = new Date().toISOString();
          await repo.write(`profiles/${await userKey(created.id)}`, { email: input.email, supabaseId: created.id, role: input.role, displayName: input.displayName, jobTitle: '', phone: '', createdAt: now, updatedAt: now, createdBy: me.profile.email });
          await audit('user-created', `${input.email} (${input.role})`, await by());
          const allow = String(env.ALLOWED_EMAILS || '').trim();
          const warning = allow && !allow.toLowerCase().split(',').map((e) => e.trim()).includes(input.email) && !lockedAdmin(env, input.email)
            ? 'ALLOWED_EMAILS in Netlify is set and does not include this address, so they cannot sign in until you add it.' : '';
          return json({ ok: true, id: created.id, warning }, 201);
        }

        if (id && !action && method === 'PUT') {
          const { key, profile } = await target(id, me);
          const change = sanitizeUserUpdate(await req.json().catch(() => null));
          if (lockedAdmin(env, profile.email)) throw new AdminError(400, 'This person is an administrator set in Netlify (ADMIN_EMAILS). Change it there.');
          const next = { ...profile, ...change, updatedAt: new Date().toISOString() };
          await repo.write(key, next);
          let warning = '';
          if (change.disabled !== undefined && sb) {
            try { await sb.setBanned(id, change.disabled); } catch (e) { warning = `Saved here, but Supabase was not updated: ${e.message}`; }
          }
          if (change.role) await audit('role-changed', `${profile.email} → ${change.role}`, await by());
          if (change.disabled !== undefined) await audit(change.disabled ? 'user-disabled' : 'user-enabled', profile.email, await by());
          return json({ ok: true, warning });
        }

        if (id && action === 'password' && method === 'POST') {
          if (!sb) return fail(409, NEEDS_KEY);
          if (!UUID_RE.test(id)) throw new AdminError(400, 'Invalid user id');
          const body = await req.json().catch(() => null);
          await sb.setPassword(id, validatePassword(body?.password));
          const profile = await repo.read(`profiles/${await userKey(id)}`);
          await audit('password-set', profile?.email || id, await by());
          return json({ ok: true });
        }

        if (id && !action && method === 'DELETE') {
          if (!sb) return fail(409, NEEDS_KEY);
          const { key, profile } = await target(id, me);
          if (lockedAdmin(env, profile.email)) throw new AdminError(400, 'This person is an administrator set in Netlify (ADMIN_EMAILS). Remove them there first.');
          await sb.deleteUser(id);
          await repo.remove(key);
          await audit('user-deleted', profile.email, await by());
          return json({ ok: true });
        }
      }
      return fail(404, 'Not found');
    } catch (e) {
      if (e instanceof AdminError) return fail(e.status, e.message);
      if (e instanceof ValidationError) return fail(400, e.message);
      throw e;
    }
  };
}
