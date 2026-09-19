#!/usr/bin/env node
/**
 * The ONLY thing in the public site that talks to Supabase.
 *
 * Runs before `astro build`, with the ANON key, against the same PostgREST
 * views the public API exposes — so a broken policy shows up as a failed build
 * here rather than as a leak in production. The service_role key is not used,
 * is not read, and would not help: everything this fetches is meant to be
 * public.
 *
 * It produces two things:
 *
 *   data/snapshot.json      committed to git. The backup for content that is
 *                           hand-entered over years and lives in a free-tier
 *                           database with thin backups, and the git-versioned
 *                           history the CMS migration otherwise gives up.
 *   src/assets/events/*     images pulled out of Storage so Astro can optimise
 *                           them and Cloudflare can serve them. Nothing in the
 *                           built HTML may point at supabase.co.
 *
 * Failure policy: LOUD. If the database is unreachable the build stops, and
 * Cloudflare keeps serving the previous deployment — a correct site and an
 * alert, rather than a stale one published over a good one. Building from the
 * snapshot is possible but must be asked for:
 *
 *   npm run build -- --from-snapshot        (or FROM_SNAPSHOT=1)
 */

import { writeFile, readFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import {
  projectRef, productionRef, snapshotFileFor, currentSnapshotPath, POINTER,
} from '../src/lib/snapshot-path.mjs';
import { renderRedirects } from '../src/lib/redirects.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const REDIRECTS = path.join(ROOT, 'public', '_redirects');
const IMAGE_DIR = path.join(ROOT, 'src', 'assets', 'events');

const fromSnapshot =
  process.argv.includes('--from-snapshot') || process.env.FROM_SNAPSHOT === '1';

// --- env -------------------------------------------------------------------
// Read .env ourselves: this script runs before Astro, so import.meta.env does
// not exist yet, and --env-file behaviour differs across Node versions.
function loadEnvFile() {
  const file = path.join(ROOT, '.env');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const value = m[2].replace(/^["']|["']$/g, '');
    if (!(m[1] in process.env)) process.env[m[1]] = value;
  }
}

/**
 * Failing that, ask the running local stack. `supabase status -o env` already
 * knows both values, so a developer never has to find a dotfile and paste a
 * JWT into it -- a step that has gone wrong every single time it has been
 * asked for in this project. .env stays the mechanism for CI and Cloudflare,
 * where there is no CLI to ask.
 */
function loadFromRunningStack() {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) return;
  try {
    const out = execFileSync('supabase', ['status', '-o', 'env'],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    for (const line of out.split('\n')) {
      const m = line.match(/^([A-Z_]+)="?(.*?)"?$/);
      if (!m) continue;
      if (m[1] === 'API_URL' && !process.env.SUPABASE_URL) process.env.SUPABASE_URL = m[2];
      // ANON_KEY is the legacy JWT; PUBLISHABLE_KEY is what newer stacks
      // print. Either is the public key, and either is fine here.
      if ((m[1] === 'ANON_KEY' || m[1] === 'PUBLISHABLE_KEY') && !process.env.SUPABASE_ANON_KEY) {
        process.env.SUPABASE_ANON_KEY = m[2];
      }
    }
    if (process.env.SUPABASE_URL) log('using the running local stack (supabase status)');
  } catch {
    // No CLI, or no stack running. The error below says what to do.
  }
}

loadEnvFile();
loadFromRunningStack();

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY ?? '';

// The public build uses the PUBLIC key on purpose: it exercises the same
// policies the public API does, so a broken policy fails the build instead of
// leaking. A secret key bypasses RLS and would cheerfully publish pending
// events -- the one outcome this whole architecture exists to prevent.
if (/^sb_secret_/.test(ANON_KEY) || /service_role/.test(ANON_KEY)) {
  console.error('\n[content] BUILD STOPPED\nA secret key was supplied. Use the anon / publishable key.\n');
  process.exit(1);
}

// --- helpers ---------------------------------------------------------------
const log = (...a) => console.log('[content]', ...a);
const die = (msg) => {
  console.error(`\n[content] BUILD STOPPED\n${msg}\n`);
  process.exit(1);
};

async function rest(pathAndQuery) {
  const url = `${SUPABASE_URL}/rest/v1/${pathAndQuery}`;
  const res = await fetch(url, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} on ${pathAndQuery}\n${await res.text()}`);
  }
  return res.json();
}

// --- fetch -----------------------------------------------------------------
async function fetchFromSupabase() {
  if (!SUPABASE_URL || !ANON_KEY) {
    die(`SUPABASE_URL / SUPABASE_ANON_KEY are not set, and no local stack answered.

Locally, the simplest fix is to start the stack -- this script reads
\`supabase status\` by itself, so there is nothing to copy:

    supabase start

For a hosted project (or CI), put them in .env at the repo root:

    SUPABASE_URL=https://YOUR-REF.supabase.co
    SUPABASE_ANON_KEY=eyJ...

The anon key is public by design; RLS is what protects the data. It is still
kept out of git, and out of the built output -- npm run verify:build fails if
a JWT-shaped string reaches dist/.`);
  }

  // The checksum is read FIRST, before the content, and the ordering is the
  // whole point.
  //
  // The poller compares this recorded value against the database's current
  // one. If content changed between the two reads, then recording the LATER
  // checksum would describe content this build never saw: the poller would
  // see no drift and the site would stay stale until the daily rebuild.
  // Recording the EARLIER one describes content at most as new as what was
  // built, so the same race produces one extra rebuild instead. Both orders
  // are wrong under a race; only one of them is wrong in the safe direction.
  const [summary] = await rest('content_checksum?select=*');
  if (!summary?.checksum) {
    die(`content_checksum returned nothing.

That view is how the rebuild poller knows whether the deployed site is
current. Building without it would publish a build-info.json with a null
checksum, which the poller reads as permanent drift.`);
  }

  const events = await rest(
    'events_public?select=*&order=starts_at.asc');
  const organizers = await rest(
    'organizers_public?select=*&order=name.asc');
  const exceptions = await rest(
    'event_exceptions_public?select=*&order=occurrence_date.asc');

  // A canary, not a formality: if a policy change ever exposed a private
  // column through these views, the build should stop rather than publish it.
  for (const o of organizers) {
    for (const forbidden of ['email', 'phone']) {
      if (forbidden in o) {
        die(`organizers_public returned a "${forbidden}" column.
That view is supposed to be the privacy boundary. Something changed in the
database; do not publish this build.`);
      }
    }
  }
  for (const e of events) {
    if (e.status && e.status !== 'approved') {
      die(`events_public returned an event with status="${e.status}" (${e.slug}).
The view is supposed to filter to approved only.`);
    }
  }

  // Counts are cheap corroboration: if the digest was computed over a
  // different row set than the one fetched, this is where it shows.
  if (Number(summary.n_events) !== events.length) {
    log(`WARNING: content changed mid-fetch (checksum saw ${summary.n_events} ` +
        `events, the fetch got ${events.length}). The next poll will rebuild.`);
  }

  return {
    fetched_at: new Date().toISOString(),
    // Which project this content came from, recorded so the deployed site can
    // be ASKED rather than assumed. A poller pointed at a different project
    // than the build would see drift that no rebuild can ever resolve.
    project_ref: projectRef(SUPABASE_URL),
    checksum: summary.checksum,
    counts: {
      events: summary.n_events,
      organizers: summary.n_organizers,
      exceptions: summary.n_exceptions,
    },
    events, organizers, exceptions,
  };
}

