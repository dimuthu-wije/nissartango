// The values the editor needs to talk to Supabase from a browser, chosen by
// the origin this page was served from. See target.js for why the origin
// decides and nothing else does.
//
//     https://editor.nissartango.fr   -> production   eqcgeqzzuzcwrflwasjo
//     http://localhost:3000           -> dev          hjsekipqryfuwdkhxuks
//
// Until 2026-09-23 this file hard-coded production, which meant every exercise
// of the editor -- every sign-in, every form, every moderation decision made
// while trying something out -- happened against the live agenda. There was no
// other way to run it.
//
// BOTH KEYS ARE PUBLIC, and that is the design rather than a compromise. A
// publishable key identifies a project; it grants nothing on its own. What a
// caller may read or write is decided by RLS against the JWT they present, on
// every request, in the database.
//
// What must NEVER appear here: an sb_secret_ key, a database connection
// string, a service_role token. Those bypass RLS entirely. See
// supabase/PROJECT_SETUP.md, "The repository is PUBLIC".
//
// A CORRECTION. This file used to say it "is generated from"
// workers/cron/wrangler.jsonc "so there is one source of truth rather than two
// that can drift". No such generator has ever existed -- they were two
// hand-copied literals that happened to agree, which is precisely the drift
// the sentence claimed to prevent. tests/editor-config.test.js now compares
// them, so the claim is enforced by something that can fail instead of by a
// comment.

import { projectFor } from '/target.js';

const project = projectFor(location.hostname);

export const SUPABASE_URL = project.url;
export const SUPABASE_ANON_KEY = project.anonKey;

// Where a magic link is told to land. Must be allow-listed in that project's
// dashboard under Authentication -> URL Configuration; a value that is not
// allow-listed is silently replaced with site_url rather than refused, which
// is why the editor handles an arrival at "/" as well as at /auth/callback.
export const REDIRECT_TO = project.redirectTo;

// Which project this page is pointed at, for anything that wants to SAY so.
// The editor shows it when it is not production, because the single most
// expensive mistake available here is doing dev work against the live agenda
// without noticing.
export const PROJECT_NAME = project.name;
export const PROJECT_REF = project.ref;
export const IS_PRODUCTION = project.ref === 'eqcgeqzzuzcwrflwasjo';
