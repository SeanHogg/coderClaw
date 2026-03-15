import type { APIRoute } from 'astro';

export const get: APIRoute = async ({ env, request }) => {
  const registry = env.SKILLS_REGISTRY_URL || 'https://api.builderforce.ai';
  const url = new URL(request.url);
  // forward query string
  const dest = new URL('/marketplace/skills', registry);
  dest.search = url.search;

  try {
    const res = await fetch(dest.toString(), {
      headers: { Accept: 'application/json' },
    });
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'proxy error' }), { status: 502, headers: { 'Content-Type': 'application/json' } });
  }
};
