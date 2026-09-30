import test from 'node:test';
import assert from 'node:assert/strict';
import { ENV, makeClient } from './helpers.mjs';
import { makeToken, verifyToken } from '../netlify/lib/auth.mjs';

test('fails closed when not configured', async () => {
  const c = makeClient({});
  assert.equal((await c.call('GET', '/api/session')).status, 503);
});

test('rejects data requests without a session', async () => {
  const c = makeClient();
  assert.equal((await c.call('GET', '/api/participants')).status, 401);
});

test('wrong password rejected, right password accepted, lockout after 5 failures', async () => {
  const c = makeClient();
  for (let i = 0; i < 5; i++) assert.equal((await c.call('POST', '/api/login', { password: 'nope' })).status, 401);
  assert.equal((await c.call('POST', '/api/login', { password: 'nope' })).status, 429);
  assert.equal((await c.login()).status, 429); // still locked even with the right password
});

test('login sets an HttpOnly session and unlocks the API', async () => {
  const c = makeClient();
  assert.equal((await c.login()).status, 200);
  assert.equal((await c.call('GET', '/api/session')).status, 200);
  assert.deepEqual((await c.call('GET', '/api/participants')).body, []);
});

test('tokens expire and die when the password changes', async () => {
  const t = await makeToken(ENV, Date.now() - 8 * 86400 * 1000);
  assert.equal(await verifyToken(ENV, t), false);
  const fresh = await makeToken(ENV);
  assert.equal(await verifyToken(ENV, fresh), true);
  assert.equal(await verifyToken({ ...ENV, APP_PASSWORD: 'a different password' }, fresh), false);
  assert.equal(await verifyToken(ENV, fresh + 'x'), false);
});

test('writes require the CSRF header and same origin', async () => {
  const c = makeClient();
  await c.login();
  assert.equal((await c.call('POST', '/api/mentors', { name: 'A' }, { 'x-requested-with': 'other' })).status, 403);
  assert.equal((await c.call('POST', '/api/mentors', { name: 'A' }, { origin: 'https://evil.test' })).status, 403);
});

test('participant CRUD, encryption at rest, conflict detection', async () => {
  const c = makeClient();
  await c.login();
  const created = await c.call('POST', '/api/participants', { firstName: 'Test', lastName: 'Person', scholarshipAmount: '250', junk: 'dropped' });
  assert.equal(created.status, 201);
  assert.equal(created.body.junk, undefined);
  assert.equal(created.body.scholarshipAmount, 250);
  for (const raw of c.blobs.m.values()) assert.ok(!raw.includes('Person'), 'plaintext leaked into storage');
  const id = created.body.id;
  const upd = await c.call('PUT', `/api/participants/${id}`, { ...created.body, lastName: 'Renamed' });
  assert.equal(upd.body.lastName, 'Renamed');
  assert.equal((await c.call('PUT', `/api/participants/${id}`, { ...created.body })).status, 409);
  assert.equal((await c.call('DELETE', `/api/participants/${id}`)).status, 200);
  assert.equal((await c.call('GET', `/api/participants/${id}`)).status, 404);
});

test('minor requires a guardian', async () => {
  const c = makeClient();
  await c.login();
  const y = new Date().getFullYear() - 10;
  const bad = await c.call('POST', '/api/participants', { firstName: 'A', lastName: 'B', dob: `${y}-01-01` });
  assert.equal(bad.status, 400);
  const ok = await c.call('POST', '/api/participants', { firstName: 'A', lastName: 'B', dob: `${y}-01-01`, guardianName: 'G' });
  assert.equal(ok.status, 201);
});

test('deleting a mentor unassigns their participants', async () => {
  const c = makeClient();
  await c.login();
  const m = (await c.call('POST', '/api/mentors', { name: 'Mentor One' })).body;
  const p = (await c.call('POST', '/api/participants', { firstName: 'A', lastName: 'B', mentorId: m.id })).body;
  await c.call('DELETE', `/api/mentors/${m.id}`);
  assert.equal((await c.call('GET', `/api/participants/${p.id}`)).body.mentorId, '');
});

test('sponsors keep contributions and validate dates', async () => {
  const c = makeClient();
  await c.login();
  const bad = await c.call('POST', '/api/sponsors', { name: 'S', nextFollowUp: 'soon' });
  assert.equal(bad.status, 400);
  const ok = await c.call('POST', '/api/sponsors', { name: 'S', contributions: [{ date: '2026-01-05', amount: '100', kind: 'Cash' }] });
  assert.equal(ok.body.contributions[0].amount, 100);
  assert.ok(ok.body.contributions[0].id);
});

test('settings, audit, backup', async () => {
  const c = makeClient();
  await c.login();
  assert.equal((await c.call('PUT', '/api/settings', { stages: [] })).status, 400);
  assert.deepEqual((await c.call('PUT', '/api/settings', { stages: ['One', 'Two'] })).body.stages, ['One', 'Two']);
  assert.ok((await c.call('GET', '/api/audit')).body.length > 0);
  const b = await c.call('GET', '/api/backup');
  assert.ok(Array.isArray(b.body.participants) && b.body.settings.stages.length === 2);
});

test('config error names the variable, and the data key tolerates quotes/spaces', async () => {
  const bad = makeClient({ ...ENV, DATA_ENCRYPTION_KEY: 'not-a-key' });
  const r = await bad.call('GET', '/api/session');
  assert.equal(r.status, 503);
  assert.match(r.body.error, /DATA_ENCRYPTION_KEY/);
  assert.doesNotMatch(r.body.error, /APP_PASSWORD/);
  const quoted = makeClient({ ...ENV, DATA_ENCRYPTION_KEY: `  "${ENV.DATA_ENCRYPTION_KEY}"  ` });
  assert.equal((await quoted.login()).status, 200);
  assert.equal((await quoted.call('POST', '/api/mentors', { name: 'X' })).status, 201);
});
