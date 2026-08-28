/**
 * Run with:  npm test        (which forces TZ=UTC)
 *
 * TZ=UTC is not incidental. The bug this file exists to prevent is invisible
 * on a machine set to Europe/Paris, which is every machine this project is
 * developed on and none of the machines it is built on. Forcing UTC here means
 * a regression fails on the laptop instead of six months later, seasonally, in
 * production.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { expand, upcoming, nextDate } from '../src/lib/occurrences.js';
import { localDateKey, zonedToInstant, partsInZone } from '../src/lib/zone.js';

const PARIS = 'Europe/Paris';

/** helper: what the clock in Paris reads, as 'YYYY-MM-DD HH:MM' */
const paris = (d) => {
  const p = partsInZone(d, PARIS);
  const pad = (n) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
};
const utc = (d) => d.toISOString().slice(0, 16).replace('T', ' ');

const weekly = (starts_at, extra = {}) => ({
  id: 'e1', slug: 's', title: 'Practica du mardi', type: 'practica',
  starts_at, duration_minutes: 120, timezone: PARIS,
  recurrence: 'weekly', recurrence_end: null,
  cancelled_at: null, cancellation_note: null, ...extra,
});

test('the process is running in UTC, which is the point', () => {
  assert.equal(new Date('2026-07-01T12:00:00Z').getHours(), 12);
});

test('21:00 stays 21:00 across the October changeover', () => {
  // 25 October 2026: Paris goes 03:00 -> 02:00, UTC+2 -> UTC+1.
  const e = weekly('2026-10-20T21:00:00+02:00');
  const got = expand(e, [], { now: new Date('2026-10-19T00:00:00Z'), horizonMonths: 1 });

  assert.deepEqual(got.slice(0, 3).map((o) => paris(o.start)), [
    '2026-10-20 21:00',
    '2026-10-27 21:00',
    '2026-11-03 21:00',
  ]);
  // ...which means the absolute instant MOVES by an hour. That is correct,
  // and it is exactly what naive +7d arithmetic gets wrong.
  assert.deepEqual(got.slice(0, 3).map((o) => utc(o.start)), [
    '2026-10-20 19:00',
    '2026-10-27 20:00',
    '2026-11-03 20:00',
  ]);
});

test('21:00 stays 21:00 across the March changeover', () => {
  // 29 March 2026: Paris goes 02:00 -> 03:00, UTC+1 -> UTC+2.
  const e = weekly('2026-03-24T21:00:00+01:00');
  const got = expand(e, [], { now: new Date('2026-03-23T00:00:00Z'), horizonMonths: 1 });

  assert.deepEqual(got.slice(0, 3).map((o) => paris(o.start)), [
    '2026-03-24 21:00',
    '2026-03-31 21:00',
    '2026-04-07 21:00',
  ]);
  assert.deepEqual(got.slice(0, 3).map((o) => utc(o.start)), [
    '2026-03-24 20:00',
    '2026-03-31 19:00',
    '2026-04-07 19:00',
  ]);
});

test('a 00:30 milonga is keyed on the Paris date, not the UTC one', () => {
  // 00:30 Paris on 5 August is 22:30 UTC on 4 August.
  const e = weekly('2026-08-05T00:30:00+02:00', { title: 'Milonga de minuit' });
  const got = expand(e, [], { now: new Date('2026-08-01T00:00:00Z'), horizonMonths: 1 });

  assert.equal(utc(got[0].start), '2026-08-04 22:30');
  assert.equal(got[0].dateKey, '2026-08-05', 'the key must be the local date');
  assert.deepEqual(got.slice(0, 3).map((o) => o.dateKey),
    ['2026-08-05', '2026-08-12', '2026-08-19']);
});

test('an exception keyed on the local date actually matches', () => {
  const e = weekly('2026-08-05T00:30:00+02:00');
  const exceptions = [{
    event_id: 'e1', occurrence_date: '2026-08-12', kind: 'cancelled',
    note: 'Pas de milonga cette nuit', moved_starts_at: null,
  }];
  const got = expand(e, exceptions, { now: new Date('2026-08-01T00:00:00Z'), horizonMonths: 1 });

  const hit = got.find((o) => o.dateKey === '2026-08-12');
  assert.equal(hit.cancelled, true);
  assert.equal(hit.note, 'Pas de milonga cette nuit');
  assert.equal(got.filter((o) => o.cancelled).length, 1, 'exactly one date is off');

  // The failure mode this guards: keying on the UTC date would look for
  // 2026-08-11 and match nothing at all.
  assert.equal(got.some((o) => o.dateKey === '2026-08-11'), false);
});

