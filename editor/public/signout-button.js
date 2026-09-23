// Wires the `#signout` button on every page.
//
// One module rather than the same listener copied into four page scripts,
// which is what it was. Copies drift: when sign-out started revoking, three of
// them would have gone on clearing localStorage and calling it done.
//
// Self-initialising on import, because `_headers` sets script-src 'self' with
// no 'unsafe-inline', so no page here may carry an inline <script>.
//
// IT DOES NOT REDIRECT. The old handler sent you to "/" the instant it had
// emptied localStorage, which was fine when that was all it did. Now there is
// something to read -- whether the session was actually revoked, and the fact
// that the access token already issued stays valid until it expires -- and a
// page that navigates away cannot be read. So it says what happened and offers
// a link.

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
