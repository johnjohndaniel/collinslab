// Signed session cookie: base64url(JSON payload) + "." + base64url(HMAC-SHA256).
const COOKIE = 'cl_session';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const enc = new TextEncoder();

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => {
  const b = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b + '='.repeat((4 - (b.length % 4)) % 4)), (c) => c.charCodeAt(0));
};

async function hmacKey(secret) {
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET missing or too short');
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function createSessionCookie(env, email) {
  const payload = b64url(enc.encode(JSON.stringify({ email, exp: Math.floor(Date.now() / 1000) + MAX_AGE })));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(env.SESSION_SECRET), enc.encode(payload));
  return `${COOKIE}=${payload}.${b64url(sig)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`;
}

export const clearSessionCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

// Returns the signed-in email, or null. Also re-checks the allowlist so
// changing ALLOWED_EMAIL immediately locks out old sessions.
export async function readSession(request, env) {
  const raw = (request.headers.get('Cookie') || '').split(/;\s*/).find((c) => c.startsWith(COOKIE + '='));
  if (!raw) return null;
  const [payload, sig] = raw.slice(COOKIE.length + 1).split('.');
  if (!payload || !sig) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(env.SESSION_SECRET), unb64url(sig), enc.encode(payload));
    if (!ok) return null;
    const { email, exp } = JSON.parse(new TextDecoder().decode(unb64url(payload)));
    if (!email || exp < Date.now() / 1000) return null;
    return isAllowed(env, email) ? email : null;
  } catch {
    return null;
  }
}

export function isAllowed(env, email) {
  const allowed = (env.ALLOWED_EMAIL || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(String(email).toLowerCase());
}
