#!/usr/bin/env node
/**
 * Checks the BUILT OUTPUT, which is the only artefact that matters.
 *
 * The brief's hardest requirement -- "nothing in the public path may call
 * Supabase at runtime, including images" -- is not something you can verify by
 * reading source. You verify it by grepping dist/. So this runs after a build
 * and fails if anything reintroduces a runtime dependency.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const DIST = path.resolve('dist');
let failures = 0;
const fail = (m) => { console.error(`  FAIL  ${m}`); failures++; };
const ok = (m) => console.log(`  ok    ${m}`);

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p));
    else out.push(p);
  }
  return out;
}

const files = await walk(DIST).catch(() => []);
if (!files.length) { console.error('dist/ is empty — run the build first'); process.exit(1); }

// --- is this output even from the current build? ---------------------------
// Verifying a stale dist/ is worse than not verifying: it reports failures
// that were fixed, or passes that no longer hold. Two cheap guards.
const oldLayout = files.some((f) => {
  const r = path.relative(DIST, f);
  return r.startsWith('client' + path.sep) || r.startsWith('server' + path.sep);
});
if (oldLayout) {
  console.error(`dist/ contains client/ and server/ directories.

That is the Cloudflare ADAPTER's output layout, from a build made before
stage 3. Whatever is in there, it is not what this repo builds now.

    rm -rf dist && npm run build && npm run verify:build
`);
  process.exit(1);
}

const index = files.find((f) => path.relative(DIST, f) === 'index.html');
const snapshotPath = path.resolve('data/snapshot.json');
try {
  const [built, fetched] = await Promise.all([stat(index), stat(snapshotPath)]);
  if (built.mtimeMs < fetched.mtimeMs) {
    console.error(`dist/index.html is older than data/snapshot.json.

The content was refreshed after this build, so these pages do not reflect it.

    npm run build && npm run verify:build
`);
    process.exit(1);
  }
} catch {
  // no snapshot yet, or no index.html: the checks below will say so.
}

const html = files.filter((f) => f.endsWith('.html'));
const rel = (f) => path.relative(DIST, f);

console.log(`\nverifying ${files.length} files in dist/ (${html.length} pages)\n`);

// 1. No Supabase anywhere in the output, including image srcs.
let leaks = [];
for (const f of files) {
  if (/\.(png|jpe?g|webp|avif|ico|woff2?)$/.test(f)) continue;
  const text = await readFile(f, 'utf8');
  for (const needle of ['supabase.co', 'supabase.in', '/rest/v1/', '/storage/v1/']) {
    if (text.includes(needle)) leaks.push(`${rel(f)} contains "${needle}"`);
  }
}
leaks.length ? leaks.forEach(fail) : ok('no supabase.co / rest / storage references in dist/');

// 2. No API key of any shape in the output. The publishable one is public by
//    design and STILL has no business being shipped: nothing in the built site
//    is allowed to call the API. A secret key is a different order of problem,
//    so it is named separately.
const KEY_SHAPES = [
  [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, 'a JWT'],
  [/sb_publishable_[A-Za-z0-9_-]{10,}/, 'a publishable key'],
  [/sb_secret_[A-Za-z0-9_-]{6,}/, 'a SECRET key'],
  [/service_role/, 'the words "service_role"'],
];
let keys = [];
for (const f of files.filter((f) => /\.(html|js|json|xml|txt|css|svg)$/.test(f))) {
  const text = await readFile(f, 'utf8');
  for (const [re, what] of KEY_SHAPES) if (re.test(text)) keys.push(`${rel(f)} contains ${what}`);
}
keys.length ? keys.forEach(fail) : ok('no API keys of any shape in dist/');

// 3. Zero client JavaScript by default.
const scripts = files.filter((f) => f.endsWith('.js') || f.endsWith('.mjs'));
scripts.length
  ? fail(`${scripts.length} JS file(s) shipped: ${scripts.map(rel).join(', ')}`)
  : ok('no client-side JavaScript');

for (const f of html) {
  const text = await readFile(f, 'utf8');
  const tags = [...text.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
  const bad = tags.filter((t) => !t.includes('application/ld+json'));
  if (bad.length) fail(`${rel(f)} has a <script> tag: ${bad[0]}`);
}

// 4. Canonical on every page.
for (const f of html) {
  const text = await readFile(f, 'utf8');
  if (!/<link rel="canonical" href="https:\/\/[^"]+"/.test(text)) {
    fail(`${rel(f)} has no canonical URL`);
  }
}
ok('every page has a canonical URL');

// 5. Event pages carry valid schema.org Event JSON-LD with a real offset.
//
//    A recurring series emits one Event per visible date inside an @graph, so
//    every node is checked, not just the first. That is the point of the
//    change: a series whose 22 October is cancelled must SAY so, and a single
//    node covering the whole series cannot.
const eventPages = html.filter((f) => rel(f).startsWith('evenements' + path.sep));
if (!eventPages.length) fail('no event detail pages were generated');

/** Every Event object in a page's JSON-LD, whether bare or inside an @graph. */
function ldEvents(data) {
  const list = Array.isArray(data) ? data : data['@graph'] ?? [data];
  return list.filter((n) => n && n['@type'] === 'Event');
}

