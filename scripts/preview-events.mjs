/**
 * A realistic agenda to design against, without touching the real one.
 *
 *     node scripts/preview-events.mjs          # fake events on
 *     node scripts/preview-events.mjs --off    # back to the real agenda
 *
 * WHY THIS EXISTS. The live database holds two events, one of which is a
 * cancellation, so the listing cannot be judged at all -- a row, a range, a
 * section, a filter and a type scale all behave differently at sixteen rows
 * than at one. Twice this fixture was written by hand into gitignored scratch
 * and deleted afterwards, and the second time it immediately exposed a defect
 * nobody had named: a three-day festival filling three byte-identical rows.
 * That is worth keeping rather than retyping.
 *
 * NOTHING HERE CAN REACH PRODUCTION, and that is structural rather than
 * careful:
 *
 *   1. it writes data/snapshot.preview.json and never data/snapshot.json --
 *      asserted below, with the real file's md5 compared before and after;
 *   2. every snapshot file and the pointer are gitignored, so none of it can
 *      be committed, let alone deployed;
 *   3. Cloudflare's build command is `npm run build`, which runs
 *      fetch-content.mjs against Supabase and REWRITES the pointer. A deploy
 *      reads real content even if a preview pointer somehow reached it.
 *
 * Running `npm run build` locally also resets the pointer, for the same
 * reason. Only `npm run build:snapshot` reads what this writes.
 *
 * THE DATES ARE RELATIVE TO TODAY, deliberately. The throwaway versions hard
 * coded October dates and would have quietly become an archive fixture a month
 * later -- a fixture that silently stops testing the thing it was built for is
 * worse than no fixture.
 *
 * WHAT IT DELIBERATELY COVERS, because each one renders differently:
 *   every format and two combinations · all four recurrences · a multi-day
 *   event (one row, a date range) · a cancelled DATE and a moved one · an
 *   event cancelled OUTRIGHT, which is a different state and a different
 *   banner · free, full-price, member-price and a price note · a signup link
 *   (the CTA) · named teachers · an event that crosses midnight · one with no
 *   duration at all · rich prose · a past event, so /archives/ is not empty.
 *
 * FLYERS ARE COVERED, as of 2026-10-12, because the card grid is built around
 * them and a grid of empty boxes cannot be judged. `events.image_file` names a
 * file that fetch-content downloads into src/assets/events/, so this writes
 * placeholder JPEGs there -- `preview-*.jpg`, deliberately drab so nobody
 * mistakes a screenshot for finished work -- and removes them again on --off.
 * That directory is gitignored (.gitignore:40), like everything else here.
 *
 * They are PLACEHOLDERS, not photographs. They prove the layout, the crop and
 * the srcset; they say nothing about how a real flyer -- usually portrait,
 * usually dense with type -- survives a square crop. That still needs a real
 * upload.
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync, readdirSync, mkdirSync } from 'node:fs';
import sharp from 'sharp';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { zonedToInstant } from '../src/lib/zone.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DATA = path.join(ROOT, 'data');
const REAL = path.join(DATA, 'snapshot.json');
const FAKE = path.join(DATA, 'snapshot.preview.json');
const POINTER = path.join(DATA, '.snapshot-current');
const ASSETS = path.join(ROOT, 'src', 'assets', 'events');
const TZ = 'Europe/Paris';

const md5 = (f) => (existsSync(f) ? createHash('md5').update(readFileSync(f)).digest('hex') : null);
const realBefore = md5(REAL);

/** Only ever the files this script wrote. A real flyer downloaded by
 *  fetch-content must survive `--off`. */
const dropPlaceholders = () => {
  if (!existsSync(ASSETS)) return 0;
  const gone = readdirSync(ASSETS).filter((f) => f.startsWith('preview-'));
  for (const f of gone) unlinkSync(path.join(ASSETS, f));
  return gone.length;
};

if (process.argv.includes('--off')) {
  writeFileSync(POINTER, 'snapshot.json\n');
  if (existsSync(FAKE)) unlinkSync(FAKE);
  const n = dropPlaceholders();
  if (n) console.log(`  removed ${n} placeholder image(s) from src/assets/events/`);
  if (md5(REAL) !== realBefore) throw new Error('the real snapshot changed — it must not');
  console.log('preview OFF — the pointer is back on snapshot.json');
  console.log(`  real snapshot untouched (md5 ${realBefore?.slice(0, 12)}…)`);
  console.log('  run: npm run build:snapshot');
  process.exit(0);
}

if (!existsSync(REAL)) {
  throw new Error('data/snapshot.json is missing — run `npm run build` once to fetch it');
}
const real = JSON.parse(readFileSync(REAL, 'utf8'));
if (!real.events?.length) throw new Error('the real snapshot has no events to use as a template');
if (!real.organizers?.length) throw new Error('the real snapshot has no organizers');

/* Organizer rows are borrowed from the real snapshot rather than invented, so
   the names, slugs and social handles on the page are the real ones. It is
   read-only: nothing is written back. */
const org = real.organizers.map((o) => o.id);
const TEMPLATE = real.events[0];

