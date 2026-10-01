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

test('it falls back to the superseded `type` column', () => {
  // 20261001120000 leaves formats nullable for one deploy, so a row created by
  // the previously-deployed editor has only `type`.
  assert.equal(formatSummary({ type: 'practica' }), 'Practica');
  assert.equal(formatSummary({ type: 'practica', formats: null }), 'Practica');
  assert.equal(formatSummary({ type: 'practica', formats: [] }), 'Practica');
  // And `formats` WINS when it has anything, because it is the column that can
  // be right about a two-part evening.
  assert.equal(formatSummary({ type: 'milonga', formats: ['cours', 'soiree'] }),
    'Cours · Soirée');
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
