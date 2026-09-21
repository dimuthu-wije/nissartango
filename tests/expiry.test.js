/**
 * Run with:  npm test
 *
 * These exist for one bug with two faces. `expires_at` is a UNIX timestamp in
 * SECONDS; `Date.now()` is MILLISECONDS. Multiply the wrong side and:
 *
 *   forget the *1000   ->  every session looks long expired, so the editor
 *                          refreshes on every single request
 *   divide instead     ->  no session ever looks expired, so the first sign
 *                          of trouble is a 401 nothing was expecting
 *
 * Both are one character, neither is visible on screen, and each is caught
 * only by a test pointing the opposite way from the other. That is why the
 * first two tests below look almost redundant and are not.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { needsRefresh, isExpired, secondsLeft, SKEW_MS } from '../editor/public/expiry.js';

// A fixed clock. Real time in a test is a coin toss you run on every commit.
const NOW = 1_800_000_000_000;                    // ms
const at = (secondsFromNow) => ({ expires_at: Math.floor(NOW / 1000) + secondsFromNow });

test('a fresh hour-long session does NOT need refreshing', () => {
  // Catches the missing *1000: without it this reads as expired and the
  // editor refreshes on every request.
  assert.equal(needsRefresh(at(3600), NOW), false);
  assert.equal(isExpired(at(3600), NOW), false);
});

test('an already-expired session DOES need refreshing', () => {
  // Catches the opposite slip, where nothing ever looks expired. Expired is a
  // reason to refresh, not a reason to give up -- the refresh token may well
  // still work, which is the whole point of the feature.
  assert.equal(isExpired(at(-1), NOW), true);
  assert.equal(needsRefresh(at(-1), NOW), true);
  assert.equal(needsRefresh(at(-86_400), NOW), true, 'a day old still tries');
});

test('the skew window opens before expiry, not at it', () => {
  const skewSec = SKEW_MS / 1000;
  assert.equal(needsRefresh(at(skewSec + 5), NOW), false, 'outside the window: leave it');
  assert.equal(needsRefresh(at(skewSec), NOW), true, 'exactly at the edge: refresh');
  assert.equal(needsRefresh(at(skewSec - 5), NOW), true, 'inside: refresh');
});

test('expiry is the moment itself, not a second later', () => {
  assert.equal(isExpired(at(0), NOW), true);
  assert.equal(isExpired(at(1), NOW), false);
});

test('a session with no expires_at is left alone', () => {
  // The shape an implicit-flow arrival has: a token turned up and nothing said
  // when it ends. Guessing an expiry would either log someone out early or
  // promise time that does not exist.
  assert.equal(isExpired({ access_token: 'x' }, NOW), false);
  assert.equal(needsRefresh({ access_token: 'x' }, NOW), false);
  assert.equal(secondsLeft({ access_token: 'x' }, NOW), null);
});

test('nothing at all is handled, not thrown at', () => {
  for (const empty of [null, undefined, {}]) {
    assert.equal(isExpired(empty, NOW), false);
    assert.equal(needsRefresh(empty, NOW), false);
    assert.equal(secondsLeft(empty, NOW), null);
  }
});

test('secondsLeft counts in seconds and goes negative', () => {
  assert.equal(secondsLeft(at(120), NOW), 120);
  assert.equal(secondsLeft(at(-30), NOW), -30);
});
