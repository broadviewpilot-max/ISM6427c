// Every request passes through this gate. Without a valid session cookie the
// only things served are the sign-in page and the sign-in API call.
import { gateConfigured, isAuthed } from '../lib/auth.mjs';

const PUBLIC = new Set(['/login.html', '/login.js', '/theme.js', '/styles.css', '/favicon.svg', '/robots.txt', '/api/login']);

export default async (request, context) => {
  const env = { APP_PASSWORD: Netlify.env.get('APP_PASSWORD'), SESSION_SECRET: Netlify.env.get('SESSION_SECRET'), SESSION_DAYS: Netlify.env.get('SESSION_DAYS') };
  const { pathname } = new URL(request.url);

  if (!gateConfigured(env)) {
    return new Response('This site is not configured yet. The administrator must set APP_PASSWORD and SESSION_SECRET in Netlify.', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
  if (PUBLIC.has(pathname)) return context.next();
  if (await isAuthed(env, request)) {
    const res = await context.next();
    res.headers.set('cache-control', 'no-store');
    return res;
  }
  if (pathname.startsWith('/api/')) {
    return new Response(JSON.stringify({ error: 'Please sign in.' }), { status: 401, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  }
  return new Response(null, { status: 302, headers: { location: '/login.html', 'cache-control': 'no-store' } });
};

export const config = { path: '/*' };
