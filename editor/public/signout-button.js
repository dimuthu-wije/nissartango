// Wires the `#signout` button on every page.
//
// One module rather than the same listener copied into four page scripts,
// which is what it was. Copies drift: when sign-out started revoking, three of
// them would have gone on clearing localStorage and calling it done.
//
// Self-initialising on import, because `_headers` sets script-src 'self' with
// no 'unsafe-inline', so no page here may carry an inline <script>.
//
// IT REDIRECTS ON SUCCESS AND STAYS PUT ON FAILURE, since 2026-10-03.
//
// It used to never redirect, because there is something to read: whether the
// session was really revoked, and that the access token already issued stays
// valid until it expires. That reasoning holds only where the reader can act on
// what it says. On SUCCESS they cannot -- it worked, and being left on a page
// they are no longer signed into, with a link to click, is a step nobody wants.
// The fact is not dropped: /?deconnecte=1 carries it to the sign-in page.
//
// On FAILURE it still stays exactly where it is. A revocation that did not
// happen is the one case where there is something to do, and navigating away
// would hide it.

import { signOut, signOutMessage } from '/auth.js';

const BUTTON_ID = 'signout';

function noteFor(button) {
  const existing = document.querySelector('.signout-note');
  if (existing) return existing;
  const p = document.createElement('p');
  p.className = 'signout-note';
  p.setAttribute('role', 'status');
  (button.closest('footer') ?? button.parentElement ?? document.body).after(p);
  return p;
}

export async function handleSignOut(button) {
  const note = noteFor(button);
  button.disabled = true;
  note.textContent = 'Déconnexion…';
  note.className = 'signout-note';

  const outcome = await signOut('global');

  note.textContent = signOutMessage(outcome);
  note.className = `signout-note ${outcome.revoked && outcome.cleared ? 'good' : 'bad'}`;

  // The button stays disabled on success: there is nothing left to sign out
  // of. On a failed revocation it comes back, because retrying is the useful
  // thing to do -- though it will need a fresh sign-in first, the local
  // session having been cleared regardless.
  button.disabled = outcome.revoked && outcome.cleared;

  if (outcome.revoked && outcome.cleared) {
    // assign, not replace: Back then returns to the page they signed out of,
    // which shows the signed-out state rather than a stale signed-in one.
    location.assign('/?deconnecte=1');
    return outcome;
  }

  const link = document.createElement('a');
  link.href = '/';
  link.textContent = 'Retour à la connexion';
  note.append(document.createTextNode(' '), link);
  return outcome;
}

document.addEventListener('click', (e) => {
  const button = e.target?.closest?.(`#${BUTTON_ID}`);
  if (!button) return;
  e.preventDefault();
  handleSignOut(button);
});
