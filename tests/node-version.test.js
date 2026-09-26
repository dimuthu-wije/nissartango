/**
 * Run with:  npm test
 *
 * The Node version is now written in three places, because three different
 * things read three different files:
 *
 *   .node-version    Cloudflare Workers Builds
 *   .nvmrc           nvm, which is how this project is run locally
 *   package.json     engines, which is what npm warns against
 *
 * Three copies of one fact is exactly the shape that drifts, and the drift is
 * invisible: each file is individually plausible, and the only symptom is that
 * the thing you tested is not the thing that shipped. So they are bound
 * together here rather than by a comment asking people to remember.
 *
 * WHY 22.23.2 AND NOT THE DEFAULT. Cloudflare's build image defaults to
 * 24.18.0 and PREINSTALLS 22.23.2 (verified against their build-image docs on
 * 2026-09-26). 22.23.2 is also what this project is developed on. Pinning to
 * it puts local and CI on the same version, and on one the image already has —
 * so nothing is downloaded and nothing is guessed. Pinning to 24 would have
 * meant shipping from a version nobody here had ever run a build on.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (name) =>
  readFileSync(new URL(`../${name}`, import.meta.url), 'utf8').trim();

const pinned = read('.node-version');
const pkg = JSON.parse(read('package.json'));

test('.node-version names an exact version, not a range', () => {
  // "22" or ">=22" would let the image choose, which is the thing being
  // removed: the point of a pin is that two machines resolve it identically.
  assert.match(pinned, /^\d+\.\d+\.\d+$/, `.node-version is "${pinned}"`);
});

test('.nvmrc and .node-version agree', () => {
  assert.equal(read('.nvmrc'), pinned,
    'nvm and Cloudflare would install different versions');
});

test('the pinned version satisfies package.json engines', () => {
  const range = pkg.engines?.node;
  assert.ok(range, 'package.json has no engines.node');

  // A tiny semver check rather than a dependency: this compares one exact
  // version against a range of the single form this file uses, and says so.
  const [major, minor, patch] = pinned.split('.').map(Number);
  const cmp = (a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]);
  const here = [major, minor, patch];

  for (const clause of range.split(/\s+/)) {
    const m = clause.match(/^(>=|<=|<|>|\^|~)?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
    assert.ok(m, `engines clause "${clause}" is not a form this test understands`);
    const [, op, MA, MI, PA] = m;
    const other = [Number(MA), Number(MI ?? 0), Number(PA ?? 0)];
    const c = cmp(here, other);
    const okFor = { '>=': c >= 0, '>': c > 0, '<=': c <= 0, '<': c < 0, undefined: c === 0 };
    assert.ok(okFor[op ?? 'undefined'],
      `${pinned} does not satisfy "${clause}" from engines "${range}"`);
  }
});

test('engines has an UPPER bound, so a newer major cannot arrive silently', () => {
  // It read ">=22.12.0" until 2026-09-26, which Cloudflare's default of 24
  // satisfied — so the build ran on a major nobody had chosen, and engines
  // raised no objection. An open-ended range is not a pin.
  assert.match(pkg.engines.node, /<\s*\d+/,
    `engines "${pkg.engines.node}" has no upper bound`);
});

test('the Node running these tests matches the pin', () => {
  // Not a style rule: if this fails, everything else in the suite was verified
  // on a version the site will not be built with. Warned rather than asserted
  // would be a check that cannot fail, which is no check.
  assert.equal(process.version, `v${pinned}`,
    `tests are running on ${process.version} but the project is pinned to v${pinned}. ` +
    'Run `nvm use` (it reads .nvmrc).');
});
