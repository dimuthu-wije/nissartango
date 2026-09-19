/**
 * Run with:  npm test
 *
 * The first test here is the one that matters. It asserts that the generated
 * rules are byte-identical to the four lines that used to be hand-written in
 * public/_redirects -- lines that were measured against Cloudflare's live asset
 * router, hop by hop. Replacing verified output with derived output is only
 * safe if the derived output is the same output, and "I read the code and it
 * looks right" is not that check.
 *
 * The second is the reason any of this exists: an event that is not published
 * must contribute no rules, because a rule pointing at a page the build did
 * not emit fails verify-build.mjs check 7 and takes the whole deploy with it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { renderRedirects, sourceUrls, checkLegacySlugs } from '../src/lib/redirects.mjs';

// The real one. Accents intact, exactly as data/fold-accented-slugs.sql found
// it before folding it to ASCII.
const CASITA_LEGACY =
  '2026-08-24-milonga-précédée-d-une-pràctica-jeudi-c-est-permis-à-la-casita';
const CASITA_NOW =
  '2026-08-24-milonga-precedee-d-une-practica-jeudi-c-est-permis-a-la-casita';

const ev = (slug, legacy_slugs = []) => ({ slug, legacy_slugs });

/** rule lines only, comments and blanks dropped */
const rulesOf = (text) =>
  (text ?? '').split('\n').filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => l.split(/\s+/));

test('reproduces the four hand-verified Casita rules exactly', () => {
  const out = renderRedirects([ev(CASITA_NOW, [CASITA_LEGACY])]);
  const rules = rulesOf(out);

  assert.equal(rules.length, 4);

  const dest = `/evenements/${CASITA_NOW}/`;
  for (const [, d, code] of rules) {
    assert.equal(d, dest, 'destination carries the trailing slash: without it the asset router adds a second hop');
    assert.equal(code, '301');
  }

  // The percent-encoded spellings are the ones that were in the committed
  // file. If encodeURIComponent ever stops matching them, this fails loudly
  // rather than silently shipping URLs nothing links to.
  const sources = rules.map(([s]) => s).sort();
  assert.deepEqual(sources, [
    '/evenements/2026-08-24-milonga-pr%C3%A9c%C3%A9d%C3%A9e-d-une-pr%C3%A0ctica-jeudi-c-est-permis-%C3%A0-la-casita',
    '/evenements/2026-08-24-milonga-pr%C3%A9c%C3%A9d%C3%A9e-d-une-pr%C3%A0ctica-jeudi-c-est-permis-%C3%A0-la-casita/',
    `/evenements/${CASITA_LEGACY}`,
    `/evenements/${CASITA_LEGACY}/`,
  ].sort());
});

test('an unpublished event contributes no rules -- the whole point', () => {
  // events_public filters to approved, so a rejected event simply is not in
  // the list handed to the generator. No event, no rule, no dangling
  // destination, no failed build.
  assert.equal(renderRedirects([]), null);
  assert.equal(renderRedirects([ev('some-other-event')]), null);
});

test('a pure-ASCII legacy slug yields two sources, not four duplicates', () => {
  // encodeURIComponent is the identity here, so the encoded and raw spellings
  // collide. Emitting both would be a duplicate rule, not extra coverage.
  assert.deepEqual(sourceUrls('old-slug'), ['/evenements/old-slug', '/evenements/old-slug/']);
  assert.equal(rulesOf(renderRedirects([ev('new-slug', ['old-slug'])])).length, 2);
});

test('refuses a legacy slug that is another published event\'s current slug', () => {
  assert.throws(
    () => renderRedirects([ev('b', ['a']), ev('a')]),
    /current slug of a/,
    'redirecting a live page away from itself is worse than no rule',
  );
});

test('refuses an event that lists its own slug', () => {
  assert.throws(() => renderRedirects([ev('a', ['a'])]), /its own current slug/);
});

test('refuses two events claiming the same legacy slug', () => {
  assert.throws(() => renderRedirects([ev('a', ['old']), ev('b', ['old'])]), /claimed by both/);
});

test('refuses a blank legacy slug, which would redirect /evenements/ itself', () => {
  assert.throws(() => renderRedirects([ev('a', [''])]), /blank/);
  assert.throws(() => renderRedirects([ev('a', ['   '])]), /blank/);
});

test('missing legacy_slugs is treated as none, not as a crash', () => {
  // Rows fetched before the column existed, and any --from-snapshot build
  // reading a snapshot written before this migration.
  assert.equal(renderRedirects([{ slug: 'a' }]), null);
  assert.deepEqual(checkLegacySlugs([{ slug: 'a' }]), []);
});

test('rules are ordered deterministically', () => {
  // Same content must produce a byte-identical file, or every build looks like
  // a change to anything diffing dist/.
  const evs = [ev('z', ['zz']), ev('a', ['aa'])];
  assert.equal(renderRedirects(evs), renderRedirects([...evs].reverse()));
});
