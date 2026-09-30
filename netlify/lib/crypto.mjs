// Field-level protection: every record is encrypted with AES-256-GCM before it
// is written to storage, in addition to Netlify's own encryption at rest.
const enc = new TextEncoder();
const dec = new TextDecoder();

const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function dataKeyConfigured(env) {
  try {
    return !!env.DATA_ENCRYPTION_KEY && fromB64(env.DATA_ENCRYPTION_KEY).length === 32;
  } catch {
    return false;
  }
}

async function key(env) {
  if (!dataKeyConfigured(env)) throw new Error('DATA_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  return crypto.subtle.importKey('raw', fromB64(env.DATA_ENCRYPTION_KEY), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

// `aad` binds a ciphertext to its storage key so records cannot be swapped.
export async function encryptJSON(env, value, aad) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: enc.encode(aad) },
    await key(env),
    enc.encode(JSON.stringify(value))
  );
  return { v: 1, iv: toB64(iv), ct: toB64(ct) };
}

export async function decryptJSON(env, blob, aad) {
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(blob.iv), additionalData: enc.encode(aad) },
    await key(env),
    fromB64(blob.ct)
  );
  return JSON.parse(dec.decode(pt));
}
