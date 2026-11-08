// /bookstore/cover/<openlibrary cover id> -> the cover image, cached at Cloudflare's edge for 30 days.
// Same-origin, so three.js can use it as a texture without CORS trouble.
export async function onRequestGet({ params }) {
  if (!/^\d{1,12}$/.test(params.id)) return new Response('Bad cover id', { status: 400 });
  const res = await fetch(`https://covers.openlibrary.org/b/id/${params.id}-L.jpg?default=false`, {
    headers: { 'User-Agent': 'collinslab-bookstore/1.0' },
    cf: { cacheTtl: 60 * 60 * 24 * 30, cacheEverything: true },
  });
  if (!res.ok) return new Response('No cover', { status: 404, headers: { 'Cache-Control': 'public, max-age=86400' } });
  return new Response(res.body, {
    headers: { 'Content-Type': res.headers.get('Content-Type') || 'image/jpeg', 'Cache-Control': 'public, max-age=2592000, immutable' },
  });
}
