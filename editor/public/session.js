// What the editor origin does today: sign you in, and say who you are.
//
// Three ways a browser can arrive here, and all three are handled because all
// three happen:
//
//   ?code=...              PKCE. The flow this page requests. The code is
//                          useless without the verifier in this browser's
//                          localStorage, so a preloading browser or a mail
//                          scanner can fetch the link and gain nothing.
//   #access_token=...      Implicit. Older links, and anything issued outside
//                          this form. Still works; noted as the weaker flow.
//   #error=...             GoTrue's failure, which arrives at the destination
//                          rather than as an HTTP error.
//
// The fragment is never sent to a server. The PKCE `code` IS -- it is a query
// parameter and will appear in logs -- which is safe only because the code
// alone cannot be redeemed. That asymmetry is the design, not an oversight.

import {
  requestLink, exchangeCode, getSession, hasSession, signOutLocally, claimsOf,
} from '/auth.js';

const $ = (s) => document.querySelector(s);
const out = () => $('#out');

const el = (tag, text, cls) => {
  const n = document.createElement(tag);
  if (text != null) n.textContent = text;       // textContent: all of this is untrusted
  if (cls) n.className = cls;
  return n;
};

function box(cls, title, detail) {
  const b = el('div', null, `box ${cls}`);
  b.appendChild(el('h2', title));
  if (detail) b.appendChild(el('p', detail));
  out().replaceChildren(b);
  return b;
}

function rows(into, pairs) {
  const dl = el('dl');
  for (const [k, v] of pairs) { dl.appendChild(el('dt', k)); dl.appendChild(el('dd', String(v ?? '—'))); }
  into.appendChild(dl);
  return dl;
}

const fmt = (secs) =>
  secs ? new Date(secs * 1000).toISOString().replace('T', ' ').replace(/\..*/, 'Z') : '—';

/** Take the credential out of the address bar once it has been read. */
function cleanUrl() {
  try { history.replaceState(null, '', location.pathname); } catch { /* sandboxed */ }
}

// --- views -----------------------------------------------------------------

function showSession(session, how) {
  let claims;
  try { claims = claimsOf(session.access_token); }
  catch (e) { return showError('A token arrived but could not be read.', String(e.message)); }

  const b = box('good', 'Signed in.');
  rows(b, [
    ['user id (sub)', claims.sub],
    ['email', claims.email],
    ['role', claims.role],
    ['issued', fmt(claims.iat)],
    ['expires', fmt(claims.exp)],
    ['flow', how],
  ]);

  const note = el('p', null, 'note');
  note.textContent =
    how === 'pkce'
      ? 'PKCE: the link carried a code that was useless without the verifier ' +
        'stored in this browser. Anything that fetched the link before you — a ' +
        'preloading browser, a mail scanner — could not have completed it. The ' +
        'access token is not shown; it is a bearer credential. These claims are ' +
        'decoded, NOT verified — PostgREST decides that, on every request.'
      : 'Implicit flow: the link itself was the credential, so anything that ' +
        'fetched it first would have spent it. That is what happened on ' +
        '2026-09-19 at 11:13. Prefer the sign-in form on this site, which uses ' +
        'PKCE. The access token is not shown, and these claims are decoded, ' +
        'NOT verified.';
  b.appendChild(note);

  const queue = el('a', 'Open the approval queue');
  queue.href = '/queue/';
  queue.className = 'btn';
  b.appendChild(queue);

  const signOut = el('button', 'Sign out of this browser');
  signOut.className = 'btn';
  signOut.addEventListener('click', () => { signOutLocally(); location.href = '/'; });
  b.appendChild(signOut);

  const caveat = el('p', null, 'note');
  caveat.textContent =
    'Signing out clears this browser only. It does not revoke the session in ' +
    'the database, and the refresh token stays live until it is used or expires.';
  b.appendChild(caveat);
}

function showError(title, detail, extra = []) {
  const b = box('bad', title, detail);
  if (extra.length) rows(b, extra);
  return b;
}

