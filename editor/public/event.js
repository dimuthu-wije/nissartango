// Create and edit an event.
//
// `/event/` creates, `/event/?id=<uuid>` edits. One form for both, because the
// writable column set is identical — 21 columns, granted at column level, so
// `status`, `slug`, `review_note` and `needs_review` are not expressible here
// no matter what this file does.
//
// WHAT THIS FORM CANNOT DO, and should not pretend to: publish. The insert
// policy is
//
//     is_member(organizer_id) AND status = 'pending' AND created_by = auth.uid()
//
// so every event created here arrives PENDING, the maintainer's own included.
// The queue is what publishes. That is why there is no "publish" control and
// no status field — not because they were left out, but because the database
// would refuse them.
//
// VALIDATION LIVES IN validate.js, with the constraint names it mirrors
// written beside each rule. It is not the enforcement and must never be
// mistaken for it — it exists so a person is told before a round trip. If it
// and the database ever disagree, the database is right.

import { getSession, hasSession, claimsOf, signOutLocally } from '/auth.js';
import {
  myOrganizers, getEvent, createEvent, updateEvent, AuthExpired,
} from '/api.js';
import { zonedToInstant, partsInZone } from '/zone.js';
import { validate } from '/validate.js';

const TYPES = ['cours', 'practica', 'milonga', 'stage', 'demo', 'festival'];
const RECURRENCES = ['none', 'weekly', 'biweekly', 'monthly'];

// A short list, not every zone the database accepts. `events_validate` checks
// against pg_timezone_names, so anything here is valid; the point of a short
// list is that a typo is impossible rather than caught. Buenos Aires because
// this is a tango site and a stage abroad is plausible.
const TIMEZONES = [
  'Europe/Paris', 'Europe/London', 'Europe/Madrid', 'Europe/Rome',
  'Europe/Berlin', 'Europe/Lisbon', 'America/Argentina/Buenos_Aires', 'UTC',
];

const out = () => document.querySelector('#out');
const pad = (n) => String(n).padStart(2, '0');

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

// --- wall clock <-> instant -------------------------------------------------
//
// `<input type="datetime-local">` speaks naive wall-clock time with no zone.
// The database stores an absolute instant. Converting between them is the one
// genuinely easy thing to get wrong here, which is why zone.js is a verbatim
// copy of the tested original rather than something written again.

/** "2027-01-15T20:00" in `tz`  ->  ISO instant for the database. */
function inputToInstant(value, tz) {
  if (!value) return null;
  const [d, t = '00:00'] = value.split('T');
  const [year, month, day] = d.split('-').map(Number);
  const [hour, minute] = t.split(':').map(Number);
  return zonedToInstant({ year, month, day, hour, minute }, tz).toISOString();
}

