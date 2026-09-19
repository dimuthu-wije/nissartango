// What a magic link actually delivers, and what this page can honestly say
// about it.
//
// GoTrue redirects to the destination with everything in the URL **fragment**:
//
//     https://editor.nissartango.fr/#access_token=eyJ…&refresh_token=…
//                                    &expires_in=3600&token_type=bearer&type=magiclink
//
// or, when the token was expired, already consumed, or malformed:
//
//     https://editor.nissartango.fr/#error=access_denied
//                                    &error_code=otp_expired
//                                    &error_description=Email+link+is+invalid+or+has+expired
//
// The fragment is never sent to a server -- browsers do not transmit it -- so
// everything here happens in the tab and nothing is logged anywhere.
//
// NO THIRD-PARTY SCRIPT ON THIS PAGE, DELIBERATELY. Any script loaded here can
// read location.hash, which is to say it can read an access token. supabase-js
// from a CDN would be the ordinary choice and is the wrong one for the single
// page in this project that handles a credential. Parsing a fragment and
// base64-decoding a JWT payload needs no library.
//
// WHAT THIS PROVES, AND WHAT IT DOES NOT. Decoding a JWT client-side does not
// verify it: the signature is not checked here and cannot be, because the
// verifying key is not ours to hold. So a green result on this page means the
// token was ISSUED AND DELIVERED to this browser -- which is exactly the thing
// nothing in this project had shown end to end. It does not mean the token is
// valid; PostgREST decides that, on every request, and it is the only opinion
// that counts.

const QS = (s) => document.querySelector(s);

/** Fragment -> plain object. Returns {} when there is no fragment. */
export function readFragment(hash = window.location.hash) {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw) return {};
  const out = {};
  for (const [k, v] of new URLSearchParams(raw)) out[k] = v;
  return out;
}

/**
 * Decode a JWT's payload. base64url, and the payload may contain non-ASCII
 * (an organizer's name in a future claim, say), so it is decoded as UTF-8
 * rather than passed straight out of atob().
 */
export function decodeJwtPayload(jwt) {
  const part = String(jwt).split('.')[1];
  if (!part) throw new Error('not a JWT: no payload segment');
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

const fmt = (secs) =>
  secs ? new Date(secs * 1000).toISOString().replace('T', ' ').replace(/\..*/, 'Z') : '—';

function row(label, value) {
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  dd.textContent = value; // textContent, not innerHTML: this is untrusted input
  return [dt, dd];
}

export function render(into = QS('#out')) {
  const f = readFragment();
  into.replaceChildren();

  const say = (cls, title, detail) => {
    const box = document.createElement('div');
    box.className = `box ${cls}`;
    const h = document.createElement('h2');
    h.textContent = title;
    box.appendChild(h);
    if (detail) {
      const p = document.createElement('p');
      p.textContent = detail;
      box.appendChild(p);
    }
    into.appendChild(box);
    return box;
  };

  // --- nothing at all -------------------------------------------------------
  if (!f.access_token && !f.error && !f.error_code) {
    say(
      'idle',
      'No authentication response in this URL.',
      'This page is the destination a magic link redirects to. Opening it ' +
        'directly is expected to look like this. Request a link, then follow ' +
        'it from the email.',
    );
    return;
  }

  // --- an error came back ---------------------------------------------------
  if (f.error || f.error_code) {
    const box = say('bad', 'The link did not sign you in.');
    const dl = document.createElement('dl');
    for (const k of ['error', 'error_code', 'error_description']) {
      if (f[k]) dl.append(...row(k, f[k]));
    }
    box.appendChild(dl);

    if (f.error_code === 'otp_expired') {
      const p = document.createElement('p');
      p.className = 'note';
      p.textContent =
        'otp_expired covers three different things and does not distinguish ' +
        'them: a link older than its expiry, a link that was already used, ' +
        'and a malformed token. A link opened twice reports the same error as ' +
        'one left overnight — and a mail scanner that follows links will ' +
        'consume it before you ever click.';
      box.appendChild(p);
    }
    clearFragment();
    return;
  }

  // --- a token arrived ------------------------------------------------------
  let claims;
  try {
    claims = decodeJwtPayload(f.access_token);
  } catch (err) {
    const box = say('bad', 'A token arrived but could not be read.', String(err && err.message));
    box.classList.add('bad');
    clearFragment();
    return;
  }

  const box = say('good', 'Signed in — the token reached this browser.');
  const dl = document.createElement('dl');
  dl.append(...row('user id (sub)', claims.sub ?? '—'));
  dl.append(...row('email', claims.email ?? '—'));
  dl.append(...row('role', claims.role ?? '—'));
  dl.append(...row('issued', fmt(claims.iat)));
  dl.append(...row('expires', fmt(claims.exp)));
  dl.append(...row('flow', f.type ?? '—'));
  box.appendChild(dl);

  // The access token itself is deliberately NOT displayed. It is a bearer
  // credential: anything on screen can be photographed, screen-shared, or
  // pasted into a chat, and pasting one has already cost this project a
  // revocation. The claims answer "who signed in"; the token answers nothing a
  // person needs to read.
  const p = document.createElement('p');
  p.className = 'note';
  p.textContent =
    'The access token is not shown, on purpose — it is a bearer credential. ' +
    'These claims are decoded, NOT verified: the signature is not checked here ' +
    'and cannot be. This proves the token was issued and delivered, which is ' +
    'the thing worth proving today. Whether it is valid is PostgREST’s ' +
    'decision, on every request.';
  box.appendChild(p);

  clearFragment();
}

/**
 * Take the credential out of the address bar once it has been read.
 *
 * It stays in memory for this page's lifetime, which is unavoidable, but it
 * should not sit in a URL that gets copied, screenshotted, or restored by a
 * "reopen last tab". replaceState rather than pushState so Back does not walk
 * into the token again.
 */
export function clearFragment() {
  try {
    history.replaceState(null, '', window.location.pathname + window.location.search);
  } catch {
    /* a sandboxed context may refuse; the page still works */
  }
}

// Self-initialising, so neither page needs an inline <script> block. That is
// the whole reason: it lets the CSP in public/_headers say script-src 'self'
// with no 'unsafe-inline' and no inline hash to keep in sync. On the one page
// in this project that receives a bearer credential, a policy that actually
// forbids injected script is worth a little indirection.
function boot() {
  if (QS('#out')) render();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

// A second link must not show the first link's answer.
//
// Found by testing, not by reading: arriving at the same URL with a different
// fragment does NOT reload the document, so `boot()` never ran again and the
// page kept displaying the previous result. Follow one link, then follow
// another, and the second would show the first one's claims -- or worse, show
// "signed in" after a link that had actually failed.
//
// clearFragment() uses replaceState, which deliberately does NOT fire
// hashchange, so clearing the token cannot retrigger this.
window.addEventListener('hashchange', boot);
