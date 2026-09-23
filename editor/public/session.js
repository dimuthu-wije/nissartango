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
import '/banner.js';   // side effect: names the project when it is not production

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
  catch (e) { return showError('Un jeton est arrivé mais n\'a pas pu être lu.', String(e.message)); }

  const b = box('good', 'Connecté.');
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
      ? 'PKCE : le lien portait un code inutilisable sans le vérificateur stocké ' +
        'dans ce navigateur. Tout ce qui aurait chargé le lien avant vous — un ' +
        'navigateur qui précharge, un scanner de courrier — n\'aurait pas pu le ' +
        'finaliser. Le jeton d\'accès n\'est pas affiché : c\'est une information ' +
        'de porteur. Ces revendications sont décodées, PAS vérifiées — c\'est ' +
        'PostgREST qui en décide, à chaque requête.'
      : 'Flux implicite : le lien était lui-même l\'identifiant, donc tout ce qui ' +
        'l\'aurait chargé en premier l\'aurait consommé. C\'est ce qui s\'est passé ' +
        'le 2026-09-19 à 11:13. Préférez le formulaire de connexion de ce site, ' +
        'qui utilise PKCE. Le jeton d\'accès n\'est pas affiché, et ces ' +
        'revendications sont décodées, PAS vérifiées.';
  b.appendChild(note);

  const links = el('div', null, 'actions');
  const queue = el('a', 'Ouvrir la file d\'attente', 'btn');
  queue.href = '/queue/';
  const add = el('a', 'Ajouter un événement', 'btn btn-quiet');
  add.href = '/event/';
  links.append(queue, add);
  b.appendChild(links);

  const signOut = el('button', 'Se déconnecter de ce navigateur');
  signOut.className = 'btn';
  signOut.addEventListener('click', () => { signOutLocally(); location.href = '/'; });
  b.appendChild(signOut);

  const caveat = el('p', null, 'note');
  caveat.textContent =
    'Se déconnecter ne vide que ce navigateur. La session n\'est pas révoquée dans ' +
    'la base, et le jeton de rafraîchissement reste actif jusqu\'à son utilisation ou son expiration.';
  b.appendChild(caveat);
}

function showError(title, detail, extra = []) {
  const b = box('bad', title, detail);
  if (extra.length) rows(b, extra);
  return b;
}

function showForm(message) {
  const b = box('idle', 'Connexion', message || 'Saisissez votre e-mail : un lien de connexion vous sera envoyé.');
  const form = el('form');
  form.className = 'signin';

  const label = el('label', 'E-mail');
  label.setAttribute('for', 'email');
  const input = el('input');
  Object.assign(input, { type: 'email', id: 'email', name: 'email', required: true, autocomplete: 'email' });
  input.placeholder = 'vous@example.org';
  const submit = el('button', 'Envoyez-moi un lien');
  submit.type = 'submit';
  submit.className = 'btn';

  form.append(label, input, submit);
  b.appendChild(form);

  const note = el('p', null, 'note');
  note.textContent =
    'Ce formulaire ne crée aucun compte — seule une adresse qui en possède déjà ' +
    'un recevra quelque chose, et une adresse sans compte ne reçoit aucune ' +
    'indication : cette page ne permet donc pas de découvrir qui a un compte. ' +
    'Les messages partent de no-reply@nissartango.fr ; si rien n\'arrive, ' +
    'vérifiez les indésirables avant d\'en redemander un.';
  b.appendChild(note);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    submit.disabled = true;
    submit.textContent = 'Envoi…';
    try {
      await requestLink(input.value.trim());
      const s = box('good', 'Regardez votre boîte mail.',
        `Si ${input.value.trim()} a un compte, un lien est en route. Il est ` +
        'valable une heure et utilisable une seule fois.');
      const n = el('p', null, 'note');
      n.textContent =
        'Ouvrez-le dans CE navigateur. Le lien se termine avec un secret stocké ' +
        'ici et nulle part ailleurs : il ne peut donc pas être finalisé sur un autre ' +
        'appareil — et c\'est aussi pourquoi rien qui se contente de charger le lien ne peut s\'en servir.';
      s.appendChild(n);
    } catch (err) {
      showError('Le lien n\'a pas pu être demandé.', String(err.message));
      const again = el('button', 'Réessayer');
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
    const b = showError('Le lien ne vous a pas connecté.', null, [
      ['error', pick('error')],
      ['error_code', errCode],
      ['error_description', pick('error_description')],
    ]);
    if (errCode === 'otp_expired') {
      b.appendChild(el('p',
        'otp_expired recouvre trois cas différents sans les distinguer : un lien ' +
        'expiré, un lien DÉJÀ UTILISÉ, et un jeton malformé. Avant de conclure à ' +
        'une expiration, vérifiez si une session a été créée — un lien en flux ' +
        'implicite consommé par un navigateur qui préchargeait signale exactement ceci.',
        'note'));
    }
    const again = el('button', 'Demander un nouveau lien');
    again.className = 'btn';
    again.addEventListener('click', () => { cleanUrl(); showForm(); });
    b.appendChild(again);
    cleanUrl();
    return;
  }

  const code = query.get('code');
  if (code) {
    box('idle', 'Finalisation de la connexion…');
    try {
      const session = await exchangeCode(code);
      cleanUrl();
      return showSession(session, 'pkce');
    } catch (err) {
      cleanUrl();
      const b = showError('Le code n\'a pas pu être échangé.', String(err.message));
      const again = el('button', 'Demander un nouveau lien');
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
