/**
 * Run with:  npm test        (which forces TZ=UTC)
 *
 * priceSummary decides what a reader sees about money, on both the agenda and
 * the event page. It had two faults, and the first one lost information:
 *
 *   - price_note was a FALLBACK. An organizer who entered 10 € and "gratuit
 *     pour les étudiants" had the second half dropped from the listing, which
 *     is the half a number cannot say. The detail page showed it and the
 *     agenda did not — the worse way round, since the agenda is what people
 *     read.
 *   - prices were formatted "12.50 €", with a dot, on a French site.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { priceSummary } from '../src/lib/price.js';

const e = (over = {}) => ({ price_full: null, price_member: null, price_note: null, ...over });

/** Intl puts a narrow no-break space (U+202F) before the symbol. */
const flat = (s) => s?.replace(/ | /g, ' ') ?? s;

test('both numbers, no note', () => {
  assert.equal(flat(priceSummary(e({ price_full: 12, price_member: 10 }))),
    '12 € / 10 € adhérent');
});

test('a note is shown ALONGSIDE a number, not instead of it', () => {
  // The bug this file exists for.
  assert.equal(flat(priceSummary(e({ price_full: 12, price_note: 'gratuit pour les étudiants' }))),
    '12 € — gratuit pour les étudiants');
});

test('a note on its own is the whole answer', () => {
  assert.equal(priceSummary(e({ price_note: 'Au chapeau' })), 'Au chapeau');
});

test('free is a price, and is not mistaken for absent', () => {
  // 0 is falsy; treating it as "no price" would silently hide a free milonga's
  // best feature.
  assert.equal(flat(priceSummary(e({ price_full: 0 }))), '0 €');
});

test('nothing at all returns null, so the row renders no price block', () => {
  assert.equal(priceSummary(e()), null);
  assert.equal(priceSummary(e({ price_note: '   ' })), null, 'whitespace is not a note');
});

test('French decimals: a comma, and two places only when there are centimes', () => {
  assert.equal(flat(priceSummary(e({ price_full: 12.5 }))), '12,50 €');
  assert.equal(flat(priceSummary(e({ price_full: 12.34 }))), '12,34 €');
  assert.equal(flat(priceSummary(e({ price_full: 12 }))), '12 €',
    '"12,00 €" for a whole-euro price is noise');
  assert.doesNotMatch(priceSummary(e({ price_full: 12.5 })), /12\.5/,
    'a dot decimal separator on a French site');
});

test('a member price alone is labelled, so it cannot read as the full price', () => {
  assert.equal(flat(priceSummary(e({ price_member: 8 }))), '8 € adhérent');
});
