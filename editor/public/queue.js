// The approval queue.
//
// Everything here was built and tested months ago and had never been opened:
// user_roles and organizer_members were empty on production until 2026-09-19,
// so is_admin() returned false for everyone and every admin policy was
// unreachable. Production still holds four events, all approved, and no
// `pending` or `rejected` row has ever existed. The transitions below have run
// in tests and nowhere else.
//
// So this page is written to be honest about an empty queue rather than to
// look busy: "nothing is waiting" and "you cannot see anything" are completely
// different states and must never render the same way.

import { getSession, hasSession, claimsOf } from '/auth.js';
import {
  isAdmin, reviewQueue, recentlyDecided, allEvents,
  approve, reject, markReviewed, AuthExpired,
} from '/api.js';
import '/banner.js';
import '/signout-button.js';   // side effect: names the project when it is not production

const out = () => document.querySelector('#out');

const el = (tag, text, cls) => {
  const n = document.createElement(tag);
  if (text != null) n.textContent = text;   // textContent everywhere: this is user-entered data
  if (cls) n.className = cls;
  return n;
};

const box = (cls, title, detail) => {
  const b = el('div', null, `box ${cls}`);
  if (title) b.appendChild(el('h2', title));
  if (detail) b.appendChild(el('p', detail));
  return b;
};

// Database enum values, shown in French.
//
// The VALUE is never translated -- `ev.status` is what approve_event and
// reject_event write and what events_public filters on, and the tag's class
// still keys off the raw value. Only the word on screen changes. Fallback is
// the raw value, so a status added to the enum and not to this map shows
// something true rather than nothing.
const STATUS_LABELS = {
  pending: 'en attente', approved: 'approuvé', rejected: 'rejeté',
};

// Same list as src/lib/content.ts TYPE_LABELS. Duplicated rather than imported
// because the editor is a separate static deployment with no build step -- the
// same reason zone.js is a copy, and with far less at stake: a stale label
// reads oddly, it does not compute a wrong time.
const TYPE_LABELS = {
  cours: 'Cours', practica: 'Practica', milonga: 'Milonga',
  stage: 'Stage', demo: 'Démonstration', festival: 'Festival',
};

const dtf = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'full', timeStyle: 'short', timeZone: 'Europe/Paris',
});
const when = (iso) => (iso ? dtf.format(new Date(iso)) : '—');