/** A Paris wall-clock time, `d` days from today, as a real instant. */
const at = (days, hour, minute = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return zonedToInstant(
    { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), hour, minute },
    TZ,
  ).toISOString();
};
/** The local date `d` days from today, as YYYY-MM-DD, for extra_dates. */
const day = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const ev = (o) => ({
  ...TEMPLATE, id: randomUUID(), legacy_slugs: [], extra_dates: [], teachers: [],
  price_member: null, price_note: null, signup_url: null, image_path: null, image_file: null,
  body: '', cancelled_at: null, cancellation_note: null, recurrence: 'none',
  recurrence_end: null, duration_minutes: 180, timezone: TZ,
  location_address: null, location_postal_code: null, organizer_id: org[0], ...o,
});

const BODY = [
  'Deux jours avec **Mauro Caiazza** et **Sol Cerquides**, dans la grande salle.',
  '',
  '## Le programme',
  '',
  'Samedi est consacré à la marche et à l’axe partagé ; dimanche aux enrosques.',
  'Chaque journée se termine par une practica ouverte, incluse dans le tarif.',
  '',
  '- 14h00 — accueil et échauffement',
  '- 14h30 — premier atelier',
  '- 17h00 — practica',
  '',
  '> Niveau intermédiaire : il faut être à l’aise avec la marche en ligne.',
  '',
  'Les places sont limitées à douze couples.',
].join('\n');

const EVENTS = [
  // --- one-offs, the "news" half of the agenda ---
  ev({ slug: `${day(5)}-stage-mauro-et-sol`, title: 'Stage intensif avec Mauro et Sol',
       starts_at: at(5, 14), formats: ['stage'], city: 'Nice', location_name: 'Studio Montmartre',
       location_address: '12 rue Gubernatis', price_full: 120, price_member: 95,
       price_note: 'tarif étudiant sur présentation de la carte',
       teachers: ['Mauro Caiazza', 'Sol Cerquides'], extra_dates: [day(6)],
       signup_url: 'https://example.org/inscription', body: BODY, organizer_id: org[1] }),
  ev({ slug: `${day(6)}-bal-bachata-kizomba`, title: 'Bal bachata & kizomba',
       starts_at: at(6, 21), formats: ['soiree'], city: 'Antibes',
       location_name: 'Salle des Associations', price_full: 12, organizer_id: org[2] }),
  ev({ slug: `${day(9)}-demonstration-theatre-de-verdure`,
       title: 'Encuentro de la Baie des Anges', starts_at: at(9, 19),
       formats: ['encuentro'], city: 'Nice', location_name: 'Théâtre de Verdure',
       price_full: 0, duration_minutes: 60 }),
  ev({ slug: `${day(13)}-nuit-de-la-milonga`, title: 'La Nuit de la Milonga',
       starts_at: at(13, 22), formats: ['milonga', 'soiree'], city: 'Nice',
       location_name: 'Hôtel Westminster', price_full: 20, duration_minutes: 300,
       organizer_id: org[2] }),       // crosses midnight: "(le lendemain)"
  ev({ slug: `${day(18)}-stage-de-danse-corse`, title: 'Stage de danse corse',
       starts_at: at(18, 15), formats: ['stage'], city: 'Villefranche-sur-Mer',
       location_name: 'Citadelle', price_full: 25, duration_minutes: null,
       organizer_id: org[2] }),        // no duration: the page shows only a start
  ev({ slug: `${day(26)}-festival-tango-cote-d-azur`,
       title: 'Festival Tango Côte d’Azur — troisième édition', starts_at: at(26, 16),
       formats: ['festival', 'milonga'], city: 'Cannes', location_name: 'Palais des Festivals',
       price_full: 90, price_member: 70, extra_dates: [day(27), day(28)],
       signup_url: 'https://example.org/festival', organizer_id: org[1] }),
  ev({ slug: `${day(40)}-milonga-des-lumieres`, title: 'Milonga des Lumières',
       starts_at: at(40, 20, 30), formats: ['milonga'], city: 'Menton',
       location_name: 'Palais de l’Europe', price_full: 15, organizer_id: org[2] }),

  // --- regulars, the "furniture" half ---
  ev({ slug: `${day(1)}-cours-debutants`, title: 'Cours débutants du lundi',
       starts_at: at(1, 19, 30), formats: ['cours'], city: 'Nice', recurrence: 'weekly',
       recurrence_end: day(240), location_name: 'MJC Magnan', price_full: 15,
       duration_minutes: 90 }),
  ev({ slug: `${day(2)}-practica-du-mardi`, title: 'Practica du mardi',
       starts_at: at(2, 20, 30), formats: ['practica'], city: 'Nice', recurrence: 'weekly',
       recurrence_end: day(240), location_name: 'Le Hangar', price_full: 8 }),
  ev({ slug: `${day(3)}-cours-puis-practica`, title: 'Cours intermédiaire puis practica',
       starts_at: at(3, 20), formats: ['cours', 'practica'], city: 'Nice', recurrence: 'weekly',
       recurrence_end: day(240), location_name: 'Studio Montmartre', price_full: 18,
       price_member: 12, organizer_id: org[1] }),
  ev({ slug: `${day(4)}-milonga-casita`,
       title: 'MILONGA précédée d’une Pràctica "Jeudi c’est permis !" à la Casita',
       starts_at: at(4, 20), formats: ['milonga', 'practica'], city: 'Nice',
       recurrence: 'weekly', recurrence_end: day(240),
       location_name: 'La Casita del Tango', price_full: 10, organizer_id: org[2] }),
  ev({ slug: `${day(8)}-bicilonga`, title: 'Bicilonga — la milonga à vélo',
       starts_at: at(8, 18), formats: ['milonga'], city: 'Nice', recurrence: 'biweekly',
       recurrence_end: day(200), location_name: 'Promenade du Paillon', price_full: 0 }),
  ev({ slug: `${day(11)}-milonga-du-premier-samedi`, title: 'Milonga du premier samedi',
       starts_at: at(11, 20, 30), formats: ['milonga'], city: 'Cannes', recurrence: 'monthly',
       recurrence_end: day(240), location_name: 'Villa Domergue', price_full: 14,
       organizer_id: org[1] }),

  // An event cancelled OUTRIGHT, not one cancelled date. Different state,
  // different banner, and it was invisible until this row existed.
  ev({ slug: `${day(21)}-milonga-annulee`, title: 'Milonga de la Toussaint',
       starts_at: at(21, 21), formats: ['milonga'], city: 'Nice',
       location_name: 'La Casita del Tango', price_full: 12,
       cancelled_at: new Date().toISOString(),
       cancellation_note: 'la salle a été réquisitionnée, nous cherchons un autre lieu',
       organizer_id: org[2] }),

  // --- the past, so /archives/ is not empty ---
  ev({ slug: `${day(-30)}-milonga-aux-amarras`, title: 'MILONGA "El Gato Tanguero" aux Amarras',
       starts_at: at(-30, 20, 30), formats: ['milonga'], city: 'Nice',
       location_name: 'Les Amarras', price_full: 10, organizer_id: org[0] }),
];

