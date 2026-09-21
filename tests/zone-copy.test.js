/**
 * Run with:  npm test
 *
 * editor/public/zone.js is a verbatim copy of src/lib/zone.js, because the
 * editor is a separate static deployment with no build step and cannot import
 * across the repo. A copy is a liability: the original changes, the copy does
 * not, and the two quietly disagree.
 *
 * This is the thing that makes the copy tolerable. It imports BOTH and asserts
 * they agree — including on the two nights a year when getting timezone
 * arithmetic wrong is visible, and on a value that round-trips through the
 * pair of functions the form actually uses.
 *
 * If this fails, do not fix it by editing editor/public/zone.js by hand. Copy
 * src/lib/zone.js over it again, header comment included.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import * as original from '../src/lib/zone.js';
import * as copy from '../editor/public/zone.js';

const PARIS = 'Europe/Paris';

test('the copy exports exactly what the original does', () => {
  assert.deepEqual(Object.keys(copy).sort(), Object.keys(original).sort());
});

test('both agree on the instant for a wall-clock time', () => {
  const cases = [
    { year: 2027, month: 1, day: 15, hour: 20, minute: 0 },   // winter, CET
    { year: 2027, month: 7, day: 15, hour: 20, minute: 0 },   // summer, CEST
    // Spring forward: 02:00 -> 03:00 on the last Sunday of March. 02:30 does
    // not exist; both must resolve it the same way, whatever that way is.
    { year: 2027, month: 3, day: 28, hour: 2, minute: 30 },
    // Autumn back: 03:00 -> 02:00 on the last Sunday of October. 02:30 happens
    // twice; the original documents resolving to the first.
    { year: 2027, month: 10, day: 31, hour: 2, minute: 30 },
  ];
  for (const parts of cases) {
    assert.equal(
      original.zonedToInstant(parts, PARIS).toISOString(),
      copy.zonedToInstant(parts, PARIS).toISOString(),
      `disagreed on ${JSON.stringify(parts)}`,
    );
  }
});

test('both agree on the offset across a changeover', () => {
  for (const iso of ['2027-01-15T12:00:00Z', '2027-07-15T12:00:00Z',
                     '2027-03-28T00:59:00Z', '2027-03-28T01:01:00Z']) {
    const d = new Date(iso);
    assert.equal(original.offsetMs(d, PARIS), copy.offsetMs(d, PARIS), `disagreed at ${iso}`);
  }
});

test('the round trip the form relies on survives both directions', () => {
  // The form does parts -> instant on save, and instant -> parts when loading
  // an event to edit. A mismatch between those two is how an event drifts an
  // hour every time somebody opens and saves it without changing anything.
  const parts = { year: 2027, month: 7, day: 15, hour: 20, minute: 30 };
  const instant = copy.zonedToInstant(parts, PARIS);
  const back = copy.partsInZone(instant, PARIS);
  assert.equal(back.year, parts.year);
  assert.equal(back.month, parts.month);
  assert.equal(back.day, parts.day);
  assert.equal(back.hour, parts.hour);
  assert.equal(back.minute, parts.minute);
});
