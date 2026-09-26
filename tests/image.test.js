/**
 * Run with:  npm test
 *
 * `image_path` was a free-text box. Filling it in correctly required knowing
 * that the bucket's convention is <organizer_id>/<event_id>/<filename> and
 * that the write policy checks only the FIRST segment against is_member() —
 * so a typed path could be refused by RLS for a reason nothing on screen
 * explained, and a correct one needed two uuids nobody has memorised.
 *
 * The editor computes it now. These pin the two things that computation has to
 * get right: a path the policy will accept, and a filename that survives the
 * build's flattening without colliding with another.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  safeName, storagePathFor, checkImage, ALLOWED, MAX_BYTES,
} from '../editor/public/image.js';

const ORG = '0a000000-0000-0000-0000-0000000000aa';
const EV = 'e0000000-0000-0000-0000-00000000000b';

/** What scripts/fetch-content.mjs does to a storage path to name the local file. */
const flatten = (p) => p.replace(/[^a-zA-Z0-9._-]+/g, '-');

test('the path is organizer/event/file, which is what the policy checks', () => {
  assert.equal(storagePathFor(ORG, EV, 'flyer.png'), `${ORG}/${EV}/flyer.png`);
  // The policy reads foldername(name)[1] — the organizer must be first, or the
  // upload 403s however correct the rest is.
  assert.equal(storagePathFor(ORG, EV, 'x.png').split('/')[0], ORG);
});

test('a path cannot be built without both ids, and says which is missing', () => {
  assert.throws(() => storagePathFor('', EV, 'f.png'), /organizer/);
  assert.throws(() => storagePathFor(ORG, null, 'f.png'), /event that exists/);
});

const RAW_NAMES = [
  'Affiche Été 2026.PNG', 'flyer (1).jpg', 'photo___final!!.webp',
  'déjà vu.avif', '../../escape.png', 'a b  c.png', '.hidden.png', '...', '',
];

test('the FILENAME is already flatten-safe', () => {
  // The first version of this test asserted flatten(path) === path over the
  // whole storage path, which can never hold: flatten maps "/" to "-" too, so
  // every path differs from its own flattening. The property that matters is
  // about the filename — everything else in the path is a uuid, which is
  // already safe.
  for (const raw of RAW_NAMES) {
    const name = safeName(raw);
    assert.equal(flatten(name), name, `${raw} -> ${name} is not flatten-stable`);
  }
});

test('distinct storage paths stay distinct after flattening', () => {
  // The collision that would matter: fetch-content names the local file by
  // flattening the WHOLE path, so two objects whose paths collapse to one
  // filename would land on one file and one would silently win.
  const paths = RAW_NAMES.map((n) => storagePathFor(ORG, EV, n));
  const flattened = paths.map(flatten);
  const distinctPaths = new Set(paths).size;
  assert.equal(new Set(flattened).size, distinctPaths,
    'two distinct storage paths flatten to the same local filename');
});

test('a filename cannot escape its folder', () => {
  const p = storagePathFor(ORG, EV, '../../../etc/passwd.png');
  assert.equal(p.split('/').length, 3, `${p} has extra segments`);
  const name = p.split('/')[2];
  assert.doesNotMatch(name, /\//, 'a slash would add a path segment');
  assert.ok(name !== '.' && name !== '..', `"${name}" names a directory`);
});

test('accents are FOLDED, not dropped', () => {
  // Dropping them turned "Affiche Été 2026.PNG" into "affiche-t-2026.png":
  // the accented letters vanished and took the word with them. These are
  // French flyers.
  assert.equal(safeName('Affiche Été 2026.PNG'), 'affiche-ete-2026.png');
  assert.equal(safeName('déjà vu.avif'), 'deja-vu.avif');
});

test('an empty, dotted or extensionless name still produces something usable', () => {
  assert.equal(safeName(''), 'flyer');
  assert.equal(safeName('...'), 'flyer', '".." is a directory, not a filename');
  assert.equal(safeName('.'), 'flyer');
  assert.equal(safeName('.hidden.png'), 'hidden.png', 'no hidden files');
  assert.equal(safeName('!!!.png'), 'flyer.png');
  assert.equal(safeName('poster'), 'poster');
});

test('names are lowercased and capped, so no two differ only by case', () => {
  assert.equal(safeName('FLYER.PNG'), 'flyer.png');
  const long = safeName('a'.repeat(200) + '.png');
  assert.ok(long.length <= 64, `${long.length} chars`);
  assert.match(long, /\.png$/);
});

test('the accepted types are exactly the bucket\'s', () => {
  // 20260828190200_storage.sql: image/jpeg, image/png, image/webp, image/avif.
  // Measured against the local stack on 2026-09-26. Storage refuses anything
  // else whatever this says; matching means the refusal is explained early.
  assert.deepEqual(Object.keys(ALLOWED).sort(),
    ['image/avif', 'image/jpeg', 'image/png', 'image/webp']);
  assert.equal(MAX_BYTES, 5_242_880, 'must equal file_size_limit on the bucket');
});

test('a good file has nothing to fix', () => {
  assert.deepEqual(checkImage({ name: 'f.png', type: 'image/png', size: 44_338 }), []);
});

test('the wrong type, an empty file and an oversized one are each refused', () => {
  assert.match(checkImage({ name: 'f.pdf', type: 'application/pdf', size: 10 })[0],
    /Format non accepté/);
  assert.match(checkImage({ name: 'f.png', type: 'image/png', size: 0 })[0], /vide/);
  const big = checkImage({ name: 'f.png', type: 'image/png', size: MAX_BYTES + 1 });
  assert.match(big[0], /Trop volumineux/);
  assert.match(big[0], /5 Mo/);
});

test('the boundary is inclusive: exactly the limit is allowed', () => {
  assert.deepEqual(checkImage({ name: 'f.png', type: 'image/png', size: MAX_BYTES }), []);
});

test('one byte over does not report itself as exactly the limit', () => {
  // toFixed(1) rendered MAX_BYTES + 1 as "5.0 Mo", so the message read
  // "Trop volumineux (5.0 Mo) — 5 Mo maximum" and looked like a bug in the
  // check rather than a file that was too big. Seen on screen, not in a test.
  const [msg] = checkImage({ name: 'f.png', type: 'image/png', size: MAX_BYTES + 1 });
  assert.doesNotMatch(msg, /\(5\.0 Mo\)/, `message says the size IS the limit: ${msg}`);
  assert.match(msg, /5\.1 Mo/);
});

test('no file at all is a problem, not a crash', () => {
  assert.deepEqual(checkImage(null), ['Choisissez un fichier.']);
  assert.deepEqual(checkImage(undefined), ['Choisissez un fichier.']);
});
