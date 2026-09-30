// Encrypted record storage on top of a Netlify Blobs store (or any store with
// the same get/setJSON/delete/list surface, which is how tests and local dev run).
import { encryptJSON, decryptJSON } from './crypto.mjs';

export function createRepo(env, blobs) {
  const read = async (key) => {
    const blob = await blobs.get(key, { type: 'json' });
    return blob ? decryptJSON(env, blob, key) : null;
  };
  return {
    read,
    async write(key, value) {
      await blobs.setJSON(key, await encryptJSON(env, value, key));
    },
    remove: (key) => blobs.delete(key),
    async list(prefix) {
      const { blobs: entries } = await blobs.list({ prefix });
      const rows = await Promise.all(entries.map((e) => read(e.key)));
      return rows.filter(Boolean);
    },
  };
}
