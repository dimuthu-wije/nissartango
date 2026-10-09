/**
 * Puts Inter where both deployments can serve it themselves.
 *
 *     node scripts/make-fonts.mjs
 *
 * RUN BY HAND, OUTPUT COMMITTED — same reasoning as make-favicon.mjs and
 * make-og-default.mjs. @fontsource/inter is a devDependency and exists only to
 * refresh these files; nothing at build time or run time needs it.
 *
 * SELF-HOSTED, NOT GOOGLE'S CDN. Hotlinking fonts.gstatic.com puts an EU IP
 * transfer in front of every visitor before anything is consented to, and this
 * site needs no cookie banner today precisely because it does nothing of the
 * kind. Self-hosting is also simply faster: one less DNS lookup, one less TLS
 * handshake, and the file is on the same connection as the page.
 *
 * BOTH DEPLOYMENTS GET THEIR OWN COPY. editor.nissartango.fr sends
 * `default-src 'self'` with no font-src, so a font served from nissartango.fr
 * would be blocked there — and the fix is a copy, not a widened policy.
 *
 * WOFF2 ONLY. Every browser has supported it since 2016; shipping the .woff
 * fallback beside it doubles the bytes for user agents that no longer exist.
 *
 * THREE WEIGHTS, and the third one is the editor's.
 *
 * 500 is the public site's only weight and every page needs it, so it is
 * preloaded in Layout.astro. 600 is for <strong> inside an organizer's own
 * prose, the single documented exception in docs/DESIGN.md.
 *
 * 400 exists because the EDITOR is an application, not a document. One weight
 * at every size is the reference's editorial signature and it belongs on the
 * public site; in a dense form UI it simply reads heavy. The editor sets its
 * body in 400 through --weight-ui, which lives in its own token block beside
 * --card and --good, because an app's body weight is an app's business.
 *
 * Shipping 400 to BOTH deployments is deliberate: one generated fonts.css and
 * one verbatim copy, rather than two that drift. The public site never asks
 * for weight 400, and a face with its own @font-face is not downloaded until
 * something uses it, so this costs it 24KB of storage and zero bytes of
 * transfer. Two diverging stylesheets is the more expensive half of that
 * trade, and this repo has already paid it once.
 *
 * A face that is DECLARED but missing is worse than one that is absent. The
 * editor already had a `font-weight: 400` rule and, with only 500 and 600
 * defined, the browser had been quietly rendering it in the 500 face. Nothing
 * looked wrong; nothing was right either.
 *
 * THE LATIN SUBSET AND FRENCH. Checked here rather than assumed: the range
 * fontsource declares for `latin` is U+0000-00FF plus a short list, which
 * carries every accented letter French uses, « », ·, ’, € and œ/Œ. It does NOT
 * carry Ÿ (U+0178), which lives in latin-ext. That is a real gap and it is
 * accepted: Ÿ appears in French essentially only in all-caps proper nouns such
 * as L'HAŸ-LES-ROSES, and the cost of covering it is a second subset for every
 * visitor. When it does occur the browser falls back for that one glyph.
 */
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const at = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const pkg = (p) => at(`node_modules/@fontsource/inter/${p}`);

const WEIGHTS = [400, 500, 600];
const faces = [];

for (const weight of WEIGHTS) {
  const css = await readFile(pkg(`${weight}.css`), 'utf8');
  // The `latin` block, not latin-ext and not the first block in the file.
  const block = new RegExp(
    String.raw`/\* inter-latin-${weight}-normal \*/\s*@font-face\s*\{([\s\S]*?)\}`,
  ).exec(css);
  if (!block) throw new Error(`no latin ${weight} @font-face in @fontsource/inter/${weight}.css`);
  const file = /url\(\.\/files\/(inter-latin-\d+-normal\.woff2)\)/.exec(block[1])?.[1];
  const range = /unicode-range:\s*([^;]+);/.exec(css.slice(block.index))?.[1]?.trim();
  if (!file) throw new Error(`no woff2 url for weight ${weight}`);
  if (!range) throw new Error(`no unicode-range for weight ${weight}`);
  faces.push({ weight, file, range });
}

// Every character the site actually sets in French, plus the punctuation the
// templates emit. If a future subset drops one of these the generator stops.
const REQUIRED = [...'àâäçéèêëîïñôöùûüÿœæ', ...'ÀÂÄÇÉÈÊËÎÏÑÔÖÙÛÜŒÆ', ...'«»·’—…€°'];
const inRange = (ch, range) => range.split(',').some((part) => {
  const [a, b] = part.trim().replace(/U\+/i, '').split('-');
  const cp = ch.codePointAt(0);
  return cp >= parseInt(a, 16) && cp <= parseInt(b ?? a, 16);
});

for (const { weight, range } of faces) {
  const missing = REQUIRED.filter((ch) => !inRange(ch, range));
  if (missing.length) {
    throw new Error(`weight ${weight}: the latin subset does not cover ${missing.join(' ')}`);
  }
}
// Reported, not enforced: the gap we know about and chose to live with.
const KNOWN_GAP = 'Ÿ';
const stillMissing = !inRange(KNOWN_GAP, faces[0].range);
console.log(`French coverage: all ${REQUIRED.length} required characters in range`);
console.log(`  ${KNOWN_GAP} (U+0178) ${stillMissing ? 'still outside — accepted, see the header' : 'is now COVERED; update the header comment'}`);

const css = `/* GENERATED by scripts/make-fonts.mjs. Do not edit; re-run it.
 *
 * A verbatim copy of this file lives at editor/public/fonts.css, because the
 * editor is a separate deployment whose CSP forbids a cross-origin font.
 * tests/fonts.test.js asserts the two agree and that every file named here
 * exists -- a @font-face pointing at a missing file fails SILENTLY, falling
 * back to the next family in the stack with nothing logged anywhere.
 */
${faces.map(({ weight, file, range }) => `@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: ${weight};
  font-display: swap;
  src: url('/fonts/${file}') format('woff2');
  unicode-range: ${range};
}`).join('\n\n')}
`;

for (const dir of ['public/fonts', 'editor/public/fonts']) {
  await mkdir(at(dir), { recursive: true });
  for (const { file } of faces) await copyFile(pkg(`files/${file}`), at(`${dir}/${file}`));
}
await writeFile(at('src/styles/fonts.css'), css);
await writeFile(at('editor/public/fonts.css'), css);

const { statSync } = await import('node:fs');
for (const { weight, file } of faces) {
  console.log(`  ${file}  weight ${weight}  ${statSync(at(`public/fonts/${file}`)).size} bytes`);
}
console.log('wrote src/styles/fonts.css and editor/public/fonts.css');