let ldNodeCount = 0;
const ldUrls = [];          // fed to check 8
for (const f of eventPages) {
  const text = await readFile(f, 'utf8');
  const m = text.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) { fail(`${rel(f)} has no JSON-LD`); continue; }
  let data;
  try { data = JSON.parse(m[1]); } catch { fail(`${rel(f)} JSON-LD is not valid JSON`); continue; }

  const nodes = ldEvents(data);
  if (!nodes.length) { fail(`${rel(f)} JSON-LD contains no Event`); continue; }
  ldNodeCount += nodes.length;

  const seenIds = new Set();
  for (const n of nodes) {
    const where = `${rel(f)} [${n.startDate ?? '?'}]`;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(n.startDate ?? '')) {
      fail(`${where} startDate lacks a UTC offset`);
    }
    if (n.location?.['@type'] !== 'Place') fail(`${where} location is not a Place`);
    if (n.location?.address?.['@type'] !== 'PostalAddress') fail(`${where} address is not a PostalAddress`);
    if (!/^https:\/\/schema\.org\/Event(Scheduled|Cancelled|Rescheduled|MovedOnline|Postponed)$/.test(n.eventStatus ?? '')) {
      fail(`${where} has no usable eventStatus: ${n.eventStatus}`);
    }
    // Cancelled and on sale at the same time is a contradiction aggregators act on.
    if (n.eventStatus === 'https://schema.org/EventCancelled' && n.offers) {
      fail(`${where} is EventCancelled but still carries offers`);
    }
    if (n.eventStatus === 'https://schema.org/EventRescheduled' && !n.previousStartDate) {
      fail(`${where} is EventRescheduled without previousStartDate`);
    }
    // Multiple nodes on one page must be distinguishable, or a consumer
    // collapses them into one and the extra dates are lost.
    if (nodes.length > 1) {
      if (!n['@id']) fail(`${where} is one of ${nodes.length} Events but has no @id`);
      else if (seenIds.has(n['@id'])) fail(`${where} repeats @id ${n['@id']}`);
      seenIds.add(n['@id']);
    }
    // A fragment @id has to land somewhere: the list item must carry the id.
    for (const u of [n['@id'], n.url]) {
      if (!u) continue;
      ldUrls.push([rel(f), u]);
      const hash = u.includes('#') ? u.slice(u.indexOf('#') + 1) : null;
      if (hash && !text.includes(`id="${hash}"`)) {
        fail(`${where} points at #${hash}, which is not an id on the page`);
      }
    }
    for (const o of n.offers ?? []) if (o.url) ldUrls.push([rel(f), o.url]);
  }
}
ok(`${eventPages.length} event page(s), ${ldNodeCount} Event node(s), offsets and statuses checked`);

// 6. Sitemap covers every event page.
//
// Comparing the raw directory name is not enough: `new URL()` percent-encodes
// non-ASCII, and sitemaps.org requires URL-escaped entries, so a legacy slug
// like ...-précédée-... appears as ...-pr%C3%A9c%C3%A9d%C3%A9e-... in the XML
// while the directory on disk keeps its accents. Both spellings are the same
// URL; accept either.
//
// (Only imported slugs look like this. public.slugify() folds accents, so
// anything created from now on is ASCII.)
const sitemapFile = files.find((f) => rel(f) === 'sitemap.xml');
if (!sitemapFile) fail('no sitemap.xml');
else {
  const xml = await readFile(sitemapFile, 'utf8');
  let missing = 0;
  for (const f of eventPages) {
    const slug = path.basename(path.dirname(rel(f)));
    const raw = `/evenements/${slug}`;
    const encoded = `/evenements/${encodeURIComponent(slug)}`;
    if (!xml.includes(raw) && !xml.includes(encoded)) {
      fail(`sitemap.xml is missing ${slug}`);
      missing++;
    }
  }
  const locs = (xml.match(/<loc>/g) ?? []).length;
  if (locs !== eventPages.length + 1) {
    fail(`sitemap.xml has ${locs} <loc> entries; expected ${eventPages.length + 1} (${eventPages.length} events + the agenda)`);
  } else if (!missing) {
    ok(`sitemap.xml lists all ${locs} URLs`);
  }
}

