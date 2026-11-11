// /manuscripts/<slug>/ -> the shared manuscript page; it reads the slug from the URL.
export async function onRequestGet({ request, env, params }) {
  if (!/^[a-z0-9-]{1,80}$/.test(params.slug)) return new Response('Not found', { status: 404 });
  const url = new URL(request.url);
  if (!url.pathname.endsWith('/')) return Response.redirect(`${url.origin}/manuscripts/${params.slug}/`, 301);
  return env.ASSETS.fetch(new URL('/manuscripts/view/', url.origin));
}
