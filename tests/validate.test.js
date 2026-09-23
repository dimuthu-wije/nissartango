/**
 * Run with:  npm test
 *
 * editor/public/validate.js duplicates constraints that live on public.events.
 * Duplication drifts, so these tests pin the rules to the SAME shape the
 * database enforces — in particular the boundaries, which are where a mirror
 * and its original usually part company.
 *
 * What these tests do NOT do is prove the database agrees. Nothing in Node can:
 * the constraints are in Postgres. They prove the mirror behaves as documented,
 * and the constraint names in validate.js are what let someone check the pair
 * by eye.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { validate } from '../editor/public/validate.js';

/** A complete, valid event. Each test breaks exactly one thing. */
const ok = (over = {}) => ({
  organizer_id: '9ce3802d-98bc-493c-8bd7-a42b61e71943',
  title: 'Milonga du jeudi',
  city: 'Nice',
  starts_at_local: '2027-01-15T20:00',
  starts_at_date: '2027-01-15',
  duration_minutes: 180,
  recurrence: 'none',
  recurrence_end: null,
  location_postal_code: '06300',
  signup_url: 'https://example.org/book',
  price_full: 12,
  price_member: 10,
  cancelled_at_local: '',
  cancellation_note: null,
  ...over,
});

const names = (v) => validate(v).map(([f]) => f);

test('a complete event has nothing to fix', () => {
  assert.deepEqual(validate(ok()), []);
});

test('everything optional may be blank', () => {
  // The shape of a bare minimum entry: a title, a place, a time, nothing else.
  assert.deepEqual(validate(ok({
    duration_minutes: null, location_postal_code: null, signup_url: null,
    price_full: null, price_member: null,
  })), []);
});

test('the four required fields are required', () => {
  assert.deepEqual(names(ok({ title: '' })), ['title']);
  assert.deepEqual(names(ok({ city: '' })), ['city']);
  assert.deepEqual(names(ok({ organizer_id: '' })), ['organizer_id']);
  assert.deepEqual(names(ok({ starts_at_local: '' })), ['starts_at']);
});

test('duration is 1..10080, and the bounds are inclusive', () => {
  // events_duration_minutes_check: > 0 AND <= 10080
  assert.deepEqual(validate(ok({ duration_minutes: 1 })), [], '1 is allowed');
  assert.deepEqual(validate(ok({ duration_minutes: 10080 })), [], '10080 is allowed');
  assert.deepEqual(names(ok({ duration_minutes: 0 })), ['duration_minutes']);
  assert.deepEqual(names(ok({ duration_minutes: 10081 })), ['duration_minutes']);
  assert.deepEqual(names(ok({ duration_minutes: 90.5 })), ['duration_minutes'], 'integer column');
});

test('postal code is exactly five digits', () => {
  assert.deepEqual(validate(ok({ location_postal_code: '06000' })), []);
  for (const bad of ['6000', '060000', '0600a', 'O6300']) {
    assert.deepEqual(names(ok({ location_postal_code: bad })), ['location_postal_code'], bad);
  }
});

test('a signup link needs a scheme', () => {
  assert.deepEqual(validate(ok({ signup_url: 'http://x.test' })), []);
  assert.deepEqual(names(ok({ signup_url: 'example.org' })), ['signup_url']);
  assert.deepEqual(names(ok({ signup_url: 'ftp://example.org' })), ['signup_url']);
});

test('prices may be zero but not negative', () => {
  // "participation libre" is a real listing, so 0 has to be expressible.
  assert.deepEqual(validate(ok({ price_full: 0, price_member: 0 })), []);
  assert.deepEqual(names(ok({ price_full: -1 })), ['price_full']);
  assert.deepEqual(names(ok({ price_member: -0.01 })), ['price_member']);
});

test('an end date needs a series', () => {
  // events_recurrence_end_needs_series
  assert.deepEqual(names(ok({ recurrence: 'none', recurrence_end: '2027-06-01' })),
    ['recurrence_end']);
  assert.deepEqual(validate(ok({ recurrence: 'weekly', recurrence_end: '2027-06-01' })), []);
});

test('an end date may equal the first occurrence, but not precede it', () => {
  // The trigger compares DATES with `<`, so same-day is valid. Getting this
  // boundary wrong would reject a legitimate one-week series that ends on the
  // day it starts.
  const series = { recurrence: 'weekly', starts_at_date: '2027-01-15' };
  assert.deepEqual(validate(ok({ ...series, recurrence_end: '2027-01-15' })), [],
    'same day is allowed');
  assert.deepEqual(validate(ok({ ...series, recurrence_end: '2027-01-16' })), []);
  assert.deepEqual(names(ok({ ...series, recurrence_end: '2027-01-14' })), ['recurrence_end']);
});

test('a cancellation note needs a cancellation', () => {
  // events_note_needs_cancellation
  assert.deepEqual(names(ok({ cancellation_note: 'Salle inondée' })), ['cancellation_note']);
  assert.deepEqual(validate(ok({
    cancellation_note: 'Salle inondée', cancelled_at_local: '2027-01-10T09:00',
  })), []);
  assert.deepEqual(validate(ok({ cancelled_at_local: '2027-01-10T09:00' })), [],
    'cancelling without a reason is allowed');
});

