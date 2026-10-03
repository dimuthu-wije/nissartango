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
  requestLink, exchangeCode, getSession, hasSession, claimsOf,
} from '/auth.js';
import '/banner.js';
import { adminOnly } from '/admin-only.js';   // also, on import: the footer link
import '/signout-button.js';   // side effect: names the project when it is not production

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

/**
 * Where a successful sign-in lands.
 *
 * /event/ because that is what somebody clicking a sign-in link came to do.
 * The callback used to stop on a panel of claims -- user id, issued, expires,
 * flow -- which is a maintainer's instrument and a dead end for an organizer:
 * correct, unreadable, and one more click from the work.
 *
 * The panel is not gone. Visiting / with a session still shows it, which is
 * where it belongs: somewhere you go on purpose, not somewhere you are left.
 */
const LANDING = '/event/';

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
  // The queue is the moderator's page. Offering it to somebody who has just
  // signed in as an organizer sends them to a panel explaining that is_admin()
  // answered false, which is true, useless to them, and the first thing they
  // would meet.
  const queue = adminOnly(el('a', 'Ouvrir la file d\'attente', 'btn'));
  queue.href = '/queue/';
  // Primary now rather than quiet: for everyone who is not an admin this is the
  // only button in the row, and a lone secondary button reads as disabled.
  const add = el('a', 'Ajouter un événement', 'btn');
  add.href = '/event/';
  links.append(queue, add);
  b.appendChild(links);

  // id="signout" so signout-button.js picks it up by delegation, like the
  // footer button on every other page -- one code path, not two.
  const signOutBtn = el('button', 'Se déconnecter partout');
  signOutBtn.className = 'btn';
  signOutBtn.id = 'signout';
  signOutBtn.type = 'button';
  b.appendChild(signOutBtn);

  const caveat = el('p', null, 'note');
  // This said sign-out "ne vide que ce navigateur" and that the session was
  // not revoked, which was true until 2026-09-23 and is now backwards. It
  // revokes every session for this account. What it still cannot do is
  // invalidate the access token already issued.
  caveat.textContent =
    'Révoque toutes les sessions de ce compte, pas seulement celle-ci. '
    + "Le jeton d'accès déjà émis reste valable jusqu'à son expiration, une heure "
    + 'au plus : PostgREST vérifie la signature et la date, et ne consulte aucune '
    + 'table de sessions.';
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

    // PLAIN FRENCH FIRST, THE CODES UNDERNEATH.
    //
    // This panel used to lead with `error_code: otp_expired` and an English
    // `error_description`, then explain in developer terms what GoTrue means by
    // it. That is the right content for whoever maintains this and the wrong
    // thing to put in front of an organizer who just wants to sign in: it reads
    // as a crash, and it does not say what to do. The diagnostics are kept --
    // they are what makes a report useful -- but folded away.
    const b = showError('Ce lien n\'a pas fonctionné.');

    if (errCode === 'otp_expired') {
      // Deliberately ordered by how often each one is actually the cause.
      // "Already opened" comes first because a mailbox that visits links before
      // you do consumes a single-use link without anyone noticing, and the
      // message GoTrue returns says "expired" either way.
      b.appendChild(el('p',
        'Les liens de connexion ne servent qu\'une fois et ne durent qu\'une '
        + 'heure. Celui-ci ne peut plus servir — le plus souvent pour une de '
        + 'ces raisons :', 'note'));
      const why = el('ul');
      for (const line of [
        'il a déjà été ouvert — parfois par le filtre de sécurité de votre '
          + 'messagerie, qui visite les liens avant vous ;',
        'il a plus d\'une heure ;',
        'il a été modifié ou coupé en route par votre messagerie.',
      ]) why.appendChild(el('li', line));
      b.appendChild(why);
      b.appendChild(el('p',
        'Demandez-en un nouveau et ouvrez-le dès réception, dans le même '
        + 'navigateur que celui où vous l\'avez demandé.', 'note'));
    } else {
      b.appendChild(el('p',
        'Demandez un nouveau lien. Si cela se reproduit, les détails '
        + 'ci-dessous aident à comprendre pourquoi.', 'note'));
    }

    // Kept, not deleted: when somebody reports that signing in fails, this is
    // the difference between a guess and an answer.
    const details = el('details', null, 'diag');
    details.appendChild(el('summary', 'Détails techniques'));
    rows(details, [
      ['error', pick('error')],
      ['error_code', errCode],
      ['error_description', pick('error_description')],
    ]);
    if (errCode === 'otp_expired') {
      details.appendChild(el('p',
        'otp_expired ne distingue pas trois cas : lien expiré, lien DÉJÀ '
        + 'UTILISÉ, jeton malformé. Le flux PKCE ne crée de session qu\'à '
        + 'l\'échange du code, donc l\'absence de session dans auth.sessions '
        + 'ne permet PAS de conclure qu\'un lien n\'a pas été consommé : un '
        + 'préchargement le consomme sans en créer. Vérifié 2026-10-03.',
        'note'));
    }
    b.appendChild(details);
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
      await exchangeCode(code);
      // replace, NOT assign: this entry's URL carries the code that was just
      // spent. Leaving it in history means Back returns to it, the exchange
      // fails on a consumed code, and the person is shown an error for having
      // pressed Back.
      location.replace(LANDING);
      return;
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

  // Arriving from the sign-out button, which now lands here rather than leaving
  // somebody on a page they are no longer signed into. The confirmation travels
  // in the URL because the message it replaces was worth keeping: sign-out
  // revokes EVERY session of the account, not just this browser's.
  if (query.get('deconnecte') !== null) {
    cleanUrl();
    showForm();
    const done = el('div', null, 'box good');
    done.appendChild(el('h2', 'Vous êtes déconnecté.'));
    done.appendChild(el('p',
      'Toutes les sessions de ce compte ont été fermées, pas seulement celle de '
      + 'ce navigateur.', 'note'));
    out().prepend(done);
    return;
  }

  showForm();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
window.addEventListener('hashchange', boot);