test('a moved occurrence lands at its new instant', () => {
  const e = weekly('2026-09-01T21:00:00+02:00');
  const exceptions = [{
    event_id: 'e1', occurrence_date: '2026-09-08', kind: 'moved',
    note: 'Décalée au mercredi', moved_starts_at: '2026-09-09T21:00:00+02:00',
  }];
  const got = expand(e, exceptions, { now: new Date('2026-09-01T00:00:00Z'), horizonMonths: 1 });

  const moved = got.find((o) => o.moved);
  assert.equal(paris(moved.start), '2026-09-09 21:00');
  assert.equal(moved.dateKey, '2026-09-09');
  assert.equal(moved.cancelled, false);
});

test('nextDate skips a cancelled date', () => {
  const e = weekly('2026-09-01T21:00:00+02:00');
  const exceptions = [{
    event_id: 'e1', occurrence_date: '2026-09-08', kind: 'cancelled',
    note: null, moved_starts_at: null,
  }];
  const now = new Date('2026-09-02T00:00:00Z');
  assert.equal(paris(nextDate(e, exceptions, { now })), '2026-09-15 21:00');
});

test('a monthly series on the 31st skips short months', () => {
  const e = weekly('2026-01-31T21:00:00+01:00', { recurrence: 'monthly' });
  const got = expand(e, [], { now: new Date('2026-01-01T00:00:00Z'), horizonMonths: 5 });
  const days = got.map((o) => o.dateKey);
  assert.deepEqual(days, ['2026-01-31', '2026-03-31', '2026-05-31']);
  assert.equal(days.includes('2026-03-03'), false, 'February must not roll over');
});

test('recurrence_end includes the whole of its last day', () => {
  const e = weekly('2026-09-01T21:00:00+02:00', { recurrence_end: '2026-09-15' });
  const got = expand(e, [], { now: new Date('2026-08-01T00:00:00Z'), horizonMonths: 6 });
  assert.deepEqual(got.map((o) => o.dateKey),
    ['2026-09-01', '2026-09-08', '2026-09-15']);
});

test('a one-off event yields exactly one occurrence', () => {
  const e = weekly('2026-09-10T21:00:00+02:00', { recurrence: 'none' });
  const got = expand(e, [], { now: new Date('2026-09-01T00:00:00Z') });
  assert.equal(got.length, 1);
  assert.equal(paris(got[0].start), '2026-09-10 21:00');
});

test('upcoming() drops past occurrences and sorts across events', () => {
  const a = weekly('2026-09-01T21:00:00+02:00', { id: 'a', recurrence: 'none' });
  const b = weekly('2026-09-03T19:00:00+02:00', { id: 'b', recurrence: 'none' });
  const c = weekly('2026-08-01T19:00:00+02:00', { id: 'c', recurrence: 'none' });
  const got = upcoming([a, b, c], new Map(), { now: new Date('2026-08-15T00:00:00Z') });
  assert.deepEqual(got.map((o) => o.event.id), ['a', 'b']);
});

test('an event cancelled outright can be excluded from the listing', () => {
  const e = weekly('2026-09-01T21:00:00+02:00', {
    recurrence: 'none', cancelled_at: '2026-08-20T10:00:00Z',
  });
  const now = new Date('2026-08-25T00:00:00Z');
  assert.equal(upcoming([e], new Map(), { now }).length, 1);
  assert.equal(upcoming([e], new Map(), { now, includeCancelled: false }).length, 0);
});

test('localDateKey matches the database definition at midnight edges', () => {
  // public.occurrence_local_date(at, tz) = (at at time zone tz)::date
  const cases = [
    ['2026-08-05T00:30:00+02:00', '2026-08-05'],  // UTC says the 4th
    ['2026-11-04T00:30:00+01:00', '2026-11-04'],  // UTC says the 3rd
    ['2026-08-04T23:59:00+02:00', '2026-08-04'],
    ['2026-01-01T00:00:00+01:00', '2026-01-01'],
  ];
  for (const [iso, want] of cases) {
    assert.equal(localDateKey(new Date(iso), PARIS), want, iso);
  }
});

test('zonedToInstant round-trips through both changeovers', () => {
  const cases = [
    [{ year: 2026, month: 10, day: 25, hour: 1, minute: 30 }, '2026-10-24 23:30'],
    [{ year: 2026, month: 10, day: 25, hour: 4, minute: 0 },  '2026-10-25 03:00'],
    [{ year: 2026, month: 3,  day: 29, hour: 1, minute: 30 }, '2026-03-29 00:30'],
    [{ year: 2026, month: 3,  day: 29, hour: 4, minute: 0 },  '2026-03-29 02:00'],
  ];
  for (const [parts, wantUtc] of cases) {
    assert.equal(utc(zonedToInstant(parts, PARIS)), wantUtc, JSON.stringify(parts));
  }
});
