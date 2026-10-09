/**
 * Generates public/og-default.jpg — the social preview card used by every page
 * that has no flyer of its own.
 *
 * RUN BY HAND, AND THE OUTPUT IS COMMITTED:
 *
 *     node scripts/make-og-default.mjs
 *
 * Not a build step, for two reasons. The card changes about never, so building
 * it on every deploy spends time on a constant. And it draws TEXT, which means
 * the result depends on the renderer and the fonts the machine has —
 * Cloudflare's build image is not this laptop, so generating it in CI would
 * silently change the card. Generating once and committing the pixels makes it
 * reproducible by not reproducing it.
 *
 * THE BRAND LETTERING IS OUTLINES, NOT TEXT, and that is new as of 2026-10-09.
 * Until then this file set the word "nissartango" as <text> in a named font
 * stack. Measured that day: the renderer here (librsvg, via sharp) draws text
 * but does NOT honour font-family at all — Times and Helvetica come back
 * byte-identical in metrics. So the stack was decorative and the card was set
 * in whatever the renderer felt like. The name and the Côte d'Azur line now
 * come from design/brand/logo-og.svg as paths, so they are exact.
 *
 * The one remaining <text> is the description, which is deliberate: it is
 * ordinary prose, it is allowed to be whatever face the renderer picks, and
 * og:description carries the same words to anything that reads markup rather
 * than pixels.
 *
 * NO COLOURED BAND. This had a 10px accent strip across the top. The design
 * system rations colour and takes structure from rules rather than panels
 * (docs/DESIGN.md), and the lockup already carries the only orange on the
 * card — a band doubled it for decoration.
 *
 * 1200×630 is the size every platform states for a large summary card. A
 * smaller image is scaled up; a wildly different aspect ratio is cropped from
 * the centre, which is how you lose the words.
 */
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const at = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));

/* Values come from src/styles/tokens.css. --accent-text, not --accent, for the
 * domain: it is lettering, and the raw brand orange is 3.71:1 on paper. */
const PAPER = '#FBFAF8';
const MUTED = '#6B6660';
const RULE  = '#B8B0A4';
const ACCENT_TEXT = '#BF4F2A';

const W = 1200, H = 630;
const MARGIN = 90;
// LOCKUP_TOP is optical, not arithmetic: at 188 the block sat ~50px below
// the canvas centre, with 188px of air above the lockup against 68px below
// the domain. 150 balances it while leaving the domain pinned low enough to
// read as a footer mark rather than part of the same block.
const LOCKUP_W = 620, LOCKUP_TOP = 150;

const lockup = await readFile(at('design/brand/logo-og.svg'), 'utf8');
const vb = /viewBox="([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)"/.exec(lockup);
if (!vb) throw new Error('logo-og.svg has no parseable viewBox');
const [minX, minY, vbW, vbH] = vb.slice(1).map(Number);

// Scale the lockup to LOCKUP_W and place its top-left at (MARGIN, LOCKUP_TOP).
const k = LOCKUP_W / vbW;
const tx = MARGIN - minX * k;
const ty = LOCKUP_TOP - minY * k;
const paths = lockup.match(/<path[^>]*\/>/g);
if (!paths?.length) throw new Error('logo-og.svg contains no <path> elements');

const ruleY = Math.round(LOCKUP_TOP + vbH * k + 56);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="${PAPER}"/>
  <g transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${k.toFixed(5)})">
    ${paths.join('\n    ')}
  </g>
  <rect x="${MARGIN}" y="${ruleY}" width="${W - MARGIN * 2}" height="1" fill="${RULE}"/>
  <text x="${MARGIN}" y="${ruleY + 62}" font-family="Inter, Helvetica Neue, Helvetica, Arial, sans-serif"
        font-size="36" font-weight="500" fill="${MUTED}">Agenda du tango et des danses sociales à Nice</text>
  <text x="${MARGIN}" y="${H - 74}" font-family="Inter, Helvetica Neue, Helvetica, Arial, sans-serif"
        font-size="28" font-weight="500" fill="${ACCENT_TEXT}" letter-spacing="2">NISSARTANGO.FR</text>
</svg>`;

const out = at('public/og-default.jpg');
const info = await sharp(Buffer.from(svg)).jpeg({ quality: 86 }).toFile(out);
console.log(`og-default.jpg  ${info.width}×${info.height}  ${info.size} bytes`);
