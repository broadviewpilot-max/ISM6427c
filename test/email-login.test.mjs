import test from 'node:test';
import assert from 'node:assert/strict';
import { ENV, makeClient } from './helpers.mjs';
import { makeUserToken, verifyToken } from '../netlify/lib/auth.mjs';

const EMAIL_ENV = { ...ENV, SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' };
const GOOD = { email: 'Pat@Example.org', password: 'a-good-password' };

// A stand-in for Supabase: accepts one account, rejects everything else.
function fakeSupabase({ down = false, user = { id: 'user-1', email: 'pat@example.org' } } = {}) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    if (down) throw new Error('network');
    const body = JSON.parse(init.body);
    if (body.email === 'pat@example.org' && body.password === GOOD.password) {
      return new Response(JSON.stringify({ access_token: 'secret-jwt', user }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
  };
  fn.calls = calls;
  return fn;
}

test('email sign-in is off (503) until Supabase is configured; board login unaffected', async () => {
  const c = makeClient(ENV, fakeSupabase());
  assert.equal((await c.call('POST', '/api/login-email', GOOD)).status, 503);
  assert.equal((await c.login()).status, 200);
});

test('right email and password unlocks the API with an HttpOnly session', async () => {
  const sb = fakeSupabase();
  const c = makeClient(EMAIL_ENV, sb);
  assert.equal((await c.call('GET', '/api/participants')).status, 401);
  assert.equal((await c.call('POST', '/api/login-email', GOOD)).status, 200);
  assert.equal((await c.call('GET', '/api/session')).status, 200);
  assert.equal(sb.calls[0].url, 'https://proj.supabase.co/auth/v1/token?grant_type=password');
  assert.equal(sb.calls[0].init.headers.apikey, 'sb_publishable_test');
});

test('the Supabase token is never handed to the browser', async () => {
  const res = await makeClient(EMAIL_ENV, fakeSupabase()).call('POST', '/api/login-email', GOOD);
  assert.equal(JSON.stringify(res.body).includes('secret-jwt'), false);
});

test('wrong password rejected, then locked out after 5 failures', async () => {
  const c = makeClient(EMAIL_ENV, fakeSupabase());
  for (let i = 0; i < 5; i++) assert.equal((await c.call('POST', '/api/login-email', { ...GOOD, password: 'nope' })).status, 401);
  assert.equal((await c.call('POST', '/api/login-email', GOOD)).status, 429);
});

test('unknown email rejected; empty fields are a 400', async () => {
  const c = makeClient(EMAIL_ENV, fakeSupabase());
  assert.equal((await c.call('POST', '/api/login-email', { email: 'stranger@example.org', password: 'x' })).status, 401);
  assert.equal((await c.call('POST', '/api/login-email', { email: '', password: '' })).status, 400);
  assert.equal((await c.call('GET', '/api/participants')).status, 401);
});

test('Supabase unreachable gives 502 and does not count toward lockout', async () => {
  const c = makeClient(EMAIL_ENV, fakeSupabase({ down: true }));
  for (let i = 0; i < 6; i++) assert.equal((await c.call('POST', '/api/login-email', GOOD)).status, 502);
});

test('ALLOWED_EMAILS blocks a valid Supabase account that is not listed', async () => {
  const blocked = makeClient({ ...EMAIL_ENV, ALLOWED_EMAILS: 'someone.else@example.org' }, fakeSupabase());
  assert.equal((await blocked.call('POST', '/api/login-email', GOOD)).status, 401);
  assert.equal((await blocked.call('GET', '/api/session')).status, 401);
  const allowed = makeClient({ ...EMAIL_ENV, ALLOWED_EMAILS: ' PAT@example.org , x@y.z' }, fakeSupabase());
  assert.equal((await allowed.call('POST', '/api/login-email', GOOD)).status, 200);
});

test('email session tokens expire, resist tampering, and die if the secret changes', async () => {
  const t0 = Date.now();
  const tok = await makeUserToken(EMAIL_ENV, 'user-1', t0);
  assert.equal(await verifyToken(EMAIL_ENV, tok, t0 + 60_000), true);
  assert.equal(await verifyToken(EMAIL_ENV, tok, t0 + 13 * 3600_000), false); // 12h default
  const [u, exp, uid, sig] = tok.split('.');
  assert.equal(await verifyToken(EMAIL_ENV, [u, Number(exp) + 99999, uid, sig].join('.'), t0), false);
  assert.equal(await verifyToken(EMAIL_ENV, [u, exp, 'f'.repeat(32), sig].join('.'), t0), false);
  assert.equal(await verifyToken({ ...EMAIL_ENV, SESSION_SECRET: 'y'.repeat(40) }, tok, t0), false);
});

test('logout clears an email session', async () => {
  const c = makeClient(EMAIL_ENV, fakeSupabase());
  await c.call('POST', '/api/login-email', GOOD);
  await c.call('POST', '/api/logout', {});
  assert.equal((await c.call('GET', '/api/session')).status, 401);
});
