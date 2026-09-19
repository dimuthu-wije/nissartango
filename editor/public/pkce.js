// The PKCE primitives, deliberately free of browser-only APIs.
//
// Split out of auth.js so Node can test them. auth.js touches localStorage,
// fetch and an absolute-path import; this file touches none of those, which
// means tests/pkce.test.js can assert the one thing here that is worth
// asserting forever: that the challenge derivation matches RFC 7636.
//
// Getting base64url subtly wrong -- padding left on, + and / not translated --
// produces a challenge that LOOKS right, is the correct length, and is
// rejected by the server an hour later as a failed exchange. The RFC ships a
// test vector precisely because this is easy to get almost right.

/** base64url, unpadded: the alphabet the spec requires. */
export const b64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * 32 random bytes -> 43 base64url characters, inside the 43..128 the spec
 * allows. crypto.getRandomValues, not Math.random: this value is the only
 * thing standing between a fetched link and a session.
 */
export const newVerifier = () => b64url(crypto.getRandomValues(new Uint8Array(32)));

/** S256: base64url(SHA-256(verifier)). */
export async function challengeFor(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return b64url(digest);
}
