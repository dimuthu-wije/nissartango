// Edit an organizer.
//
// `/organizer/` lists the ones you belong to; `/organizer/?id=<uuid>` edits one.
//
// THERE IS NO CREATE, and that is the database's decision. `authenticated`
// holds no INSERT and no DELETE grant on public.organizers, so even the admin
// policy cannot be exercised from a user token. A "New organizer" button would
// 403 every time it was pressed. Creating one is the dashboard or service_role.
//
// AND NOT EVERY MEMBER MAY SAVE. `organizers_owner_update` requires
// is_owner(id) -- role = 'owner' in organizer_members. An EDITOR can read the
// row and create events for it and cannot change its name. That is a narrower
// permission than the events form needs, so this page asks the database both
// questions (is_owner, is_admin) rather than inferring either from the
// membership list it already has.
//
// THE POINT OF THIS PAGE IS THE TWO PAIRS OF CONTACT FIELDS, and that they are
// not the same thing:
//
//   email / phone                  PRIVATE. Readable by members here, absent
//                                  from organizers_public, never in the build.
//   contact_email / contact_phone  PUBLIC. On the event page, permanently, and
//                                  only with a recorded consent beside them --
//                                  organizers_contact_*_needs_consent refuses
//                                  the value otherwise.
//
// Those columns exist (2026-09-22) because their absence was the cause of the
// leak verify-build.mjs warns about: with nowhere sanctioned to put a phone
// number, it went into an event's free text. A form that made the two pairs
// look alike would recreate the problem in a new place, which is why they are
// separated on screen and labelled by what happens to them rather than by
// which column they are.

import { getSession, hasSession, claimsOf, signOutLocally } from '/auth.js';
import {
  myOrganizers, getOrganizer, updateOrganizer, isAdmin, isOwner, AuthExpired,
} from '/api.js';
import { validateOrganizer } from '/validate.js';
import { consentFor } from '/consent.js';

const out = () => document.querySelector('#out');

const el = (tag, text, cls) => {
  const n = document.createElement(tag);
  if (text != null) n.textContent = text;
  if (cls) n.className = cls;
  return n;
};

const box = (cls, title, detail) => {
  const b = el('div', null, `box ${cls}`);
  if (title) b.appendChild(el('h2', title));
  if (detail) b.appendChild(el('p', detail));
  return b;
};

// --- field construction -----------------------------------------------------

const fields = new Map();

function field(name, labelText, control, { hint, required } = {}) {
  const wrap = el('div', null, 'field');
  const label = el('label', labelText + (required ? ' *' : ''));
  label.setAttribute('for', name);
  control.id = name;
  control.name = name;
  wrap.append(label, control);
  if (hint) wrap.appendChild(el('p', hint, 'hint'));
  const err = el('p', null, 'field-error');
  err.hidden = true;
  wrap.appendChild(err);
  fields.set(name, { control, err, wrap });
  return wrap;
}

const input = (type, attrs = {}) => Object.assign(el('input'), { type, ...attrs });
const val = (n) => fields.get(n).control.value.trim();

function showErrors(problems) {
  for (const { err, wrap } of fields.values()) {
    err.hidden = true; err.textContent = ''; wrap.classList.remove('has-error');
  }
  for (const [name, message] of problems) {
    const f = fields.get(name);
    if (!f) continue;
    f.err.textContent = message;
    f.err.hidden = false;
    f.wrap.classList.add('has-error');
  }
  if (problems.length) fields.get(problems[0][0])?.control.focus();
}

// --- reading the form -------------------------------------------------------

/** Read one contact pair out of the form and into column names. */
function contactPair(kind) {
  const { value, consentAt } = consentFor(
    val(`contact_${kind}`),
    fields.get(`contact_${kind}_consented`).control.checked,
    fields.get(`contact_${kind}`).wasConsentAt ?? null,
  );
  return {
    [`contact_${kind}`]: value,
    [`contact_${kind}_consent_at`]: consentAt,
  };
}

function readForm() {
  return {
    name: val('name'),
    website: val('website') || null,
    instagram: val('instagram') || null,
    facebook: val('facebook') || null,
    tiktok: val('tiktok') || null,
    email: val('email') || null,
    phone: val('phone') || null,
    ...contactPair('email'),
    ...contactPair('phone'),
  };
}

