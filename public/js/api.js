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
  logExport: (detail) => request('POST', 'audit', { action: 'export', detail }).catch(() => {}),
  logout: () => request('POST', 'logout', {}).catch(() => {}),
};
