/**
 * Run with:  npm test
 *
 * These exist for one mistake that is invisible once made: re-stamping the
 * consent timestamp on every save.
 *
 * `contact_email_consent_at` records WHEN somebody agreed that an address may
 * be published permanently. A form that writes `now()` each time it saves
 * still satisfies the CHECK constraint, still shows the right thing on screen,
 * still publishes the right address — and has quietly replaced the answer to
 * the only question the column exists to answer. Nothing downstream complains,
 * because nothing downstream knows what the date was supposed to be.
 *
 * The second test below is the one that catches it, and it is the reason this
 * logic is a separate file rather than three lines inside organizer.js.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { consentFor } from '../editor/public/consent.js';

const NOW = new Date('2027-03-01T12:00:00.000Z');
const EARLIER = '2026-11-05T09:30:00.000Z';

test('newly published: stamped with now()', () => {
  assert.deepEqual(
    consentFor('hi@example.org', true, null, NOW),
    { value: 'hi@example.org', consentAt: NOW.toISOString() },
  );
});

test('still published: the ORIGINAL stamp survives a re-save', () => {
  // The whole point. Saving an unchanged row must not move the date.
  assert.deepEqual(
    consentFor('hi@example.org', true, EARLIER, NOW),
    { value: 'hi@example.org', consentAt: EARLIER },
  );
});

test('withdrawn: the value goes, the record that consent was given stays', () => {
  // A stamp with no value is legal -- the CHECK is one-directional -- and is
  // exactly the shape a withdrawal should leave. Nulling the stamp as well
  // would erase the only evidence the publication was ever agreed to.
  assert.deepEqual(
    consentFor('', true, EARLIER, NOW),
    { value: null, consentAt: EARLIER },
  );
  assert.deepEqual(
    consentFor(null, false, EARLIER, NOW),
    { value: null, consentAt: EARLIER },
  );
});

test('unticked: nothing is published even with a value typed', () => {
  // The database would refuse this pairing anyway. The form must not send it
  // and then blame the constraint.
  assert.deepEqual(
    consentFor('hi@example.org', false, null, NOW),
    { value: null, consentAt: null },
  );
});

test('never consented and nothing typed: both stay null', () => {
  assert.deepEqual(consentFor('', false, null, NOW), { value: null, consentAt: null });
  assert.deepEqual(consentFor(undefined, false, undefined, NOW), { value: null, consentAt: null });
});

test('whitespace is not a value', () => {
  // ' ' would pass a truthiness check and fail organizers_contact_phone_check
  // (btrim(contact_phone) <> ''), which is a round trip to learn nothing.
  assert.deepEqual(consentFor('   ', true, null, NOW), { value: null, consentAt: null });
});

test('a typed value is trimmed, because the constraint compares btrim', () => {
  assert.deepEqual(
    consentFor('  hi@example.org  ', true, null, NOW),
    { value: 'hi@example.org', consentAt: NOW.toISOString() },
  );
});

test('the pair the database will accept: never a value without a stamp', () => {
  // The invariant, stated once over every combination rather than per case.
  for (const value of ['hi@example.org', '', null, '   ']) {
    for (const ticked of [true, false]) {
      for (const was of [null, EARLIER]) {
        const { value: v, consentAt } = consentFor(value, ticked, was, NOW);
        if (v !== null) {
          assert.notEqual(consentAt, null,
            `value without consent for (${JSON.stringify(value)}, ${ticked}, ${was})`);
        }
      }
    }
  }
});