function button(label, cls, onClick) {
  const b = el('button', label, cls);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

// --- one row ---------------------------------------------------------------

function card(ev, refresh) {
  const c = el('article', null, 'card');

  const head = el('div', null, 'card-head');
  head.appendChild(el('h3', ev.title));
  const tags = el('div', null, 'tags');
  tags.appendChild(el('span', STATUS_LABELS[ev.status] ?? ev.status, `tag tag-${ev.status}`));
  if (ev.needs_review) tags.appendChild(el('span', 'à revoir', 'tag tag-flag'));
  tags.appendChild(el('span', TYPE_LABELS[ev.type] ?? ev.type, 'tag'));
  head.appendChild(tags);
  c.appendChild(head);

  const dl = el('dl');
  const row = (k, v) => { dl.appendChild(el('dt', k)); dl.appendChild(el('dd', v ?? '—')); };
  row('quand', when(ev.starts_at));
  // A null organizer means RLS hid the row, not that the event has none --
  // organizer_id is NOT NULL. Saying "(not visible to you)" keeps those apart.
  row('organisateur', ev.organizers?.name ?? '(non visible pour vous)');
  row('où', [ev.location_name, ev.city].filter(Boolean).join(', ') || '—');
  row('identifiant', ev.slug);
  if (ev.review_note) row('note', ev.review_note);
  c.appendChild(dl);

  const noteInput = el('input');
  Object.assign(noteInput, { type: 'text', placeholder: 'Motif (obligatoire pour rejeter)' });
  noteInput.className = 'note-input';
  c.appendChild(noteInput);

  const actions = el('div', null, 'actions');
  const status = el('p', null, 'note');

  const run = async (fn, working) => {
    actions.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    status.textContent = working;
    try {
      await fn();
      await refresh();
    } catch (err) {
      if (err instanceof AuthExpired) return renderExpired();
      status.textContent = `Échec : ${err.message}`;
      actions.querySelectorAll('button').forEach((b) => { b.disabled = false; });
    }
  };

  if (ev.status !== 'approved') {
    actions.appendChild(button('Approuver', 'btn', () =>
      run(() => approve(ev.id, noteInput.value), 'Approbation…')));
  }
  if (ev.status !== 'rejected') {
    actions.appendChild(button('Rejeter', 'btn btn-quiet', () => {
      if (!noteInput.value.trim()) {
        // The function refuses a blank reason anyway. Saying so here avoids a
        // round trip that returns an error the person could have been told
        // about before they clicked.
        status.textContent = 'Un rejet exige un motif : la base refuse un motif vide.';
        noteInput.focus();
        return;
      }
      return run(() => reject(ev.id, noteInput.value), 'Rejet…');
    }));
  }
  if (ev.needs_review) {
    actions.appendChild(button('Marquer comme revu', 'btn btn-quiet', () =>
      run(() => markReviewed(ev.id), 'Retrait du drapeau…')));
  }

  // Edit is a link, not a button: it navigates, and a person may reasonably
  // want it in a new tab while keeping the queue open.
  const edit = el('a', 'Modifier', 'btn btn-quiet');
  edit.href = `/event/?id=${encodeURIComponent(ev.id)}`;
  actions.appendChild(edit);

  c.append(actions, status);
  return c;
}

// --- views -----------------------------------------------------------------

function renderExpired() {
  const b = box('bad', 'Votre session a expiré.',
    'Les jetons d\'accès durent une heure. Reconnectez-vous pour continuer.');
  const a = el('a', 'Aller à la connexion');
  a.href = '/';
  a.className = 'btn';
  b.appendChild(a);
  out().replaceChildren(b);
}

function renderSignedOut() {
  const b = box('idle', 'Non connecté.',
    'La file d\'attente n\'est visible que par un administrateur.');
  const a = el('a', 'Se connecter');
  a.href = '/';
  a.className = 'btn';
  b.appendChild(a);
  out().replaceChildren(b);
}

function renderNotAdmin(claims) {
  // Signed in and refused is a different state from signed out, and telling
  // someone to "sign in" here would send them round a loop that cannot help.
  const b = box('bad', 'Vous êtes connecté, mais pas administrateur.',
    'is_admin() a répondu false pour ce compte. C\'est la réponse de la base, ' +
    'pas une supposition de cette page : un administrateur a besoin d\'une ligne dans user_roles.');
  const dl = el('dl');
  dl.append(el('dt', 'connecté en tant que'), el('dd', claims.email ?? '—'));
  dl.append(el('dt', 'identifiant utilisateur'), el('dd', claims.sub ?? '—'));
  b.appendChild(dl);
  out().replaceChildren(b);
}

async function render() {
  const [queue, decided, all] = await Promise.all([
    reviewQueue(), recentlyDecided(), allEvents(),
  ]);
  const frag = document.createDocumentFragment();

  const top = el('div', null, 'actions');
  const add = el('a', 'Nouvel événement', 'btn');
  add.href = '/event/';
  top.appendChild(add);
  frag.appendChild(top);

  if (!queue.length) {
    // "Nothing waiting" -- said plainly, because an empty queue and a broken
    // one look identical if you only print the items you found.
    frag.appendChild(box('good', 'Rien en attente.',
      'Aucun événement n\'a le statut « pending » et aucun n\'est signalé à revoir. ' +
      'La requête a bien été exécutée et a renvoyé zéro ligne : ce n\'est pas une erreur.'));
  } else {
    const h = box('idle', `${queue.length} en attente`,
      'Événements en attente, et tout ce qui est signalé pour un second regard.');
    frag.appendChild(h);
    for (const ev of queue) frag.appendChild(card(ev, render));
  }

  if (decided.length) {
    const b = box('idle', 'Décisions récentes',
      'Pour qu\'une mauvaise décision reste visible plutôt que perdue. Approuvez ou rejetez à nouveau pour la changer.');
    const ul = el('ul', null, 'decided');
    for (const d of decided) {
      const li = el('li');
      // STATUS_LABELS, not the raw enum: this list printed "approved" and
      // "rejected" in English while every other tag on the page was French.
      li.append(el('span', STATUS_LABELS[d.status] ?? d.status, `tag tag-${d.status}`),
                el('span', ` ${d.title}`));
      if (d.review_note) li.appendChild(el('span', ` — ${d.review_note}`, 'muted'));
      const edit = el('a', 'Modifier', 'linkish');
      edit.href = `/event/?id=${encodeURIComponent(d.id)}`;
      li.append(el('span', ' '), edit);
      ul.appendChild(li);
    }
    b.appendChild(ul);
    frag.appendChild(b);
  }

  // Everything, because the two lists above are "waiting" and "the last five
  // decisions" -- an event approved a week ago appeared in neither, and the
  // only route to its edit form was knowing its uuid.
  if (all.length) {
    const b = box('idle', `Tous les événements (${all.length})`,
      'Pour modifier un événement déjà approuvé — y compris pour lui ajouter une affiche.');
    const ul = el('ul', null, 'decided');
    for (const ev of all) {
      const li = el('li');
      li.append(el('span', STATUS_LABELS[ev.status] ?? ev.status, `tag tag-${ev.status}`));
      if (ev.needs_review) li.appendChild(el('span', 'à revoir', 'tag tag-flag'));
      li.appendChild(el('span', ` ${when(ev.starts_at)} — ${ev.title}`));
      const edit = el('a', 'Modifier', 'linkish');
      edit.href = `/event/?id=${encodeURIComponent(ev.id)}`;
      li.append(el('span', ' '), edit);
      ul.appendChild(li);
    }
    b.appendChild(ul);
    frag.appendChild(b);
  }

  out().replaceChildren(frag);
}

async function boot() {
  if (!out()) return;
  if (!hasSession()) return renderSignedOut();

  out().replaceChildren(box('idle', 'Chargement…'));
  // getSession refreshes if the access token is spent, so coming back to this
  // page tomorrow reloads the queue rather than showing a sign-in form.
  let session;
  try { session = await getSession(); } catch { return renderExpired(); }
  try {
    if (!(await isAdmin())) return renderNotAdmin(claimsOf(session.access_token));
    await render();
  } catch (err) {
    if (err instanceof AuthExpired) return renderExpired();
    const b = box('bad', 'La file d\'attente n\'a pas pu être chargée.', String(err.message));
    b.appendChild(button('Réessayer', 'btn', boot));
    out().replaceChildren(b);
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
