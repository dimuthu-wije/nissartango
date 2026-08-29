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
const eventPages = html.filter((f) => rel(f).startsWith('evenements' + path.sep));
if (!eventPages.length) fail('no event detail pages were generated');
for (const f of eventPages) {
  const text = await readFile(f, 'utf8');
  const m = text.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) { fail(`${rel(f)} has no JSON-LD`); continue; }
  let data;
  try { data = JSON.parse(m[1]); } catch (err) { fail(`${rel(f)} JSON-LD is not valid JSON`); continue; }
  if (data['@type'] !== 'Event') fail(`${rel(f)} JSON-LD is not an Event`);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(data.startDate ?? '')) {
    fail(`${rel(f)} startDate lacks a UTC offset: ${data.startDate}`);
  }
  if (data.location?.['@type'] !== 'Place') fail(`${rel(f)} location is not a Place`);
  if (data.location?.address?.['@type'] !== 'PostalAddress') fail(`${rel(f)} address is not a PostalAddress`);
}
ok(`${eventPages.length} event page(s) with Event JSON-LD, offsets included`);

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

console.log(failures ? `\n${failures} FAILED\n` : '\nbuild output verified\n');
process.exit(failures ? 1 : 0);
