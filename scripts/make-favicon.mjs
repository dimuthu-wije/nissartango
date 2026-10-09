/**
 * Generates the site's icons from the brand mark.
 *
 *     node scripts/make-favicon.mjs
 *
 * RUN BY HAND, OUTPUT COMMITTED — same reasoning as scripts/make-og-default.mjs:
 * icons change about never, and building them on every deploy spends time on a
 * constant.
 *
 * THE MARK IS READ FROM design/brand/, NOT INLINED HERE. Until 2026-10-09 this
 * file drew its own lowercase "n" and carried its own copy of the accent
 * colour, and its own comment called that "provisional and meant to be
 * replaced". It has been. Reading the file means the mark has exactly one
 * definition in this repo, and regenerating after a change to it needs no edit
 * here — which is the failure this project keeps having, a value fixed in one
 * place and left stale in another.
 *
 * WHY THE "T". The wordmark is nissARTango, with ART set inside the name. Both
 * an A and a T were drawn as candidate marks. Rendered at 16px the A's
 * triangular counter fills in and goes muddy while the T stays crisp, and 16px
 * in a tab strip is the only size that decides a favicon.
 *
 * THE LETTER IS A PATH, NOT <text>. An SVG favicon with a <text> element is
 * rendered with whatever font the BROWSER picks, which differs between
 * browsers and can fall back to something that does not fit the box. Geometry
 * renders identically everywhere. (The same is true of the renderer used here:
 * measured 2026-10-09, librsvg draws text but does NOT honour font-family, so
 * anything that must be exact has to arrive as outlines.)
 *
 * KNOCKED OUT OF A SOLID FIELD, because the real test of a favicon is 16px in a
 * tab strip. A thin dark letterform on a light ground disappears there; a
 * filled shape with the letter cut out of it stays a recognisable blob at any
 * size, and reads on both light and dark tab bars without a
 * prefers-color-scheme switch.
 *
 * rx="26" IS LOAD-BEARING and is asserted, not assumed. The 180x180 iOS icon
 * is this same mark with its corners squared, produced by a literal string
 * replace: iOS applies its own mask, and a rounded icon inside a rounded mask
 * gets clipped twice. If that attribute were ever written any other way the
 * replace would silently do nothing and the failure would be invisible.
 */
import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const at = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const pub = (name) => at(`public/${name}`);

const MARK = await readFile(at('design/brand/logo-mark-square.svg'), 'utf8');

if (!MARK.includes('rx="26"')) {
  throw new Error('logo-mark-square.svg has no rx="26" — the squared iOS icon '
    + 'would silently come out rounded. Fix the mark, not this check.');
}
const SQUARED = MARK.replace('rx="26"', 'rx="0"');
if (SQUARED === MARK) throw new Error('the rx replace changed nothing');

const png = (svg, size) => sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();

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

await writeFile(pub('favicon.svg'), MARK.endsWith('\n') ? MARK : `${MARK}\n`);

const sizes = [16, 32, 48];
const images = [];
for (const size of sizes) images.push({ size, data: await png(MARK, size) });
await writeFile(pub('favicon.ico'), ico(images));

// 180x180 is what iOS asks for; it is also what Android reads when there is no
// manifest. No transparency and no rounding: the OS applies its own mask, and a
// rounded icon inside a rounded mask gets clipped twice.
await sharp(Buffer.from(SQUARED)).resize(180, 180).png().toFile(pub('apple-touch-icon.png'));

console.log(`favicon.svg, favicon.ico (${sizes.join('/')}), apple-touch-icon.png`);
