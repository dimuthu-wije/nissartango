/**
 * Run with:  npm test
 *
 * src/lib/span.js renders when an occurrence starts and ends. It exists because
 * `duration_minutes` had exactly one use in the site -- schema.org's `endDate`
 * -- so it was public to machines and invisible to readers. On 2026-10-02 the
 * Mauro et Sol workshop's markup said three one-hour sessions for 120 € while
 * the page said only "à 18:00".
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { endOf, timeSpan, spanLabel } from '../src/lib/span.js';

const PARIS = 'Europe/Paris';
const at = (iso) => new Date(iso);

test('a known length renders as a span', () => {
  assert.equal(spanLabel(at('2026-10-02T16:00:00Z'), 180, PARIS), 'de 18:00 à 21:00');
  assert.equal(spanLabel(at('2026-10-02T16:00:00Z'), 60, PARIS), 'de 18:00 à 19:00');
});

test('no length renders the start alone, and that is a real answer', () => {
  // The Option-3 shape: a multi-day workshop whose days differ in length cannot
  // be described by one duration, so the field is left empty on purpose and no
  // endDate is published. "à 18:00" must read as finished, not as broken.
  assert.equal(spanLabel(at('2026-10-02T16:00:00Z'), null, PARIS), 'à 18:00');
  assert.equal(spanLabel(at('2026-10-02T16:00:00Z'), undefined, PARIS), 'à 18:00');
  assert.equal(endOf(at('2026-10-02T16:00:00Z'), null), null);
});

test('zero and nonsense are unknown, not instantaneous', () => {
  // events_duration_minutes_check is `> 0 and <= 10080`, so neither can be
  // stored -- but "de 18:00 à 18:00" would be worse than no span at all.
  for (const bad of [0, -30, NaN, '', 'soon', {}]) {
    assert.equal(spanLabel(at('2026-10-02T16:00:00Z'), bad, PARIS), 'à 18:00', String(bad));
  }
});

test('crossing local midnight says so', () => {
  // A milonga from 21:00 running four hours ends at 01:00 the NEXT day.
  // "de 21:00 à 01:00" alone reads as an event that went backwards in time.
  assert.equal(spanLabel(at('2026-09-10T19:00:00Z'), 240, PARIS),
    'de 21:00 à 01:00 (le lendemain)');
  const s = timeSpan(at('2026-09-10T19:00:00Z'), 240, PARIS);
  assert.equal(s.nextDay, true);
  assert.equal(s.start, '21:00');
  assert.equal(s.end, '01:00');
});

test('the next day is decided by the local date, not by the hour', () => {
  // 23:30 + 20 minutes is the next day at 23:50 + 20. Comparing clock faces
  // would get one of these wrong; comparing local date keys gets both right.
  assert.equal(timeSpan(at('2026-09-10T21:30:00Z'), 20, PARIS).nextDay, false); // 23:30 -> 23:50
  assert.equal(timeSpan(at('2026-09-10T21:50:00Z'), 20, PARIS).nextDay, true);  // 23:50 -> 00:10
});

test('the autumn changeover is handled by the clock, not by arithmetic', () => {
  // 2026-10-25 is the last Sunday of October: 03:00 becomes 02:00, so that day
  // has 25 hours. Starting 14:00 on the 24th and running 1500 minutes (25 h)
  // ends at 14:00 on the 25th -- NOT 15:00, which is what adding 25 hours to a
  // wall clock would give.
  assert.equal(spanLabel(at('2026-10-24T12:00:00Z'), 1500, PARIS),
    'de 14:00 à 14:00 (le lendemain)');
});

test('the spring changeover too, in the other direction', () => {
  // 2026-03-29: 02:00 becomes 03:00, so that day has 23 hours. 22:00 on the
  // 28th plus 300 minutes (5 h) is 04:00 on the 29th by the clock, because one
  // of those hours does not exist.
  const s = timeSpan(at('2026-03-28T21:00:00Z'), 300, PARIS);
  assert.equal(s.start, '22:00');
  assert.equal(s.end, '04:00');
  assert.equal(s.nextDay, true);
});

test('formatting happens in the EVENT zone, never the builder time zone', () => {
  // The Cloudflare builder runs in UTC. A formatter without an explicit zone
  // prints 16:00 for an 18:00 workshop -- right on a laptop in Paris, wrong in
  // production, and only for half the year.
  assert.equal(spanLabel(at('2026-10-02T16:00:00Z'), 60, 'Europe/Paris'), 'de 18:00 à 19:00');
  assert.equal(spanLabel(at('2026-10-02T16:00:00Z'), 60, 'UTC'), 'de 16:00 à 17:00');
  assert.equal(spanLabel(at('2026-10-02T16:00:00Z'), 60, 'America/Argentina/Buenos_Aires'),
    'de 13:00 à 14:00');
});