// --- images ----------------------------------------------------------------
/** `0a00…/e000…/affiche.jpg` -> `0a00…-e000…-affiche.jpg` */
const flatten = (storagePath) => storagePath.replace(/[^a-zA-Z0-9._-]+/g, '-');

async function downloadImages(events, { prune = true } = {}) {
  await mkdir(IMAGE_DIR, { recursive: true });
  const wanted = new Map();

  for (const e of events) {
    if (!e.image_path) continue;
    wanted.set(flatten(e.image_path), e.image_path);
  }

  // Remove files for images that are no longer referenced, so a deleted flyer
  // does not linger forever.
  //
  // Only a PRODUCTION build prunes. src/assets/events is one directory shared
  // by every project, and a dev build pruning it would delete the flyers the
  // `--from-snapshot` emergency path needs -- an emergency deploy that comes
  // out without its images. Adding is harmless; deleting is not.
  for (const existing of prune ? await readdir(IMAGE_DIR).catch(() => []) : []) {
    if (existing !== '.gitkeep' && !wanted.has(existing)) {
      await unlink(path.join(IMAGE_DIR, existing));
      log(`removed unused image ${existing}`);
    }
  }

  for (const [file, storagePath] of wanted) {
    const dest = path.join(IMAGE_DIR, file);
    if (existsSync(dest)) continue;   // content-addressed by path; cheap rebuilds

    const url = `${SUPABASE_URL}/storage/v1/object/event-images/${storagePath}`;
    const res = await fetch(url, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    });
    if (!res.ok) {
      die(`could not download ${storagePath} (${res.status}).
The bucket is private and readable via an anon policy; if this is a 400 or
403, that policy is the thing to look at.`);
    }
    await writeFile(dest, Buffer.from(await res.arrayBuffer()));
    log(`downloaded ${file}`);
  }
  return wanted;
}

