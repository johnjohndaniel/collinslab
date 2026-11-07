import { readSession } from '../_lib/session.js';

// Public endpoint so the front page can show "Sign in" vs "Signed in as …".
export const onRequestGet = async ({ request, env }) =>
  Response.json({ email: await readSession(request, env) }, { headers: { 'Cache-Control': 'no-store' } });
