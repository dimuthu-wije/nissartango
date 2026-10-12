/**
 * Run with:  npm test
 *
 * scripts/preview-events.mjs writes a fake agenda so the design can be worked
 * on against something other than two events. Its header claims that nothing
 * it writes can reach production, and gives three reasons. Two of them are
 * properties of OTHER files, and this is what stops them quietly going away.
 *
 * The .gitignore half is not hypothetical. AGENTS.md records two separate
 * incidents where an agent rewrote .gitignore from a copy that did not exist
 * on its side and shipped a file containing only the appended block, deleting
 * the rules that keep .env, dist/ and node_modules/ out of git. A clobbered
 * .gitignore looks like nothing at all until something is committed that
 * should never have been -- here, a snapshot full of invented events, or
 * worse, the real one.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (p) => readFileSync(ROOT + p, 'utf8');

test('.gitignore still keeps every snapshot and the pointer out of git', () => {
  const lines = read('.gitignore').split('\n').map((l) => l.trim());
  for (const rule of ['data/snapshot.json', 'data/snapshot.*.json', 'data/.snapshot-current']) {
    assert.ok(lines.includes(rule), `.gitignore no longer contains "${rule}"`);
  }
  // The bare name needs its own line: data/snapshot.*.json does NOT match
  // data/snapshot.json, because that glob wants a second dot. .gitignore says
  // so itself; this asserts the thing the comment is about.
  assert.ok(lines.includes('data/snapshot.json'),
    'the bare snapshot.json rule is gone — the wildcard does not cover it');
});

test('the preview generator never writes the real snapshot', () => {
  const src = read('scripts/preview-events.mjs');
  // Every write goes through writeFileSync. REAL may only be READ.
  const writes = [...src.matchAll(/writeFileSync\(\s*([A-Za-z_][\w.]*)/g)].map((m) => m[1]);
  assert.ok(writes.length >= 2, `expected several writes, found ${writes.length}`);
  assert.ok(!writes.includes('REAL'),
    'preview-events.mjs writes to REAL — it must only ever read it');
  for (const w of writes) {
    assert.ok(['FAKE', 'POINTER'].includes(w),
      `preview-events.mjs writes to ${w}; only FAKE and POINTER are allowed`);
  }
});

test('the generator checks the real snapshot is unchanged, both paths', () => {
  const src = read('scripts/preview-events.mjs');
  const guards = (src.match(/the real snapshot changed/g) ?? []).length;
  assert.equal(guards, 2,
    'both the --off path and the generate path must verify the real md5 afterwards');
});
