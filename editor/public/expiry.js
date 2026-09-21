// When is a session too old to use?
//
// Split out of auth.js for the same reason pkce.js was: auth.js needs
// localStorage, fetch and an absolute-path import, and none of that is
// necessary to answer this question. Node can test it.
//
// THE TRAP THIS EXISTS FOR. `expires_at` is a UNIX timestamp in SECONDS --
// that is what GoTrue returns and what auth.js stores. `Date.now()` is in
// MILLISECONDS. Compare them directly and a live session looks 1,000x expired,
// so every request refreshes; multiply the wrong side and it never expires at
// all, so the first real failure is a 401 the UI does not expect. Neither is
// visible in a screenshot, and both are one character.
//
// A SKEW, and why it is not zero. Refreshing at the exact moment of expiry
// means the access token can die between the check and the request arriving.
// Sixty seconds is comfortably longer than any round trip here and far shorter
// than the hour a token lives, so it costs at most one extra refresh per hour.

export const SKEW_MS = 60_000;

/** Seconds of life left. Negative once it has expired. Null if unknowable. */
export function secondsLeft(session, now = Date.now()) {
  if (!session?.expires_at) return null;
  return Math.round(session.expires_at * 1000 - now) / 1000;
}

/** Already unusable: the server would refuse this token. */
export function isExpired(session, now = Date.now()) {
  if (!session?.expires_at) return false;   // unknown is not expired
  return session.expires_at * 1000 <= now;
}

/**
 * Should we refresh before using it?
 *
 * True while there is still time left, when that time is inside the skew --
 * and also true once it has expired, because a refresh token may well still
 * work. "Expired" is a reason to refresh, not a reason to give up.
 *
 * A session with no expires_at is left alone: that is the shape an
 * implicit-flow arrival has, where nothing told us when it ends.
 */
export function needsRefresh(session, now = Date.now(), skewMs = SKEW_MS) {
  if (!session?.expires_at) return false;
  return session.expires_at * 1000 - skewMs <= now;
}