// 7. Every redirect destination must actually exist. A 301 into a 404 is
//    worse than no redirect: it launders a dead link into a live-looking one,
//    and search engines follow it before discovering the page is gone.
const redirectsFile = files.find((f) => rel(f) === '_redirects');
if (redirectsFile) {
  const lines = (await readFile(redirectsFile, 'utf8'))
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('/'));

  let bad = 0;
  for (const line of lines) {
    const [, dest] = line.split(/\s+/);
    if (!dest || !dest.startsWith('/')) continue;
    const target = decodeURIComponent(dest.replace(/\/$/, ''));
    const exists = target === ''
      || files.some((f) => rel(f) === path.join(target.slice(1), 'index.html')
                        || rel(f) === target.slice(1));
    if (!exists) { fail(`_redirects points at ${dest}, which is not in dist/`); bad++; }
  }
  if (!bad) ok(`${lines.length} redirect(s), all pointing at pages that exist`);
}

// 8. Every internal URL the site emits must be the form the server returns
//    200 for, with no redirect in between.
//
//    Cloudflare's asset router serves <slug>/index.html at /<slug>/ and 301s
//    the bare /<slug> to it. So an extension-less path without a trailing
//    slash is a redirect, and a canonical, a sitemap entry or a JSON-LD url in
//    that form declares one URL while the server answers on another. This
//    check resolves each emitted URL against dist/ the same way the router
//    would, and fails on anything that would not answer directly.
const distSet = new Set(files.map((f) => rel(f).split(path.sep).join('/')));

/** How the asset router would resolve a pathname; null if it would not, directly. */
function resolves(pathname) {
  let p = decodeURIComponent(pathname);
  if (p === '/') return distSet.has('index.html') ? 'index.html' : null;
  if (p.endsWith('/')) {
    const f = p.slice(1) + 'index.html';
    return distSet.has(f) ? f : null;
  }
  // No trailing slash: only a real file answers directly. An extension-less
  // path here is precisely the redirect case.
  const f = p.slice(1);
  return distSet.has(f) ? f : null;
}

const emitted = [];   // [source, url]
for (const f of html) {
  const text = await readFile(f, 'utf8');
  for (const m of text.matchAll(/<link rel="canonical" href="([^"]+)"/g)) emitted.push([rel(f), m[1]]);
  for (const m of text.matchAll(/<meta property="og:url" content="([^"]+)"/g)) emitted.push([rel(f), m[1]]);
  for (const m of text.matchAll(/<a\b[^>]*\shref="([^"]+)"/g)) emitted.push([rel(f), m[1]]);
}
emitted.push(...ldUrls);

const sitemapText = sitemapFile ? await readFile(sitemapFile, 'utf8') : '';
for (const m of sitemapText.matchAll(/<loc>([^<]+)<\/loc>/g)) emitted.push(['sitemap.xml', m[1]]);

if (redirectsFile) {
  for (const line of (await readFile(redirectsFile, 'utf8')).split('\n')) {
    const t = line.trim();
    if (!t.startsWith('/')) continue;
    const dest = t.split(/\s+/)[1];
    if (dest) emitted.push(['_redirects', dest]);
  }
}

// The origin the site declares about itself. Anything on it is ours to serve;
// anything else is somebody else's problem and is skipped.
const origin = (() => {
  for (const [, u] of emitted) {
    const m = /^(https?:\/\/[^/]+)/.exec(u);
    if (m) return m[1];
  }
  return null;
})();

let redirecting = 0, checked = 0;
const reported = new Set();
for (const [source, raw] of emitted) {
  let pathname;
  if (raw.startsWith('/')) {
    if (raw.startsWith('//')) continue;
    pathname = raw;
  } else if (origin && raw.startsWith(origin + '/')) {
    pathname = raw.slice(origin.length);
  } else if (raw === origin) {
    pathname = '/';
  } else {
    continue;   // external, mailto:, #fragment-only, relative
  }
  pathname = pathname.split('#')[0].split('?')[0];
  if (pathname === '') pathname = '/';
  checked++;
  if (!resolves(pathname)) {
    const key = `${source} -> ${pathname}`;
    if (reported.has(key)) continue;
    reported.add(key);
    const wouldWork = resolves(pathname.endsWith('/') ? pathname : pathname + '/');
    fail(wouldWork
      ? `${source} emits ${pathname}, which 301s. Use ${pathname}/`
      : `${source} emits ${pathname}, which is not in dist/ at all`);
    redirecting++;
  }
}
if (!redirecting) ok(`${checked} internal URL(s) emitted, every one served directly`);

console.log(failures ? `\n${failures} FAILED\n` : '\nbuild output verified\n');
process.exit(failures ? 1 : 0);