// Placeholder flyers for the cards that would carry one. Drab on purpose: a
// screenshot of this must not be mistakable for a finished page, and a bright
// invented image would flatter a layout that has never met a real poster.
// Portrait source, square crop -- which is what a real flyer will do.
mkdirSync(ASSETS, { recursive: true });
const TONES = ['#CFC8BE', '#C3BDB4', '#D6CFC5', '#BDB6AC'];
let toned = 0;
for (const e of EVENTS) {
  if (!['stage-mauro', 'festival-tango', 'nuit-de-la-milonga', 'encuentro'].some((k) => e.slug.includes(k))) continue;
  // The name fetch-content would give it. That script derives image_file from
  // image_path by flattening, and SKIPS the download when the file is already
  // on disk -- so writing it under exactly that name makes the fixture satisfy
  // the real pipeline instead of going round it. Getting this wrong fails the
  // build loudly, which is how it was found.
  e.image_path = `preview/${e.id}/${e.slug}.jpg`;
  const file = e.image_path.replace(/[^a-zA-Z0-9._-]+/g, '-');
  const bg = TONES[toned % TONES.length];
  const fg = toned % 2 ? '#8E867B' : '#A29A8F';
  await sharp(Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200">
       <rect width="900" height="1200" fill="${bg}"/>
       <rect x="0" y="720" width="900" height="16" fill="${fg}"/>
       <circle cx="450" cy="430" r="190" fill="none" stroke="${fg}" stroke-width="16"/>
     </svg>`,
  )).jpeg({ quality: 80 }).toFile(path.join(ASSETS, file));
  e.image_file = file;
  toned += 1;
}

const find = (frag) => EVENTS.find((e) => e.slug.includes(frag)).id;
const EXCEPTIONS = [
  { event_id: find('milonga-casita'), occurrence_date: day(11), kind: 'cancelled',
    note: 'salle indisponible', moved_starts_at: null },
  { event_id: find('practica-du-mardi'), occurrence_date: day(16), kind: 'moved',
    note: 'décalée d’une heure', moved_starts_at: at(16, 21, 30) },
];

writeFileSync(FAKE, JSON.stringify({
  ...real,
  fetched_at: new Date().toISOString(),
  checksum: createHash('md5').update('preview-fixture').digest('hex'),
  counts: { events: EVENTS.length, organizers: real.organizers.length,
            exceptions: EXCEPTIONS.length },
  events: EVENTS, exceptions: EXCEPTIONS,
}, null, 2));
writeFileSync(POINTER, 'snapshot.preview.json\n');

if (md5(REAL) !== realBefore) throw new Error('the real snapshot changed — it must not');

console.log(`preview ON — ${EVENTS.length} events, ${EXCEPTIONS.length} exceptions, ${toned} placeholder flyer(s)`);
console.log(`  real snapshot untouched (md5 ${realBefore.slice(0, 12)}…)`);
console.log('  run: npm run build:snapshot && npm run preview');
console.log('  off: node scripts/preview-events.mjs --off');
