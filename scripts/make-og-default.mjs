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
 * the result depends on which fonts the machine has — Cloudflare's build image
 * is not this laptop, so generating it in CI would silently change the card.
 * Generating once and committing the pixels makes it reproducible by not
 * reproducing it.
 *
 * TYPOGRAPHIC, NOT A LOGO. This is deliberately the site's name and palette and
 * nothing else: there is no brand mark to use yet (public/favicon.svg is still
 * Astro's logo from `npm create astro`). Replace this the day there is one.
 *
 * 1200×630 is the size every platform states for a large summary card. A
 * smaller image is scaled up; a wildly different aspect ratio is cropped from
 * the centre, which is how you lose the words.
 */
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const BG = '#fbfaf8';     // --bg
const INK = '#1a1a1a';    // --ink
const MUTED = '#6b6b6b';  // --muted
const ACCENT = '#a01b2e'; // --accent

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
  <rect width="1200" height="630" fill="${BG}"/>
  <rect x="0" y="0" width="1200" height="10" fill="${ACCENT}"/>
  <text x="90" y="300" font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
        font-size="104" font-weight="700" fill="${INK}" letter-spacing="-3">nissartango</text>
  <text x="90" y="372" font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
        font-size="38" fill="${MUTED}">Agenda du tango et des danses sociales</text>
  <text x="90" y="428" font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
        font-size="38" fill="${MUTED}">à Nice et sur la Côte d'Azur</text>
  <text x="90" y="560" font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
        font-size="30" font-weight="600" fill="${ACCENT}" letter-spacing="2">NISSARTANGO.FR</text>
</svg>`;

const out = fileURLToPath(new URL('../public/og-default.jpg', import.meta.url));
const info = await sharp(Buffer.from(svg)).jpeg({ quality: 86 }).toFile(out);
console.log(`og-default.jpg  ${info.width}×${info.height}  ${info.size} bytes`);
