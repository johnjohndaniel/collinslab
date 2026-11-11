// Brain feed, read-only, behind the sign-in gate (functions/_middleware.js).
//   GET /api/brain/meta                 v1/meta.json, never cached (it names the current hashes)
//   GET /api/brain/dashboard?v=<sha256>  v1/dashboard.json
//   GET /api/brain/graph?v=<sha256>      v1/graph.json
// The ETag is the SHA-256 of the body actually served, so a file caught mid-upload is never
// cached under the hash meta.json promises. When ?v matches it, the browser may keep the
// response for a year (private, immutable). Otherwise it must revalidate. Only R2 get() is used.
const FILES = { meta: 'v1/meta.json', dashboard: 'v1/dashboard.json', graph: 'v1/graph.json' };

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function onRequestGet({ request, env, params }) {
  const key = FILES[params.file];
  if (!key) return Response.json({ error: 'unknown file' }, { status: 404 });
  if (!env.BRAIN_FEED) return Response.json({ error: 'brain feed not bound' }, { status: 503 });
  const obj = await env.BRAIN_FEED.get(key);
  if (!obj) return Response.json({ error: 'not published yet' }, { status: 404 });
  const body = await obj.arrayBuffer();
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' };
  if (params.file === 'meta') return new Response(body, { headers: { ...headers, 'Cache-Control': 'private, no-store' } });

  const sha = hex(await crypto.subtle.digest('SHA-256', body));
  const etag = `"${sha}"`;
  const pinned = new URL(request.url).searchParams.get('v') === sha;
  headers.ETag = etag;
  headers['Cache-Control'] = pinned ? 'private, max-age=31536000, immutable' : 'private, no-cache';
  if ((request.headers.get('If-None-Match') || '').split(/\s*,\s*/).includes(etag)) return new Response(null, { status: 304, headers });
  return new Response(body, { headers });
}
