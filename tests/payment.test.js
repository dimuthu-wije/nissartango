/**
 * Run with:  npm test
 *
 * Payment methods are stored as ASCII slugs and constrained by
 * events_payment_methods_known; the French words live only in the label map.
 * These pin the two things that can go wrong quietly:
 *
 *   - an empty array must render NOTHING. Defaulting to "espèces" would put a
 *     claim on the page that no organizer made, and the person who turns up
 *     with only a card is the one who pays for it.
 *   - a slug with no label must fall back to itself rather than vanish, so a
 *     method added to the CHECK constraint and not to the map still shows
 *     something true.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { PAYMENT_LABELS, paymentSummary } from '../src/lib/payment.js';

test('the labels cover exactly what the constraint allows', () => {
  // events_payment_methods_known: especes, cb, cheque, virement.
  assert.deepEqual(Object.keys(PAYMENT_LABELS).sort(),
    ['cb', 'cheque', 'especes', 'virement']);
});

test('several methods read as a list', () => {
  assert.equal(paymentSummary({ payment_methods: ['especes', 'cb'] }),
    'espèces, carte bancaire');
});

test('nothing said renders nothing — not "espèces"', () => {
  assert.equal(paymentSummary({ payment_methods: [] }), null);
  assert.equal(paymentSummary({}), null);
  assert.equal(paymentSummary(null), null);
});

test('an unlabelled slug shows itself rather than disappearing', () => {
  // The failure this prevents: a method added to the constraint but not to the
  // map would silently drop out of the list, and the page would say "espèces"
  // for an event that also takes something else.
  assert.equal(paymentSummary({ payment_methods: ['especes', 'lydia'] }),
    'espèces, lydia');
});

test('order is preserved, so the stored array decides what is shown', () => {
  assert.equal(paymentSummary({ payment_methods: ['cheque', 'especes'] }),
    'chèque, espèces');
});
