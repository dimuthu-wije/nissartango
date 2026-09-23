// Signing out, and the one guarantee it has to make.
//
// Split out of auth.js so Node can test it, like pkce.js, expiry.js,
// consent.js and target.js: no fetch, no localStorage, no absolute imports.
//
// THE GUARANTEE. The browser is cleared whether or not the server accepted the
// revocation. Get that backwards -- clear only on success -- and the failure
// mode is the worst one available here: the network hiccups, the person is
// told something went wrong, and they walk away from a machine that is still
// signed in. A revocation that failed is a problem; a revocation that failed
// AND left the session usable is that same problem plus a false sense that
// nothing happened.
//
// So the order is: ask the server, then clear locally, always. The result says
// which of the two halves worked, because those are genuinely different
// outcomes and the page should not pretend otherwise.
//
// WHAT SIGNING OUT DOES NOT DO, and the UI must not claim it does. Revoking a
// session deletes it and its refresh token -- GoTrue deletes the rows rather
// than flagging them, measured on 2026-09-19 when auth.sessions and
// auth.refresh_tokens both went to zero. It does NOT invalidate the access
// token already issued: PostgREST validates signature and expiry and consults
// no session table, so that JWT is accepted until its `exp`, up to an hour
// later, whatever this does. The only lever that closes that window is
// rotating the project's signing key, which invalidates every token for every
// user at once. See AGENTS.md.

/** GoTrue's logout scopes. `others` exists too; the editor does not offer it. */
export const SCOPES = {
  // Every session this account has anywhere. The right default for a control
  // whose whole purpose is "make this stop being usable" -- if you are signing
  // out because a laptop was lost, per-session would be the wrong answer and
  // you would have no way to know.
  global: '?scope=global',
  // This session only.
  local: '?scope=local',
};

/** @returns {string} the path to POST, e.g. "logout?scope=global" */
export function logoutPath(scope = 'global') {
  const q = SCOPES[scope];
  if (!q) throw new Error(`unknown sign-out scope: ${scope}`);
  return `logout${q}`;
}

/**
 * Revoke, then clear -- clearing even when revoking throws.
 *
 * @param {() => Promise<unknown>} revoke  talks to the server
 * @param {() => void} clear               empties this browser
 * @returns {Promise<{revoked: boolean, cleared: boolean, reason?: string}>}
 */
export async function performSignOut(revoke, clear) {
  let revoked = false;
  let reason;
  try {
    await revoke();
    revoked = true;
  } catch (err) {
    reason = err?.message ? String(err.message) : String(err);
  }

  // Not in a `finally`: if clearing itself throws, the caller has to hear
  // about it, and a finally that swallows the failure would report a sign-out
  // that did not happen in either place.
  let cleared = false;
  try {
    clear();
    cleared = true;
  } catch (err) {
    reason = `${reason ? reason + '; ' : ''}could not clear this browser: ${err?.message ?? err}`;
  }

  return reason === undefined ? { revoked, cleared } : { revoked, cleared, reason };
}

/**
 * What to tell the person, in French, given that outcome.
 *
 * Deliberately never says "signed out" without qualification when the server
 * refused: the session is still live somewhere, and they may be about to close
 * a laptop believing otherwise.
 */
export function signOutMessage({ revoked, cleared, reason }) {
  if (revoked && cleared) {
    return 'Déconnecté. La session est révoquée et ce navigateur est vidé. '
      + "Le jeton d'accès déjà émis reste valable jusqu'à son expiration, une heure au plus.";
  }
  if (!revoked && cleared) {
    return 'Ce navigateur est vidé, mais la session n\'a PAS pu être révoquée '
      + `sur le serveur${reason ? ` (${reason})` : ''}. Elle reste utilisable ailleurs `
      + 'jusqu\'à son expiration. Réessayez une fois reconnecté.';
  }
  if (revoked && !cleared) {
    return 'La session est révoquée sur le serveur, mais ce navigateur n\'a pas pu '
      + `être vidé${reason ? ` (${reason})` : ''}. Fermez cet onglet.`;
  }
  return `Échec de la déconnexion${reason ? ` : ${reason}` : ''}. `
    + 'Ni le serveur ni ce navigateur n\'ont été modifiés.';
}
