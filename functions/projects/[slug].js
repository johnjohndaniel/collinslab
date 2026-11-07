// /projects/<slug>/ -> the shared project page; it reads the slug from the URL.
export async function onRequestGet({ request, env, params }) {
  if (!/^[a-z0-9-]{1,60}$/.test(params.slug)) return new Response('Not found', { status: 404 });
  const url = new URL(request.url);
  if (!url.pathname.endsWith('/')) return Response.redirect(`${url.origin}/projects/${params.slug}/`, 301);
  return env.ASSETS.fetch(new URL('/projects/view/', url.origin));
}
