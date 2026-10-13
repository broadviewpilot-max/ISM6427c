import test from 'node:test';
import assert from 'node:assert/strict';
import { ENV, makeClient, memoryBlobs } from './helpers.mjs';

const EMAIL_ENV = { ...ENV, SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' };
const ACCOUNTS = {
  'pat@example.org': { id: 'user-pat', password: 'pat-password-1' },
  'lee@example.org': { id: 'user-lee', password: 'lee-password-1' },
};
// Stand-in for Supabase with two accounts.
const fakeSupabase = async (url, init) => {
  const { email, password } = JSON.parse(init.body);
  const a = ACCOUNTS[email];
  return a && a.password === password
    ? new Response(JSON.stringify({ user: { id: a.id, email } }), { status: 200 })
    : new Response('{}', { status: 400 });
};
const signIn = async (c, who) => assert.equal((await c.call('POST', '/api/login-email', { email: who, password: ACCOUNTS[who].password })).status, 200);

test('board-password session: profile GET says "board", PUT is refused', async () => {
  const c = makeClient(EMAIL_ENV, fakeSupabase);
  await c.login();
  assert.deepEqual((await c.call('GET', '/api/profile')).body, { kind: 'board' });
  assert.equal((await c.call('PUT', '/api/profile', { displayName: 'X' })).status, 403);
});

test('profile requires a session', async () => {
  const c = makeClient(EMAIL_ENV, fakeSupabase);
  assert.equal((await c.call('GET', '/api/profile')).status, 401);
  assert.equal((await c.call('PUT', '/api/profile', { displayName: 'X' })).status, 401);
});

test('first email sign-in creates an empty profile holding the email', async () => {
  const c = makeClient(EMAIL_ENV, fakeSupabase);
  await signIn(c, 'pat@example.org');
  assert.deepEqual((await c.call('GET', '/api/profile')).body, { kind: 'email', email: 'pat@example.org', displayName: '', jobTitle: '', phone: '' });
});

test('a person can save their profile; it persists across sign-ins; email cannot be changed', async () => {
  const blobs = memoryBlobs();
  const c = makeClient(EMAIL_ENV, fakeSupabase, blobs);
  await signIn(c, 'pat@example.org');
  const put = await c.call('PUT', '/api/profile', { displayName: '  Pat Jones ', jobTitle: 'Mentor', phone: '555-0100', email: 'evil@example.org' });
  assert.equal(put.status, 200);
  assert.equal(put.body.displayName, 'Pat Jones');
  assert.equal(put.body.email, 'pat@example.org');
  const again = makeClient(EMAIL_ENV, fakeSupabase, blobs); // new browser, same database
  await signIn(again, 'pat@example.org');
  assert.deepEqual((await again.call('GET', '/api/profile')).body, { kind: 'email', email: 'pat@example.org', displayName: 'Pat Jones', jobTitle: 'Mentor', phone: '555-0100' });
});

test('profile validation: name required, length limits', async () => {
  const c = makeClient(EMAIL_ENV, fakeSupabase);
  await signIn(c, 'pat@example.org');
  assert.equal((await c.call('PUT', '/api/profile', { displayName: '   ' })).status, 400);
  assert.equal((await c.call('PUT', '/api/profile', { displayName: 'x'.repeat(81) })).status, 400);
  assert.equal((await c.call('PUT', '/api/profile', { displayName: 'Pat', phone: '1'.repeat(41) })).status, 400);
  assert.equal((await c.call('PUT', '/api/profile', 'nope')).status, 400);
});

test('people can only see and change their own profile', async () => {
  const blobs = memoryBlobs();
  const pat = makeClient(EMAIL_ENV, fakeSupabase, blobs);
  const lee = makeClient(EMAIL_ENV, fakeSupabase, blobs);
  await signIn(pat, 'pat@example.org');
  await signIn(lee, 'lee@example.org');
  await pat.call('PUT', '/api/profile', { displayName: 'Pat', phone: '111' });
  await lee.call('PUT', '/api/profile', { displayName: 'Lee', phone: '222' });
  assert.equal((await pat.call('GET', '/api/profile')).body.displayName, 'Pat');
  assert.equal((await lee.call('GET', '/api/profile')).body.displayName, 'Lee');
  assert.equal((await lee.call('GET', '/api/profile')).body.phone, '222');
});

test('profiles are not exposed through the generic data routes or the backup', async () => {
  const c = makeClient(EMAIL_ENV, fakeSupabase);
  await signIn(c, 'pat@example.org');
  await c.call('PUT', '/api/profile', { displayName: 'Pat', phone: '555' });
  assert.equal((await c.call('GET', '/api/profiles')).status, 404);
  assert.equal(JSON.stringify((await c.call('GET', '/api/backup')).body).includes('555'), false);
});

test('the activity log records who acted: profile name, email, or board password', async () => {
  const blobs = memoryBlobs();
  const pat = makeClient(EMAIL_ENV, fakeSupabase, blobs);
  const board = makeClient(EMAIL_ENV, fakeSupabase, blobs);
  await signIn(pat, 'pat@example.org');
  await pat.call('POST', '/api/mentors', { name: 'First Mentor' }); // no name set yet: falls back to email
  await pat.call('PUT', '/api/profile', { displayName: 'Pat Jones' });
  await pat.call('POST', '/api/mentors', { name: 'Second Mentor' });
  await board.login();
  await board.call('POST', '/api/mentors', { name: 'Third Mentor' });
  const rows = (await board.call('GET', '/api/audit')).body;
  const created = rows.filter((r) => r.action === 'created').map((r) => r.by).sort();
  assert.deepEqual(created, ['Pat Jones', 'board password', 'pat@example.org']);
  assert.ok(rows.some((r) => r.action === 'profile-updated' && r.by === 'Pat Jones'));
});
