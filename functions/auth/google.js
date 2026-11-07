import { verifyGoogleIdToken } from '../_lib/google.js';
import { createSessionCookie, isAllowed } from '../_lib/session.js';

export async function onRequestPost({ request, env }) {
  let credential;
  try {
    ({ credential } = await request.json());
  } catch {
    return Response.json({ error: 'expected JSON' }, { status: 400 });
  }
  let claims;
  try {
    claims = await verifyGoogleIdToken(credential, env.GOOGLE_CLIENT_ID);
  } catch (e) {
    console.log('google sign-in rejected:', e.message);
    return Response.json({ error: 'Sign-in rejected.' }, { status: 401 });
  }
  if (!isAllowed(env, claims.email)) {
    console.log('google sign-in for non-allowed account');
    return Response.json({ error: 'This Google account does not have access.' }, { status: 403 });
  }
  return Response.json({ ok: true, email: claims.email }, {
    headers: { 'Set-Cookie': await createSessionCookie(env, claims.email) },
  });
}
