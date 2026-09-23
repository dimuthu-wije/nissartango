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
import { needsRefresh, isExpired, secondsLeft } from '/expiry.js';
export { secondsLeft };

import { logoutPath, performSignOut } from '/signout.js';
export { signOutMessage } from '/signout.js';

/** The session is gone and cannot be recovered here. Sign in again. */
export class AuthExpired extends Error {
  constructor(why) {
    super(why || 'votre session a expiré');
    this.name = 'AuthExpired';
  }
}

/**
 * One shape, written in one place. expires_at is stored in SECONDS because
 * that is what GoTrue speaks; see expiry.js for why that matters.
 */
function store(s) {
  const saved = {
    access_token: s.access_token,
    refresh_token: s.refresh_token,
    expires_at: s.expires_at ?? Math.floor(Date.now() / 1000) + (s.expires_in ?? 3600),
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(saved));
  return saved;
}

function readStored() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    return s?.access_token ? s : null;
  } catch { return null; }
}

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
    throw new Error('ce navigateur ne stocke pas de données : un lien ne pourrait pas être finalisé ici');
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
      'aucune connexion n\'a été engagée dans ce navigateur. Un lien PKCE ne peut ' +
      'être finalisé que là où il a été demandé — c\'est précisément ce qui empêche ' +
      'quoi que ce soit d\'autre de le consommer. Ouvrez la page de connexion ici ' +
      'et demandez-en un nouveau.',
    );
  }
  const session = await api('token', { auth_code: code, code_verifier: verifier }, '?grant_type=pkce');
  // One-shot: a verifier that survives its exchange is a credential lying
  // around for no reason.
  localStorage.removeItem(VERIFIER_KEY);
  store(session);
  return session;
}

/**
 * The session as it stands, or null if it is already unusable.
 *
 * SYNCHRONOUS, and therefore cannot refresh. Use it to decide what to paint
 * before any await -- getSession() is what anything talking to the server
 * should call.
 */
export function storedSession() {
  const s = readStored();
  return s && !isExpired(s) ? s : null;
}

/**
 * Is there a session here AT ALL, expired or not?
 *
 * Lets a caller tell "you were never signed in" from "your session ran out",
 * which need different words: the second is worth apologising for and the
 * first is not.
 */
export const hasSession = () => !!readStored();

// One refresh in flight at a time.
//
// Without this, a page that fires several requests at once sends several
// refreshes with the SAME refresh token. Supabase rotates refresh tokens, so
// the second one is presenting a token the first has already spent -- inside
// the reuse interval that is tolerated, outside it the whole session is
// revoked as suspected replay. Sharing one promise makes the race impossible
// rather than unlikely.
let inFlight = null;

/**
 * Trade the refresh token for a new session.
 *
 * Assumes rotation: whatever comes back is stored, including a new refresh
 * token. If this project's rotation setting ever changes, storing the same
 * token again is harmless -- which is why this does not try to detect it.
 */
export function refreshSession() {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const s = readStored();
    if (!s?.refresh_token) throw new AuthExpired('aucun jeton de rafraîchissement dans ce navigateur');
    let fresh;
    try {
      fresh = await api('token', { refresh_token: s.refresh_token }, '?grant_type=refresh_token');
    } catch (err) {
      // A refused refresh is terminal: the token is revoked, replayed or
      // expired, and retrying cannot help. Clear it rather than leave a
      // credential that will fail identically on every future request.
      signOutLocally();
      throw new AuthExpired(err?.message);
    }
    return store(fresh);
  })().finally(() => { inFlight = null; });
  return inFlight;
}

/**
 * A session good enough to send, refreshing first if it is close to expiry.
 *
 * This is what makes the editor usable for longer than one hour, and what lets
 * a returning visitor stay signed in: an access token that died overnight is a
 * reason to refresh, not a reason to show the sign-in form.
 */
export async function getSession() {
  const s = readStored();
  if (!s) throw new AuthExpired('non connecté');
  if (!needsRefresh(s)) return s;
  return refreshSession();
}

/**
 * Local sign-out: clears this browser, revokes nothing.
 *
 * Kept, and still used -- but only as the second half of signOut() below, and
 * as the honest thing to call when there is no session to revoke. Anything
 * offering a person a "sign out" control should call signOut().
 */
export function signOutLocally() {
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(VERIFIER_KEY);
}

/**
 * Sign out and REVOKE, which is what a sign-out control should mean.
 *
 * POST /auth/v1/logout needs the access token in the Authorization header --
 * the apikey alone is not enough, and a call without it returns 401 while
 * looking like it worked from the outside. Scope defaults to global: every
 * session this account has, because the reason someone reaches for this is
 * usually "make this stop being usable", and per-session would be the wrong
 * answer at exactly the moment it mattered.
 *
 * THE BROWSER IS CLEARED EITHER WAY. performSignOut() owns that guarantee and
 * is tested for it; the ordering matters enough to live in a file Node can
 * run. What this function adds is the two real effects: the HTTP call, and
 * localStorage.
 *
 * It does NOT invalidate the access token already issued. Nothing here can:
 * PostgREST checks signature and expiry and consults no session table, so that
 * token is good until its `exp`. Revoking closes refresh, not the hour already
 * granted -- signOutMessage() says so rather than letting the UI imply
 * otherwise.
 */
export async function signOut(scope = 'global') {
  const stored = readStored();

  const revoke = async () => {
    if (!stored?.access_token) {
      // Nothing to revoke is not a failure, and calling anyway would send a
      // request that can only 401 -- then be reported as a revocation that
      // failed, which is a worse description of "you were not signed in".
      return { skipped: true };
    }
    const res = await fetch(`${SUPABASE_URL}/auth/v1/${logoutPath(scope)}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${stored.access_token}`,
      },
    });
    // 204 is success and carries no body. A 401 here means the token had
    // already expired, in which case the session it belonged to is closing on
    // its own -- still worth reporting, because "already gone" and "revoked
    // just now" are different answers to "is it usable".
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        detail = body?.msg || body?.error_description || body?.error || detail;
      } catch { /* 204s and empty bodies */ }
      throw new Error(detail);
    }
    return { skipped: false };
  };

  return performSignOut(revoke, signOutLocally);
}

/** Claims, decoded and NOT verified. PostgREST verifies; this only displays. */
export function claimsOf(jwt) {
  const part = String(jwt).split('.')[1];
  if (!part) throw new Error('not a JWT');
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
  const bytes = Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}