test('several problems are all reported, not just the first', () => {
  // A form that shows one error, gets fixed, then shows another is worse than
  // one that shows three.
  const p = validate(ok({ title: '', city: '', signup_url: 'nope' }));
  assert.equal(p.length, 3);
  assert.deepEqual(p.map(([f]) => f).sort(), ['city', 'signup_url', 'title']);
});

test('every problem carries a message a person can act on', () => {
  for (const [, message] of validate(ok({ title: '', duration_minutes: 0 }))) {
    assert.ok(message.length > 10, `too terse: ${message}`);
    assert.match(message, /[.!]$/, `not a sentence: ${message}`);
  }
});

// ---------------------------------------------------------------------------
// Organizers.
//
// The pair that matters here is consent. The database refuses a published
// contact value without a timestamp beside it, so these tests pin the form to
// the same rule -- and, in the other direction, to the case the database has
// no opinion about: a ticked box with nothing to publish is legal SQL and a
// mistake on screen.
// ---------------------------------------------------------------------------
import { validateOrganizer } from '../editor/public/validate.js';

/** A complete, valid organizer. Each test breaks exactly one thing. */
const org = (over = {}) => ({
  name: 'Nissartango',
  website: null, instagram: null, facebook: null, tiktok: null,
  email: null, phone: null,
  contact_email: null, contact_phone: null,
  contact_email_consented: false, contact_phone_consented: false,
  contact_email_was_consented: false, contact_phone_was_consented: false,
  ...over,
});

const onames = (v) => validateOrganizer(v).map(([f]) => f);

test('organizer: a complete one has nothing to fix', () => {
  assert.deepEqual(validateOrganizer(org()), []);
});

test('organizer: only the name is required', () => {
  assert.deepEqual(onames(org({ name: '' })), ['name']);
});

test('organizer: a social HANDLE is not a URL', () => {
  // organizers_instagram_check rejects a pasted profile URL, but its message
  // would not explain why. This is the mistake the field actually invites.
  for (const k of ['instagram', 'facebook', 'tiktok']) {
    const p = validateOrganizer(org({ [k]: `https://${k}.com/nissartango` }));
    assert.deepEqual(p.map(([f]) => f), [k], k);
    assert.match(p[0][1], /identifiant, pas un lien/i, k);
  }
  assert.deepEqual(validateOrganizer(org({ instagram: 'nissartango' })), []);
});

test('organizer: handle length and charset follow the constraints', () => {
  // instagram/tiktok are {1,40}; facebook is {1,60} and also allows hyphens.
  assert.deepEqual(validateOrganizer(org({ instagram: 'a'.repeat(40) })), []);
  assert.deepEqual(onames(org({ instagram: 'a'.repeat(41) })), ['instagram']);
  assert.deepEqual(onames(org({ instagram: 'no-hyphens-here' })), ['instagram']);
  assert.deepEqual(validateOrganizer(org({ facebook: 'hyphens-are-fine' })), []);
  assert.deepEqual(validateOrganizer(org({ facebook: 'a'.repeat(60) })), []);
  assert.deepEqual(onames(org({ facebook: 'a'.repeat(61) })), ['facebook']);
});

test('organizer: a website needs a scheme', () => {
  assert.deepEqual(validateOrganizer(org({ website: 'https://x.test' })), []);
  assert.deepEqual(onames(org({ website: 'x.test' })), ['website']);
});

test('organizer: both email columns are checked, and they are different columns', () => {
  assert.deepEqual(onames(org({ email: 'not-an-address' })), ['email']);
  assert.deepEqual(onames(org({
    contact_email: 'not-an-address', contact_email_consented: true,
  })), ['contact_email']);
  // The private one needs no consent: it is never published.
  assert.deepEqual(validateOrganizer(org({ email: 'me@example.org' })), []);
});

test('organizer: publishing a contact detail requires the box', () => {
  // Mirrors organizers_contact_email_needs_consent. Without this the database
  // refuses the write and the person sees a constraint name.
  assert.deepEqual(onames(org({ contact_email: 'hi@example.org' })), ['contact_email']);
  assert.deepEqual(validateOrganizer(org({
    contact_email: 'hi@example.org', contact_email_consented: true,
  })), []);
  assert.deepEqual(onames(org({ contact_phone: '06 12 34 56 78' })), ['contact_phone']);
  assert.deepEqual(validateOrganizer(org({
    contact_phone: '06 12 34 56 78', contact_phone_consented: true,
  })), []);
});

test('organizer: a ticked box with nothing to publish is caught here, not by the database', () => {
  // Legal SQL -- the CHECK is one-directional -- so nothing downstream would
  // complain. It is still somebody ticking a box expecting to publish.
  assert.deepEqual(onames(org({ contact_email_consented: true })), ['contact_email']);
});

test('organizer: withdrawing a published detail is allowed and keeps the record', () => {
  // Cleared value, box still ticked, consent previously given: this is the
  // withdrawal case. The form sends value=null and KEEPS the stamp, so there
  // must be no error telling the person to fill it back in.
  assert.deepEqual(validateOrganizer(org({
    contact_email: '', contact_email_consented: true, contact_email_was_consented: true,
  })), []);
});

test('organizer: every problem carries a message a person can act on', () => {
  for (const [, message] of validateOrganizer(org({ name: '', website: 'nope' }))) {
    assert.ok(message.length > 10, `too terse: ${message}`);
    assert.match(message, /[.!]$/, `not a sentence: ${message}`);
  }
});
