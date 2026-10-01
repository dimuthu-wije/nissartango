// What happens at an event, as a SET of formats rather than one value.
//
// An evening is often a class AND then dancing. `events.type` held one enum
// value, so the only way to say both was the title -- production has an event
// called "Milonga précédée d'une practica", which is prose where a field
// should be: nothing can filter on it, and the page showed one badge for a
// two-part evening. That column was dropped on 2026-10-01 (20261001140000);
// this is the only thing that answers the question now.
//
// `soiree` exists because this agenda is tango-FIRST, not tango-only
// (confirmed 2026-10-01: bachata, kizomba and danse corse are on it on
// purpose) and every other value is tango vocabulary. A Corsican dance evening
// was stored as a `milonga`, and its page said so to a reader. "Milonga" is
// what a tango social evening is called, not what any social evening is.
//
// THE DANCE STYLE IS NOT HERE. It is in every such event's title, and a
// `dance` field only earns its keep when something filters on it. Two axes in
// one column is the mistake being undone; adding a third column nothing reads
// would be the next one.
//
// PURE .js, like zone.js, price.js and payment.js, for two reasons: Node can
// test it without astro:content, and the editor -- a separate static
// deployment with no build step -- can load the same file as a verbatim copy
// at editor/public/format.js. tests/format.test.js holds the two honest.

/** Slug -> French label. The ORDER is the reading order of a badge list. */
export const FORMAT_LABELS = {
  cours: 'Cours',
  practica: 'Practica',
  milonga: 'Milonga',
  stage: 'Stage',
  demo: 'Démonstration',
  festival: 'Festival',
  soiree: 'Soirée',
};

/** The same table as the editor's checkboxes want it. */
export const FORMATS = Object.entries(FORMAT_LABELS)
  .map(([value, label]) => ({ value, label }));

const ORDER = Object.keys(FORMAT_LABELS);

/**
 * The formats of an event, deduplicated and in canonical order.
 *
 * CANONICAL ORDER, NOT STORED ORDER, so "Soirée · Cours" can never appear:
 * ticking boxes in an arbitrary sequence must not change how the page reads.
 * The table above is ordered so the common pairs come out chronologically —
 * `Cours · Soirée`, `Practica · Milonga`.
 *
 * NO LONGER FALLS BACK TO `type`. It did for one day: 20261001120000 left
 * `formats` nullable while the previously-deployed editor still wrote only
 * `type`, and 20261001140000 dropped that column once the editor had caught up.
 * `formats` is NOT NULL now, so a row without one cannot exist.
 *
 * An unknown slug is KEPT rather than dropped: a value the database accepted
 * and this file has not heard of should render as itself, not vanish.
 */
export function formatsOf(event) {
  const raw = Array.isArray(event?.formats) ? event.formats : [];
  const seen = new Set(raw.filter(Boolean));
  return [
    ...ORDER.filter((slug) => seen.has(slug)),
    ...[...seen].filter((slug) => !ORDER.includes(slug)).sort(),
  ];
}

/** "Cours · Soirée", or '' when an event somehow has no format at all. */
export function formatSummary(event) {
  return formatsOf(event).map((slug) => FORMAT_LABELS[slug] ?? slug).join(' · ');
}

/**
 * "Cours et soirée" — the same thing as a fragment of a French sentence, for
 * the meta description and the structured data, where a middot would be read
 * aloud by a screen reader and indexed by a search engine as punctuation.
 *
 * Only the first word is capitalised, because the result starts a sentence and
 * the rest are common nouns. French does not title-case them; the agenda's
 * dates learned that the hard way.
 */
export function formatProse(event) {
  const labels = formatsOf(event).map((slug) => FORMAT_LABELS[slug] ?? slug);
  if (!labels.length) return '';
  return [labels[0], ...labels.slice(1).map((l) => l.toLocaleLowerCase('fr'))]
    .join(' et ');
}
