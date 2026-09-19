/**
 * Run with:  npm test
 *
 * The first test is the one that matters, and it is the reason these
 * primitives were split out of editor/public/auth.js at all.
 *
 * base64url is easy to get ALMOST right: leave the padding on, or forget to
 * translate + and /, and the challenge is still 43-ish characters of
 * plausible-looking text. Nothing local complains. The failure surfaces
 * minutes or an hour later, at the server, as an exchange that will not
 * complete — and it is indistinguishable from an expired link.
 *
 * RFC 7636 ships a test vector because of exactly that. Asserting against the
 * spec's own numbers is the difference between "this looks like base64url" and
 * "this is the function the server is going to check against".
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { b64url, newVerifier, challengeFor } from '../editor/public/pkce.js';

test('challengeFor matches the RFC 7636 appendix B test vector', async () => {
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
  assert.equal(await challengeFor(verifier), challenge);
});

test('b64url emits the URL alphabet and no padding', async () => {
  // 0xFB 0xFF chosen because it encodes to '+/' in standard base64 — the two
  // characters that must be translated, and the case a naive btoa() passes
  // straight through.
  const out = b64url(new Uint8Array([0xfb, 0xff, 0xbf]));
  assert.match(out, /^[A-Za-z0-9_-]+$/);
  assert.ok(!out.includes('+') && !out.includes('/'), 'standard-alphabet characters leaked');
  assert.ok(!out.includes('='), 'padding must be stripped');

  // A length that forces padding in standard base64 (1 byte -> 'xx==').
  assert.ok(!b64url(new Uint8Array([0x01])).includes('='));
});

test('a verifier is inside the length the spec allows', () => {
  const v = newVerifier();
  assert.equal(v.length, 43);
  assert.ok(v.length >= 43 && v.length <= 128, 'RFC 7636 section 4.1');
  assert.match(v, /^[A-Za-z0-9_-]+$/);
});

test('verifiers are not reused', () => {
  // If this ever fails, every sign-in shares one secret and PKCE protects
  // nothing — the whole point is that the verifier is unguessable per attempt.
  const seen = new Set(Array.from({ length: 200 }, () => newVerifier()));
  assert.equal(seen.size, 200);
});

test('the challenge is not the verifier', async () => {
  // Sending the verifier as the challenge would "work" end to end while
  // putting the secret in the email link, which is the failure PKCE exists to
  // prevent. It would pass every other test here.
  const v = newVerifier();
  assert.notEqual(await challengeFor(v), v);
});
