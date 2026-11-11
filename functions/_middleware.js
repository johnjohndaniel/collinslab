// Gatekeeper for the whole site: only the front page, the login flow and
// static bundles are public; everything else needs a valid session.
import { readSession } from './_lib/session.js';

const PUBLIC_EXACT = new Set(['/', '/index.html', '/favicon.svg', '/robots.txt', '/login', '/login/', '/login/index.html']);
const PUBLIC_PREFIX = ['/assets/', '/auth/', '/readingframe/'];  // Google requires the app's home + privacy pages to be public

const isPublic = (path) => PUBLIC_EXACT.has(path) || PUBLIC_PREFIX.some((p) => path.startsWith(p));

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // One canonical host, so the Google sign-in origin and the cookie always match.
  if (url.hostname === 'www.collinslab.dev') {
    url.hostname = 'collinslab.dev';
    return Response.redirect(url.toString(), 301);
  }

  // Cross-site write protection: state-changing requests must come from this origin.
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) return new Response('Forbidden', { status: 403 });
  }

  if (!isPublic(url.pathname)) {
    const email = await readSession(request, env);
    if (!email) {
      if (url.pathname.startsWith('/api/')) {
        return Response.json({ error: 'not signed in' }, { status: 401 });
      }
      const login = new URL('/login/', url.origin);
      login.searchParams.set('next', url.pathname + url.search);
      return Response.redirect(login.toString(), 302);
    }
    context.data.email = email;
  }

  const res = await context.next();
  const out = new Response(res.body, res);
  out.headers.set('X-Content-Type-Options', 'nosniff');
  out.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Private pages are never stored, except responses that already chose a private cache policy
  // (the brain feed's hash-pinned files). Shared caches never see private content either way.
  const cc = res.headers.get('Cache-Control') || '';
  if (!isPublic(url.pathname) && !cc.startsWith('private')) out.headers.set('Cache-Control', 'private, no-store');
  return out;
}
