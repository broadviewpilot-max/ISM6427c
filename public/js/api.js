// Thin client for the /api function plus a small in-memory cache.
async function request(method, path, body) {
  const res = await fetch('/api/' + path, {
    method,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'aimsir' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) { location.replace('/login.html'); throw new Error('Please sign in.'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// Who is signed in and what they may do. Filled from /api/profile at start-up; the
// server enforces every permission, this only decides what to show.
export const session = { me: { kind: 'board', role: 'board', permissions: [] } };
export const can = (perm) => !!session.me.permissions?.includes(perm);

const cache = {};
export const api = {
  request,
  async list(name, force) {
    if (force || !cache[name]) cache[name] = await request('GET', name);
    return cache[name];
  },
  async save(name, rec) {
    const saved = rec.id ? await request('PUT', `${name}/${rec.id}`, rec) : await request('POST', name, rec);
    delete cache[name];
    if (name === 'mentors') delete cache.participants;
    return saved;
  },
  async remove(name, id) {
    await request('DELETE', `${name}/${id}`);
    delete cache[name];
    if (name === 'mentors') delete cache.participants;
  },
  async settings(force) {
    if (force || !cache.settings) cache.settings = await request('GET', 'settings');
    return cache.settings;
  },
  async saveSettings(s) { cache.settings = await request('PUT', 'settings', s); return cache.settings; },
  async profile(force) {
    if (force || !cache.profile) cache.profile = await request('GET', 'profile');
    session.me = cache.profile;
    return cache.profile;
  },
  async saveProfile(p) { cache.profile = await request('PUT', 'profile', p); session.me = cache.profile; return cache.profile; },
  logExport: (detail) => request('POST', 'audit', { action: 'export', detail }).catch(() => {}),
  logout: () => request('POST', 'logout', {}).catch(() => {}),
};