function showForm(message) {
  const b = box('idle', 'Sign in', message || 'Enter your email and a sign-in link will be sent.');
  const form = el('form');
  form.className = 'signin';

  const label = el('label', 'Email');
  label.setAttribute('for', 'email');
  const input = el('input');
  Object.assign(input, { type: 'email', id: 'email', name: 'email', required: true, autocomplete: 'email' });
  input.placeholder = 'vous@example.org';
  const submit = el('button', 'Send me a link');
  submit.type = 'submit';
  submit.className = 'btn';

  form.append(label, input, submit);
  b.appendChild(form);

  const note = el('p', null, 'note');
  note.textContent =
    'No account is created from this form — only an address that already has ' +
    'one will receive anything, and an address without one is told nothing, ' +
    'so this page cannot be used to discover who has an account. Mail is sent ' +
    'from no-reply@nissartango.fr; if nothing arrives, check spam before ' +
    'asking for another.';
  b.appendChild(note);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    submit.disabled = true;
    submit.textContent = 'Sending…';
    try {
      await requestLink(input.value.trim());
      const s = box('good', 'Check your email.',
        `If ${input.value.trim()} has an account, a link is on its way. It is ` +
        'valid for one hour and can be used once.');
      const n = el('p', null, 'note');
      n.textContent =
        'Open it in THIS browser. The link is completed with a secret stored ' +
        'here and nowhere else, so it cannot be finished on another device — ' +
        'which is also why nothing that merely fetches the link can use it.';
      s.appendChild(n);
    } catch (err) {
      showError('The link could not be requested.', String(err.message));
      const again = el('button', 'Try again');
      again.className = 'btn';
      again.addEventListener('click', () => showForm());
      out().firstChild.appendChild(again);
    }
  });

  input.focus();
}

// --- routing ---------------------------------------------------------------

async function boot() {
  if (!out()) return;

  const query = new URLSearchParams(location.search);
  const frag = new URLSearchParams(location.hash.replace(/^#/, ''));

  // GoTrue can report failure on either side depending on the flow.
  const errCode = query.get('error_code') || frag.get('error_code');
  if (errCode || query.get('error') || frag.get('error')) {
    const pick = (k) => query.get(k) || frag.get(k);
    const b = showError('The link did not sign you in.', null, [
      ['error', pick('error')],
      ['error_code', errCode],
      ['error_description', pick('error_description')],
    ]);
    if (errCode === 'otp_expired') {
      b.appendChild(el('p',
        'otp_expired covers three different things and does not distinguish ' +
        'them: an expired link, an ALREADY-USED link, and a malformed token. ' +
        'Before assuming expiry, check whether a session was created — an ' +
        'implicit-flow link spent by a preloading browser reports exactly this.',
        'note'));
    }
    const again = el('button', 'Request a new link');
    again.className = 'btn';
    again.addEventListener('click', () => { cleanUrl(); showForm(); });
    b.appendChild(again);
    cleanUrl();
    return;
  }

  const code = query.get('code');
  if (code) {
    box('idle', 'Completing sign-in…');
    try {
      const session = await exchangeCode(code);
      cleanUrl();
      return showSession(session, 'pkce');
    } catch (err) {
      cleanUrl();
      const b = showError('The code could not be exchanged.', String(err.message));
      const again = el('button', 'Request a new link');
      again.className = 'btn';
      again.addEventListener('click', () => showForm());
      b.appendChild(again);
      return;
    }
  }

  if (frag.get('access_token')) {
    const session = { access_token: frag.get('access_token'), refresh_token: frag.get('refresh_token') };
    cleanUrl();
    return showSession(session, frag.get('type') || 'implicit');
  }

  if (hasSession()) {
    try {
      // Refreshes a spent access token rather than asking for another link.
      return showSession(await getSession(), 'stored');
    } catch {
      // The refresh token is gone or refused; the form is the honest answer.
    }
  }

  showForm();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
window.addEventListener('hashchange', boot);
