import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

/**
 * Every <loc> is the trailing-slash form, which is what the server returns 200
 * for. Submitting URLs that redirect wastes crawl budget and muddies which URL
 * is the real one.
 *
 * Hand-rolled rather than @astrojs/sitemap: the URL set here is small and
 * known, and lastmod should come from the database's updated_at rather than
 * from build time -- otherwise every daily rebuild claims every page changed,
 * which is exactly the signal a crawler learns to ignore.
 */
export const GET: APIRoute = async ({ site }) => {
  const events = await getCollection('events');

  const urls = [
    { loc: new URL('/', site).href, lastmod: null as string | null, priority: '1.0' },
    ...events.map((e) => ({
      loc: new URL(`/evenements/${e.data.slug}/`, site).href,
      lastmod: (e.data.updated_at ?? e.data.created_at ?? null)?.slice(0, 10) ?? null,
      priority: '0.8',
    })),
  ];

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url>
    <loc>${u.loc}</loc>${u.lastmod ? `
    <lastmod>${u.lastmod}</lastmod>` : ''}
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>
`;

  return new Response(body, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