/** An instant from the database  ->  "2027-01-15T20:00" as read in `tz`. */
function instantToInput(iso, tz) {
  if (!iso) return '';
  const p = partsInZone(new Date(iso), tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** The calendar date of an instant in `tz` — what recurrence_end compares to. */
function instantToDate(iso, tz) {
  if (!iso) return '';
  const p = partsInZone(new Date(iso), tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

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

function selectOf(options, value) {
  const s = el('select');
  for (const o of options) {
    const opt = el('option', o.label ?? o);
    opt.value = o.value ?? o;
    if ((o.value ?? o) === value) opt.selected = true;
    s.appendChild(opt);
  }
  return s;
}

const val = (n) => fields.get(n).control.value.trim();
const num = (n) => (val(n) === '' ? null : Number(val(n)));

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

function readForm() {
  const tz = val('timezone');
  const startsLocal = fields.get('starts_at').control.value;
  const cancelledLocal = fields.get('cancelled_at').control.value;
  const startsIso = inputToInstant(startsLocal, tz);
  return {
    organizer_id: val('organizer_id'),
    title: val('title'),
    type: val('type'),
    timezone: tz,
    starts_at_local: startsLocal,
    starts_at_date: startsIso ? instantToDate(startsIso, tz) : '',
    starts_at: startsIso,
    duration_minutes: num('duration_minutes'),
    recurrence: val('recurrence'),
    recurrence_end: val('recurrence_end') || null,
    location_name: val('location_name') || null,
    location_address: val('location_address') || null,
    location_postal_code: val('location_postal_code') || null,
    city: val('city'),
    // Split on commas, drop blanks. `teachers` is NOT NULL with a '{}' default,
    // so an empty field must send [] and never null.
    teachers: val('teachers').split(',').map((s) => s.trim()).filter(Boolean),
    price_full: num('price_full'),
    price_member: num('price_member'),
    price_note: val('price_note') || null,
    signup_url: val('signup_url') || null,
    image_path: val('image_path') || null,
    body: fields.get('body').control.value.trim() || null,
    cancelled_at_local: cancelledLocal,
    cancelled_at: inputToInstant(cancelledLocal, tz),
    cancellation_note: val('cancellation_note') || null,
  };
}

/** Only the columns the database will accept. */
function payload(v) {
  const { starts_at_local, starts_at_date, cancelled_at_local, ...rest } = v;
  return rest;
}

// --- the page ---------------------------------------------------------------

function buildForm(organizers, existing) {
  const tz = existing?.timezone ?? 'Europe/Paris';
  const form = el('form', null, 'event-form');
  fields.clear();

  const section = (title) => {
    form.appendChild(el('h3', title, 'section'));
  };

  section('What and who');
  form.appendChild(field('organizer_id', 'Organizer',
    selectOf(organizers.map((o) => ({ value: o.id, label: o.name })), existing?.organizer_id),
    { required: true, hint: organizers.length === 1
      ? 'The only organizer you may create events for.'
      : 'Only organizers you are a member of are listed — the database refuses the rest.' }));
  form.appendChild(field('title', 'Title',
    input('text', { value: existing?.title ?? '', maxLength: 200 }), { required: true }));
  form.appendChild(field('type', 'Type', selectOf(TYPES, existing?.type ?? 'milonga'),
    { required: true }));

  section('When');
  form.appendChild(field('starts_at', 'Starts',
    input('datetime-local', { value: instantToInput(existing?.starts_at, tz) }),
    { required: true, hint: 'Wall-clock time in the timezone below.' }));
  form.appendChild(field('timezone', 'Timezone',
    selectOf(TIMEZONES.includes(tz) ? TIMEZONES : [tz, ...TIMEZONES], tz),
    { required: true }));
  form.appendChild(field('duration_minutes', 'Duration (minutes)',
    input('number', { value: existing?.duration_minutes ?? '', min: 1, max: 10080, step: 1 }),
    { hint: 'Optional. A series has one shape and many occurrences, so there is no end time.' }));
  form.appendChild(field('recurrence', 'Repeats',
    selectOf(RECURRENCES, existing?.recurrence ?? 'none')));
  form.appendChild(field('recurrence_end', 'Repeats until',
    input('date', { value: existing?.recurrence_end ?? '' }),
    { hint: 'Only for a repeating event, and not before the first one.' }));

  section('Where');
  form.appendChild(field('location_name', 'Venue',
    input('text', { value: existing?.location_name ?? '' })));
  form.appendChild(field('location_address', 'Address',
    input('text', { value: existing?.location_address ?? '' })));
  form.appendChild(field('location_postal_code', 'Postal code',
    input('text', { value: existing?.location_postal_code ?? '', inputMode: 'numeric', maxLength: 5 }),
    { hint: 'Five digits.' }));
  form.appendChild(field('city', 'City',
    input('text', { value: existing?.city ?? 'Nice' }), { required: true }));

  section('Details');
  form.appendChild(field('teachers', 'Teachers',
    input('text', { value: (existing?.teachers ?? []).join(', ') }),
    { hint: 'Separated by commas.' }));
  form.appendChild(field('price_full', 'Price',
    input('number', { value: existing?.price_full ?? '', min: 0, step: '0.01' })));
  form.appendChild(field('price_member', 'Price, members',
    input('number', { value: existing?.price_member ?? '', min: 0, step: '0.01' })));
  form.appendChild(field('price_note', 'Price note',
    input('text', { value: existing?.price_note ?? '' }),
    { hint: 'For what a number cannot say — "participation libre".' }));
  form.appendChild(field('signup_url', 'Signup link',
    input('url', { value: existing?.signup_url ?? '' }), { hint: 'http:// or https://' }));
  form.appendChild(field('image_path', 'Image path',
    input('text', { value: existing?.image_path ?? '' }),
    { hint: 'A path in Supabase Storage. Nothing serves these yet — see AGENTS.md.' }));
  const body = el('textarea');
  body.rows = 5;
  body.value = existing?.body ?? '';
  form.appendChild(field('body', 'Description', body));

  section('Cancellation');
  form.appendChild(field('cancelled_at', 'Cancelled at',
    input('datetime-local', { value: instantToInput(existing?.cancelled_at, tz) }),
    { hint: 'A cancelled event stays published and keeps its page — that is deliberate.' }));
  form.appendChild(field('cancellation_note', 'Why',
    input('text', { value: existing?.cancellation_note ?? '' }),
    { hint: 'Needs a cancellation date beside it.' }));

  // Recurrence end only makes sense for a series. Disabled rather than hidden,
  // so the rule is visible instead of the control mysteriously not existing.
  const rec = fields.get('recurrence').control;
  const recEnd = fields.get('recurrence_end').control;
  const syncRecurrence = () => {
    recEnd.disabled = rec.value === 'none';
    if (recEnd.disabled) recEnd.value = '';
  };
  rec.addEventListener('change', syncRecurrence);
  syncRecurrence();

  return form;
}

async function save(existing, statusEl, submitEl) {
  const v = readForm();
  const problems = validate(v);
  showErrors(problems);
  if (problems.length) {
    statusEl.textContent = `${problems.length} thing${problems.length > 1 ? 's' : ''} to fix.`;
    return;
  }

  submitEl.disabled = true;
  statusEl.textContent = existing ? 'Saving…' : 'Creating…';
  try {
    const row = existing
      ? await updateEvent(existing.id, payload(v))
      : await createEvent(payload(v));
    renderSaved(row, !existing);
  } catch (err) {
    if (err instanceof AuthExpired) return renderExpired();
    submitEl.disabled = false;
    // The database's own words. A CHECK constraint or a trigger naming the
    // rule is more useful than anything this page could paraphrase.
    statusEl.textContent = `Refused: ${err.message}`;
  }
}

function renderSaved(row, created) {
  const b = box('good', created ? 'Created.' : 'Saved.');
  const dl = el('dl');
  const add = (k, v2) => { dl.append(el('dt', k), el('dd', String(v2 ?? '—'))); };
  add('title', row?.title);
  add('slug', row?.slug);
  add('status', row?.status);
  add('needs review', row?.needs_review ? 'yes' : 'no');
  b.appendChild(dl);

  b.appendChild(el('p',
    created
      ? 'Created as PENDING — the insert policy allows nothing else, for anyone. ' +
        'It is not on the site until it is approved in the queue.'
      : row?.status === 'approved' && row?.needs_review
        ? 'Still published, and flagged for review: editing a live event does not ' +
          'take it off the site, it puts it in the queue.'
        : 'Saved.',
    'note'));

  const queue = el('a', 'Open the queue');
  queue.href = '/queue/';
  queue.className = 'btn';
  const again = el('a', 'Add another');
  again.href = '/event/';
  again.className = 'btn btn-quiet';
  const row2 = el('div', null, 'actions');
  row2.append(queue, again);
  b.appendChild(row2);

  out().replaceChildren(b);
}

function renderExpired() {
  const b = box('bad', 'Your session has expired.', 'Sign in again to carry on.');
  const a = el('a', 'Go to sign-in'); a.href = '/'; a.className = 'btn';
  b.appendChild(a);
  out().replaceChildren(b);
}

function renderSignedOut() {
  const b = box('idle', 'Not signed in.', 'Only a member of an organizer may add events.');
  const a = el('a', 'Sign in'); a.href = '/'; a.className = 'btn';
  b.appendChild(a);
  out().replaceChildren(b);
}

async function boot() {
  if (!out()) return;
  if (!hasSession()) return renderSignedOut();
  out().replaceChildren(box('idle', 'Loading…'));

  let session;
  try { session = await getSession(); } catch { return renderExpired(); }

  const id = new URLSearchParams(location.search).get('id');

  try {
    const [memberships, existing] = await Promise.all([
      myOrganizers(),
      id ? getEvent(id) : Promise.resolve(null),
    ]);

    const organizers = memberships
      .map((m) => m.organizers)
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));

    if (!organizers.length) {
      // Signed in and a member of nothing. Say exactly that: it is a
      // membership problem, and signing in again cannot fix it.
      const claims = claimsOf(session.access_token);
      const b = box('bad', 'You are not a member of any organizer.',
        'Creating an event requires is_member(organizer_id), and being an admin ' +
        'does not substitute for it — there is no admin insert policy.');
      const dl = el('dl');
      dl.append(el('dt', 'signed in as'), el('dd', claims.email ?? '—'));
      b.appendChild(dl);
      return out().replaceChildren(b);
    }

    if (id && !existing) {
      return out().replaceChildren(box('bad', 'That event is not visible to you.',
        'Either it does not exist, or RLS hides it — those are the same answer ' +
        'from the database, deliberately, so this page cannot be used to probe ' +
        'which events exist.'));
    }

    const wrap = box('idle', existing ? 'Edit event' : 'New event',
      existing
        ? 'Changes to a published event keep it live and put it in the queue.'
        : 'Created as pending. The queue is what publishes it.');

    const form = buildForm(organizers, existing);
    const status = el('p', null, 'note');
    const submit = el('button', existing ? 'Save changes' : 'Create event', 'btn');
    submit.type = 'submit';
    const actions = el('div', null, 'actions');
    actions.appendChild(submit);
    form.append(actions, status);

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      save(existing, status, submit);
    });

    wrap.appendChild(form);
    out().replaceChildren(wrap);
  } catch (err) {
    if (err instanceof AuthExpired) return renderExpired();
    const b = box('bad', 'The form could not be loaded.', String(err.message));
    out().replaceChildren(b);
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

document.addEventListener('click', (e) => {
  if (e.target?.id === 'signout') { signOutLocally(); location.href = '/'; }
});
