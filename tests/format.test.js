/**
 * Run with:  npm test
 *
 * Two jobs, like zone-copy.test.js: prove the behaviour, and keep
 * editor/public/format.js honest as a verbatim copy of src/lib/format.js. The
 * editor is a separate static deployment with no build step and cannot import
 * across the repo, so the copy exists; a copy nothing checks is a liability.
 *
 * If the copy test fails, do not hand-edit editor/public/format.js. Copy
 * src/lib/format.js over it again, header comment included.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import * as original from '../src/lib/format.js';
import * as copy from '../editor/public/format.js';

const { FORMAT_LABELS, FORMATS, formatsOf, formatSummary, formatProse } = original;

test('a single-format event reads as it always did', () => {
  assert.equal(formatSummary({ formats: ['milonga'] }), 'Milonga');
  assert.equal(formatSummary({ formats: ['demo'] }), 'Démonstration');
});

test('a class followed by dancing is two formats, in reading order', () => {
  // The point of the whole column. Ticking the boxes in either order must
  // produce the chronological reading, never "Soirée · Cours".
  assert.equal(formatSummary({ formats: ['cours', 'soiree'] }), 'Cours · Soirée');
  assert.equal(formatSummary({ formats: ['soiree', 'cours'] }), 'Cours · Soirée');
  assert.equal(formatSummary({ formats: ['milonga', 'practica'] }), 'Practica · Milonga');
});

test('duplicates collapse', () => {
  // The CHECK constraint cannot refuse ['cours','cours'] -- a check may not
  // contain a subquery (0A000), which is why there is only a length bound. So
  // the duplicate has to die somewhere, and this is where.
  assert.deepEqual(formatsOf({ formats: ['cours', 'cours'] }), ['cours']);
  assert.equal(formatSummary({ formats: ['cours', 'cours'] }), 'Cours');
});

test('`type` is gone and is no longer consulted', () => {
  // It was a one-day fallback: 20261001120000 left `formats` nullable while the
  // deployed editor still wrote only `type`, and 20261001140000 dropped the
  // column once the editor had caught up. A row carrying only `type` can no
  // longer exist -- `formats` is NOT NULL -- and if one somehow arrives, the
  // honest answer is nothing rather than a guess from a column this schema does
  // not have.
  assert.equal(formatSummary({ type: 'practica' }), '');
  assert.equal(formatSummary({ type: 'milonga', formats: ['cours', 'soiree'] }),
    'Cours · Soirée');
  assert.equal(formatSummary({ formats: null }), '');
  assert.equal(formatSummary({ formats: [] }), '');
});

test('an unknown slug renders as itself rather than vanishing', () => {
  // Same contract the templates had with `TYPE_LABELS[e.type] ?? e.type`: a
  // value the database accepted and this file has not heard of must still
  // reach the page. Silently dropping it would show a milonga as having no
  // format at all.
  assert.equal(formatSummary({ formats: ['bal'] }), 'bal');
  assert.equal(formatSummary({ formats: ['cours', 'bal'] }), 'Cours · bal');
});

test('nothing at all is empty, not "undefined"', () => {
  assert.equal(formatSummary({}), '');
  assert.equal(formatSummary(null), '');
  assert.deepEqual(formatsOf({}), []);
});

test('soiree exists, and every label is non-empty', () => {
  // soiree is the reason this migration happened: every other value is tango
  // vocabulary, and the agenda is tango-first, not tango-only.
  assert.equal(FORMAT_LABELS.soiree, 'Soirée');
  for (const [slug, label] of Object.entries(FORMAT_LABELS)) {
    assert.ok(label && label.trim(), `${slug} has no label`);
  }
});

test('FORMATS matches the database CHECK, exactly', () => {
  // events_formats_known in 20261001120000 lists these seven. If the two ever
  // disagree the editor offers a checkbox the database refuses, and the
  // refusal surfaces as a 400 with no explanation on screen.
  assert.deepEqual(FORMATS.map((f) => f.value),
    ['cours', 'practica', 'milonga', 'stage', 'demo', 'festival', 'soiree']);
});

test('the copy exports exactly what the original does', () => {
  assert.deepEqual(Object.keys(copy).sort(), Object.keys(original).sort());
});

test('the copy agrees on every case above', () => {
  const cases = [
    { formats: ['cours', 'soiree'] }, { formats: ['soiree', 'cours'] },
    { formats: ['cours', 'cours'] }, { type: 'practica' },
    { formats: ['bal'] }, {},
  ];
  for (const e of cases) {
    assert.equal(copy.formatSummary(e), original.formatSummary(e),
      `disagreed on ${JSON.stringify(e)}`);
  }
  assert.deepEqual(copy.FORMAT_LABELS, original.FORMAT_LABELS);
});

test('the prose form is a sentence fragment, not a badge', () => {
  // Goes into the meta description and the structured data, where a middot is
  // punctuation to a search engine and noise to a screen reader.
  assert.equal(formatProse({ formats: ['cours', 'soiree'] }), 'Cours et soirée');
  assert.equal(formatProse({ formats: ['practica', 'milonga'] }), 'Practica et milonga');
  assert.equal(formatProse({ formats: ['milonga'] }), 'Milonga');
  // Only the first word capitalised: the rest are common nouns and French does
  // not title-case them. The agenda's dates learned the same thing.
  assert.equal(formatProse({ formats: ['cours', 'demo'] }), 'Cours et démonstration');
  assert.equal(formatProse({}), '');
});

// ---------------------------------------------------------------------------
// The lists that must agree, read from the migrations themselves.
//
// WHY THIS EXISTS. 20261001120000 added `formats text[]` with a CHECK listing
// seven values and kept the single-valued `type`, so the editor writes
// `formats[0]` into an ENUM column. Six of the seven were enum labels.
// `soiree` -- the one the migration existed for -- was not, and the first real
// use of the feature failed with
//
//     invalid input value for enum event_type: "soiree"
//
// The copies that were checked were the ones somebody thought of as copies.
// The enum was not one of them, because `type` is scheduled for deletion --
// and a column scheduled for deletion is still a column that gets written to.
// ---------------------------------------------------------------------------
import { readdirSync, readFileSync } from 'node:fs';

/** Every migration, with SQL line comments stripped so prose cannot match. */
const migrations = (() => {
  const dir = new URL('../supabase/migrations/', import.meta.url);
  return readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
    .map((f) => readFileSync(new URL(f, dir), 'utf8'))
    .join('\n')
    .replace(/--[^\n]*/g, '');
})();

