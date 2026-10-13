import test from 'node:test';
import assert from 'node:assert/strict';
import { ENV, makeClient, memoryBlobs } from './helpers.mjs';
import { PW, SECRET, fakeSupabase } from './fake-supabase.mjs';

const BASE = { ...ENV, SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', ADMIN_EMAILS: 'boss@example.org' };
const ADMIN_ENV = { ...BASE, SUPABASE_SECRET_KEY: SECRET };

async function setup(env = ADMIN_ENV, seed = {}) {
  const sb = fakeSupabase({ 'boss@example.org': PW, 'emp@example.org': PW, 'pat@example.org': PW, ...seed });
  const blobs = memoryBlobs();
  const client = () => makeClient(env, sb, blobs);
  const signIn = async (email) => { const c = client(); const r = await c.call('POST', '/api/login-email', { email, password: PW }); assert.equal(r.status, 200, `${email} sign-in`); return c; };
  const boss = await signIn('boss@example.org');
  const emp = await signIn('emp@example.org');
  const pat = await signIn('pat@example.org');
  const id = (email) => sb.byEmail(email).id;
  return { sb, blobs, client, signIn, boss, emp, pat, id };
}
const setRole = (t, email, role) => t.boss.call('PUT', `/api/admin/users/${t.id(email)}`, { role });

test('a new email account is a plain "user": own profile only, no Foundation data', async () => {
  const t = await setup();
  const me = (await t.pat.call('GET', '/api/profile')).body;
  assert.equal(me.role, 'user');
  assert.deepEqual(me.permissions, []);
  for (const path of ['/api/participants', '/api/mentors', '/api/sponsors', '/api/settings', '/api/audit', '/api/backup']) {
    assert.equal((await t.pat.call('GET', path)).status, 403, path);
  }
  assert.equal((await t.pat.call('POST', '/api/mentors', { name: 'x' })).status, 403);
  assert.equal((await t.pat.call('GET', '/api/session')).status, 200);
  assert.equal((await t.pat.call('PUT', '/api/profile', { displayName: 'Pat' })).status, 200);
});

test('ADMIN_EMAILS makes an administrator with full access', async () => {
  const t = await setup();
  assert.equal((await t.boss.call('GET', '/api/profile')).body.role, 'administrator');
  const created = await t.boss.call('POST', '/api/mentors', { name: 'M' });
  assert.equal(created.status, 201);
  assert.equal((await t.boss.call('GET', '/api/settings')).status, 200);
  assert.equal((await t.boss.call('PUT', '/api/settings', { stages: ['A', 'B'] })).status, 200);
  assert.equal((await t.boss.call('GET', '/api/audit')).status, 200);
  assert.equal((await t.boss.call('GET', '/api/backup')).status, 200);
  assert.equal((await t.boss.call('DELETE', `/api/mentors/${created.body.id}`)).status, 200);
  assert.equal((await t.boss.call('GET', '/api/admin/overview')).status, 200);
});

test('employee can view, add and edit records, but not delete, change settings, read the log, back up, or administer', async () => {
  const t = await setup();
  assert.equal((await setRole(t, 'emp@example.org', 'employee')).status, 200);
  const made = await t.emp.call('POST', '/api/mentors', { name: 'Mentor' });
  assert.equal(made.status, 201);
  assert.equal((await t.emp.call('GET', '/api/mentors')).status, 200);
  assert.equal((await t.emp.call('PUT', `/api/mentors/${made.body.id}`, { ...made.body, name: 'Renamed' })).status, 200);
  assert.equal((await t.emp.call('GET', '/api/settings')).status, 200);
  assert.equal((await t.emp.call('POST', '/api/audit', { action: 'export', detail: 'x' })).status, 200);
  assert.equal((await t.emp.call('DELETE', `/api/mentors/${made.body.id}`)).status, 403);
  assert.equal((await t.emp.call('PUT', '/api/settings', { stages: ['A'] })).status, 403);
  assert.equal((await t.emp.call('GET', '/api/audit')).status, 403);
  assert.equal((await t.emp.call('GET', '/api/backup')).status, 403);
  assert.equal((await t.emp.call('GET', '/api/admin/overview')).status, 403);
});

test('the shared board password keeps its existing access but cannot administer', async () => {
  const t = await setup();
  const board = t.client();
  assert.equal((await board.login()).status, 200);
  const made = await board.call('POST', '/api/sponsors', { name: 'S' });
  assert.equal(made.status, 201);
  assert.equal((await board.call('GET', '/api/backup')).status, 200);
  assert.equal((await board.call('GET', '/api/audit')).status, 200);
  assert.equal((await board.call('DELETE', `/api/sponsors/${made.body.id}`)).status, 200);
  assert.equal((await board.call('GET', '/api/admin/overview')).status, 403);
  assert.equal((await board.call('GET', '/api/admin/users')).status, 403);
});

test('nobody can give themselves a role through their profile', async () => {
  const t = await setup();
  const r = await t.pat.call('PUT', '/api/profile', { displayName: 'Pat', role: 'administrator', disabled: false, supabaseId: 'x' });
  assert.equal(r.status, 200);
  assert.equal(r.body.role, 'user');
  assert.equal((await t.pat.call('GET', '/api/admin/overview')).status, 403);
});

test('every admin endpoint refuses non-administrators', async () => {
  const t = await setup();
  const id = t.id('pat@example.org');
  const calls = [['GET', '/api/admin/overview'], ['GET', '/api/admin/users'], ['POST', '/api/admin/users', { email: 'n@x.org', password: PW }],
    ['PUT', `/api/admin/users/${id}`, { role: 'administrator' }], ['POST', `/api/admin/users/${id}/password`, { password: PW }], ['DELETE', `/api/admin/users/${id}`]];
  for (const who of [t.pat, t.emp, t.client()]) for (const [m, p, b] of calls) {
    assert.ok([401, 403].includes((await who.call(m, p, b)).status), `${m} ${p}`);
  }
});

test('role changes take effect on the very next request', async () => {
  const t = await setup();
  await setRole(t, 'emp@example.org', 'employee');
  assert.equal((await t.emp.call('GET', '/api/participants')).status, 200);
  await setRole(t, 'emp@example.org', 'user');
  assert.equal((await t.emp.call('GET', '/api/participants')).status, 403);
  assert.equal((await t.emp.call('GET', '/api/profile')).body.role, 'user');
});

test('administrators cannot change or remove themselves, or an administrator set in ADMIN_EMAILS', async () => {
  const t = await setup();
  const self = t.id('boss@example.org');
  assert.equal((await t.boss.call('PUT', `/api/admin/users/${self}`, { role: 'user' })).status, 400);
  assert.equal((await t.boss.call('PUT', `/api/admin/users/${self}`, { disabled: true })).status, 400);
  assert.equal((await t.boss.call('DELETE', `/api/admin/users/${self}`)).status, 400);
  // a second administrator (promoted in the app) still cannot touch the Netlify-locked one
  await setRole(t, 'emp@example.org', 'administrator');
  for (const r of [{ role: 'user' }, { disabled: true }]) assert.equal((await t.emp.call('PUT', `/api/admin/users/${self}`, r)).status, 400);
  assert.equal((await t.emp.call('DELETE', `/api/admin/users/${self}`)).status, 400);
  assert.equal((await t.boss.call('GET', '/api/admin/overview')).status, 200);
});

test('deactivating a person ends their access immediately and blocks sign-in; reactivating restores it', async () => {
  const t = await setup();
  const id = t.id('pat@example.org');
  await setRole(t, 'pat@example.org', 'employee');
  assert.equal((await t.pat.call('GET', '/api/participants')).status, 200);
  assert.equal((await t.boss.call('PUT', `/api/admin/users/${id}`, { disabled: true })).status, 200);
  assert.equal((await t.pat.call('GET', '/api/participants')).status, 401); // existing session dies at once
  assert.equal(t.sb.users.get(id).banned, true); // and Supabase is told too
  const again = t.client();
  assert.equal((await again.call('POST', '/api/login-email', { email: 'pat@example.org', password: PW })).status, 401); // Supabase now refuses
  t.sb.users.get(id).banned = false; // even if Supabase let them through, the app still refuses
  assert.equal((await again.call('POST', '/api/login-email', { email: 'pat@example.org', password: PW })).status, 403);
  assert.equal((await t.boss.call('PUT', `/api/admin/users/${id}`, { disabled: false })).status, 200);
  assert.equal((await again.call('POST', '/api/login-email', { email: 'pat@example.org', password: PW })).status, 200);
  assert.equal((await again.call('GET', '/api/participants')).status, 200);
});

test('administrator creates a user with a role; the person can sign in; bad input is refused', async () => {
  const t = await setup();
  const made = await t.boss.call('POST', '/api/admin/users', { email: 'New@Example.org', password: 'brand-new-pass-1', role: 'employee', displayName: 'Nia New' });
  assert.equal(made.status, 201);
  const nia = t.client();
  assert.equal((await nia.call('POST', '/api/login-email', { email: 'new@example.org', password: 'brand-new-pass-1' })).status, 200);
  const prof = (await nia.call('GET', '/api/profile')).body;
  assert.equal(prof.role, 'employee');
  assert.equal(prof.displayName, 'Nia New');
  assert.equal((await t.boss.call('POST', '/api/admin/users', { email: 'new@example.org', password: 'brand-new-pass-1' })).status, 400); // duplicate
  assert.equal((await t.boss.call('POST', '/api/admin/users', { email: 'nope', password: 'brand-new-pass-1' })).status, 400);
  assert.equal((await t.boss.call('POST', '/api/admin/users', { email: 'z@example.org', password: 'short' })).status, 400);
  assert.equal((await t.boss.call('POST', '/api/admin/users', { email: 'z@example.org', password: 'long-enough-pass', role: 'god' })).status, 400);
});

test('administrator can set a new password for someone; the old one stops working', async () => {
  const t = await setup();
  const id = t.id('pat@example.org');
  assert.equal((await t.boss.call('POST', `/api/admin/users/${id}/password`, { password: 'short' })).status, 400);
  assert.equal((await t.boss.call('POST', `/api/admin/users/${id}/password`, { password: 'a-new-strong-pass-9' })).status, 200);
  const c = t.client();
  assert.equal((await c.call('POST', '/api/login-email', { email: 'pat@example.org', password: PW })).status, 401);
  assert.equal((await c.call('POST', '/api/login-email', { email: 'pat@example.org', password: 'a-new-strong-pass-9' })).status, 200);
});

test('administrator can delete a user: Supabase account and profile are gone and their session ends', async () => {
  const t = await setup();
  const id = t.id('pat@example.org');
  assert.equal((await t.boss.call('DELETE', `/api/admin/users/${id}`)).status, 200);
  assert.equal(t.sb.users.has(id), false);
  assert.equal((await t.pat.call('GET', '/api/profile')).status, 401);
  const list = (await t.boss.call('GET', '/api/admin/users')).body.users;
  assert.equal(list.some((u) => u.email === 'pat@example.org'), false);
});

test('user list merges Supabase accounts with profiles, including people who have never signed in', async () => {
  const t = await setup(ADMIN_ENV, { 'never@example.org': PW });
  const { users, userManagement, warning } = (await t.boss.call('GET', '/api/admin/users')).body;
  assert.equal(userManagement, true);
  assert.equal(warning, '');
  const never = users.find((u) => u.email === 'never@example.org');
  assert.equal(never.signedInBefore, false);
  assert.equal(never.role, 'user');
  assert.equal(users.find((u) => u.email === 'boss@example.org').roleLocked, true);
  // role can be pre-assigned before their first sign-in
  assert.equal((await t.boss.call('PUT', `/api/admin/users/${never.id}`, { role: 'employee' })).status, 200);
  const first = t.client();
  await first.call('POST', '/api/login-email', { email: 'never@example.org', password: PW });
  assert.equal((await first.call('GET', '/api/profile')).body.role, 'employee');
});

test('without the secret key the page still works from profiles and says what is missing', async () => {
  const t = await setup(BASE);
  const body = (await t.boss.call('GET', '/api/admin/users')).body;
  assert.equal(body.userManagement, false);
  assert.ok(body.users.length >= 3);
  assert.equal((await t.boss.call('POST', '/api/admin/users', { email: 'n@x.org', password: PW })).status, 409);
  assert.equal((await t.boss.call('POST', `/api/admin/users/${t.id('pat@example.org')}/password`, { password: PW })).status, 409);
  assert.equal((await t.boss.call('DELETE', `/api/admin/users/${t.id('pat@example.org')}`)).status, 409);
  assert.equal((await setRole(t, 'emp@example.org', 'employee')).status, 200); // role changes still work
});

test('a Supabase outage degrades the user list with a warning instead of failing', async () => {
  const t = await setup();
  const broken = async () => { throw new Error('network down'); };
  const degraded = makeClient(ADMIN_ENV, broken, t.blobs);
  degraded.setCookie(t.boss.getCookie()); // same signed-in administrator, but Supabase is unreachable
  const res = await degraded.call('GET', '/api/admin/users');
  assert.equal(res.status, 200);
  assert.match(res.body.warning, /Could not reach Supabase/);
  assert.ok(res.body.users.some((u) => u.email === 'pat@example.org')); // still lists people who have signed in
});

test('overview reports health, config and activity without ever exposing a secret', async () => {
  const t = await setup();
  await t.boss.call('POST', '/api/mentors', { name: 'M' });
  const r = await t.boss.call('GET', '/api/admin/overview');
  assert.equal(r.status, 200);
  const o = r.body;
  const svc = Object.fromEntries(o.services.map((s) => [s.name.split(' (')[0], s.status]));
  assert.equal(svc['Database'], 'ok');
  assert.equal(svc['Supabase Auth'], 'ok');
  assert.equal(svc['Supabase admin key'], 'ok');
  assert.equal(o.records.mentors, 1);
  assert.ok(o.people.signedIn >= 3);
  assert.equal(o.people.roles.administrator >= 1, true);
  assert.ok(o.activity.signIns24h >= 3);
  assert.equal(o.config.find((c) => c.name.startsWith('User management')).ok, true);
  assert.equal(o.links.supabase, 'https://supabase.com/dashboard/project/proj');
  const text = JSON.stringify(o);
  for (const secret of [SECRET, ENV.APP_PASSWORD, ENV.SESSION_SECRET, ENV.DATA_ENCRYPTION_KEY, 'sb_publishable_test', PW]) assert.equal(text.includes(secret), false, 'leaked a secret');
});

test('overview flags a failing database or Supabase without crashing', async () => {
  const t = await setup();
  const down = async () => new Response('{}', { status: 503 });
  const sick = makeClient(ADMIN_ENV, down, { ...t.blobs, setJSON: async () => { throw new Error('storage down'); } });
  sick.setCookie(t.boss.getCookie());
  const r = await sick.call('GET', '/api/admin/overview');
  assert.equal(r.status, 200);
  const status = Object.fromEntries(r.body.services.map((s) => [s.name.split(' (')[0], s.status]));
  assert.equal(status['Database'], 'fail');
  assert.equal(status['Supabase Auth'], 'fail');
  assert.equal(status['Supabase admin key'], 'fail');
});

test('admin actions are written to the activity log with who did them', async () => {
  const t = await setup();
  await t.boss.call('PUT', '/api/profile', { displayName: 'Boss Person' });
  await setRole(t, 'emp@example.org', 'employee');
  await t.boss.call('POST', '/api/admin/users', { email: 'c@example.org', password: 'created-pass-123' });
  await t.boss.call('POST', `/api/admin/users/${t.id('pat@example.org')}/password`, { password: 'another-strong-pass' });
  const rows = (await t.boss.call('GET', '/api/audit?limit=200')).body;
  for (const action of ['role-changed', 'user-created', 'password-set']) assert.ok(rows.some((r) => r.action === action && r.by === 'Boss Person'), action);
  assert.equal(JSON.stringify(rows).includes('another-strong-pass'), false); // passwords are never logged
});

test('admin routes reject malformed ids and cross-site requests', async () => {
  const t = await setup();
  for (const bad of ['not-a-uuid', '..%2F..%2Fsecret', '1;drop']) {
    assert.equal((await t.boss.call('PUT', `/api/admin/users/${bad}`, { role: 'user' })).status, 400, bad);
    assert.equal((await t.boss.call('POST', `/api/admin/users/${bad}/password`, { password: 'long-enough-pass' })).status, 400, bad);
  }
  assert.equal((await t.boss.call('PUT', `/api/admin/users/${t.id('pat@example.org')}`, { role: 'user' }, { 'x-requested-with': '' })).status, 403);
  assert.equal((await t.boss.call('PUT', `/api/admin/users/${t.id('pat@example.org')}`, { role: 'user' }, { origin: 'https://evil.example' })).status, 403);
});

test('ADMIN_EMAILS can always sign in even when ALLOWED_EMAILS would exclude them', async () => {
  const sb = fakeSupabase({ 'boss@example.org': PW, 'emp@example.org': PW });
  const env = { ...ADMIN_ENV, ALLOWED_EMAILS: 'someone.else@example.org' };
  const blobs = memoryBlobs();
  assert.equal((await makeClient(env, sb, blobs).call('POST', '/api/login-email', { email: 'boss@example.org', password: PW })).status, 200);
  assert.equal((await makeClient(env, sb, blobs).call('POST', '/api/login-email', { email: 'emp@example.org', password: PW })).status, 401);
});
