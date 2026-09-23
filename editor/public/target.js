// Which Supabase project this page talks to, decided by the ORIGIN it is
// served from.
//
// Split out of config.js so Node can test it, for the same reason pkce.js,
// expiry.js and consent.js are separate: no browser globals in here, just a
// hostname in and a project out.
//
// WHY THE ORIGIN DECIDES, and not an environment variable or a toggle.
//
// The editor is static assets with no build step -- that is deliberate
// (editor/wrangler.jsonc: no `main`, so there is no server-side code path that
// could hold a key). There is nothing to substitute a variable at build time,
// and a runtime toggle -- a query parameter, a localStorage flag, a menu --
// would mean the page served from editor.nissartango.fr could be pointed
// somewhere else by whatever set the flag. The origin cannot be set by the
// page. It is the one input that is not under the page's control, which is
// exactly what you want deciding this.
//
// So: the production origin always gets production, and it is not expressible
// any other way.
//
// WHY UNKNOWN HOSTS GET DEV. A preview deployment (editor/wrangler.jsonc sets
// preview_urls: true) is served from a hostname nobody listed here. Sending it
// to production would make every preview a production test, which is the thing
// this file exists to stop. Sending it to dev means `_headers`'s CSP --
// connect-src names production's origin and only that -- blocks the request
// visibly, in the console, instead of quietly editing the live agenda. A loud
// failure on a preview is a better outcome than a silent success against
// production.
//
// BOTH KEYS ARE PUBLIC. A publishable key identifies a project and grants
// nothing on its own; what a caller may read or write is decided by RLS
// against their JWT, on every request, in the database. What must NEVER appear
// here is an sb_secret_ key, a service_role token, or a connection string.

export const PROJECTS = {
  prod: {
    name: 'production',
    ref: 'eqcgeqzzuzcwrflwasjo',
    url: 'https://eqcgeqzzuzcwrflwasjo.supabase.co',
    anonKey: 'sb_publishable_skzfneinpRaYYqrpLvgYMw_rhaPUQ5E',
    redirectTo: 'https://editor.nissartango.fr/auth/callback',
  },
  dev: {
    name: 'dev',
    ref: 'hjsekipqryfuwdkhxuks',
    url: 'https://hjsekipqryfuwdkhxuks.supabase.co',
    anonKey: 'sb_publishable_H-FVZTnodP2tWgrGTRYkaQ_J0BEANOo',
    // Dev's Site URL is http://localhost:3000 -- the scaffold default, still
    // unchanged, measured 2026-09-23 with the /auth/v1/verify probe in
    // editor/README.md. That is why `npm run dev:editor` serves on 3000 and
    // not on whatever port was free: the port is part of the auth
    // configuration, and changing it means changing the dashboard.
    redirectTo: 'http://localhost:3000/auth/callback',
  },
};

/** The production origin, and nothing else, is production. */
export const PROD_HOST = 'editor.nissartango.fr';

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0']);

/**
 * @param {string} hostname  location.hostname -- no port, no scheme
 * @returns {'prod' | 'dev'}
 */
export function targetFor(hostname) {
  const h = String(hostname ?? '').toLowerCase();
  if (h === PROD_HOST) return 'prod';
  if (LOCAL.has(h) || h.endsWith('.localhost')) return 'dev';
  return 'dev';
}

/** The project this hostname talks to. */
export const projectFor = (hostname) => PROJECTS[targetFor(hostname)];
