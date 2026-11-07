import { clearSessionCookie } from '../_lib/session.js';

export const onRequestPost = () => new Response(null, {
  status: 303,
  headers: { Location: '/', 'Set-Cookie': clearSessionCookie() },
});
