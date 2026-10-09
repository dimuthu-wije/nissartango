/**
 * Run with:  npm test
 *
 * A @font-face pointing at a file that is not there FAILS SILENTLY. The
 * browser falls back to the next family in the stack, nothing is logged, no
 * build step complains, and the page looks very slightly wrong in a way that
 * is easy to read as "that's just how it renders". This file is the thing that
 * notices.
 *
 * It reads only COMMITTED files -- never node_modules -- so it means the same
 * in CI, where @fontsource/inter may not be installed at all (it is a
 * devDependency that exists only to regenerate these artefacts).
 *
 * If something here fails, re-run `node scripts/make-fonts.mjs` rather than
 * hand-editing the generated CSS.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
/** Comments in these files legitimately contain the words they describe --
 *  this file's own header says "@font-face" twice. Splitting on that without
 *  stripping comments first reported a comment fragment as a face with no
 *  font-display, which is how the first version of the test below failed
 *  against correct CSS. */
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '');

const SITE_CSS = 'src/styles/fonts.css';
const EDITOR_CSS = 'editor/public/fonts.css';

test('the editor\'s copy of the font faces is byte-identical', () => {
  // The editor sends `default-src 'self'` with no font-src, so it cannot load
  // a font from nissartango.fr and needs its own copy of both the CSS and the
  // files. Two copies drift; this is what stops them.
  assert.equal(read(EDITOR_CSS), read(SITE_CSS),
    'editor/public/fonts.css has drifted — re-run scripts/make-fonts.mjs');
});

test('every font file named in the CSS exists, in BOTH deployments', () => {
  const urls = [...read(SITE_CSS).matchAll(/url\('([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(urls.length >= 2, `expected at least two faces, found ${urls.length}`);
  for (const url of urls) {
    assert.ok(url.startsWith('/fonts/'), `${url} is not served from /fonts/`);
    const name = url.replace(/^\//, '');
    for (const dir of ['public', 'editor/public']) {
      const f = path.join(ROOT, dir, name);
      assert.ok(existsSync(f), `${dir}/${name} is missing — the face would fall back silently`);
      assert.ok(readFileSync(f).length > 1000, `${dir}/${name} is implausibly small`);
    }
  }
});

test('the subset covers every character French actually sets', () => {
  // Checked against the DECLARED unicode-range, which is the thing that
  // governs behaviour: a glyph outside it is not used from this file even if
  // the file contains it, because the browser never downloads it for that
  // character.
  const range = /unicode-range:\s*([^;]+);/.exec(read(SITE_CSS))?.[1];
  assert.ok(range, 'no unicode-range declared');
  const covers = (ch) => range.split(',').some((part) => {
    const [a, b] = part.trim().replace(/U\+/i, '').split('-');
    const cp = ch.codePointAt(0);
    return cp >= parseInt(a, 16) && cp <= parseInt(b ?? a, 16);
  });
  const required = [...'àâäçéèêëîïñôöùûüÿœæ', ...'ÀÂÄÇÉÈÊËÎÏÑÔÖÙÛÜŒÆ', ...'«»·’—…€°'];
  const missing = required.filter((ch) => !covers(ch));
  assert.deepEqual(missing, [], `the subset does not cover ${missing.join(' ')}`);
});

test('Ÿ is still the one known gap, and still deliberate', () => {
  // U+0178 lives in latin-ext. It appears in French essentially only in
  // all-caps proper nouns (L'HAŸ-LES-ROSES) and covering it would mean a
  // second subset for every visitor. If this ever starts passing, the
  // headers in make-fonts.mjs and tokens.css are wrong and should be fixed.
  const range = /unicode-range:\s*([^;]+);/.exec(read(SITE_CSS))[1];
  const covered = range.split(',').some((part) => {
    const [a, b] = part.trim().replace(/U\+/i, '').split('-');
    return 0x178 >= parseInt(a, 16) && 0x178 <= parseInt(b ?? a, 16);
  });
  assert.equal(covered, false,
    'Ÿ is now covered — delete this test and the comments that say it is not');
});

test('every face swaps rather than blocking', () => {
  const faces = code(SITE_CSS).split('@font-face').slice(1);
  assert.ok(faces.length >= 2);
  for (const f of faces) {
    assert.match(f, /font-display:\s*swap/,
      'a face without font-display: swap hides text while it downloads');
  }
});

test('the preload names a real file and carries crossorigin', () => {
  // Without crossorigin the browser fetches the font TWICE: the preload and
  // the CSS request are treated as different, and the preload is wasted.
  const layout = read('src/layouts/Layout.astro');
  const m = /<link rel="preload" href="([^"]+)"[\s\S]{0,200}?\/>/.exec(layout);
  assert.ok(m, 'no font preload in Layout.astro');
  assert.ok(existsSync(path.join(ROOT, 'public', m[1].replace(/^\//, ''))),
    `preloaded ${m[1]} does not exist`);
  assert.match(m[0], /crossorigin/);
  assert.match(m[0], /as="font"/);
  assert.ok(read(SITE_CSS).includes(m[1]), 'the preloaded file is not one of the faces');
});
