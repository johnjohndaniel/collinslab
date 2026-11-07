// Verify a Google Identity Services ID token (RS256 JWT) against Google's published keys.
const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
let cachedKeys = null; // { keys, expires }

const unb64url = (s) => {
  const b = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b + '='.repeat((4 - (b.length % 4)) % 4)), (c) => c.charCodeAt(0));
};
const json = (s) => JSON.parse(new TextDecoder().decode(unb64url(s)));

async function googleKeys() {
  if (cachedKeys && cachedKeys.expires > Date.now()) return cachedKeys.keys;
  const res = await fetch(CERTS_URL);
  if (!res.ok) throw new Error(`Google certs fetch failed: ${res.status}`);
  const maxAge = Number((res.headers.get('Cache-Control') || '').match(/max-age=(\d+)/)?.[1] || 3600);
  cachedKeys = { keys: (await res.json()).keys, expires: Date.now() + maxAge * 1000 };
  return cachedKeys.keys;
}

export async function verifyGoogleIdToken(token, clientId) {
  const parts = String(token).split('.');
  if (parts.length !== 3) throw new Error('malformed token');
  const [h, p, s] = parts;
  const header = json(h);
  if (header.alg !== 'RS256') throw new Error('unexpected alg');
  const jwk = (await googleKeys()).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('unknown signing key');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, unb64url(s), new TextEncoder().encode(`${h}.${p}`));
  if (!valid) throw new Error('bad signature');
  const claims = json(p);
  const now = Date.now() / 1000;
  if (!ISSUERS.includes(claims.iss)) throw new Error('bad issuer');
  if (claims.aud !== clientId) throw new Error('bad audience');
  if (!(claims.exp > now - 60)) throw new Error('expired');
  if (claims.email_verified !== true && claims.email_verified !== 'true') throw new Error('email not verified');
  return claims;
}