// --- main ------------------------------------------------------------------
let snapshot;
let readFrom = null;   // set when building --from-snapshot

if (fromSnapshot) {
  readFrom = currentSnapshotPath(ROOT);
  if (!existsSync(readFrom)) die(`--from-snapshot, but ${path.relative(ROOT, readFrom)} does not exist.`);
  snapshot = JSON.parse(await readFile(readFrom, 'utf8'));
  log(`building from the snapshot of ${snapshot.fetched_at} — NOT live data`);
} else {
  try {
    snapshot = await fetchFromSupabase();
  } catch (err) {
    die(`could not reach Supabase.

${err.message}

The previous deployment is still serving, which is the correct outcome: a
failed build changes nothing. Fix the cause, or build the last known content
deliberately with:

    npm run build -- --from-snapshot
`);
  }
  // Named after the project it came from. data/snapshot.json is PRODUCTION's
  // and is committed; every other project writes data/snapshot.<ref>.json,
  // which .gitignore covers. So a build against dev cannot overwrite the
  // backup of production's content, and there is no flag to remember.
  await mkdir(DATA_DIR, { recursive: true });
}

// Where this build's content belongs, and the pointer that tells the rest of
// the build which file to read. The pointer is gitignored, so a fresh clone --
// and any `--from-snapshot` that has never fetched -- falls back to
// production's committed snapshot, which is the right default for the
// emergency path.
const SNAPSHOT_FILE = readFrom
  ? path.basename(readFrom)
  : snapshotFileFor(snapshot.project_ref, ROOT);
const SNAPSHOT = path.join(DATA_DIR, SNAPSHOT_FILE);
const IS_PRODUCTION = SNAPSHOT_FILE === 'snapshot.json';
if (!fromSnapshot) {
  await writeFile(SNAPSHOT, JSON.stringify(snapshot, null, 2) + '\n');
  await writeFile(path.join(DATA_DIR, POINTER), SNAPSHOT_FILE + '\n');
  if (!IS_PRODUCTION) {
    log(`project ${snapshot.project_ref} is not production (${productionRef(ROOT)}); ` +
        `wrote data/${SNAPSHOT_FILE}, leaving data/snapshot.json alone`);
  }
}

const files = await downloadImages(snapshot.events, { prune: IS_PRODUCTION }).catch((err) => {
  if (fromSnapshot) {
    log(`WARNING: images not refreshed (${err.message})`);
    return new Map();
  }
  throw err;
});

// Record the local filename on each event so the pages can resolve it without
// knowing anything about Storage.
for (const e of snapshot.events) {
  e.image_file = e.image_path ? flatten(e.image_path) : null;
}
await writeFile(SNAPSHOT, JSON.stringify(snapshot, null, 2) + '\n');

// Legacy URLs come from content now, not from a file somebody maintains.
//
// This runs for --from-snapshot too: the rules are derived from
// snapshot.events either way, so the emergency path publishes the same
// redirects as a live fetch rather than whatever happened to be on disk.
//
// A throw here is correct. renderRedirects only refuses when a rule would be
// worse than no rule -- a legacy slug shadowing a published event, or two
// events claiming the same one -- and publishing that is worse than not
// publishing at all.
const redirects = renderRedirects(snapshot.events);
if (redirects) {
  await writeFile(REDIRECTS, redirects);
} else {
  // No legacy slugs anywhere. Remove any file a previous build left, so a
  // stale rule cannot outlive the content that justified it.
  await unlink(REDIRECTS).catch(() => {});
}
const ruleCount = redirects
  ? redirects.split('\n').filter((l) => l.trim() && !l.startsWith('#')).length
  : 0;

log(`${snapshot.events.length} events, ${snapshot.organizers.length} organizers, ` +
    `${snapshot.exceptions.length} exceptions, ${files.size} images, ` +
    `${ruleCount} redirect rule(s)`);
