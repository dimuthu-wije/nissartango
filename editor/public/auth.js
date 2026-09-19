// PKCE magic-link sign-in, by hand.
//
// WHY BY HAND, AND NOT supabase-js. The library is the ordinary choice and it
// would work. It is not used here because the only way to load it on this
// origin is from a CDN, and anything loaded on the page that receives a
// credential can read that credential. public/_headers says
// `script-src 'self'` with no 'unsafe-inline' precisely so that is not
// possible, and a CDN tag would be the one exception that makes the policy
// decorative. The flow below is about sixty lines; the library is worth
// reaching for when the editor needs more than sign-in, and then it should be
// VENDORED into this directory rather than fetched at runtime.
//
// WHY PKCE AND NOT THE IMPLICIT FLOW. Measured on 2026-09-19: an implicit-flow
// magic link, clicked well inside its hour, failed with `otp_expired` because
// Chrome had preloaded the link and spent the single-use token before the
// person clicked. auth.users showed last_sign_in_at 11:13:18 and a live
// session; the click was the token's SECOND use. Same user agent, same IP --
// invisible from the server side.
//
// In the implicit flow the link IS the credential, so anything that fetches it
// spends it: a preloading browser, a mail scanner, a corporate link-rewriter.
// In PKCE the link carries a `code` that is worthless without the verifier held
// in the browser that STARTED the sign-in. A prefetch has no verifier. It can
// fetch the link as often as it likes and never complete a login.
//
// WHAT THIS DOES NOT FIX, stated because the first draft of this comment
// claimed it did.
//
// The email link still points at {SUPABASE_URL}/auth/v1/verify?token=..., and
// THAT endpoint is single-use whatever flow follows it: it validates the token
// and redirects to redirect_to with a `code`. So a prefetch can still spend the
// token, and a person can still be shown `otp_expired`.
//
// PKCE buys CONFIDENTIALITY, not availability:
//
//   before   a preload completed a full login. On 2026-09-19 at 11:13 it
//            created a real session, with real tokens, for whatever fetched
//            the link.
//   after    a preload gets a code it cannot redeem. No session exists for
//            anyone but the browser holding the verifier.
//
// That is the property worth having -- a mail scanner or a corporate link
// rewriter cannot log in as an organizer -- and it is guaranteed by
// construction rather than by a browser setting. Whether the person's own
// click still succeeds is a separate question, and switching off Chrome's page
// preloading is still the only lever anyone has over it. Do not read a
// successful sign-in as proof that prefetching was survived; read the session
// table.

import { SUPABASE_URL, SUPABASE_ANON_KEY, REDIRECT_TO } from '/config.js';

const VERIFIER_KEY = 'nt.pkce.verifier';
const SESSION_KEY = 'nt.session';

// The primitives live in pkce.js so Node can test them against RFC 7636's
// vector; everything below needs a browser. Re-exported so callers and the
// console have one import to reach for.
export { newVerifier, challengeFor } from '/pkce.js';
import { newVerifier, challengeFor } from '/pkce.js';

async function api(path, body, query = '') {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/${path}${query}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch { /* 204s and empty bodies */ }
  if (!res.ok) {
    throw new Error(data?.msg || data?.error_description || data?.error || `HTTP ${res.status}`);
  }
  return data;
}

/**
 * Ask for a link. The verifier is stored FIRST: if the request succeeds and
 * the write had failed, the resulting code could never be redeemed and the
 * failure would surface an hour later as "expired", which is the least
 * debuggable thing this flow can do.
 */
export async function requestLink(email) {
  const verifier = newVerifier();
  localStorage.setItem(VERIFIER_KEY, verifier);
  if (localStorage.getItem(VERIFIER_KEY) !== verifier) {
    throw new Error('this browser is not storing data, so a link could not be completed here');
  }
  await api('otp', {
    email,
    // No account is created from this form. Sign-up is a decision with a
    // moderation consequence -- a row in auth.users that is_admin() and
    // is_owner() will be asked about -- and it does not belong behind an
    // email field on a page anyone can open.
    create_user: false,
    code_challenge: await challengeFor(verifier),
    code_challenge_method: 's256',
  }, `?redirect_to=${encodeURIComponent(REDIRECT_TO)}`);
}

/**
 * Redeem the `?code=` the link came back with.
 *
 * PKCE puts the code in the QUERY string, unlike the implicit flow's fragment.
 * That is a real difference: a query string IS sent to the server and does
 * appear in logs. It is safe here only because the code alone is useless --
 * which is the entire point of the verifier.
 */
export async function exchangeCode(code) {
  const verifier = localStorage.getItem(VERIFIER_KEY);
  if (!verifier) {
    throw new Error(
      'no sign-in was started in this browser. A PKCE link can only be ' +
      'completed where it was requested, which is what stops anything else ' +
      'from spending it -- open the sign-in page here and request a new one.',
    );
  }
  const session = await api('token', { auth_code: code, code_verifier: verifier }, '?grant_type=pkce');
  // One-shot: a verifier that survives its exchange is a credential lying
  // around for no reason.
  localStorage.removeItem(VERIFIER_KEY);
  localStorage.setItem(SESSION_KEY, JSON.stringify({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + (session.expires_in ?? 3600),
  }));
  return session;
}

export function storedSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    if (!s?.access_token) return null;
    // Expired is not signed in. The token would be refused by PostgREST
    // anyway; saying so here is the difference between "you are logged out"
    // and an unexplained failure on the next thing you click.
    if (s.expires_at && s.expires_at * 1000 < Date.now()) return null;
    return s;
  } catch { return null; }
}

/**
 * Local sign-out. It clears this browser and does NOT revoke the session in
 * the database -- that needs POST /auth/v1/logout with the access token, and
 * the refresh token stays live until it is used or expires. Say so rather than
 * implying more than it does.
 */
export function signOutLocally() {
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(VERIFIER_KEY);
}

/** Claims, decoded and NOT verified. PostgREST verifies; this only displays. */
export function claimsOf(jwt) {
  const part = String(jwt).split('.')[1];
  if (!part) throw new Error('not a JWT');
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
  const bytes = Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}
