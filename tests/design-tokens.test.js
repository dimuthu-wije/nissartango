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

test('every font-size on the public site comes from the scale', () => {
  // SITE only, deliberately, and this is a boundary rather than an oversight.
  // The editor carries 23 ad-hoc sizes of its own (0.72 / 0.78 / 0.8 / 0.82 /
  // 0.85 / 0.87 / 0.9 / 0.92 / 0.95 / 1.02 / 1.05 / 1.35rem). Putting them on
  // this scale means moving its body type from 13.6px to 16px, which changes
  // the layout of five working pages -- real work with its own verification,
  // not a rename. The COLOUR drift between the two deployments is fixed; the
  // type drift is not, and is listed in AGENTS.md Outstanding.
  //
  // When the editor is converted, add ...EDITOR back here and delete this.
  const bad = [];
  for (const f of SITE) {
    strip(read(f)).split('\n').forEach((line, i) => {
      const m = /font-size:\s*([^;]+);/.exec(line);
      if (m && !m[1].includes('var(')) bad.push(`${f}:${i + 1}  font-size: ${m[1].trim()}`);
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