/**
 * The shape validateOrganizer() reads: the RAW typed values, plus the boxes.
 *
 * The contact fields are deliberately re-read from the controls rather than
 * taken from readForm(), and that is not a tidiness point. readForm() has
 * already applied consentFor(), which nulls an unconsented value -- so
 * validating its output asked "is there an unconsented value?" of an object
 * that can never contain one. The answer was always no, the form said "Saved",
 * and what somebody typed was dropped on the floor.
 *
 * Found by filling the field and pressing Save, which is the only way it was
 * ever going to be found: every unit test passes raw values straight to
 * validateOrganizer and so never exercised this wiring.
 */
function forValidation(v) {
  return {
    ...v,
    contact_email: val('contact_email') || null,
    contact_phone: val('contact_phone') || null,
    contact_email_consented: fields.get('contact_email_consented').control.checked,
    contact_phone_consented: fields.get('contact_phone_consented').control.checked,
    contact_email_was_consented: !!fields.get('contact_email').wasConsentAt,
    contact_phone_was_consented: !!fields.get('contact_phone').wasConsentAt,
  };
}

// --- the form ---------------------------------------------------------------

function buildForm(org) {
  const form = el('form', null, 'event-form');
  fields.clear();

  const section = (title, note) => {
    form.appendChild(el('h3', title, 'section'));
    if (note) form.appendChild(el('p', note, 'hint'));
  };

  section('Identity');
  form.appendChild(field('name', 'Name', input('text', { value: org.name ?? '' }),
    { required: true }));

  // Shown, not editable, and the reason is worth one line on screen: `slug` is
  // not in the UPDATE grant, so this is the database's position rather than a
  // UI choice. Every event URL contains it.
  const slug = input('text', { value: org.slug ?? '', disabled: true });
  form.appendChild(field('slug', 'Slug', slug,
    { hint: 'Fixed. It is in every link to this organizer, so it cannot move.' }));

  section('Links',
    'Handles, not addresses. Store "nissartango"; the site builds the link.');
  form.appendChild(field('website', 'Website', input('url', { value: org.website ?? '' }),
    { hint: 'Full address, starting with https://.' }));
  for (const [k, label] of [['instagram', 'Instagram'], ['facebook', 'Facebook'], ['tiktok', 'TikTok']]) {
    form.appendChild(field(k, label, input('text', { value: org[k] ?? '' })));
  }

  section('Private contact — never published',
    'For me to reach you. These are absent from the public view, so they never ' +
    'reach the built site or the repository, whatever a template does.');
  form.appendChild(field('email', 'Email (private)', input('email', { value: org.email ?? '' })));
  form.appendChild(field('phone', 'Phone (private)', input('tel', { value: org.phone ?? '' })));

  section('Public contact — published on every one of your events',
    'These appear on the site as links, and anyone can see them. Leave them ' +
    'blank if you would rather not publish a way to be contacted.');

  for (const [kind, label, type] of [['email', 'Public email', 'email'],
                                     ['phone', 'Public phone', 'tel']]) {
    const name = `contact_${kind}`;
    const f = field(name, label, input(type, { value: org[name] ?? '' }));
    form.appendChild(f);
    // The stamp travels on the field, so readForm can preserve it without a
    // second lookup and without a module-level variable.
    fields.get(name).wasConsentAt = org[`${name}_consent_at`] ?? null;

    const cb = input('checkbox');
    cb.checked = !!org[`${name}_consent_at`];
    const cbWrap = field(`${name}_consented`, 'Publish this, permanently', cb, {
      hint: 'Publishing is not reversible in the way people expect: pages are ' +
            'cached, copied and indexed by others. Removing it here removes it ' +
            'from the site, and not from anywhere it has already been seen.',
    });
    cbWrap.classList.add('field-check', 'consent');
    form.appendChild(cbWrap);
  }

  return form;
}

async function save(org, status, submit) {
  const v = readForm();
  const problems = validateOrganizer(forValidation(v));
  showErrors(problems);
  if (problems.length) {
    status.textContent = `${problems.length} thing(s) to fix.`;
    return;
  }

  submit.disabled = true;
  status.textContent = 'Saving…';
  try {
    const saved = await updateOrganizer(org.id, v);
    if (!saved) {
      // PATCH returning no row means the UPDATE matched nothing, and with
      // return=representation that is what a policy refusal looks like -- not
      // an error. Say what it actually means rather than "saved".
      status.textContent =
        'Nothing was saved: the database did not accept the change. ' +
        'Updating an organizer requires being its owner.';
      return;
    }
    status.textContent = 'Saved.';
    // Re-read what the database stored rather than what was sent: the consent
    // stamp may have just been created, and the next save has to preserve it.
    for (const kind of ['email', 'phone']) {
      fields.get(`contact_${kind}`).wasConsentAt = saved[`contact_${kind}_consent_at`] ?? null;
      fields.get(`contact_${kind}_consented`).control.checked =
        !!saved[`contact_${kind}_consent_at`];
    }
  } catch (err) {
    if (err instanceof AuthExpired) return renderExpired();
    status.textContent = `Refused: ${err.message}`;
  } finally {
    submit.disabled = false;
  }
}

