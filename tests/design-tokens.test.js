/**
 * Run with:  npm test
 *
 * src/styles/tokens.css is the only place a design VALUE may be written down,
 * and editor/public/tokens.css is a verbatim copy of it because the editor is
 * a separate static deployment with no build step and cannot import across the
 * repo. Both of those are liabilities that this file converts into assertions.
 *
 * WHAT WENT WRONG BEFORE, and what each test below would have caught:
 *
 *   - The two deployments kept separate palettes that had drifted apart:
 *     --fg #1d1b18 against --ink #1a1a1a, --muted #5f5b55 against #6b6b6b,
 *     --line #e2ddd6 against #e5e2dd. Two names for one idea, two values for
 *     one colour, neither obviously wrong on its own screen.
 *   - Ten distinct font sizes existed between 0.7 and 1.9rem, four of them
 *     indistinguishable by eye. Nobody chose that; it accumulated one
 *     declaration at a time.
 *   - Two tokens -- --bad and --surface -- were USED by pages and defined
 *     nowhere. `color: var(--bad)` with no fallback is invalid at computed
 *     value time, so the archive's "Annulé" silently rendered in inherited
 *     ink. Nothing failed; it just quietly did not do what it said.
 *
 * If the copy test fails, copy src/styles/tokens.css over
 * editor/public/tokens.css. Do not hand-edit the copy.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

/** Comments legitimately discuss colours and token names -- this file's own
 *  header does. Scanning them would make every explanation a violation. */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');

function walk(dir, exts, out = []) {
  for (const name of readdirSync(path.join(ROOT, dir))) {
    const rel = path.join(dir, name);
    if (statSync(path.join(ROOT, rel)).isDirectory()) walk(rel, exts, out);
    else if (exts.some((e) => name.endsWith(e))) out.push(rel);
  }
  return out;
}

const TOKEN_FILES = ['src/styles/tokens.css', 'editor/public/tokens.css'];
const SITE = walk('src/pages', ['.astro'])
  .concat(['src/layouts/Layout.astro', 'src/styles/base.css']);
const EDITOR = walk('editor/public', ['.html']).concat(['editor/public/style.css']);

const definedIn = (file) =>
  [...strip(read(file)).matchAll(/--([a-z0-9-]+)\s*:/g)].map((m) => `--${m[1]}`);
const usedIn = (file) =>
  [...strip(read(file)).matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map((m) => m[1]);

test('the editor\'s copy of the tokens is byte-identical to the original', () => {
  assert.equal(
    readFileSync(path.join(ROOT, 'editor/public/tokens.css'), 'utf8'),
    readFileSync(path.join(ROOT, 'src/styles/tokens.css'), 'utf8'),
    'editor/public/tokens.css has drifted — copy src/styles/tokens.css over it',
  );
});

test('a literal colour may only appear as a token definition', () => {
  // The rule is deliberately about the LINE, not the file: a hex is allowed
  // where it defines a custom property and nowhere else. That permits the
  // editor's own status colours, which are app-specific and belong with it,
  // while still refusing `color: #6b6b6b` anywhere.
  const bad = [];
  for (const f of [...TOKEN_FILES, ...SITE, ...EDITOR]) {
    strip(read(f)).split('\n').forEach((line, i) => {
      if (!/#[0-9a-fA-F]{3,8}\b/.test(line)) return;
      if (/^\s*--[a-z0-9-]+\s*:\s*#[0-9a-fA-F]{3,8}\s*;?\s*$/.test(line)) return;
      bad.push(`${f}:${i + 1}  ${line.trim()}`);
    });
  }
  assert.deepEqual(bad, [], `literal colour outside a token definition:\n${bad.join('\n')}`);
});

test('every font-size comes from the scale, in BOTH deployments', () => {
  // The editor carried 26 ad-hoc declarations across twelve distinct values
  // between 0.72 and 1.35rem. They are now five tokens, one of which
  // (--text-ui, 14px) is the editor's own: the public ramp steps 11 -> 16 ->
  // 19 because a reading page needs nothing between, and a form of labels,
  // hints and inline errors needs exactly that.
  //
  // EXEMPT: a size in `em`. That is a RATIO to the surrounding text, not a
  // point on the scale -- .guide code is 0.9em because monospace set at the
  // same pixel size reads larger than the proportional text around it, and
  // the correction has to follow whatever that text is. A rem token could not
  // express it.
  const bad = [];
  for (const f of [...SITE, ...EDITOR]) {
    strip(read(f)).split('\n').forEach((line, i) => {
      const m = /font-size:\s*([^;]+)[;]/.exec(line);
      if (!m) return;
      const value = m[1].trim();
      if (value.includes('var(') || /^[\d.]+em$/.test(value)) return;
      bad.push(`${f}:${i + 1}  font-size: ${value}`);
    });
  }
  assert.deepEqual(bad, [], `font-size not taken from the scale:\n${bad.join('\n')}`);
});

test('every token the public site uses is defined in tokens.css', () => {
  const defined = new Set(definedIn('src/styles/tokens.css'));
  const missing = [];
  for (const f of SITE) for (const t of usedIn(f)) if (!defined.has(t)) missing.push(`${f}  ${t}`);
  assert.deepEqual([...new Set(missing)], [], `undefined token:\n${missing.join('\n')}`);
});

test('every token the editor uses is defined by the editor or the shared set', () => {
  const defined = new Set([
    ...definedIn('editor/public/tokens.css'),
    ...definedIn('editor/public/style.css'),
  ]);
  const missing = [];
  for (const f of EDITOR) for (const t of usedIn(f)) if (!defined.has(t)) missing.push(`${f}  ${t}`);
  assert.deepEqual([...new Set(missing)], [], `undefined token:\n${missing.join('\n')}`);
});

test('the public site declares no design values of its own', () => {
  // Every --name: lives in tokens.css. A page that declares one has started a
  // second source of truth, which is the thing this whole file exists to stop.
  const bad = [];
  for (const f of SITE) for (const t of definedIn(f)) bad.push(`${f}  ${t}`);
  assert.deepEqual(bad, [], `token declared outside tokens.css:\n${bad.join('\n')}`);
});

test('type inside an SVG drawing stays in user units', () => {
  // The guide's lifecycle diagram sets font-size as an SVG ATTRIBUTE, which
  // has no colon and so is invisible to the rule above. That is deliberate,
  // and it is NOT an oversight to be tidied away onto the rem scale.
  //
  // An SVG with a viewBox is a drawing that scales as a whole. Its text sizes
  // are in USER UNITS, so they shrink and grow with the geometry they label.
  // A rem value would not: on a narrow screen the boxes and arrows would
  // scale down while the words stayed put, and the labels would burst out of
  // the shapes they belong to. 11.5 is not a typographic choice competing
  // with --text-label, it is a measurement inside a picture.
  //
  // What CAN go wrong is someone giving one of them a unit, which pins it and
  // breaks exactly that. That is what this asserts.
  const bad = [];
  for (const f of EDITOR.filter((x) => x.endsWith('.html'))) {
    for (const m of read(f).matchAll(/font-size="([^"]+)"/g)) {
      if (!/^[\d.]+$/.test(m[1])) bad.push(`${f}  font-size="${m[1]}"`);
    }
  }
  assert.deepEqual(bad, [],
    `an SVG font-size with a unit stops scaling with its drawing:\n${bad.join('\n')}`);
});
