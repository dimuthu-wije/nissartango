/**
 * Generates the site's icons from one mark.
 *
 *     node scripts/make-favicon.mjs
 *
 * RUN BY HAND, OUTPUT COMMITTED — same reasoning as scripts/make-og-default.mjs:
 * icons change about never, and building them on every deploy spends time on a
 * constant.
 *
 * WHY THIS EXISTS AT ALL: public/favicon.svg and favicon.ico were Astro's own
 * logo, straight from `npm create astro`, until 2026-10-03. The browser tab,
 * the bookmark and the iOS home screen all showed the framework the site was
 * built with.
 *
 * PROVISIONAL AND MEANT TO BE REPLACED. This is a typographic mark in the
 * site's own accent, not a designed identity. Replace the SVG below and re-run.
 *
 * THE LETTER IS A PATH, NOT <text>. An SVG favicon with a <text> element is
 * rendered with whatever font the BROWSER picks, which differs between
 * browsers and can fall back to something that does not fit the box. Geometry
 * renders identically everywhere.
 *
 * KNOCKED OUT OF A SOLID FIELD, because the real test of a favicon is 16px in a
 * tab strip. A thin dark letterform on a light ground disappears there; a
 * filled shape with the letter cut out of it stays a recognisable blob at any
 * size, and reads on both light and dark tab bars without a
 * prefers-color-scheme switch.
 */
import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ACCENT = '#a01b2e';   // --accent
const pub = (name) => fileURLToPath(new URL(`../public/${name}`, import.meta.url));

// A lowercase n: left stem, shoulder, right stem. Drawn on a 128 grid with a
// round cap, so the strokes keep their weight when scaled down to 16.
const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <rect width="128" height="128" rx="26" fill="${ACCENT}"/>
  <path d="M43 96 V50 M43 66 a21 21 0 0 1 42 0 V96"
        fill="none" stroke="#ffffff" stroke-width="14"
        stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const png = (size) => sharp(Buffer.from(MARK)).resize(size, size).png().toBuffer();

/**
 * An .ico containing PNGs. The container is a 6-byte header, one 16-byte entry
 * per image, then the payloads; Windows has accepted PNG payloads since Vista,
 * which is what lets one file hold 16/32/48 without three bitmap encoders.
 */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);              // reserved
  header.writeUInt16LE(1, 2);              // 1 = icon
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = images.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size === 256 ? 0 : size, 0);
    e.writeUInt8(size === 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);                    // palette size
    e.writeUInt8(0, 3);                    // reserved
    e.writeUInt16LE(1, 4);                 // colour planes
    e.writeUInt16LE(32, 6);                // bits per pixel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });

  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

await writeFile(pub('favicon.svg'), MARK + '\n');

const sizes = [16, 32, 48];
const images = [];
for (const size of sizes) images.push({ size, data: await png(size) });
await writeFile(pub('favicon.ico'), ico(images));

// 180x180 is what iOS asks for; it is also what Android reads when there is no
// manifest. No transparency and no rounding: the OS applies its own mask, and a
// rounded icon inside a rounded mask gets clipped twice.
await sharp(Buffer.from(
  MARK.replace('rx="26"', 'rx="0"'),
)).resize(180, 180).png().toFile(pub('apple-touch-icon.png'));

console.log(`favicon.svg, favicon.ico (${sizes.join('/')}), apple-touch-icon.png`);
