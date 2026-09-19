// The two values the editor needs to talk to Supabase from a browser.
//
// BOTH ARE PUBLIC, and that is the design rather than a compromise. The
// publishable key identifies the project; it grants nothing on its own. What a
// caller may read or write is decided by RLS against the JWT they present, on
// every request, in the database. That is why the key can ship to a browser and
// sit in a public repo -- the same key is already committed in
// workers/cron/wrangler.jsonc, and this file is generated from it so there is
// one source of truth rather than two that can drift.
//
// What must NEVER appear here: an sb_secret_ key, a database connection
// string, a service_role token. Those bypass RLS entirely. See
// supabase/PROJECT_SETUP.md, "The repository is PUBLIC".
export const SUPABASE_URL = 'https://eqcgeqzzuzcwrflwasjo.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_skzfneinpRaYYqrpLvgYMw_rhaPUQ5E';

// Where a magic link is told to land. Allow-listed in the dashboard under
// Authentication -> URL Configuration; a value that is not allow-listed is
// silently replaced with site_url rather than refused.
export const REDIRECT_TO = 'https://editor.nissartango.fr/auth/callback';
