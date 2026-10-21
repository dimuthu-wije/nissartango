/**
 * Run with:  npm test
 *
 * src/lib/map.js turns an event's venue into a Google Maps URL, and the only
 * interesting thing it does is REFUSE. `city` is `not null` with a default of
 * 'Nice', so every event has one and a query built from it alone always
 * "works" -- Google answers with the middle of town. A link that looks helpful
 * and is not teaches a reader to stop following it, which costs more than the
 * link was ever worth.
 *
 * The URL format is Google's documented Maps URLs API. It was measured once,
 * on 2026-10-21, by loading it: Google accepted it and carried the encoded
 * query intact. These assertions cannot re-measure that -- they pin the shape
 * this project decided to emit, so a change to it is deliberate.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mapsUrl, mapsQuery } from '../src/lib/map.js';

const CASITA = {
  location_name: 'La Casita del Tango',
  location_address: '12 rue Gubernatis',
  location_postal_code: '06000',
  city: 'Nice',
};

test('the city alone never makes a link', () => {
  assert.equal(mapsUrl({ city: 'Nice' }), null);
  assert.equal(mapsQuery({ city: 'Antibes' }), null);
  // An empty string is what a blank form field submits, not undefined
  // (AGENTS.md gotcha 1), so it must not count as a venue either.
  assert.equal(mapsUrl({ location_name: '', location_address: '', city: 'Nice' }), null);
  assert.equal(mapsUrl(null), null);
});

test('a venue name is enough, and so is a street on its own', () => {
  assert.equal(mapsQuery({ location_name: 'Théâtre de Verdure', city: 'Nice' }),
    'Théâtre de Verdure, Nice');
  assert.equal(mapsQuery({ location_address: '7 place Garibaldi', location_postal_code: '06300', city: 'Nice' }),
    '7 place Garibaldi, 06300 Nice');
});

test('the postcode and the city are one field, joined by a space', () => {
  // "06000, Nice" is not how anyone writes a French address, and the event
  // page renders those two on one line precisely because they are one thing.
  assert.equal(mapsQuery(CASITA), 'La Casita del Tango, 12 rue Gubernatis, 06000 Nice');
  assert.doesNotMatch(mapsQuery(CASITA), /06000,/);
});

test('the name goes in the query, not only the address', () => {
  // Either half being slightly wrong is survivable when the other is there.
  assert.match(mapsQuery(CASITA), /^La Casita del Tango,/);
});

test('the URL is the documented api=1 form, fully encoded', () => {
  const url = mapsUrl(CASITA);
  assert.ok(url.startsWith('https://www.google.com/maps/search/?api=1&query='),
    `not the documented Maps URLs form: ${url}`);

  // The query must survive as ONE parameter. An unencoded comma or space is
  // tolerated by Google today and is not something to rely on; an unencoded
  // `&` in a venue name ("Pierre & Paul") would split the URL outright.
  const value = url.slice(url.indexOf('&query=') + 7);
  assert.equal(decodeURIComponent(value), mapsQuery(CASITA));
  assert.doesNotMatch(value, /[ &#?]/, 'the query is not fully percent-encoded');

  const amp = mapsUrl({ location_name: 'Chez Pierre & Paul', city: 'Nice' });
  assert.doesNotMatch(amp.slice(amp.indexOf('&query=') + 7), /&/,
    'an ampersand in a venue name escaped into the URL and split the query');
});
