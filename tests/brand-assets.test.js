/**
 * Run with:  npm test
 *
 * A FILE THAT VANISHES FROM design/brand/ MAKES NO NOISE. Ten of the twelve
 * are referenced by nothing -- print variants, raster exports, the Illustrator
 * source -- so removing one breaks no build, fails no check, and renders no
 * page wrong. The eleventh is inlined into the header of every page.
 *
 * This is not hypothetical. logo-wordmark-mono.svg was deleted from the working
 * tree some time after 2026-10-12, by nothing either session recorded, and sat
 * as an uncommitted deletion until a `git add -A` on 2026-10-21 swept it into a
 * commit and pushed it to a public repo. Nobody noticed for nine days because
 * nothing could notice. Restored in 1d4c19d, byte-identical.
 *
 * WHY THIS MATTERS MORE THAN A FOLDER OF ARTWORK SUGGESTS. design/ is
 * deliberately NOT on Cloudflare's build-watch exclude list and must never be
 * put on it (AGENTS.md gotcha 11), precisely because Layout.astro inlines the
 * wordmark at build time. A file in here is code that happens to be a drawing.
 *
 * Same shape as tests/fonts.test.js: a @font-face naming a missing file falls
 * back silently, so a test is the only thing that would ever say so.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const at = (p) => path.join(ROOT, p);
const read = (p) => readFileSync(at(p), 'utf8');

/**
 * The three files something actually READS, discovered rather than typed:
 * whoever changes an import changes this test's subject with it. Hard-coding
 * the three would let a rename pass while the new path pointed nowhere.
 */
const READERS = [
  'src/layouts/Layout.astro',
  'scripts/make-og-default.mjs',
  'scripts/make-favicon.mjs',
];

/** Every committed file, including the ones nothing reads. THAT is the half
 *  this test exists for -- the referenced ones already break loudly. */
const INVENTORY = [
  'logo-mark-1024.png', 'logo-mark-512.png', 'logo-mark-square.svg',
  'logo-og.svg', 'logo-source.svg',
  'logo-wordmark-1x.png', 'logo-wordmark-2x.png', 'logo-wordmark-3x.png',
  'logo-wordmark-colour.svg', 'logo-wordmark-dark.svg',
  'logo-wordmark-mono.svg', 'logo-wordmark.svg',
];

test('every design/brand file a reader names is present and not empty', () => {
  const named = new Set();
  for (const reader of READERS) {
    for (const m of read(reader).matchAll(/design\/brand\/([\w.-]+\.(?:svg|png))/g)) {
      named.add(m[1]);
    }
  }

  // AN EMPTY RESULT MUST NOT READ AS A PASS. If the import syntax changes and
  // the regex stops matching, every assertion below runs zero times and the
  // test goes green while asserting nothing -- the exact failure AGENTS.md
  // records for `git grep -E` and for grepping the deployed CSS.
  assert.ok(named.size >= 3,
    `expected at least 3 brand files to be named across ${READERS.length} readers, `
    + `found ${named.size} (${[...named].join(', ') || 'none'}) — the paths moved, `
    + 'or this regex no longer matches them');

  for (const file of named) {
    const p = `design/brand/${file}`;
    assert.ok(existsSync(at(p)), `${p} is named by a reader and does not exist`);
    assert.ok(statSync(at(p)).size > 0, `${p} exists and is zero bytes`);
  }
});

test('the whole committed inventory is still there', () => {
  for (const file of INVENTORY) {
    const p = `design/brand/${file}`;
    assert.ok(existsSync(at(p)),
      `${p} is gone. Nothing may reference it — that is why this test exists. `
      + 'Restore it, or remove it from INVENTORY on purpose.');
    assert.ok(statSync(at(p)).size > 0, `${p} is zero bytes`);
  }
});

test('the wordmark the header inlines follows light and dark by itself', () => {
  // Layout.astro inlines this one `?raw` SPECIFICALLY so its ink paths can be
  // currentColor while the art keeps its literal orange: one file, two themes,
  // no JavaScript, which an <img> cannot do. Swap in a literal-fill variant --
  // logo-wordmark-colour.svg and -dark.svg are right there, same size, and
  // neither carries currentColor — and the header silently stops following
  // dark mode. Nothing else would catch that.
  const svg = read('design/brand/logo-wordmark.svg');
  assert.match(svg, /currentColor/,
    'design/brand/logo-wordmark.svg has no currentColor — the inlined header '
    + 'wordmark can no longer follow the light/dark switch');

  const importLine = read('src/layouts/Layout.astro');
  assert.match(importLine, /design\/brand\/logo-wordmark\.svg\?raw/,
    'Layout.astro no longer imports the wordmark ?raw — if that is deliberate, '
    + 'this test and the comment above it need rewriting, not deleting');
});
