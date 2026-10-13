// Shared password-gate logic. Uses only Web Crypto so it runs unchanged in
// Netlify Edge Functions (Deno) and Netlify Functions (Node).
const enc = new TextEncoder();

export const COOKIE = 'aimsir_session';
export const DEFAULT_SESSION_DAYS = 7;

const b64u = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function sha256Hex(s) {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}

// Constant-time string comparison (over equal-length digests).
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

// The gate fails closed: without a strong password and signing secret nothing is served.
export function gateConfigured(env) {
  return !!(env.APP_PASSWORD && env.APP_PASSWORD.length >= 8 && env.SESSION_SECRET && env.SESSION_SECRET.length >= 32);
}

export async function checkPassword(env, input) {
  if (!gateConfigured(env) || typeof input !== 'string') return false;
  const [a, b] = await Promise.all([sha256Hex(input), sha256Hex(env.APP_PASSWORD)]);
  return safeEqual(a, b);
}

// The signature covers a fingerprint of the current password, so changing
// APP_PASSWORD in Netlify signs every existing session out.
async function sign(env, exp) {
  const fp = await sha256Hex(env.APP_PASSWORD);
  return hmac(env.SESSION_SECRET, `v1.${exp}.${fp}`);
}

export function sessionDays(env) {
  const n = Number(env.SESSION_DAYS);
  return Number.isFinite(n) && n > 0 && n <= 30 ? n : DEFAULT_SESSION_DAYS;
}

export async function makeToken(env, now = Date.now()) {
  const exp = Math.floor(now / 1000) + Math.round(sessionDays(env) * 86400);
  return `${exp}.${await sign(env, exp)}`;
}

export async function verifyToken(env, token, now = Date.now()) {
  if (!gateConfigured(env) || typeof token !== 'string') return false;
  if (token.startsWith('u.')) return verifyUserToken(env, token, now);
  const [exp, sig] = token.split('.');
  if (!/^\d+$/.test(exp || '') || !sig || Number(exp) < Math.floor(now / 1000)) return false;
  return safeEqual(sig, await sign(env, exp));
}

// ---- Email sign-in (Supabase Auth) -------------------------------------
// Supabase only proves who the person is. Once it has, the server issues its
// own signed cookie, so no Supabase token is ever kept or sent to the browser.
export const DEFAULT_EMAIL_SESSION_HOURS = 12;

export function emailLoginConfigured(env) {
  return /^https:\/\/[^/\s]+$/.test(env.SUPABASE_URL || '') && !!env.SUPABASE_PUBLISHABLE_KEY;
}

export function emailSessionSeconds(env) {
  const n = Number(env.EMAIL_SESSION_HOURS);
  return Math.round((Number.isFinite(n) && n > 0 && n <= 168 ? n : DEFAULT_EMAIL_SESSION_HOURS) * 3600);
}

// Optional extra lock: when ALLOWED_EMAILS is set, only those addresses get in,
// even if someone manages to create a Supabase account.
export function emailAllowed(env, email) {
  const list = String(env.ALLOWED_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  return list.length === 0 || list.includes(String(email).toLowerCase());
}

async function signUser(env, exp, uid) {
  return hmac(env.SESSION_SECRET, `u1.${exp}.${uid}`);
}

// Stable, non-reversible key for a Supabase user; names that user's profile record.
export const userKey = async (userId) => (await sha256Hex(String(userId))).slice(0, 32);

export async function makeUserToken(env, userId, now = Date.now()) {
  const uid = await userKey(userId);
  const exp = Math.floor(now / 1000) + emailSessionSeconds(env);
  return `u.${exp}.${uid}.${await signUser(env, exp, uid)}`;
}

async function verifyUserToken(env, token, now) {
  const [, exp, uid, sig] = token.split('.');
  if (!/^\d+$/.test(exp || '') || !/^[0-9a-f]{32}$/.test(uid || '') || !sig || Number(exp) < Math.floor(now / 1000)) return false;
  return safeEqual(sig, await signUser(env, exp, uid));
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

// The signed-in email user's key, or null for a board-password session.
export async function userIdFromRequest(env, req) {
  const token = parseCookies(req.headers.get('cookie') || '')[COOKIE];
  return typeof token === 'string' && token.startsWith('u.') && (await verifyToken(env, token)) ? token.split('.')[2] : null;
}

export const isAuthed = (env, req) => verifyToken(env, parseCookies(req.headers.get('cookie') || '')[COOKIE]);

export function sessionCookie(env, token, secure, maxAgeSeconds) {
  const age = token ? maxAgeSeconds ?? Math.round(sessionDays(env) * 86400) : 0;
  return `${COOKIE}=${token || ''}; Path=/; Max-Age=${age}; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
}
