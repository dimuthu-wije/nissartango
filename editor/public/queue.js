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

import { getSession, hasSession, signOutLocally, claimsOf } from '/auth.js';
import {
  isAdmin, reviewQueue, recentlyDecided, approve, reject, markReviewed, AuthExpired,
} from '/api.js';

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
  tags.appendChild(el('span', ev.status, `tag tag-${ev.status}`));
  if (ev.needs_review) tags.appendChild(el('span', 'needs review', 'tag tag-flag'));
  tags.appendChild(el('span', ev.type, 'tag'));
  head.appendChild(tags);
  c.appendChild(head);

  const dl = el('dl');
  const row = (k, v) => { dl.appendChild(el('dt', k)); dl.appendChild(el('dd', v ?? '—')); };
  row('when', when(ev.starts_at));
  // A null organizer means RLS hid the row, not that the event has none --
  // organizer_id is NOT NULL. Saying "(not visible to you)" keeps those apart.
  row('organizer', ev.organizers?.name ?? '(not visible to you)');
  row('where', [ev.location_name, ev.city].filter(Boolean).join(', ') || '—');
  row('slug', ev.slug);
  if (ev.review_note) row('note', ev.review_note);
  c.appendChild(dl);

  const noteInput = el('input');
  Object.assign(noteInput, { type: 'text', placeholder: 'Reason (required to reject)' });
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
      status.textContent = `Failed: ${err.message}`;
      actions.querySelectorAll('button').forEach((b) => { b.disabled = false; });
    }
  };

  if (ev.status !== 'approved') {
    actions.appendChild(button('Approve', 'btn', () =>
      run(() => approve(ev.id, noteInput.value), 'Approving…')));
  }
  if (ev.status !== 'rejected') {
    actions.appendChild(button('Reject', 'btn btn-quiet', () => {
      if (!noteInput.value.trim()) {
        // The function refuses a blank reason anyway. Saying so here avoids a
        // round trip that returns an error the person could have been told
        // about before they clicked.
        status.textContent = 'A rejection needs a reason — the database refuses a blank one.';
        noteInput.focus();
        return;
      }
      return run(() => reject(ev.id, noteInput.value), 'Rejecting…');
    }));
  }
  if (ev.needs_review) {
    actions.appendChild(button('Mark reviewed', 'btn btn-quiet', () =>
      run(() => markReviewed(ev.id), 'Clearing the flag…')));
  }

  c.append(actions, status);
  return c;
}

// --- views -----------------------------------------------------------------

function renderExpired() {
  const b = box('bad', 'Your session has expired.',
    'Access tokens last an hour. Sign in again to carry on.');
  const a = el('a', 'Go to sign-in');
  a.href = '/';
  a.className = 'btn';
  b.appendChild(a);
  out().replaceChildren(b);
}

function renderSignedOut() {
  const b = box('idle', 'Not signed in.',
    'The approval queue is only visible to an administrator.');
  const a = el('a', 'Sign in');
  a.href = '/';
  a.className = 'btn';
  b.appendChild(a);
  out().replaceChildren(b);
}

function renderNotAdmin(claims) {
  // Signed in and refused is a different state from signed out, and telling
  // someone to "sign in" here would send them round a loop that cannot help.
  const b = box('bad', 'You are signed in, but not an administrator.',
    'is_admin() returned false for this account. That is the database\'s answer, ' +
    'not this page\'s guess — an admin needs a row in user_roles.');
  const dl = el('dl');
  dl.append(el('dt', 'signed in as'), el('dd', claims.email ?? '—'));
  dl.append(el('dt', 'user id'), el('dd', claims.sub ?? '—'));
  b.appendChild(dl);
  out().replaceChildren(b);
}

async function render() {
  const [queue, decided] = await Promise.all([reviewQueue(), recentlyDecided()]);
  const frag = document.createDocumentFragment();

  if (!queue.length) {
    // "Nothing waiting" -- said plainly, because an empty queue and a broken
    // one look identical if you only print the items you found.
    frag.appendChild(box('good', 'Nothing is waiting.',
      'No event has status "pending" and none is flagged for review. The query ' +
      'ran and returned zero rows — this is not an error.'));
  } else {
    const h = box('idle', `${queue.length} waiting`,
      'Pending events, and anything flagged for a second look.');
    frag.appendChild(h);
    for (const ev of queue) frag.appendChild(card(ev, render));
  }

  if (decided.length) {
    const b = box('idle', 'Recently decided',
      'So a wrong decision is visible rather than gone. Approve or reject again to change one.');
    const ul = el('ul', null, 'decided');
    for (const d of decided) {
      const li = el('li');
      li.append(el('span', d.status, `tag tag-${d.status}`), el('span', ` ${d.title}`));
      if (d.review_note) li.appendChild(el('span', ` — ${d.review_note}`, 'muted'));
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

  out().replaceChildren(box('idle', 'Loading…'));
  // getSession refreshes if the access token is spent, so coming back to this
  // page tomorrow reloads the queue rather than showing a sign-in form.
  let session;
  try { session = await getSession(); } catch { return renderExpired(); }
  try {
    if (!(await isAdmin())) return renderNotAdmin(claimsOf(session.access_token));
    await render();
  } catch (err) {
    if (err instanceof AuthExpired) return renderExpired();
    const b = box('bad', 'The queue could not be loaded.', String(err.message));
    b.appendChild(button('Retry', 'btn', boot));
    out().replaceChildren(b);
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

document.addEventListener('click', (e) => {
  if (e.target?.id === 'signout') { signOutLocally(); location.href = '/'; }
});