const quoted = (s) => [...s.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

test('event_type is dropped, and stays dropped', () => {
  // This test used to assert that the enum's labels matched FORMAT_LABELS,
  // because the editor wrote formats[0] into an enum column and a format that
  // was not a label was a save that failed -- which is exactly how `soiree`
  // broke. 20261001140000 removed the column and the type, so that divergence
  // is no longer possible rather than merely watched.
  //
  // What is worth asserting now is that it did not come back: a new enum column
  // for the same question would reintroduce two authorities for one fact, and
  // the CHECK below would stop being the only one.
  const drop = migrations.lastIndexOf('drop type public.event_type');
  assert.ok(drop > 0, 'event_type is not dropped anywhere in the migrations');

  const lastUse = Math.max(
    migrations.lastIndexOf('alter type public.event_type add value'),
    migrations.lastIndexOf('public.event_type not null'),
  );
  assert.ok(drop > lastUse,
    'something uses public.event_type AFTER it is dropped -- either the drop '
    + 'moved or a column was added back');
});

test('events_formats_known holds exactly the same list', () => {
  const check = migrations.match(/events_formats_known[\s\S]*?array\[([^\]]*)\]/);
  assert.ok(check, 'could not find events_formats_known in the migrations');
  assert.deepEqual(quoted(check[1]).sort(), Object.keys(FORMAT_LABELS).sort(),
    'the CHECK and FORMAT_LABELS disagree: the editor would offer a checkbox '
    + 'the database refuses, and the refusal reaches the person as a 400.');
});