// --- states -----------------------------------------------------------------

function renderSignedOut() {
  const b = box('idle', 'Not signed in.', 'This page needs a session.');
  const a = el('a', 'Sign in');
  a.href = '/';
  b.appendChild(a);
  out().replaceChildren(b);
}

function renderExpired() {
  const b = box('bad', 'Your session has expired.',
    'A refresh was tried and did not work, so signing in again is the only way on.');
  const a = el('a', 'Sign in');
  a.href = '/';
  b.appendChild(a);
  out().replaceChildren(b);
}

function renderList(organizers) {
  const b = box('idle', 'Your organizers',
    'Pick one to edit. Only an owner may save changes; an editor can create ' +
    'events for an organizer without being able to rename it.');
  const ul = el('ul', null, 'list');
  for (const { org, role } of organizers) {
    const li = el('li');
    const a = el('a', org.name);
    a.href = `/organizer/?id=${encodeURIComponent(org.id)}`;
    li.append(a, el('span', ` — ${role}`, 'note'));
    ul.appendChild(li);
  }
  b.appendChild(ul);
  out().replaceChildren(b);
}

// --- boot -------------------------------------------------------------------

async function boot() {
  if (!out()) return;
  if (!hasSession()) return renderSignedOut();
  out().replaceChildren(box('idle', 'Loading…'));

  let session;
  try { session = await getSession(); } catch { return renderExpired(); }

  const id = new URLSearchParams(location.search).get('id');

  try {
    const memberships = await myOrganizers();
    const mine = memberships
      .filter((m) => m.organizers)
      .map((m) => ({ org: m.organizers, role: m.role }))
      .sort((a, b) => a.org.name.localeCompare(b.org.name));

    if (!mine.length) {
      const claims = claimsOf(session.access_token);
      const b = box('bad', 'You are not a member of any organizer.',
        'There is nothing here to edit. Membership is granted in ' +
        'organizer_members, and being an admin does not create one.');
      const dl = el('dl');
      dl.append(el('dt', 'signed in as'), el('dd', claims.email ?? '—'));
      b.appendChild(dl);
      return out().replaceChildren(b);
    }

    if (!id) return renderList(mine);

    // Both questions go to the database. `mine` already carries a role, but an
    // admin may edit an organizer they do not own, and a stale membership row
    // in this page's memory is not the thing the policy consults.
    const [org, admin, owner] = await Promise.all([
      getOrganizer(id), isAdmin(), isOwner(id),
    ]);

    if (!org) {
      return out().replaceChildren(box('bad', 'That organizer is not visible to you.',
        'Either it does not exist, or RLS hides it — the database gives the ' +
        'same answer to both, deliberately.'));
    }

    const mayWrite = owner || admin;
    const wrap = box('idle', `Edit ${org.name}`,
      mayWrite
        ? 'Changes are live as soon as they are saved. Events are not affected.'
        : null);

    const form = buildForm(org);
    const status = el('p', null, 'note');
    const submit = el('button', 'Save changes', 'btn');
    submit.type = 'submit';

    if (!mayWrite) {
      // Disable and SAY WHY. A form that looks writable and 403s on save
      // teaches nothing; this is a membership fact the person can act on.
      submit.disabled = true;
      for (const { control } of fields.values()) control.disabled = true;
      wrap.appendChild(box('bad', 'You can read this, but not change it.',
        'organizers_owner_update requires being an OWNER of this organizer. ' +
        'You are an editor, which lets you create events for it. Ask an owner, ' +
        'or an admin, to change the details themselves.'));
    }

    const actions = el('div', null, 'actions');
    actions.appendChild(submit);
    form.append(actions, status);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (mayWrite) save(org, status, submit);
    });

    wrap.appendChild(form);

    const frag = document.createDocumentFragment();
    frag.appendChild(wrap);
    const back = el('p', null, 'note');
    const a = el('a', '← All your organizers');
    a.href = '/organizer/';
    back.appendChild(a);
    frag.appendChild(back);
    out().replaceChildren(frag);
  } catch (err) {
    if (err instanceof AuthExpired) return renderExpired();
    out().replaceChildren(box('bad', 'The form could not be loaded.', String(err.message)));
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

document.addEventListener('click', (e) => {
  if (e.target?.id === 'signout') { signOutLocally(); location.href = '/'; }
});
